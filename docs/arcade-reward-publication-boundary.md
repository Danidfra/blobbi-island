# Publish-reliability boundary for the arcade reward hook

**Status: IMPLEMENTED in Phase 3.** This document was written as analysis, and
the strategy it recommended in §3 is what shipped. It is kept as the reasoning
record; §5 states what was actually built and where the code lives.

The original framing, "analysis only, nothing grants tickets, the Phase 1
balance is strictly read-only": was true when it was written and is no longer
true. `useArcadeReward` grants Arcade Tickets, and it does so exactly as
described below.

The audit (`docs/arcade-audit.md` §16.2) flagged the shared publish primitive as
the highest-severity obstacle to a trustworthy reward loop. This document
confirms the exact behaviour, states the boundary the reward hook must sit
behind, and picks the smallest correct fix, without changing the primitive now.

---

## 1. Confirmed current behaviour

`src/hooks/useNostrPublish.ts`, lines 30–50:

```ts
try {
  await nostr.event(event, { signal: AbortSignal.timeout(5000) });
} catch (error) {
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    // Timeout errors are common with relays - treat as partial success
    console.warn('Event publish timed out but may have succeeded on some relays:', error);
    // falls through
  } else {
    if (event.kind === 31950) { return { ...event, id: 'temp-' + Date.now() }; }
    throw error;
  }
}
return event;
```

Three distinct outcomes, precisely:

| Outcome | Result |
| --- | --- |
| At least one relay accepts | resolves, genuinely published |
| **5 s timeout / abort** | **resolves**: a `console.warn`, then treated as success |
| All relays reject (non-timeout) | throws, except kind:31950, which resolves with a synthetic id |

The middle row is the problem. `NPool.event` rejects only when *every* relay
fails, so a timeout means "no relay confirmed within 5 s": which includes "no
relay ever received it".

This leniency is correct for what it was tuned for: presence heartbeats and
movement, where a dropped event is re-sent 25 seconds later and nothing is lost.
It is wrong for a one-shot grant of a scarce resource.

### The exact failure the reward hook would produce

`useInventoryMutation` applies an optimistic cache update in `onMutate`, awaits
`publish(template)`, and invalidates the canonical key in `onSettled`. So:

1. player finishes a run, is awarded 8 tickets;
2. `onMutate` writes +8 into the cache, the UI shows 8 tickets;
3. `publish` times out and **resolves as success**;
4. `onError` never runs, so there is no rollback and no error toast;
5. `onSettled` invalidates and refetches; the relay returns the *old* inventory;
6. the 8 tickets silently disappear.

The player is shown a reward, then has it taken away, and at no point is anything
reported as having failed. `useFirstEggAdoption` already hit exactly this class of
bug and worked around it with a local `strictPublish` helper, precedent that
this is a real failure mode, not a theoretical one.

---

## 2. The boundary the reward hook must sit behind

> **A ticket grant may only be marked `claimed` once the new quantity has been
> confirmed to exist on a relay. A resolved `publish()` is not confirmation.**

Concretely, `useArcadeReward` must:

1. **Mint `runId` before publishing.** Persist `{runId, award, status: 'pending'}`
   to `localStorage` *before* the write, so a refresh mid-claim is recoverable.
2. **Never treat a resolved publish as proof.** Either publish strictly (a
   timeout is an error) or read back and compare quantities.
3. **Surface failure honestly.** "Couldn't save your tickets, retry" beats a
   number that evaporates. Retry reuses the same `runId`.
4. **Be idempotent on `runId`.** A `runId` already in the persisted claimed set is
   a no-op, so double-clicks, StrictMode double-invocations and retries after a
   *successful-but-unconfirmed* publish cannot double-grant.
5. **Stay out of the game.** The game produces a result; only this hook writes.

