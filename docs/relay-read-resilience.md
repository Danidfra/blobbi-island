# Relay Read Resilience

Status: **implemented.** Player state now survives an uncertain relay. The Mine
durable-session / end-of-run energy settlement is deliberately NOT part of this
phase: see [`mine-session-settlement-audit.md`](mine-session-settlement-audit.md).

---

## 1. Why `NPool.query()`'s empty result is insufficient

`NPool.query()`: the API every read in this app went through, **never
throws**. Its own documentation says so:

> *"If the signal is aborted, this method will return partial results instead of
> throwing."*

and the implementation ends in a bare `catch { }`. A timeout, a dead socket, a
refused subscription and a genuinely empty relay therefore all produce the same
value: `[]`.

That single collapse produced the whole reported failure:

```
known player with 1 Blobbi
→ background refetch hits an unreachable relay
→ NPool.query resolves []                      (no error anywhere)
→ useBlobbis records [] as success
→ cache goes 1 pet → 0 pets                    (good state ERASED)
→ BlobbiIsland routes playing → selection
→ PlayingView / MiningGame unmounts            (session lost, energy spent,
                                                no Coin reward)
→ "Your nest is empty. You don't have a Blobbi yet."
```

A *thrown* error would have been safe: React Query keeps the previous `data`
behind an error: but the pool never threw, so that path was unreachable.

## 2. The new read-completion semantics

`src/lib/relay-read.ts` is built on **`NRelay.req()`**, the lower-level Nostrify
API `query()` is implemented with. It yields raw NIP-01 messages, and `NPool`
only forwards `EOSE`/`CLOSED` once every routed relay has sent them:

| Observed | Outcome |
|---|---|
| `EVENT…` then `EOSE` | `answered` |
| `EOSE` with no events | `answered` with `events: []`: **the only confirmed empty** |
| our deadline elapses first | `unknown('timeout')` |
| caller's signal aborts | `unknown('aborted')` |
| `CLOSED` before `EOSE` | `unknown('closed')` |
| iteration throws, or ends without `EOSE` | `unknown('unreachable')` |

