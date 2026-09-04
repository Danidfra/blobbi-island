# The Arcade Prize Counter (V1)

The Prize Counter closes the visible Arcade V1 loop:

```
play a dedicated game → earn Arcade Tickets → browse prizes
  → redeem a prize → own it, and see that you own it
```

It is reached the way everything in the arcade is reached: walking the Blobbi
to the PRIZES counter on the ground floor, which opens the arcade's one
contained dialog (`ArcadeGameShell`, `surface="notice"`) with the counter
inside. There is no second route, no separate shop entry point, and no page
navigation.

Read alongside:
[`arcade-reward-publication-boundary.md`](./arcade-reward-publication-boundary.md)
(§7 covers the earning half and the shared trust model).

---

## 1. What is real and what is temporary

| piece | status |
| --- | --- |
| ticket balance | **real**: the canonical kind:31633 inventory, read through the shared query |
| ticket spending | **real**: a signed kind:31633 publish through the one approved spend writer |
| prize catalogue | **temporary**: placeholder fixtures in `src/arcade/prizes/prize-catalogue.ts`, versioned `temp-v1`, awaiting the official prize list and artwork |
| prize ownership | **temporary**: a clearly-namespaced local store (`blobbi:arcade:prize-ownership:temp-v1:<pubkey>`), NOT inventory, not visible on other devices |
| official kind:31632 prize definitions | **deferred** |
| inventory-backed prize delivery | **deferred** |
| grant/redemption protocol events | **deferred** |
| anti-fraud, server authority | **deferred** |

This is the client-trusted Arcade V1: the client prices the prize, spends the
tickets, and grants the ownership. A modified client can cheat every step.
Nothing scarce, paid, competitive or real-world may trust any of it.

## 2. Architecture

```
prize-catalogue.ts (pure data)     prize-redemption.ts (pure eligibility + state machine)
        │                                   │
        └──────────────► useArcadePrizeRedemption ◄──────────────┐
                                    │                            │
             ┌──────────────────────┼─────────────────────┐      │
             ▼                      ▼                     ▼      │
   arcade-redemption-ledger   arcade-prize-spend-writer   arcade-prize-ownership
   (localStorage records,     (kind:31633 remove, strict  (TEMPORARY local store
    sync locks)                publish + verify read)      behind an interface)
                                    ▲
                     PrizeCounter / PrizeCard / PrizeDetail (UI only)
```

- **The catalogue** is pure and lives under `src/arcade/`, where
  `boundaries.test.ts` proves it can reach no relay and no inventory. Its
  `delivery` union records FUTURE intent per prize (badge / Blobbi effect /
  Home furniture / inventory / mock) without implementing any of it.
- **The spend writer** is the mirror of the reward writer: freshest-event
  read-modify-write through the canonical `applyMutation`/
  `buildInventoryTemplate` helpers, refusal below the price (a balance can
  never go negative), strict publish (timeout ≠ success), verify read-back.
  kind:11125 is never touched; no component constructs inventory tags.
- **Ownership** sits behind `ArcadePrizeOwnership` precisely so the real
  deliveries: inventory grants, profile badges, Blobbi effect unlocks, Home
  furniture: can replace the temporary store writer-by-writer with no UI
  change.
- **The hook** (`useArcadePrizeRedemption`) is the only module holding the
  writer and the store, mirroring `useArcadeReward`'s discipline; the pinned
  user list in `boundaries.test.ts` keeps it that way.

## 3. The redemption lifecycle

```
reserved → spending → spent → delivering → confirmed
   │           │                   ▲ └ delivery-failed keeps `delivering` (recoverable)
   │           └→ spend-unresolved ┘ (reconcile-only, NEVER respent)
   └→ failed-before-spend (provably nothing sent, retryable)
```