> **⚠️ CORRECTED: see §6.** The original text here read: "Point 4 is what makes
> point 2 safe: with idempotency, the expensive failure mode of a strict publish
> (retrying something that actually succeeded) costs nothing." **That is false.**
> The `runId` is not carried in kind:31633, the grant is additive, and re-reading
> the balance does not make a retry idempotent. It produced a real duplicate
> grant. §6 has the correction.

---

## 3. Smallest correct solution for the reward phase

**Recommended: a local strict publish inside the reward hook, plus a
verify-after-write read. Do not change `useNostrPublish`.**

```
useArcadeReward
  ├── persist pending claim (localStorage, keyed by runId)
  ├── strictPublish(31633 template)      ← timeout/abort = ERROR, not success
  ├── verify: re-read 31633, assert the ticket quantity advanced by the award
  ├── mark claimed (localStorage) + reconcile the cache
  └── on failure → keep `pending`, show retry (same runId)
```

Why this shape:

- **Scoped.** `useNostrPublish` is used by presence, chat, playback, profile,
  Blobbi state and inventory. Tightening it globally would turn every relay hiccup
  into a user-visible error across the whole app, and would need compatibility
  proof for each caller, far more risk than the reward phase needs to take on.
- **Precedented.** `useFirstEggAdoption` already does exactly this locally, so the
  pattern is established in this codebase rather than invented for the arcade.
- **Verification closes the last gap.** Strict publishing removes "timeout read as
  success"; the read-back removes "accepted by a relay that then dropped it". The
  two together are what let the UI claim the tickets are real.
- **Cheap.** The read is one filtered query for one addressable event, on a path
  that runs once per completed run.

### What this still cannot fix

- **Read-after-write is not guaranteed by Nostr.** A verification read may miss a
  genuinely-published event, producing a false failure. ~~Idempotency on `runId`
  makes the retry harmless~~, **corrected in §6: there is no retry.** Such an
  attempt becomes `ambiguous` and is resolved by a read-only reconciliation, never
  by publishing again.
- **Cross-instance races.** kind:31633 is replaceable and newest-wins; two tabs
  can still clobber one another (documented in `docs/INVENTORY_ARCHITECTURE.md`).
  A shared `localStorage` claimed-set limits the damage to the same browser.
- **Client-authored scores.** Out of scope here and unfixable client-side.

### Rejected alternatives

| Option | Why not |
| --- | --- |
| Change `useNostrPublish` globally now | Highest blast radius, touches every kind, and this phase has no reward code to justify it. Worth revisiting once the reward hook proves the pattern. |
| Add a `strict: true` option to `useNostrPublish` | Reasonable eventually, but it is still an edit to the shared primitive for a caller that does not exist yet. Ship the local helper first, then extract if a second caller appears. |
| Trust the optimistic cache and skip verification | This is the current behaviour, and it is the bug. |
| Retry blindly on timeout without idempotency | Turns one unconfirmed grant into several confirmed ones. |

---

## 4. Status at the end of Phase 2

- No change made to `src/hooks/useNostrPublish.ts` in this phase.
- No ticket-grant logic exists.
- The Phase 1 ticket balance is read-only: it renders a quantity from a query and
  publishes nothing.

---

## 5. What Phase 3 actually built

The recommendation in §3 shipped unchanged. `src/hooks/useNostrPublish.ts` is
**still not modified**.

| §2 requirement | Where it lives |
| --- | --- |
| 1. Mint `runId` and persist the claim before publishing | `DanceMachine` mints it; `createPendingClaim` + `src/lib/arcade-claim-ledger.ts` persist it before the first read |
| 2. Never treat a resolved publish as proof | `src/inventory/arcade-reward-writer.ts`: a local strict publish; a timeout REJECTS |
| 3. Surface failure honestly | `useArcadeReward` distinguishes `failed` (provably nothing was written, retryable) from `unresolved` (it may have been, reconciliation only); `DanceResults` renders both, with different copy and different buttons |
| 4. Be idempotent on `runId` | a synchronous module-level lock, a cross-tab lock, and a `localStorage` ledger keyed by `(pubkey, runId)` in which four statuses block a new grant; see §6, because the FIRST version of this got it wrong |
| 5. Stay out of the game | `src/arcade/boundaries.test.ts` proves no module under `src/arcade/` can reach a relay or an inventory |

