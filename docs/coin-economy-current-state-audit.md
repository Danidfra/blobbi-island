# Coin Economy — Current-State Audit

Audit-only. No production code was changed, no migration performed, nothing
published.

- **Branch:** `production`
- **HEAD:** `24fa40ef807e111733115f8c3b3fa5bd0888199d`
  (`Merge branch 'blobbi-economy-reset' into production`)
- **Working tree:** clean (no uncommitted changes, no untracked files)
- **Upstreams:** `nostr/production` = HEAD (0 ahead / 0 behind).
  `origin/main` and `nostr/main` are **23 commits behind** HEAD — the economy
  work exists only on `production`, it has never been merged to `main`.
- **Validation at audit time:** `npm test` → exit 0
  (tsc clean, workspace typecheck clean, eslint 0 errors / 17 pre-existing
  warnings, **239 test files / 4690 tests passed**, `vite build` clean).

Supersedes the "current state" sections of
[`coin-economy-migration-audit.md`](coin-economy-migration-audit.md) (already
self-marked historical) and confirms
[`blobbi-coin-cutover.md`](blobbi-coin-cutover.md) against the source tree.

---

## 1. Verdict

> **A. Migration complete.**
>
> Every production Coin read and every production Coin write uses the official
> Blobbi Coin quantity in kind:31633. kind:11125 `coins` survives **only** as
> an inert parsed field with zero consumers, preserved opaquely on republish.

The Beach Treasure Hunt is classified separately in
[`beach-treasure-hunt-current-state-audit.md`](beach-treasure-hunt-current-state-audit.md):
**complete and Coin-reward-connected; item reward deliberately not connected.**

