# Family activation readiness

**Status:** the safety boundaries are hardened. Family is still deliberately
unreachable, and this phase did not make it selectable.

Two things happened here: a production regression in Blobbi adoption was fixed,
and the local safety boundaries were corrected so that a future activation phase
does not inherit them.

- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Player controls: [`player-safety-controls.md`](./player-safety-controls.md)

---

## Part 0 — the adoption publish regression

### What a player saw

```
[HatchingCeremony] Adoption publish failed:
AggregateError: All promises were rejected
```

The ceremony never completed, so a new player could not adopt a Blobbi at all.

### Where the error came from

`AggregateError: All promises were rejected` is `Promise.any` with nothing to
resolve. It comes from `NPool.event`, which fans an event out to the relays its
`eventRouter` returns and resolves as soon as ONE accepts. Island's router
returns exactly one URL — "only publish to the selected relay for faster
publishing" — so the aggregate contained a single rejection: **the one
configured relay did not accept the event inside the timeout.**

The failure is transport, not schema. Checked, in order:

| Question | Answer |
|---|---|
| Is the event structurally valid? | Yes — kind 31124, one `d`, one `name`, all required state tags, plain string values, a `client` tag added by the writer |
| Does the relay require NIP-42 AUTH? | No — it answers `EVENT` directly, with an `OK … false "invalid: signature verification failed"` for a deliberately bogus event |
| Does it accept the game's kinds? | Yes — a read-only probe found stored 31124, 11125, 31633, 31950 and 36767 events |
| Was the relay reachable? | Yes, and slow: ~1.6 s to first message on a good connection |

So the event was fine and the relay was up. What was not fine is what the
adoption path did about a relay that did not answer quickly enough.

### What was actually wrong, and is now fixed

**No retry, on a budget that included the handshake.** One `AbortSignal.timeout(5000)`
covered opening the socket, publishing and waiting for the relay's `OK`, and a
single failure ended the ceremony. It is now **three attempts of one signed
event**, 8 s for the first (it may pay for a cold socket) and 5 s after.

Signing is deliberately outside the retry. A signer that refuses is a decision —
a dismissed extension prompt, a dead bunker — and retrying it would re-prompt
the player. The same signed event goes back out each time, so a retry that lands
after a silent success is a duplicate the relay collapses, not a second Blobbi.

**A profile read that could not fail, and therefore lied.** `NPool.query()`
returns `[]` for a timeout, a dead socket and a genuinely new player alike. The
adoption read used it, and the result is the base the FINAL profile is built on:
an unanswered read looked like "this player has no profile", and the event
published a moment later carried a `has[]` containing only the new Blobbi.
**Every previously adopted Blobbi would have been dropped from the ownership
list by a slow relay.** That is worse than the reported bug and was found while
looking for it.

It now uses `readRelayConfirmedOrThrow` — the repo's existing rule for state
whose false absence is destructive: an empty answer is read twice before it is
believed, and an unusable one throws. Adoption fails and the player retries,
which is the correct outcome.

**An error nobody could act on.** The pool's `AggregateError` is now caught and
re-thrown as `AdoptionPublishError`, which names WHICH write failed and keeps
the cause for diagnostics. The ceremony maps it to *"We couldn't save your
Blobbi yet. Check your connection and try again."* — never "saved", because the
writer rejects unless a relay actually accepted.

### Partial success and retry

```
  nothing accepted            → nothing published, nothing to reconcile, retry
  baby accepted, profile not  → the baby is live and unreferenced; a retry
                                re-reads the profile and republishes the SAME
                                addressable coordinate, so the ownership list
                                gains it exactly once
  duplicate submit            → one run, shared by both callers
```

The baby is published first and the profile only if it succeeded, so there is no
ordering in which a profile references a Blobbi that does not exist. Both events
are addressable/replaceable, so a retry replaces rather than accumulates — no
migration and no dedupe record is needed.

### The double console line

`[HatchingCeremony] Adoption publish failed` appeared twice. The underlying
adoption runs **once**: `finalizeInFlightRef` returns the same promise to a
second caller, and a test asserts three publish attempts for one event rather
than six. Two lines mean two SUBMITS sharing one run — each caller catches, so
each logs — and the most ordinary way to get two submits is the retry button
after the first failure, which is exactly what the copy invites. The guard is
intact; the logging is honest.