Verification is a read-back of the newest kind:31633 taken **before** and
**after** the write; `advanceClaim` reaches `claimed` only when
`after − before === award`.

---

## 6. CORRECTION: an ambiguous retry is NOT safe

**A manual test produced a duplicate grant: a 3-ticket reward was added twice,
resulting in 6 tickets.** The regression is covered by
`src/hooks/useArcadeReward.test.tsx` →
**`REGRESSION: the observed 3 → 6 duplicate grant`**.

### What this document got wrong

§2 point 4 said idempotency on `runId` "is what makes point 2 safe: with
idempotency, the expensive failure mode of a strict publish (retrying something
that actually succeeded) costs nothing." §3 repeated it: "Idempotency on `runId`
makes the retry harmless."

**That was false**, and the first version of the reward hook inherited it. The
`runId` is not carried in kind:31633, the event is a list of item addresses and
quantities and nothing else, so no relay and no read can associate a balance
with a run. "Idempotency on `runId`" existed only as a *local claimed-set*, and
the claimed set was only written on a CONFIRMED success. An unconfirmed attempt
left no blocking record at all.

Worse, the grant is **additive**. Re-reading the freshest inventory before each
write prevents stale-state clobbering; it does nothing for idempotency:

```
balance 10 · reward 3
attempt 1: read 10 → publish +3 → balance 13
           verification read is a beat behind and still says 10
           → "verify-mismatch" → recorded as `failed` → retryable
           → UI offers "Try again"
attempt 2: read 13 → publish +3 → balance 16
```

Both attempts were individually correct. The player got 6.

### What changed

| before | after |
| --- | --- |
| `verify-mismatch` / `verify-unavailable` / `publish-timeout` → status `failed` | → status **`ambiguous`** |
| `failed` was retryable | `ambiguous` is **never** republishable |
| UI: "Try again" | UI: **"Check ticket status"**, read-only |
| only a `claimed` record blocked a new grant | `claimed`, `publishing`, `verifying` **and** `ambiguous` all block |
| unknown publish errors → `publish-rejected` (retryable) | → `verify-unavailable` (unresolved) |
| the ledger write was best-effort | a read-back-verified durable record is a **prerequisite for publishing** |
| the baseline read could fail and the publish continued | a failed baseline read **cancels the publish**: with no baseline nothing can ever be reconciled |
| cross-tab exclusion was claimed but not implemented | Web Locks, or a verified `localStorage` lease, around the whole operation |

### Reconciliation replaces retry

An unresolved claim's only action is a **read-only** reconciliation. It re-reads
the inventory and compares it against the baseline recorded before the attempt:

- `now >= baseline + award` → **confirmed**. `>=` rather than `===` because an
  unrelated grant landing in between can only push the number up, and erring
  toward confirming can only ever cost a payment that was owed; never pay one
  twice.
- anything else → **stays unresolved**, attempt counted, nothing published.

There is deliberately no branch that republishes. If the read cannot prove the
grant landed, it also cannot prove it did not.

### Retryable versus reconciliation-only

Only failures that provably happened **before** the event could reach a relay
are retryable: `invalid-claim`, `lock-unavailable`, `ledger-unavailable`,
`baseline-unavailable`, `sign-failed`, and `publish-rejected` from a writer that
can prove it. Everything else, including anything unrecognised, is unresolved.

### Why "all relays rejected" is not retryable