Two genuine findings remain, neither of which is a legacy-Coin dependency —
see [§10](#10-findings).

---

## 2. Chronological commit reconstruction

Read from the diffs, not the messages.

### `e9a48a3` — `feat(beach): add treasure hunt minigame foundation`
**Beach gameplay.** 48 files, +7168. Adds the pure simulation
(`src/beach/treasure-hunt/`: generator, detector, digging, reducer, policy,
result, seeded RNG, geometry — all with tests), the UI layer
(`TreasureHuntModal/Game/Intro/Results/Shack`, `field-transform`,
`detector-audio`, `treasure-hunt-config`), the Beach shack interactable and
stand point, final artwork, and the `/dev/treasure-hunt` harness.
**Rewards deliberately staged out** — the commit body says "keep rewards
simulation-only pending the Coin cutover", and the code matches: no wallet,
no ledger, no relay import anywhere in the Beach tree at this commit.
*Complete for its stated scope, intentionally staged.*

### `038fc5d` — `feat(economy): add canonical Blobbi Coin foundation`
**Coin infrastructure + the actual migration.** 58 files, +5402/−1539. This is
the cutover commit:
- registers the Coin in `src/protocol/event-registry.ts`, adds the single
  identity module `src/inventory/coin.ts`;
- adds `src/inventory/coin-wallet.ts` (the canonical mutator), the durable
  `src/lib/coin-op-ledger.ts`, `src/lib/cross-tab-op-lock.ts`;
- **deletes `src/inventory/useCoinsMutation.ts`** (the kind:11125 writer) and
  its tests;
- migrates every consumer: `MiningGame`, `usePurchaseItem`, `useBatchPurchase`,
  `ArcadePassModal`, `BlobbiInfoModal`, `FoodShopModal`;
- adds `grantLines` so a purchase is one atomic event (charge + items);
- adds the Beach reward stack (`src/beach/rewards/*`,
  `useTreasureHuntRewards`, `beach-reward-ledger`) and connects the hunt;
- removes the `coins` tag from the kind:11125 managed serializer set.

The commit body is honest that the bootstrap and the adoption-coupled grant
were expected to be reworked. *Complete migration, one staged piece.*

### `258b5db` — `refactor(economy): initialize canonical Island Coins`
**Cleanup + the reset the previous commit anticipated.** 36 files.
- **deletes `useCoinBootstrap`** (the legacy 11125 → 31633 migration) entirely
  — there is now *no* legacy migration at all;
- decouples the initial allocation from first-egg adoption
  (`useFirstEggAdoption` no longer imports any economy module);
- adds `src/inventory/economy-entry.ts`: 200 Coins once per pubkey, proven by
  an `["allocation","island-economy:v1"]` marker published **atomically in the
  same event** as the +200;
- adds `extractForeignInventoryTags` / `dedupeExactTags` to
  `useInventoryMutation`, making **every** kind:31633 rewrite lossless for
  unknown tags;
- adds `coin-cutover.contract.test.ts` source contracts and
  `inventory-roundtrip.test.ts`;
- updates `NIP.md`, `INVENTORY_ARCHITECTURE.md`, the event registry doc.
*Complete.*

### `9b75f22` — `chore(deps): upgrade Blobbi Kit to 0.4.0`
Dependency bump only (3 files). No economy content.

### `24fa40e` — merge of `blobbi-economy-reset` into `production`
No content of its own.

---

## 3. Canonical Coin identity — verified, not assumed

**Stable address**

```
31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:coin
```

| Question | Answer | Evidence |
|---|---|---|
| Hardcoded in a registry? | Yes | `src/protocol/event-registry.ts:714` (`BLOBBI_COIN_D`), entry at `:1071-1094`, `status: 'active'` |
| Single identity module? | Yes | `src/inventory/coin.ts` — derives the address via `officialItemAddress()`, never hand-written |
| Issuer | `OFFICIAL_ITEM_ISSUER_PUBKEY` (`src/inventory/constants.ts:23`) — the same trust root as all 20 official items |
| type / category | `currency` / `currency` |
| `max_stack` | **Deliberately absent** from the published definition. The app enforces `MAX_COIN_BALANCE = 1_000_000_000` in the wallet instead (`coin.ts:62`) |
| symbol / name / image | `🪙` / `Blobbi Coin` / front + back Blossom URLs |
| Fetched by the production catalog? | Yes — via the ordinary official-item path (`useItemCatalog` + exact-issuer trust), with a bundled fallback |
| **Actually published and verified?** | **Yes — verified live during this audit** |

I fetched
`naddr1qvzqqqrmjqpzp8hm35cytwn48umxf4grxz95j7pn26ex5m2lfw2yh7kyywd0ucafq…`
from the relay. The returned event:

- id `fe3fce5a69d3fd93341a4b2d689bf3c97a986882fd5380d39ea1de8176d82797` —
  **exactly** the diagnostic id recorded in `coin.ts:55`;
- `pubkey` = the official issuer; kind 31632; `d = blobbi:currency:coin`;
- tags match the registry record field-for-field (`name`, `type`, `category`,
  `image` ×3 with `front`/`back` views, `symbol`, `version 1`,
  `context game:blobbi`, six `t` topics, `alt`);
- **no `max_stack` tag**, confirming the documented omission;
- content: `{"description":…,"metadata":{"itemId":"blobbi-coin","stackable":true,"denomination":1}}`.

So this is not a fixture-only or registry-only claim: the definition is real,
issuer-signed, and matches the code. The event id is correctly documented as
*diagnostics only* — identity is the address.

---

## 4. Legacy Coin readers

Searched the whole `src/` tree for `coins`, `coinBalance`, `balance`, profile
selectors, `.coins` property access, and every UI that renders a currency
number.

| File / module | Surface | What it reads | Class | Notes |
|---|---|---|---|---|
| `src/inventory/useCoinWallet.ts:43` `useCoinBalance` | the ONE balance reader | `getQuantity(inventory, BLOBBI_COIN_ADDRESS)` from the kind:31633 query | **A** | `null` while unknown — never a fake zero |
| `src/components/blobbi/BlobbiInfoModal.tsx:118,514-532` | player profile / HUD balance | `useCoinBalance` | **A** | separate loading + error + retry states |
| `src/components/blobbi/FoodShopModal.tsx:54,142` | shop balance + affordability | `useCoinBalance` | **A** | `null` ⇒ purchase disabled, not "0" |
| `src/components/blobbi/ArcadePassModal.tsx:67,75` | pass affordability | `useCoinBalance` | **A** | display only; wallet re-reads for the charge |
| `src/inventory/coin-wallet.ts:330,444,466` | authoritative in-lock read | fresh relay read of 31633 | **A** | the only read a charge is ever based on |
| `src/beach/…`, `MiningGame` | reward paths | no balance read at all | **A** | amount is computed, wallet validates |
| `src/lib/blobbi-parsers.ts:91` | `parseOwnerProfile` | `coins` tag → `OwnerProfile.coins` | **B** | parsed, exposed, and consumed by **nothing** |
| `src/lib/blobbi-types.ts:26,77` | type declaration | documents the historic tag shape | **B** | both fields carry explicit OBSOLETE doc comments |
| `src/hooks/useOptimizedStatus.ts` | generic `StatusUpdate` merge | no coin field exists | **D** | allowlisted in the contract test as plumbing |
| `src/inventory/shop-catalog.ts:52-155` | `entry.coins` | **prices**, not a balance | **D** | price config; deliberately excluded from the contract regex |
| `src/lib/blobbi-profile-storage-opacity.test.ts:88` | test | asserts the tag still parses | **D** | test-only |

**Class C (production behavior still depending on 11125 coins): none.**

A repository-walking contract test enforces this
(`src/inventory/coin-cutover.contract.test.ts:51-70`): any production file
outside a three-file allowlist that matches
`/(owner|ownerProfile|existingProfile|mergedProfile|profile)\??\.coins/`
fails the suite.

---

## 5. Legacy Coin writers

| Writer / file | Trigger | Writes 11125? | Writes 31633? | Fresh read? | Serialized? | Safe? |
|---|---|---|---|---|---|---|
| `src/inventory/coin-wallet.ts` | **every** Coin movement | **No** | Yes (Coin qty) | Yes, in-lock | Yes — queued cross-tab Web Lock **+** shared per-user chain | **Yes** |
| `MiningGame.tsx:88` → `grantCoins` | mining session end | No | via wallet | via wallet | via wallet | Yes |
| `beach/rewards/provisional-authorization.ts:113` → `grantCoins` | eligible hunt finished | No | via wallet | via wallet | via wallet | Yes |
| `usePurchaseItem.ts:87` → `spendCoins(+grantLines)` | single purchase | No | via wallet, **atomic** | via wallet | via wallet | Yes |
| `useBatchPurchase.ts:181` → `spendCoins(+grantLines)` | cart purchase | No | via wallet, **atomic** | via wallet | via wallet | Yes |
| `ArcadePassModal.tsx:98` → `spendCoins` | pass purchase | No | via wallet | via wallet | via wallet | Yes¹ |
| `economy-entry.ts:250` → `grantCoins(+marker,+precondition)` | first authenticated entry | No | via wallet, **atomic** | Yes ×2 + in-lock | via wallet | Yes |
| `useInventoryMutation.ts:393` | item consume / free purchase / lab | No | Yes (items only) | Yes | Yes (per-user chain) | Yes |
| `arcade-reward-writer.ts:154` | arcade game win (**Tickets**) | No | Yes (Ticket qty) | Yes | **No** | **See §10.1** |
| `arcade-prize-spend-writer.ts:142` | prize redemption (**Tickets**) | No | Yes (Ticket qty) | Yes | **No** | **See §10.1** |

**Writer topology:**

- **Exactly one canonical Coin writer** — `coin-wallet.ts`. No dual-write, no
  legacy-only writer, no temporary bridge.
- `useCoinsMutation.ts` is **deleted from disk** and a contract test
  (`coin-cutover.contract.test.ts:43-49`) fails the suite if any production
  file so much as mentions the name.
- No production module can construct a `['coins', …]` tag — enforced at
  `coin-cutover.contract.test.ts:32-41`.
- No module outside the three wallet files may pass `BLOBBI_COIN_ADDRESS` into
  `applyMutation` — enforced at `:72-91`.
- The kind:11125 serializer no longer manages `coins`; the tag rides the
  unknown-tag passthrough verbatim (`blobbi-parsers.ts:336-344,376`), enforced
  at `:166-181`.

¹ The Arcade Pass has a known, *documented and honestly surfaced* seam: the
`sessionStorage` pass grant happens after the charge, so a storage failure
leaves the coins spent. The UI copy says exactly that
(`ArcadePassModal.tsx:136-145`). This is a product decision, not a migration gap.

---

## 6. Player-visible balances

| Surface | Source | Canonical? |
|---|---|---|
| `BlobbiInfoModal` (the profile/HUD balance) | `useCoinBalance` | ✅ |
| `FoodShopModal` (shop header + affordability) | `useCoinBalance` | ✅ |
| `ArcadePassModal` | `useCoinBalance` | ✅ |
| `MiningGame` results | computed reward + wallet outcome phase | ✅ |
| `TreasureHuntIntro` / `TreasureHuntResults` | policy numbers + wallet outcome | ✅ |
| `EconomyEntryNotice` | allocation *status* text only — renders no number | n/a |
| `ArcadeTicketBalance` | Arcade **Ticket** qty (a different currency) | n/a |
| `BlobbiHUD` / `hud-primitives` / `PetStatusBar` / `VirtualWorld` | **no coin display at all** | n/a |
| Dev tools (`/dev/treasure-hunt`, `/dev/equipment`, Equipment Lab) | simulation only; never a Coin | n/a |

**No split.** The dangerous pattern the audit brief asked about (HUD on
inventory, shop on profile, or any equivalent) does not exist: all four
player-visible balances resolve through the single `useCoinBalance` hook, which
reads the single `useIslandInventory` query, keyed by pubkey (so logout/login
cannot expose another account's balance). A contract test pins the HUD reader
specifically (`coin-cutover.contract.test.ts:155-164`).

There is no coin counter in the persistent world HUD — the balance lives in the
profile modal, the shop and the pass dialog. That is a product observation, not
a migration defect.

---

## 7. Mine rewards

Migrated in `038fc5d` (`src/components/blobbi/MiningGame.tsx`).

| Question | Answer |
|---|---|
| Still awards 11125 `coins`? | **No.** The absolute-`coins`-republish-from-React-cache path is gone. |
| Grants official inventory Coins? | Yes — `grantCoins({opId, amount, label:'mine-reward'})` (`:88`). |
| Same canonical writer as everything else? | Yes. |
| Once per completed session? | Yes — one `opId` minted at **Start** (`:74`), plus a `finishedRef` guard (`:103`) covering both finish paths (auto + button). |
| Serialized? | Yes — cross-tab Web Lock + shared per-user write chain, inside the wallet. |
| Fresh relay read? | Yes — in-lock, and `refreshFromRelay()` on cave entry so energy isn't spent from a stale snapshot (`:69-72`). |
| Preserves unrelated inventory? | Yes — the lossless `buildInventoryTemplate` (items, contexts, grants, content, unknown tags all ride through). |
| Rollback / reconciliation? | No rollback (a published replaceable event cannot be un-published — correct). Reconciliation: durable ledger + read-back verification + `reconcileOp`. |
| Can refresh/retry duplicate? | **No.** The ledger short-circuits an applied `opId`; a blocked/ambiguous record refuses a second publish. |
| Cap / cooldown? | Balance ceiling only. **No per-session or per-day cap on mining income** — the drop table alone bounds it. See §10.2. |

Reward states are surfaced honestly in the results UI: `granting` / `applied` /
`ambiguous` / `failed` with distinct copy (`MiningGame.tsx:222-240`).

---

## 8. Beach rewards

Fully connected to the canonical wallet. Flow:

```
Start ─► reserveRewardedHunt(roundKey)          [cross-tab lock; daily slot; mints opId]
        └─ no slot ─► practice hunt (fully playable, pays nothing)
round runs ─► reportParticipation(opId, {digs, activeSeconds})   [refresh-safe]
finish ─► buildTreasureHuntResult(round)         [pure]
        ─► authorizeReward(result, opId)
             ├─ rewardEligibility()               [re-checked even on resume]
             ├─ calculateTreasureHuntReward()     [pure, deterministic, capped]
             ├─ finalizeBeachReward()             [amount fixed BEFORE any publish]
             └─ wallet.grantCoins({opId, …})      [canonical; same opId end-to-end]
```

- **Coin write path:** `useTreasureHuntRewards` → `provisional-authorization`
  → `coin-wallet.grantCoins`. One `opId` from reservation to Coins.
- **Item reward write path: none.** `TreasureHuntResult.specialCandidateFound`
  records *candidacy only* (`result.ts:16`, `types.ts:151`), and the production
  UI policy disables special generation outright
  (`treasure-hunt-config.ts:105-115`, `special.minCount/maxCount = 0`) precisely
  so the game never implies an item it does not grant. This is a deliberate,
  documented product gate, not a broken path.
- **Atomicity:** only one value write exists, so there is no partial-settlement
  question. The wallet *does* support `grantLines` for an atomic item+coin
  event, which is exactly the seam a future item reward would use.
- **One-succeeds-one-fails:** not reachable today (single write).
- **Idempotency:** two durable ledgers. The Beach ledger owns the slot and the
  fixed amount; the wallet ledger owns exactly-once publication. Both keyed by
  the same `opId`.
- **Retry:** `finalized` (amount fixed, grant unconfirmed) → re-run
  `grantCoins` under the same `opId`; `ambiguous` → **read-only** reconciliation
  only, never a blind re-publish (`useTreasureHuntRewards.ts:200-235`).
- **Unresolved outcomes:** startup recovery scans the ledger, abandons stale
  reservations per the participation rule, and surfaces `pendingOps` for
  explicit recovery.
- **Caps:** `maxCoinsPerRound: 25`, `rewardedHuntsPerWindow: 10` per UTC day,
  plus a monotonic-window guard against naive clock-rollback farming.

The trust model is stated repeatedly and accurately in the source: this is a
**provisional, client-trusted** issuance path. The ledgers/locks/read-backs
prevent accidental duplication and loss — not cheating.

---

## 9. Shops, Arcade Pass, and kind:11125 status

### 9.1 Shop spending — fully migrated, and strictly better than before

| Aspect | State |
|---|---|
| Prices | `src/inventory/shop-catalog.ts` — validated against the official registry; only `consumable` categories may be priced, so **currency can never be sold for currency** (`:130-141`) |
| Balance | `useCoinBalance` for display; the **wallet's fresh in-lock read** for the actual charge |
| Deduction | `spendCoins` |
| Item grant | `grantLines` on the **same** `spendCoins` operation |
| Atomic? | **Yes — one kind:31633 replacement event carries charge + items.** The old two-event "items granted but coins not charged" leak is structurally gone |
| Touches owner profile? | **No** |
| All shops on one path? | Yes — `usePurchaseItem` (single) and `useBatchPurchase` (cart) both call `spendCoins`; `FoodShopModal` is the only shop UI |
| Free items | Skip the wallet entirely; plain inventory grant |

### 9.2 Arcade Pass — fully migrated

Reads `useCoinBalance`, spends via `spendCoins` with a per-attempt `opId`
(`ArcadePassModal.tsx:67,98`). Insufficient funds are rejected by the wallet
against a fresh read, not against the rendered number. A synchronous
`inFlightRef` guard prevents same-tick double-charge (`:86`). Ambiguous
outcomes get their own honest copy.

**`useCoinsMutation` is gone** — file deleted, zero importers, and a contract
test keeps it deleted. No other legacy Coin-specific profile mutation
abstraction exists anywhere in `src/`.

### 9.3 kind:11125 after the migration

| Question | Answer |
|---|---|
| `coins` still in the current type? | Yes — `OwnerProfile.coins?: number` and `OwnerProfileOptionalTags.coins?: string`, both carrying explicit OBSOLETE doc comments |
| Still parsed? | Yes — `blobbi-parsers.ts:91` |
| Still serialized / published? | **No.** Removed from `MANAGED_OWNER_PROFILE_TAG_NAMES`; the serializer emits no `coins` tag; a pre-existing tag rides the unknown-tag passthrough verbatim |
| Read only for backward compat? | Yes — and in fact read by *nothing*. It is inert data, not even a fallback |
| Tests pin it as current behavior? | No. `blobbi-profile-storage-opacity.test.ts:88` asserts the tag still *parses* and survives republish — that's compat, not canonicity |
| Docs still call it the balance? | **Yes, in three places** — see §11 |

This is the correct end state: **legacy read compatibility** without **legacy
production ownership**. Deleting the parse is *not* recommended — it is
deliberate, documented, and harmless, and it keeps the historic tag shape
legible.

---

## 10. Findings

### 10.1 The two Arcade Ticket writers bypass the shared serialization — a real drift risk on the shared kind:31633 event

> **RESOLVED** by `fix(economy): preserve coin deltas and serialize shared
> inventory writes`. Both writers now run inside `runInventoryTransaction`
> (`src/inventory/inventory-transaction.ts`), on the same cross-tab lock name
> and the same per-tab chain as the Coin wallet, with the shared monotonic
> `created_at`. The same commit fixed a MORE severe defect this audit missed —
> see §10.4. Kept below as the record of what was found.

`src/inventory/arcade-reward-writer.ts` and
`src/inventory/arcade-prize-spend-writer.ts` do a fresh read, mutate through the
canonical helper, and build with the canonical lossless template — all correct.
But unlike **every other** kind:31633 writer they:

- do **not** call `serializeInventoryWrite(pubkey, …)` (the shared per-user
  write chain), and
- do **not** take the cross-tab Web Lock, and
- use `created_at: Math.floor(Date.now()/1000)` with **no monotonic bump**
  (`arcade-reward-writer.ts:165`, `arcade-prize-spend-writer.ts:153`), while the
  Coin wallet uses `max(now, previous.created_at + 1)` specifically to avoid
  same-second NIP-01 ties.

Failure mode: a ticket grant and a Coin mutation whose read-modify-write windows
overlap both build from the same base; kind:31633 is replaceable, so
newest-wins silently discards the loser's delta — which may be the Coin change.

**This is not a leftover from the migration; it predates it.** But it *became*
relevant at the cutover: before, Coins lived in kind:11125 and an arcade write
physically could not touch them. Now Coins and Tickets share one event.

Likelihood is moderate (arcade play and coin spending are usually sequential,
but multi-tab and retry paths overlap); severity is a silently lost Coin
grant or an uncharged spend. The fix is small and local: route both writers
through `serializeInventoryWrite` + the cross-tab lock and adopt the monotonic
`created_at`.

### 10.2 No Mine income cap

Beach income is bounded three ways (per-round cap 25, 10 rewarded hunts per UTC
day, minimum participation). The Mine has **none** of these — only the gem drop
table and player patience. Not a correctness bug, and out of scope for a
migration audit, but it is the one place the two Coin sources are governed by
visibly different policy.

### 10.4 MISSED BY THIS AUDIT: a resolved-empty read was a valid publish base

The audit checked that every writer performed a *fresh* read; it did not ask
what happens when that read RESOLVES EMPTY. Because kind:31633 is replaceable,
building on an empty base does not lose a delta — it replaces the player's
entire inventory. A relay that does not carry (or has not caught up with) the
event turned a `+20` Mine reward into a total balance of 20, wiping Coins,
Arcade Tickets and every consumable, and the write even read back as verified.

Fixed by `readAuthoritativeInventoryBase`
(`src/inventory/useIslandInventory.ts`), which confirms an empty answer with a
second read before it may become a publish base, and is now used by the shared
transaction primitive AND by `useInventoryMutation`. Regression coverage:
`coin-delta-invariant.test.ts`, `mine-reward.regression.test.ts`,
`inventory-write-topology.contract.test.ts`.

### 10.3 Non-findings, checked and cleared

- **Dual-source drift between 11125 and 31633:** impossible. Nothing writes
  11125 `coins`, nothing reads it, and the two are never summed or compared.
- **Optimistic-cache split keys:** none. One query key,
  `inventoryQueryKey(pubkey)`, invalidated by the wallet in a `finally` after
  every outcome.
- **Stale balance across logout/login:** the query key is pubkey-scoped.
- **Old events overwriting new Coin state:** guarded by fresh in-lock reads and
  the wallet's monotonic `created_at`.
- **Double bootstrap / double allocation:** the marker + quantity travel in one
  replaceable event, the in-lock `precondition` re-checks the marker on the
  exact base, and the op id is stable (never randomly minted). A rejected read
  is treated as *unknown*, never as *empty* — the service publishes nothing
  rather than fabricating a base.
- **Coin caught by `max_stack:1` machinery:** no. `LAB_OFFICIAL_ITEMS` is
  projected from `ADDRESSED_OFFICIAL_COSMETICS` + effect items only; the Coin is
  in neither list, so no bulk lab action, no `normalize-stacks` repair and no
  `/dev/equipment` simulation can reach it.
- **Coin equippable:** no. `useEquippableCosmetics` iterates
  `ADDRESSED_OFFICIAL_COSMETICS` only.
- **Coin consumable:** no. `action: null` and `useUseItem` throws on a null
  action (`useUseItem.ts:115-117`).
- **Coin as an arcade prize:** no. The six-prize catalog is hardcoded to three
  cosmetics + three effects.
- **Coin degraded to `unknown` category:** no — `currency` survives the whole
  adapter path, pinned by `src/inventory/currency-category.test.ts`.
- **Currency sold in the shop:** structurally impossible —
  `CONSUMABLE_ITEM_CATEGORIES` excludes `currency`, and pricing a non-consumable
  is a hard validation error.

---

## 11. Documentation needing updates

Three documents still describe kind:11125 as the live balance:

| Doc | Lines | Stale claim |
|---|---|---|
| `docs/INVENTORY_MANUAL_VALIDATION.md` | §3, ~58–69 | "Coins decrease in **11125** by the local shop price"; "Ordering: item grant (31633) publishes BEFORE coin deduct (11125). On coin failure, item is kept and a partial-success warning is shown (favor-user)". **All three statements are now wrong** — the purchase is one atomic event |
| `docs/arcade-foundation.md` | ~448–457 | "`useCoinsMutation` resolving means … the freshest available kind:11125 was fetched…" — describes a deleted module and a retired publish model |
| `NIP.md` | 27, ~68 | Summary row still reads "Player profile: coins, owned pets…"; the notable-tags list still shows `["coins", "<number>"]` with no obsolete marker (unlike the inventory note directly beneath it, and unlike the accurate note at line 124) |

Already correct and needing nothing: `blobbi-coin-cutover.md`,
`INVENTORY_ARCHITECTURE.md`, `blobbi-dance.md`, `arcade-prize-counter.md`,
`docs/protocol/blobbi-island-event-registry.md`, and both prior audits (each
carries an explicit superseded/historical status header).

---

## 12. Migration matrix

| Surface | Old model | Current model | Status | Required action |
|---|---|---|---|---|
| HUD / profile balance (`BlobbiInfoModal`) | 11125 `coins` | 31633 Coin qty via `useCoinBalance` | **complete** | none |
| Mine reward | 11125 absolute republish from React cache | `coin-wallet.grantCoins`, one opId/session | **complete** | none (income cap is a product question, §10.2) |
| Beach Coin reward | did not exist | `coin-wallet.grantCoins` via provisional authorizer | **complete** | none |
| Beach item reward | did not exist | candidacy only; special generation disabled | **intentionally not connected** | none unless the product wants item drops |
| Shop spend | two events (item 31633 + coins 11125), favor-user leak | one atomic `spendCoins` + `grantLines` | **complete** | none |
| Arcade Pass | `useCoinsMutation` → 11125 | `spendCoins`, fresh-read affordability | **complete** | none |
| Owner profile (kind:11125) | canonical balance holder | inert parsed field; never serialized | **complete (legacy compat)** | keep the parse; update docs (§11) |
| Initial allocation | coupled to first-egg adoption / legacy bootstrap | marker-proven, atomic, once per pubkey | **complete** | none |
| Dev tools | n/a | simulation-only; never touch a Coin | **complete** | none |
| Arcade Ticket writers | n/a (tickets always lived in 31633) | shared `runInventoryTransaction` | **complete** | none — fixed after this audit (§10.1) |
| Any 31633 publish base | fresh read, empty answer trusted | fresh read, empty answer **confirmed** | **complete** | none — fixed after this audit (§10.4) |

---

## 13. Recommended next phase

> **DONE.** Implemented in `fix(economy): preserve coin deltas and serialize
> shared inventory writes`, together with the §10.4 empty-base fix. The
> original recommendation is preserved below.

> **Serialize the two Arcade Ticket writers onto the shared kind:31633 write
> path.**

Narrow and mechanical:

1. Wrap `publishTicketGrant` (`arcade-reward-writer.ts`) and the prize spend
   (`arcade-prize-spend-writer.ts`) in `withQueuedCrossTabLock` +
   `serializeInventoryWrite(pubkey, …)`, exactly as `coin-wallet.ts:305-308`
   does.
2. Adopt `created_at = max(now, previous.created_at + 1)`, which means reading
   the raw event (`fetchInventoryWithMeta`) instead of `fetchInventory`.
3. Extend `coin-cutover.contract.test.ts` with a "every kind:31633 writer is
   serialized" contract so a future writer cannot skip the chain.
4. Add a regression test for interleaved ticket-grant / coin-spend.

This closes the only remaining path by which a Coin balance can be silently
lost, and it is cleanup — not a redesign. Everything else in the Coin cutover is
done.

**Explicitly not recommended:** deleting the kind:11125 `coins` parse (§9.3),
any further migration work, or a Beach item-reward implementation (that is a
product decision, and the wallet's `grantLines` seam is already in place for it).