Ordering is deliberate: **tickets are spent before ownership is granted**, so
the reachable bad state is "paid but not delivered": kept as a durable
`delivering` record the UI surfaces ("finishing delivery") and completes
without spending again. The opposite order could hand out prizes whose payment
failed, with no clawback.

- A redemption id is `prizeId:attemptId`, with the price and catalogue version
  frozen at reservation.
- Double-clicks are stopped by a synchronous same-document lock; remounts and
  refreshes by the durable ledger.
- **Durable persistence is a prerequisite for publication.** Both the
  `reserved` record and the `spending` record (which carries the baseline,
  the only evidence a refresh-mid-spend can reconcile against) are written AND
  read back before `spendTickets` may run. If either round trip fails, nothing
  is published and the failure is a retryable `ledger-unavailable`; a
  persistence failure AFTER a possibly-published spend is never downgraded to
  retryable: the durable `spending` record hydrates as unresolved.
- An **unresolved spend** (timeout, verify mismatch, unreadable verify, or any
  unrecognised publication error) offers exactly one action: a read-only
  status check. Reconciliation confirms **only when the balance reads exactly
  `baseline − price`**: a drop by more, by less, no drop, or a rise all stay
  unresolved, because they are evidence of OTHER writes (a concurrent spend in
  another tab must never be misattributed to this redemption). Even exact
  equality is limited evidence, kind:31633 has no operation identity, but it
  is the most conservative rule a balance-only reconciliation can have. There
  is no republish path.
- **Publication errors are classified only as far as the client can prove.**
  `NPool.event` surfaces no per-relay OK/failure breakdown, so the production
  writer never claims "all relays rejected"; a generic publication error is
  unresolved, reconcile-only. The retryable `publish-rejected` classification
  exists solely for writers that CAN prove it (test and DEV fakes, or a future
  per-relay client contract).
- True cross-system atomicity does not exist (a replaceable relay event plus a
  local store), and none is pretended. This machinery is **bug protection for
  honest players, not anti-fraud**.

### Delivery, verified end to end