### Was it caused by a recent phase?

**No.** Phase F added the name admission ahead of the read, F.1 and G did not
touch this path, and F.2 did not touch relay configuration. The single-relay
`eventRouter` and the flat 5 s timeout both predate the roadmap; the default
relay was last changed in September 2025. The regression is a latent fragility
meeting a slow relay, not a code change.

### Recommended, not done

`eventRouter` returns one relay for every publish in the app. Fanning adoption
out to the other configured preset would remove the single point of failure, and
`NPool.event` already accepts an explicit relay list — but publishing a player's
data to a relay they did not choose is a real decision, and `relaySelection` is
a capability precisely because "a different relay is a different population". It
belongs in a phase that decides that, gated on the capability.

---

## Part A — safety resolution

### Before

`IslandSafetyPolicyContext` defaulted to `STANDARD_POLICY`. A missing provider
and a deliberately chosen Standard were **the same state**, and neither the
island nor any consumer could tell them apart.

### After: three states

```
  unprovided   no provider above this subtree. A BUG, not a profile.
  resolving    a provider is mounted and has not decided yet.
  resolved     a profile was chosen deliberately, and its policy is here.
```

`unprovided` is distinct from `resolving` on purpose: a missing provider will
not fix itself, and waiting for it would hide the wiring mistake.

The shipped path resolves `standard` **explicitly, on the first render** — the
profile is still a literal, so nothing waits and production mounts exactly as it
always has. What changed is that it says so.

### The world does not mount unresolved

`SafetyGate` renders the island only under `resolved`. It wraps the whole
`BlobbiIsland` page, not just the world, because the pieces around it are not
inert: the location provider decides where presence will be published, the shell
mounts the chrome that opens the theater and the photo booth, and the economy
notice is already reading.

That is the enforcement. Rather than making every button in the app require a
provider to render — which would have broken 390 unit tests that render one
component in isolation, and tested harnesses rather than subjects — the
permissive fallback survives but can no longer reach anything that matters:

- it is **reported** (`noteMissingSafetyProvider`, logged once, counted for
  tests);
- and the island **cannot mount on it at all**.

### No pre-resolution network effect

Proven by the gate rather than one boundary at a time: presence publication, the
chat subscription, the Blossom uploader, the kind 1 share, theater sessions and
the adoption writer all mount inside the island, so the proof is that the island
does not mount. Tests hold that under `resolving` and under `unprovided`, and
assert the world mounts on the very first render under the shipped path.

---

## Part B/C — account scope

### Before

One browser-wide key each:

```
  blobbi:safety:relationships:v1
  blobbi:safety:reports:v1
```

Two people sharing a laptop shared one mute list, one block list and one pile of
reports. The child's blocks applied to the parent's island; the parent could
read every report the child had filed. Neither asked for it and neither could
see it.

### After

Keyed by the account whose decisions they are:

```
  blobbi:safety:relationships:v1:<pubkey>
  blobbi:safety:reports:v1:<pubkey>
```

`account-scope.ts` owns the answer for both stores, and `PlayerSafetyAccountSync`
points it at the signed-in user with a layout effect — the stores are read
during render by components below it, and a passive effect would leave the first
of those renders answering with the previous account's list.

Switching account drops the parsed cache and wakes every subscriber, so a world
left mounted re-prunes: nobody stays hidden because the previous player hid them.

**Signed out keeps nothing.** An in-memory store, never persisted and dropped on
account change — because the obvious implementation of a signed-out bucket hands
it to the first account that signs in, which is the leak being closed. Nothing is
lost: the island requires an account, so a signed-out player has nobody to block.
A malformed pubkey is treated as signed out rather than used as a key.

Scoping changes where a decision is written, not whether it leaves the device.
Nothing publishes.

### Parser and version rules

