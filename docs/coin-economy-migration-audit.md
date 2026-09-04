# Coin Economy: Repository Audit and Migration Planning (Coin 0)

Status: **superseded: historical.** The cutover this audit drove was
implemented and then AMENDED by the economy reset: the legacy bootstrap
(§6 Option A's migration) and the adoption-coupled initial grant were
REJECTED and replaced by the marker-based economy-entry allocation. See
`docs/blobbi-coin-cutover.md` for the canonical current state (official
Blobbi Coin in kind:31633, wallet, economy entry, Beach rewards). This
document remains the audit-time reference for the risks that drove the
design; its migration strategy sections are of historical value only.

Original status: audit only; no Coin item defined, no migration performed, no writers added.
Companion document: `docs/beach-treasure-hunt-audit.md` (Beach minigame audit; shared
repository-state section lives there: HEAD `305087b` on `production`, clean tree,
219/4414 tests green).

This document maps every Coin read and write in the repository, traces the Mine
reward flow with actual constants, assesses whether the canonical kind:31633
inventory writer can hold a currency, and lays out migration strategy options.
It decides nothing: the Coin name, `d` identifier, and migration strategy remain
explicit product decisions (Coin 1).

---

## 1. Where Coins live today

A Coin balance is **one tag on one replaceable event**: `["coins", "<int>"]` on the
kind:11125 Blobbonaut Owner Profile (`NIP.md:27,67`).

- Kind constants: `src/lib/blobbi-kinds.ts:19,29` (11125 canonical; 31125 legacy).
- Legacy kind:31125 is **read-compat only**: included in every profile query and
  accepted by `parseOwnerProfile` (`src/lib/blobbi-parsers.ts:78`), but every publish
  is hardcoded to 11125 (`src/protocol/event-registry.ts:257-276`).
- Initial balance: `INITIAL_BLOBBONAUT_COINS = 200`
  (`@blobbi-kit/core`, granted at first-egg adoption).
- **Verified: no code anywhere treats a Coin as a kind:31632/31633 item.** The only
  `currency`-category item is the Arcade Ticket (`blobbi:currency:arcade-ticket`,
  `src/protocol/event-registry.ts:675,1015-1035`). `src/inventory/shop-catalog.ts`
  refuses to price currency items; `arcade-reward-writer.ts:40` states "Coins live in
  the Blobbonaut profile."

Parser/serializer chokepoint: `mergeOwnerProfileTags`
(`src/lib/blobbi-parsers.ts:356-397`) emits `['coins', profile.coins.toString()]` on
**every** profile republish and passes unknown tags through. Consequence: any caller
holding a stale or defaulted `OwnerProfile` republishes that stale balance.
`parseOwnerProfile` defaults a missing/garbage `coins` tag to **0**.

---

## 2. Complete Coin read/write map

| File / system | Reads | Writes | Purpose | Source of truth used | Risk |
|---|---|---|---|---|---|
| `src/lib/blobbi-parsers.ts:78-105,356-397` | ✅ | ✅ (serializer) | Parse/serialize `coins` tag | the 11125/31125 event | missing tag parses as 0; stale profile in → stale balance out |
| `src/inventory/useCoinsMutation.ts:43-110` | ✅ | ✅ **canonical writer** | Delta against a **fresh, latest-by-created_at relay read**; rejects negative results | relay | read-modify-write with no CAS: concurrent deltas lose updates; no optimistic cache write |
| `src/inventory/usePurchaseItem.ts:61-118` | ✅ (param) | via canonical | Single-item purchase (grant then deduct) | caller-supplied `currentCoins` for guard | **dormant; no UI caller**; `onSettled` skips profile-cache invalidation |
| `src/inventory/useBatchPurchase.ts:162-232` | ✅ (param) | via canonical | Cart purchase: one 31633 grant + one 11125 deduction | optimistic status for guard, relay for charge | non-atomic two-event op (documented, favors user); grant can land with charge failing |
| `src/inventory/shop-catalog.ts:47-199` | prices |, | The entire coin price list (21 consumables, 10–150 coins), validated at import | local module | prices are client-side only |
| `src/components/blobbi/FoodShopModal.tsx` (:60,138,180-187,444) | ✅ | via `useBatchPurchase` | The general store | `status.owner?.coins ?? 0` (optimistic cache) | `?? 0` renders "0 coins" during failed/in-flight query and blocks purchases; weaker double-submit guard than ArcadePassModal |
| `src/components/blobbi/ArcadePassModal.tsx` (:19,111,118-134) | ✅ | via canonical | 20-coin Arcade Pass | relay (charge); `?? null` for display | best-hardened spender; failed pass-storage after charge burns 20 coins (documented, tested) |
| `src/components/blobbi/NoPassModal.tsx:54` |: |, | copy | hardcoded "20 coins" | price literal duplicated from `ARCADE_PASS_PRICE` |
| `src/components/blobbi/MiningGame.tsx` (:10-15,53-69,110,244) | ✅ (`owner.coins \|\| 0`) | ✅ **second independent writer** | Mine rewards | optimistic status (read) / React Query cache (write) | **highest risk**: see §3 |
| `src/hooks/useBlobbiEvents.ts` (:90-121,125-178) | ✅ (cache) | ✅ writer | Generic 11125 create/update; only live write consumer is MiningGame | React Query cache | empty cache ⇒ publishes `coins: 0` and drops every unknown tag (profile wipe); publish not awaited |
| `src/hooks/useOptimizedStatus.ts` (:44-62,131-173) | ✅ primary read | ❌ (local only) | Combined status + optimistic overlay; `updateOwnerCoins` | relay + per-hook-instance pending refs | `updateOwnerCoins` is cosmetic, per-instance, expires after 30 s; 30 s staleTime means authorization against half-minute-old balances |
| `src/hooks/useBlobbonautProfile.ts` (:16-45,47-155) | ✅ | ⚠️ implicit writer | Companion switch republishes the whole tag array incl. `coins` | **`events[0]` unsorted** in the mutation (query sorts; mutation does not) | can republish an **older** event's coins, silent balance rollback; its rollback logic covers only `currentCompanion` |
| `src/hooks/useFirstEggAdoption.ts` (:170-231) | ✅ | ✅ genesis writer | Grants starting 200 coins; existing profiles republished verbatim | freshest relay read (sorted) | full-profile republish racing any in-flight coin write |
| `src/components/blobbi/BlobbiInfoModal.tsx:113,502-512` | ✅ HUD |, | The 🪙 coin chip | optimistic profile | `\|\| 0` renders "0 Coins" while loading/failed |
| `src/pages/DevArcade.tsx:96,1130` | ✅ | via `ArcadePassModal` | Dev harness mounts the **real** pass modal | relay | **a dev page that spends real coins on the signed-in account** |
| Arcade ticket/prize writers (`arcade-reward-writer.ts`, `arcade-prize-spend-writer.ts`), `ItemBagModal`, `DevEquipment`, game-item tools | ❌ | ❌ | tickets / items only | 31633 | pinned coin-free by boundary tests (`arcade-reward-writer.test.ts:214`, `boundaries.test.ts`, `DevEquipment.test.tsx:238`) |

Test coverage pins the good paths (`useCoinsMutation.test.tsx`: tag preservation,
exactly one `coins` tag, negative rejection; `ArcadePassModal.test.tsx`: exactly one
charge, unknown-balance never rendered as 0, no compensating write; arcade boundary
tests: no coin writes outside the pass). **No boundary test exists for
`MiningGame`**, which is why its writer bypass went unflagged.

### 2.1 Writer enumeration (anything that can publish a new balance)

Direct writers:

1. **`useCoinsMutation`** (`src/inventory/useCoinsMutation.ts`): canonical:
   delta-based, fresh relay read, latest-by-`created_at`, negative guard.
2. **`useUpdateOwnerProfile`** (`src/hooks/useBlobbiEvents.ts:125-178`): absolute
   value, cache-sourced, no freshness/negative guard. Sole live caller: MiningGame.
3. **`useCreateOwnerProfile`** (`useBlobbiEvents.ts:90-121`): genesis; tests only.
4. **`useFirstEggAdoption.finalizeAdoption`**: genesis grant of 200; verbatim
   republish for existing profiles.
5. **`useSetCurrentCompanion`** (`useBlobbonautProfile.ts:53-102`): implicit:
   republishes the whole tag array from an **unsorted** `events[0]`.

Indirect (funnel through #1): `usePurchaseItem` (dormant), `useBatchPurchase`
(FoodShopModal), `ArcadePassModal` (also reachable from `/dev/arcade`).

Looks-like-a-writer-but-isn't: `useOptimizedStatus.updateOwnerCoins`: local,
per-instance, expires in 30 s, publishes nothing.

**There is no single coin chokepoint today.** Purchases and the pass funnel through
`useCoinsMutation`; mining, adoption, and the companion switch do not.

### 2.2 Consolidated current-state risks

1. MiningGame: duplicated unguarded writer; empty cache ⇒ publishes `coins: 0` and
   wipes unknown tags; races and clobbers concurrent purchases; reachable twice
   (auto + button) with no in-flight guard.
2. Companion switch: unsorted `events[0]` can silently roll the balance back.
3. No CAS/lost-update protection even in the canonical writer (two tabs both read the
   same base; last publish wins).
4. No optimistic coin cache write anywhere ⇒ UI authorizes against pre-charge
   numbers; only the writer's `newCoins < 0` guard prevents overdraft.
5. `?? 0` / `|| 0` balance rendering in FoodShopModal and BlobbiInfoModal (the bug
   already fixed in ArcadePassModal).
6. Non-atomic two-event purchases and the pass grant (documented; pass can burn 20
   coins with no pass).
7. `usePurchaseItem` skips profile-cache invalidation.
8. `NoPassModal` duplicates the pass price literal.
9. `/dev/arcade` spends real coins.
10. The event registry's 11125 `sourceFiles` list omits `useBlobbonautProfile.ts`,
    the registry under-reports the writer set.

---

## 3. Mine reward flow (traced, with actual constants)

The Mine (`src/components/blobbi/MiningGame.tsx`, ~250 lines) is a pre-arcade
prototype mounted from `PlayingView.tsx:524` when `background === 'cave-inside.png'`.

**Session:** state machine `instructions → playing → results | low-energy`
(`:33`). No timer, no session length, bounded only by energy. Entry via the cave
hotspot walk-to-interact (`MineCaveEntrance.tsx:115-163`,
approach `{x:50, y:82.4}`).

**Constants (verbatim):**

- Ore values (`:10-15`): stone 1, gem-1 10, gem-2 25, gem-3 50 coins.
- Drop table (`:114-124`, one `Math.random()`, no multipliers/luck/pet scaling):
  gem-3 5%, gem-2 10%, gem-1 15%, stone 70%.
- Energy: cost 10/click (`:96`); session ends at energy ≤ 20 (`:77,:109`); ceiling
  assumed 100 (`:37`). **The terminating click returns before the gem roll (`:111`),
  the last click costs 10 energy and yields nothing.**
- Cooldowns/caps: **none**: no timestamp, no daily counter, no fee, no pass gate.
- Energy refill: no client-side regeneration exists (sleep hooks are dead code; the
  bed is a visual pose only). The only real refill is the Energy Drink: +35 energy
  for 30 coins (`event-registry.ts:1009`, `shop-catalog.ts:85`).

**Reward grant (`finishMining`, `:53-69`):** sums `GEM_VALUES`, computes
`newCoins = (owner.coins || 0) + totalCoins` from **optimistic** status, calls
`updateOwnerCoins(newCoins)` (cosmetic, per-instance, expires in 30 s) and
`updateOwnerProfile({ coins: newCoins })`: the cache-based writer, **not**
`useCoinsMutation`. Coins are stored by republishing kind:11125; energy is published
as kind:31124 **on every click** (8 events per full session, second-granular
`created_at` ⇒ NIP-01 lowest-id tie-breaks can retain the wrong final energy).

**Reliability:** no fresh read; no rollback (fire-and-forget `mutate`, publish not
even awaited); 5 s publish timeout **resolved as success** (`useNostrPublish.ts:35-39`);
no retry, no idempotency key, no read-back. Refresh/crash mid-session: `minedItems`
is plain React state and location resets to `'town'` on load, **the reward is lost
while the energy costs were already published per click.** Exploit note: the
optimistic energy deduction expires and re-entry reads a ≤30 s-stale cache, so
exit/re-enter can restore pre-session energy whenever the 31124 writes didn't settle.

**Trust model:** fully client-authoritative and self-published, browser RNG,
browser-summed totals, player-signed balance. The arcade's publication boundary
(`docs/arcade-reward-publication-boundary.md`) explicitly protects only honest
clients, and the Mine sits outside even that boundary.

**Earnings (computed from the constants):**

- Rolls from full energy: `n = ceil((100−20)/10) = 8` clicks → **7 rolls** (last
  click yields nothing).
- EV/roll = 0.70×1 + 0.15×10 + 0.10×25 + 0.05×50 = **7.20 coins**.

| Per full-energy session | Coins | Notes |
|---|---|---|
| Minimum (played out) | 7 | all stone; probability 0.7⁷ ≈ 8.2% |
| **Mean** | **50.4** | 7 × 7.20 (σ ≈ 32.5) |
| Maximum | 350 | all gem-3; probability ≈ 7.8 × 10⁻¹⁰ |

- Coins per minute (no timer exists, so cadence is assumed, flagged as such):
  instantaneous mining ≈ 4 s of clicking ⇒ ~**756 coins/min** burst; realistic loop
  incl. transitions/walk ≈ 12 s ⇒ ~**250 coins/min**: but only if the energy
  deduction fails to persist (the bypass above). If energy persists, a 30-coin
  Energy Drink buys 3 rolls ≈ 21.6 coins expected ⇒ **EV-negative**; the honest
  steady state is ~**50 coins per fully-rested Blobbi**, gated by an energy source
  that doesn't exist in the client.
- Tests: **zero** cover the Mine reward path (only the exterior cave entrance is
  tested).

**Implication for the Beach:** "mine ≈ 50 coins/session, ~7.2 EV/roll, 5% rare"
is the only existing repeatable-earnings reference point, but it is not a balanced
economy to match: it is an unbounded, unreliable prototype. Beach V1 balance should
be set against intended play-session value, not against the Mine's exploitable rates,
and Mine hardening belongs to the Coin 2 cutover (it must be rewired through the
canonical balance API anyway).

---

## 4. Inventory writer safety assessment (kind:31633)

Protocol logic lives in `@nostr-games/inventory@0.3.0` (dist); Island orchestration
in `src/inventory/` (import surface `package.ts`). One canonical serializer
(`buildInventoryTemplate`, `useInventoryMutation.ts:110-125`), three publish paths:
`useInventoryMutation` (in-mutex), `arcade-reward-writer`, `arcade-prize-spend-writer`
(both outside the mutex, both strict-publish).

**Guarantees present:**

1. Fresh relay read (3 s timeout) before every build, the cache is never the write
   base (`useInventoryMutation.ts:295-306`; both arcade writers likewise).
2. Empty/stale cache can never clobber a real inventory (tested).
3. Per-user, per-tab mutation mutex (`mutationChains`, `:56-71`; proven by
   `concurrency.test.tsx`).
4. Hard quantity validation: integer, non-negative, finite, ≤ MAX_SAFE_INTEGER,
   overflow-checked addition. Zero = canonical "absent" on read, write, and build.
5. Unrelated item entries preserved on every write.
6. Optimistic cache update + rollback + post-settlement invalidation.
7. Bulk ops are one replaceable event (`batch`, `set-many`, `replace`).
8. On the arcade-ticket path only: strict publish (timeout surfaces), baseline +
   read-back verification, ambiguity classification (`publish-timeout` /
   `verify-unavailable`), durable per-run claim ledger with cross-tab Web Lock,
   never-republish rule (`useArcadeReward.ts:187-203,478-555,618-692`,
   `arcade-claim-ledger.ts`).

**Guarantees missing (each is a currency-loss or duplication path):**

1. Lost-update window between fresh read and publish: 31633 is newest-wins; a
   concurrent writer's delta is overwritten in full.
2. No cross-tab/cross-device coordination for inventory (documented in
   `INVENTORY_ARCHITECTURE.md:222-229`). Two tabs both "+5" ⇒ net +5.
3. `useNostrPublish` resolves publish **timeouts as success** (`:35-39`): the
   canonical hook cannot distinguish landed from lost; the arcade writers bypass it
   for exactly this reason.
4. No read-back verification in the canonical writer; `onSettled` fixes the cache,
   not decisions already taken (e.g. coins deducted after an unverified grant).
5. No idempotency key / ambiguity model for ordinary writes ⇒ additive retry after
   an ambiguous publish double-credits (the documented duplicate-3-ticket defect;
   only the arcade path is immunized).
6. No `created_at` monotonicity guard, same-second writes tie-break on lowest event
   id and one write is silently discarded.
7. Read-after-write consistency is assumed, not guaranteed (mutex only holds under a
   read-your-write relay).
8. The two arcade writers sit outside the mutex, grant and spend can interleave with
   shop/use writes in the same tab.
9. Foreign tags and `content` are **destroyed on every write**
   (pinned by `arcade-reward-writer.test.ts:197-212`): which also forecloses
   stamping a nonce/sequence number on the event as a mitigation.
10. `remove` silently clamps to 0 (underflow refusal is caller policy only).
11. `max_stack` is not enforced by any production writer (lab-only), and the fetched
    `max_stack` tag never reaches Island's resolved definition
    (`protocol-adapter.ts:306-334` drops it).
12. No server-side validation at all, `authority: 'player'`; a `set` mutation can
    write any balance.

### Verdict

> **Is the current canonical inventory writer safe enough for a client-trusted
> currency balance? Not as-is.** It is well-built for low-frequency, human-paced
> item ownership. For a currency incremented/decremented from multiple features it
> lacks: strict publish (no timeout-as-success), read-back verification, an
> idempotency/ambiguity model on every value-bearing write, `created_at`
> monotonicity, a single mutex covering **all** writers, and cross-tab locking.
> Every one of those already exists in the repo, on the arcade-ticket claim path,
> but per-feature, not in the writer. The migration must generalize that pattern
> (a canonical Coin balance API wrapping the inventory writer with
> ledger + lock + strict publish + read-back), **not** create a new writer.

---

## 5. Official item registry findings (for a future Coin item)

- Issuer: `OFFICIAL_ITEM_ISSUER_PUBKEY = 9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9`
  (`src/inventory/constants.ts:22-23`); single trust root, re-exported everywhere.
- Official relays: `wss://relay.ditto.pub`, `wss://relay.dreamith.to`
  (`constants.ts:33-36`); catalog fan-out adds the app relay, deduped.
- Registry: `src/protocol/event-registry.ts` is canonical; 36 registered identities
  (20 consumables/currency incl. Arcade Ticket, 4 wearables, 12 effect items, the
  "sixteen" are the equippables). All addresses built by `officialItemAddress()`;
  membership predicates compare the **whole** `31632:<issuer>:<d>` address; event ids
  are never identity; no code executes behavior from item event content (verified,
  all content readers are defensive data extractors).
- **No Coin item exists.** `blobbi:currency:` resolves only to `arcade-ticket`.
- Naming convention: `blobbi:<class>:<kebab-slug>`: a Coin would follow
  `blobbi:currency:<slug>`. **The slug and display name are undecided product
  decisions (Coin 1); nothing here picks them.**
- The correct stackable non-equippable shape is the Arcade Ticket template:
  `type/category = currency`, **no `max_stack` tag** (absence = unbounded, the right
  choice for a currency), no `content.visual` (non-equippable by omission),
  `metadata.action: null` (unusable in care flows), `t` tags, versioned immutable
  image URL, `alt` tag. Registry-side it also needs `itemId`, `emoji`, and
  `status: 'reserved'` until fetched back from both official relays, then `'active'`.
- Ancillary gaps to be aware of (not blockers): `resolveFromDefinition` drops the
  fetched `maxStack`; `shop-catalog.ts` hard-errors if a currency item is ever
  priced (good: it protects the Coin from being sold for Coins).

---

## 6. Migration strategy options

Target model: official Coin kind:31632 definition + quantity in the player's
kind:31633 → canonical balance. Forbidden intermediate state (restated as a hard
rule): **there must never be two production balances treated as authoritative**,
e.g. Mine writing `profile.coins` while Beach writes inventory Coin, or the Shop
reading `profile.coins` while the HUD displays inventory Coin.

### Option A: Clean cutover with legacy bootstrap (recommended direction)

One release flips everything at once:

1. **Coin 1 (spec, no code):** decide name + `d`; publish the kind:31632 definition
   from the official issuer (Item Studio path, reserved→active); specify the
   **canonical Coin balance API**: one module owning read + delta-write, wrapping
   the inventory writer with the arcade-claim guarantees (strict publish, read-back,
   idempotent operation ledger, cross-tab lock, `created_at` monotonicity,
   serialization of *all* Coin writes); specify the **legacy bootstrap**: on first
   canonical read, if no Coin entry exists in 31633 and the 11125 profile carries a
   `coins` tag, perform a one-time migration write (idempotent, recorded, e.g. via
   the operation ledger; whether a marker also lands on an event is part of the spec
   since foreign tags don't survive writes today).
2. **Coin 2 (one coherent change):** switch HUD, FoodShop, ArcadePass, Mine,
   purchase hooks, dev tools, fixtures, and tests to the balance API; delete/retire
   the five direct 11125 coin writers' coin responsibility (profile republishes
   keep passing the legacy tag through untouched or drop it, spec decision);
   `useCoinsMutation` becomes legacy-frozen or is rewired to the new API.
   After cutover, kind:31633 is the only canonical balance.

Pros: no dual-authority window; matches the repo's precedent (kind:31634 equipment
was migrated exactly this way, "clean cut and delete the legacy path", commit
`67df788`). Cons: big-bang release; the bootstrap must be exactly-once per player
and race-safe (two tabs bootstrapping concurrently), and stale relays serving an old
profile could bootstrap a stale balance, the fresh-read + sorted-latest discipline
of `useCoinsMutation` must carry over.

### Option B: Read-canonical-first, staged writers

Cutover reads first (HUD + affordability checks read the canonical balance with
legacy fallback), then move writers one release at a time.

Pros: smaller releases. Cons: **this is the forbidden dual-write window** unless the
fallback logic is airtight, a Mine still writing `profile.coins` after the Shop
charges inventory Coin desynchronizes the two balances immediately. Only acceptable
if "fallback" means *bootstrap-then-canonical-only*, which collapses into Option A
with extra steps. Not recommended.

### Option C: Freeze-and-restart

Freeze legacy coins (display-only), start everyone at a fresh canonical balance
(optionally credited with the legacy amount later).

Pros: simplest correctness story. Cons: player-visible disruption; still needs the
bootstrap eventually. Only worth considering if the bootstrap proves intractable.

**Recommendation:** Option A. Additionally, sequence **Beach 2 after Coin 2** so the
Beach's first real payout is written through the canonical balance API and no new
legacy-coin writer is ever created.

### Prerequisites for Coin 2 regardless of option

- Fix or retire the rogue writers *as part of* the cutover: MiningGame rewired
  through the balance API; `useSetCurrentCompanion` must sort by `created_at` before
  republishing; adoption bootstrap coordinated with the Coin bootstrap.
- Boundary tests generalizing the existing pattern: no module outside the balance
  API may import an 11125 coin write or build a Coin 31633 delta (mirror
  `arcade/boundaries.test.ts` and `DevEquipment.test.tsx`'s import-graph walk).
- `useNostrPublish`'s timeout-as-success (`:35-39`) must not be on the Coin write
  path (use strict publish like the arcade writers).
- Kill or gate the real-coin spend in `/dev/arcade`.
- Test-pinned invariants: exactly-once bootstrap, no dual-write, HUD never renders
  unknown balance as 0 (extend ArcadePassModal's pattern to FoodShop/InfoModal).

---

## 7. Trust model (explicit, applies before and after migration)

- Round/operation ids, serialized writes, ledgers, and locks protect against
  **accidental duplication** (double-submit, retry-after-ambiguity, tab races).
- Fresh reads, sorted-latest selection, and read-back reconciliation improve
  correctness against stale caches and relays.
- **None of this is cryptographic anti-cheat.** Both the legacy `coins` tag and a
  future inventory Coin are player-signed (`authority: 'player'`,
  `event-registry.ts:421-435`); any client can publish any balance. The economy
  remains trusted to the official client. The migration changes *where* the balance
  lives and *how safely honest clients mutate it*; not who is trusted.

---

## 8. Open product decisions (explicitly not decided here)

1. Coin display name and stable `d` slug (`blobbi:currency:<?>`).
2. Issuer confirmation (presumably the existing official issuer) and relay set.
3. Coin item art/emoji; whether the definition carries a `max_stack` (recommend
   none, per the ticket precedent).
4. Bootstrap semantics: exact trigger, exactly-once mechanism, what happens to the
   legacy `coins` tag after migration (kept frozen? zeroed? dropped from the
   managed-tag list?), and treatment of kind:31125-only legacy profiles.
5. Migration strategy sign-off (Option A recommended, not approved).
6. Whether Mine hardening (limits, exactly-once, energy model) is in scope for
   Coin 2 or a separate phase, the rewire through the balance API is mandatory
   either way.
7. Beach reward pricing in Coins (depends on the intended economy, not on the Mine's
   current exploitable rates: see §3).