Delivery is **idempotent per redemption id**: the temporary ownership store
remembers every delivered id, so retrying one attempt (the recovery path may
legitimately run several times) never grants twice, and, for a repeatable
prize, never eats a later attempt's legitimate increment. The sequence is
explicit: transition to `delivering` (best-effort persist, the durable
`spent` record plus per-id idempotency already guarantee no re-spend), grant,
**verify** the delivery via `hasDelivery` rather than assuming a resolved
grant, then transition to `confirmed`: which is only shown as done when the
final record persisted and read back. If ownership succeeds but the final
record will not stick, the prize is kept, nothing is respent, and the state
remains a recoverable finalization ("could not record the redemption as
finished") until a retry completes the bookkeeping.

### Repeatable prizes

A repeatable prize (the Arcade Snack) is fully supported: a `confirmed`
attempt is terminal for that attempt but does not retire the prize, a new
explicit redemption mints a fresh attempt id and its own ledger record, and
the ownership count increments exactly once per confirmed attempt. Anything
in flight, unresolved or undelivered still blocks the next attempt. The UI
shows `Owned ×N` / `Redeemed ×N` and returns to `Redeem again` after a
success; non-repeatable prizes still retire to `Owned`.

## 4. The catalogue (temporary fixtures)

Eight entries exercise every interface state, cheap/mid/premium prices, all
present categories, a repeatable consumable, a coming-soon entry, and the two
flagship future-facing prizes:

- **Mini Arcade Trophy** (75): a **badge**, not furniture. Badges are
  collectible achievements that will later display on the profile card, the
  Blobbi card and arcade surfaces. No badge display is implemented yet.
- **Arcade Glow** (120, premium): a **Blobbi effect** (`effectId:
  'arcade-glow'`). Effects are future cosmetic animations on the Blobbi; no
  effect renderer is implemented yet.
- **Mini Arcade Cabinet** (500, premium): future **Home furniture**
  (`furnitureId: 'mini-arcade-cabinet'`, `gameplayMode: 'no-rewards'`). The
  product intent, encoded in metadata and player-facing copy: it will be
  placeable in the Home, it will open arcade games from there, and **games
  launched from the Home cabinet will award no Arcade Tickets**. None of that
  is implemented: no placement, no Home interaction, no Home launching, no
  no-reward mode: and `boundaries.test.ts` asserts no Home module imports
  prize code yet.

Prices are UI fixtures, not economy decisions. The display order is
deterministic: everyday prizes by ascending price, premium long-term goals
last; owned prizes keep their place with an Owned label.

## 5. The interface

**Desktop (`md:`+)**: shelf and detail side by side inside the wide contained
shell: sign + always-visible balance up top, category filter chips, a 2–3
column card grid on the left, and a fixed detail column on the right whose
confirm button never scrolls away.

**Mobile**: a deliberate composition, not a squeezed grid: one surface at a
time (shelf ⇄ detail), 1 column under 400 px and 2 above, horizontally
scrollable category chips, a sticky action bar above the safe-area inset, a
visible back control, ≥44 px targets, and exactly one scrolling region at a
time (the shell's own scroll is disabled for this surface).

**Selection is never redemption.** A card only selects; the detail panel shows
artwork, category, description, price, balance now, balance after, ownership
and availability, and the explicit `Redeem for N Tickets` press is the only
thing that spends. Success is restrained: a stamp, a few pinging emoji
(suppressed under reduced motion), the balance updating through the shared
query, and the card flipping to Owned.

**States implemented**: counter: balance loading / unavailable / ready,
logged out (browsing stays free), empty catalogue, empty filter; prize:
available, unaffordable ("Need N more" in words, not colour), selected, owned,
coming soon, premium, broken image → emoji fallback, repeatable; redemption:
confirmation, reserving, spending, spend-unresolved, checking, delivering,
delivery-recovery (with a counter-level "finishing delivery" banner on
reopen), success, failed-before-spend with retry.

**Accessibility**: the shell provides dialog semantics, focus management and
Escape; the counter adds a labelled radiogroup for categories, text labels for
every state, `role="status"` live regions for balance problems and redemption
progress, aria labels for the balance numbers, and reduced-motion-aware
celebration.

## 6. DEV harness

`/dev/arcade` gains a Prize Counter section: open the real counter with a fake
spend writer (confirm / sign-refused / timeout / verify-mismatch), a
toggleable failing delivery, catalogue fixtures (real / broken-image / empty),
an owned-prize seed, and a reset. The displayed balance comes from the
existing cache-seeding chips (0 / 7 / 1234); a signed-out browser reviews the
logged-out state. Nothing in the harness can publish a real spend.

## 7. Replacing the temporary pieces

1. Publish official kind:31632 prize definitions (official issuer), and swap
   the catalogue entries to `delivery: { type: 'inventory', itemAddress }` or
   their badge/effect/furniture ids: the types already exist.
2. Implement real delivery writers behind `ArcadePrizeOwnership` (inventory
   grant, badge collection, effect unlock, furniture) and route by
   `prize.delivery.type` inside the hook's delivery step.
3. When the grant/redemption protocol arrives, replace
   `ArcadePrizeSpendWriter`'s implementation behind the same interface,
   result → redemption request → verifiable grant, with no change to the
   counter, the catalogue shape, or the ledger's exactly-once rules.
4. Migrate or amnesty the `temp-v1` ownership namespace, then delete it.

---

**Superseded (Phase 9.5):** the counter described above, the temporary
fixture catalogue and the client-trusted V1 redemption, was retired from the
player-facing surface. The counter now shows the six official
kind:31632-backed prizes, preview-only, with redemption disabled until the
durable grant flow ships. See
[`arcade-prize-catalog.md`](./arcade-prize-catalog.md). The spend machinery
documented here remains in the tree, tested and unwired, as the future
phase's starting point.