| Input | Relationships | Reports |
|---|---|---|
| unknown version (`v: 2`) | empty store | empty list |
| missing version | read as v1 — the shape that shipped first | bare array read as v1 |
| malformed JSON | empty | empty |
| wrong types | entry dropped | entry dropped |
| invalid pubkey | entry dropped | record dropped |
| oversized array | capped before parsing | capped before parsing |
| duplicate pubkeys | one entry per key | dedupe, see below |

A version tag was written from the start and never read. Reading a v2 record with
v1 rules is how a block quietly becomes a mute; an unknown version now yields an
empty store, which is visibly wrong and recoverable rather than subtly wrong.

### Self-actions

`setPlayerMuted`, `setPlayerBlocked` and `buildPlayerReport` all refuse when the
target is the signed-in account, at the DATA boundary. The card that offers these
buttons only ever opens on somebody else, so the only route here is a direct
call — and blocking your own account would delete your own Blobbi from your own
island with a Settings row as the only clue.

### Capacity

Unchanged and already correct: at `MAX_TRACKED_PLAYERS`, only mute-only entries
are evicted, oldest first, and the store is allowed past the cap rather than drop
a block.

---

## Part C — report evidence

### Before

`evidence.sourceEvent` was the **whole signed event, verbatim** — content, every
tag, the signature — attached automatically whenever the report dialog opened on
a player who had recently spoken.

### After

Five fields, reduced at the builder so the raw event never reaches storage:

```
  eventId        a POINTER a future reviewer could resolve against a relay
  authorPubkey   already checked to be the reported player
  createdAt      when they said it
  messageClass   text | quick | template | emote
  renderedText   what this build put on screen, capped
```

`content`, `tags` and `sig` are gone. Their absence is the point: that was an
attacker-controlled blob written to a child's device because they asked for help,
and almost none of it was ever read — **nothing in this build verifies a
signature, and there is no reviewer to verify one for.** The documentation no
longer claims otherwise.

**Attaching a message is now a choice.** The dialog shows the last thing the
player said with an unticked checkbox. Opening a card is not a decision about a
message, and a rendered message is the only unbounded, attacker-authored string a
report can hold.

### Retention and dedupe

Capped at `MAX_STORED_REPORTS`, oldest first. A complaint with the same reporter,
target, category and evidence inside a minute is the same complaint — a
double-tap, a retry, a dialog that did not visibly close. Dedupe is deliberately
NOT keyed on the report id, because a retry mints a new one. A different category
or a different message still gets through, and the same complaint an hour later
is a new one.

---

## Part D — persistence outcomes are truthful

Both writers read back what they wrote: `setItem` can throw, and in hardened
environments it can silently do nothing. "It did not throw" is not "it is
stored", and here the difference is whether a player who pressed Block is
protected after a reload.

Report-and-block attempts the two independently and says what happened:

```
  both succeed         → close
  block ok, save fails → "They're blocked, but we couldn't save the report…"
  save ok, block fails → "Report saved, but we couldn't block them…"
  both fail            → "We couldn't save that report on this device…"
```

Blocking is the action that actually protects the player, so it is never skipped
because the report could not be saved.

**Copy says what is true.** "Save report" and "Save and block", never "Send" —
nothing leaves the device, and a child who reads "Sent" reasonably believes
somebody is now looking.

---

## Remaining blockers before Family can be selectable

1. **Nothing reads a stored profile yet.** `ACTIVE_EXPERIENCE_PROFILE` is a
   literal. The provider is the one place that grows a read, and `SafetyGate` is
   already waiting on it — but the read, its storage, and its validation do not
   exist.
2. **The fallback must never downgrade.** A device whose guardian chose Family
   and whose storage read fails must not become Standard. Today's fallback is
   Standard, which is correct only while Standard is the only profile.
3. **No selector, no guardian control, no PIN.** Out of scope here by
   instruction, and the whole of the next phase.
4. **The permissive context default still exists.** Reported and unreachable by
   the island, but it should become a throw once the test suite has a provider
   where it needs one.
5. **The theater catalog is empty**, so a curated experience can gather and not
   watch.
6. **Stranger-authored names are permitted in Family** by decision (Phase F.1),
   pending the social identity model.
7. **Reports have no destination**, and the copy says so.
