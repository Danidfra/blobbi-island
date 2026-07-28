# Publish-reliability boundary for the future arcade reward hook

**Analysis only.** Nothing in this document is implemented yet, and nothing in
this phase grants tickets. The Arcade Ticket balance shipped in Phase 1 is
strictly read-only, so no reward publication can occur.

The audit (`docs/arcade-audit.md` §16.2) flagged the shared publish primitive as
the highest-severity obstacle to a trustworthy reward loop. This document
confirms the exact behaviour, states the boundary the reward hook must sit
behind, and picks the smallest correct fix — without changing the primitive now.

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
| At least one relay accepts | resolves — genuinely published |
| **5 s timeout / abort** | **resolves** — a `console.warn`, then treated as success |
| All relays reject (non-timeout) | throws — except kind:31950, which resolves with a synthetic id |

The middle row is the problem. `NPool.event` rejects only when *every* relay
fails, so a timeout means "no relay confirmed within 5 s" — which includes "no
relay ever received it".

This leniency is correct for what it was tuned for: presence heartbeats and
movement, where a dropped event is re-sent 25 seconds later and nothing is lost.
It is wrong for a one-shot grant of a scarce resource.

### The exact failure the reward hook would produce

`useInventoryMutation` applies an optimistic cache update in `onMutate`, awaits
`publish(template)`, and invalidates the canonical key in `onSettled`. So:

1. player finishes a run, is awarded 8 tickets;
2. `onMutate` writes +8 into the cache — the UI shows 8 tickets;
3. `publish` times out and **resolves as success**;
4. `onError` never runs, so there is no rollback and no error toast;
5. `onSettled` invalidates and refetches; the relay returns the *old* inventory;
6. the 8 tickets silently disappear.

The player is shown a reward, then has it taken away, and at no point is anything
reported as having failed. `useFirstEggAdoption` already hit exactly this class of
bug and worked around it with a local `strictPublish` helper — precedent that
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
3. **Surface failure honestly.** "Couldn't save your tickets — retry" beats a
   number that evaporates. Retry reuses the same `runId`.
4. **Be idempotent on `runId`.** A `runId` already in the persisted claimed set is
   a no-op, so double-clicks, StrictMode double-invocations and retries after a
   *successful-but-unconfirmed* publish cannot double-grant.
5. **Stay out of the game.** The game produces a result; only this hook writes.

Point 4 is what makes point 2 safe: with idempotency, the expensive failure mode
of a strict publish (retrying something that actually succeeded) costs nothing.

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
  proof for each caller — far more risk than the reward phase needs to take on.
- **Precedented.** `useFirstEggAdoption` already does exactly this locally, so the
  pattern is established in this codebase rather than invented for the arcade.
- **Verification closes the last gap.** Strict publishing removes "timeout read as
  success"; the read-back removes "accepted by a relay that then dropped it". The
  two together are what let the UI claim the tickets are real.
- **Cheap.** The read is one filtered query for one addressable event, on a path
  that runs once per completed run.

### What this still cannot fix

- **Read-after-write is not guaranteed by Nostr.** A verification read may miss a
  genuinely-published event, producing a false failure. Idempotency on `runId`
  makes the retry harmless, and the pending claim survives a reload.
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

## 4. Status

- No change made to `src/hooks/useNostrPublish.ts` in this phase.
- No ticket-grant logic exists.
- The Phase 1 ticket balance is read-only: it renders a quantity from a query and
  publishes nothing.