The timeout is owned by the wrapper, never delegated to the pool, because the
pool erases the distinction. `Machina` (the pool's message queue) throws
`AbortError` on abort and `NPool.req` propagates it, so a truncated read is
observable.

**Partial reads are `unknown`, not partial results.** If events arrived and then
the deadline elapsed, `partialCount` records how many, but the outcome is
`unknown`: "3 of your 5 Blobbis" is a worse lie than "we don't know yet".

### What this deliberately does NOT claim

It cannot prove a relay holds every relevant event. `EOSE` means "this relay has
sent everything it intends to send for this REQ"; a relay that lost an event, or
was never asked, still EOSEs. The narrower question it answers is the one that
was actually being got wrong:

> did this read finish in a state we are willing to treat as usable, or did our
> own timeout / transport uncertainty make the result unusable?

### API

```ts
readRelay(nostr, filters, opts)              → RelayReadOutcome     (never throws)
readRelayEventsOrThrow(nostr, filters, opts) → NostrEvent[]         (throws on unknown)
readRelayConfirmed(nostr, filters, opts)     → RelayReadOutcome     (confirmed-empty)
readRelayConfirmedOrThrow(...)               → NostrEvent[]
```

`RelayReadUnknownError` carries `reason` and `partialCount`. Its message is a
stable vocabulary, `relay-read-timeout`, `relay-read-closed`,
`relay-read-aborted`, `relay-read-unreachable`: for logs and tests. **Product
UI never renders it**: the UI only needs "we know there are none" versus "we
could not establish the state".

`req` is optional on the reader interface purely so the many existing test fakes
that expose only `query` keep working; production always has it. Without `req`
the wrapper falls back to the old, weaker "a resolved call is an answer"
assumption. `supportsCompletionAwareReads()` exposes which path is in use.

## 3. Confirmed-empty policy

For state whose false absence is destructive, one empty answer is not a fact:

```
answered non-empty              → accept (ONE read)
answered empty → read again
     second answered empty      → CONFIRMED empty
     second answered non-empty  → accept the non-empty answer
     second unknown             → unknown (NOT empty)
unknown                         → unknown
```

Bounded to exactly two reads, no loop, no backoff, no sleep, and only the
empty branch pays the second round-trip, so the common case costs nothing.

**Where it is applied, and why:**

| Reader | Why confirmation is justified |
|---|---|
| `useBlobbis` (`['blobbis']`) | decides whether the player owns any Blobbi at all; a false empty ejects them from the world and shows the destructive empty-nest copy |
| `useBlobbonautProfile` (`['blobbonaut-profile']`) | holds `current_companion`; losing it routes an active player to the selection screen even with the pet list intact |
| `useOptimizedStatus` (`['owner-profile']`, `['pet-states']`) | `currentPet` becomes null and every HUD surface that reads it breaks |
| `readAuthoritativeInventoryBase` (kind:31633) | a replaceable-event publish base; an empty base does not lose a delta, it erases the entire inventory |
| `useIslandInventory` (kind:31633 display) | a false empty renders a Coin balance of `0`, which reads as "my money is gone" |

Everything else keeps a single read. This is not a repo-wide rewrite.

## 4. Stale-known-data policy

The invariant: **known-good state is never downgraded by doubt.**

- Critical query functions **throw** on unknown instead of resolving `[]`/`null`,
  so React Query retains the last successful `data` behind `error`.
- The selection screen keeps rendering the pet cards when a refetch fails, with
  a quiet `Reconnecting…` note. It does *not* swap the collection for an error
  screen: that would be the same destructive downgrade in friendlier clothes.
- The error screen ("The nest is hiding") is only for **nothing known + read
  unusable**.
- `"You don't have a Blobbi yet."` renders only from a **confirmed** empty list
  (`Array.isArray(blobbis) && !hasBlobbis && !isReadUnusable`). `undefined`,
  never successfully read: is explicitly not an empty nest.

## 5. Player routing invariant

`nextGameState(current, inputs)` in `src/pages/blobbi-island-state.ts` is a
pure function, so the invariant is tested behaviourally rather than by reading
the component's source:

```
while playing:
  loading             → playing        (background refetch)
  read unusable       → playing        (UNKNOWN never ejects)
  nothing read yet    → playing
  CONFIRMED empty []  → selection
  known list, no selectable companion → selection

before the world:
  unchanged: route to the selection screen, which renders its own
  loading / unknown / confirmed-empty states honestly
```

**Companion preservation.** `BlobbiIsland` remembers the last companion it
actually resolved and re-selects *that same Blobbi* while the profile read is
unresolved, provided it is still present in the known pet list. It never picks a
different Blobbi. (`useOptimizedStatus`'s `allPets[0]` fallback is for a player
who has never chosen a companion, not for covering an unresolved read; with
profile retention that case is no longer reachable from a relay failure.)

## 6. Inventory publish-base invariant

Unchanged in intent, now actually true:

```
unknown         → never a publish base (throws)
confirmed empty → a valid first-write base
```

The `a1036e9` implementation assumed `nostr.query` rejects on timeout. It does
not, so the guarantee was only as strong as "two consecutive timeouts are
unlikely". It now rests on EOSE. Everything else from `a1036e9` is untouched:
cross-tab serialization, the shared per-tab chain, monotonic `created_at`, the
lossless builder, the Coin op ledger's exactly-once semantics, the Ticket
writers' error contracts, and strict publish.

## 7. Reconnect and timeout review

- **`refetchOnReconnect`** remains at its default (`true`). It was a *symptom
  amplifier*, not a cause: a reconnect burst was dangerous only because each
  read could fabricate an empty result. Now a burst against not-yet-ready relays
  produces `unknown`, which is retained-and-quiet. Disabling it without evidence
  would trade a fixed problem for a staleness problem.
- **Timeouts are unchanged** (2 s for `useBlobbis`, 3 s for profile/status/
  inventory). They were never the bug, misclassifying them was. Raising them
  would only slow down the honest "unknown" signal. Mobile resume is worth
  re-measuring against real relays before adjusting; there is no evidence yet
  that justifies a change.

## 8. Still-vulnerable readers (follow-up, not this phase)

Ranked by consequence:

1. **`useFirstEggAdoption`** (`src/hooks/useFirstEggAdoption.ts`): reads the
   owner profile as a **merge base for a republish**. A false empty would build
   a fresh profile and drop existing fields. Same class as the inventory base.
   Left alone here because adoption's *expected* case genuinely is an absent
   profile, so the change needs its own tests.
2. **`fetchInventory`** (the non-confirming kind:31633 read): still used by
   `useUseItem`'s ownership guard and `useEquipmentMutation`. A false empty
   blocks a legitimate action ("Not enough X"), which is annoying but not
   destructive.
3. **`usePlacementState`** (kind:31634): a false empty makes equipped cosmetics
   briefly disappear. Presentation only.
4. **`PlayingView`** single-Blobbi read, `MultiplayerLayer`, `useSharedPlayback`,
   `useAuthor`, `useLoggedInAccounts`: presence, social
   and metadata reads where a transient empty is self-correcting.

## 9. Remaining Mine work (next phase)

This phase removes the *failure*; it does not change how the Mine spends energy.
One session still performs 8 kind:31124 publishes and 32 invalidations. What
changed is the refetch storm and the consequences of a bad read:

| Metric | Before | After |
|---|---|---|
| `refreshFromRelay` calls | 11 | **1** |
| relay reads from those | 22 | **2** |
| total relay reads / session | ~38 | **18** |
| kind:31124 publishes | 8 | 8 *(next phase)* |
| an unlucky read can wipe the nest | **yes** | **no** |

Still to do, in the settlement phase: a durable Mine session record, local
energy during play, an end-of-run energy delta settled against a fresh
kind:31124 read, and hardening the kind:31124 writer (fresh base, serialization,
monotonic `created_at`, strict publish) the way kind:31633 already is.