Read from the client, not inferred: `NPool.event` is
`await Promise.any(relays.map(r => r.event(...)))`, which rejects with an
`AggregateError` only when every relay's promise rejects and surfaces no
per-relay OK/failure breakdown. `NRelay1.event` throws a plain `Error(reason)`
when a relay answers `OK false`: and an indistinguishable plain `Error` when the
socket dies after the `EVENT` frame was written, in which case the relay may well
have stored it. There is no way with this contract to tell a definitive rejection
from an unknown outcome, so the unknown outcome wins.

The cost is a claim that stays unresolved when the player was simply offline. The
alternative cost is paying a scarce reward twice.

### Still unfixable

Read-after-write is not guaranteed by Nostr; kind:31633 is replaceable so two
tabs can still clobber one another; a client-authored score cannot be verified
client-side. Exact scope of what the fix does and does not protect:
`docs/blobbi-dance.md` §8.

## 7. Arcade V1: all three dedicated games pay, and the client is trusted

Blobbi Dance, Air Hockey and Pool each carry an `active` reward policy
(`dance/dance-reward.ts`, `hockey/hockey-reward.ts`, `pool/pool-reward.ts`), the
catalogue says `grantsTickets: true` for all three, and every results screen
offers the same claim through the same machinery.

### The trust model, stated plainly

**This is a deliberately client-trusted economy, and it must be treated as
one.** The client computes the game result, the client prices it with a local
policy, and the client writes the tickets directly into the player's own
kind:31633 inventory. A modified client can therefore mint tickets at will.
That is accepted for Arcade V1 so the reward loop could ship as a player
experience first; it means **no leaderboard, scarce economy, payment or
real-world value may trust an Arcade Ticket balance yet**.

The exactly-once machinery documented above (§5–§6) is protection against
APPLICATION BUGS: double-clicks, Strict Mode, remounts, ambiguous publishes,
not against a determined attacker. It keeps an honest client from paying a run
twice; it cannot keep a dishonest one from paying itself.

### The seam a trusted flow replaces

The pipeline is arranged so the future grant-backed flow swaps ONE piece:

```
ArcadeGameResult → reward policy → ArcadeRewardCalculation
      → useArcadeRewardController → useArcadeReward → ArcadeRewardWriter → kind:31633
```

`ArcadeRewardWriter` is an interface. Today its one production implementation
(`createArcadeTicketWriter`) publishes the inventory event itself; a
grant-backed writer: result submitted to a reward authority, a signed grant
coming back, the balance derived from grants, replaces that implementation
behind the same interface. Game physics, match reducers, result contracts,
policies and the claim lifecycle do not change.

### The shared economy (policies v1)

All three policies are `flat`, capped at **8 tickets per run**, pay the shared
participation floor of **2** for a completed loss, and pay **0** for an
abandoned run (an aborted run produces no result at all). Pinned by
`reward-economy.test.ts`:

| scenario | Dance (~68 s) | Air Hockey (~3 min) | Pool (~4 min) |
| --- | --- | --- | --- |
| weak completion / loss | 2 | 2 | 2 |
| average clear / Normal win | 4 (80%) | 6 (7–5) | 7 (legal 8, one foul) |
| strong Normal win | 6 (96%) | 7 (7–3) | 7 (clean, rival's early 8) |
| best realistic run | 8 (96% + full combo) | 8 (7–0 shutout) | 8 (clean legal 8) |

Not parity: dance is shorter and pays a little more per minute, pool takes
longer and pays a little less, but the same test asserts no game's typical
tickets-per-minute exceeds another's by more than 2.5×, so no single machine is
the obvious farm.

### The visible balance

`ArcadeTicketBalance` shows the kind:31633 balance in the arcade HUD
(`PlayingView`, arcade locations only, with `showZero`: a genuine zero, a
loading read and an unavailable read each render distinctly), and the shared
`ArcadeRewardPanel` repeats it on every results screen, where it updates after a
confirmed claim. The **Prize Counter** (V1) now spends tickets through the
mirror-image spend boundary: see
[`arcade-prize-counter.md`](./arcade-prize-counter.md).
