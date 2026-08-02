# Blobbi Coin — the Official Currency Cutover and Provisional Beach Rewards

Status: **implemented.** The canonical production Coin balance is the official
Blobbi Coin quantity in the player's kind:31633 inventory. kind:11125 `coins`
is deprecated (historical, preserved, never active). Beach Treasure Hunt pays
provisional, client-trusted Coin rewards.

Supersedes the "current state" sections of
`docs/coin-economy-migration-audit.md` (the audit's findings drove this
implementation; its risk analysis remains the reference).

---

## 1. The official Coin

- **Identity (canonical, stable):**
  `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:coin`
- Issuer: the official item issuer (same trust root as all official items).
- Definition: issuer-signed kind:31632, `d = blobbi:currency:coin`, name
  "Blobbi Coin", type/category `currency`, front+back Blossom artwork,
  symbol 🪙. Registered in `src/protocol/event-registry.ts` and resolved
  through the established official-item path (exact-issuer trust, bundled
  fallback offline). The currently observed revision's event id is recorded
  in `src/inventory/coin.ts` **for diagnostics only — never identity**.
- `max_stack` is intentionally absent from the published definition (optional
  per the inventory spec; games MAY ignore it). The application enforces its
  own ceiling, `MAX_COIN_BALANCE = 1_000_000_000`
  (`src/inventory/coin.ts`), in the wallet — violations are rejected, never
  silently clamped.
- One identity module: `src/inventory/coin.ts` (`BLOBBI_COIN_ADDRESS`,
  `BLOBBI_COIN_D`, `BLOBBI_COIN_ISSUER`, `BLOBBI_COIN_SYMBOL`, images,
  amount validation). No feature duplicates the event JSON.

## 2. The canonical wallet

`src/inventory/coin-wallet.ts` (`createCoinWallet`) is the ONLY production
mutation surface, generalizing the arcade ticket writer's guarantees:

- amounts: integer, positive, ≤ ceiling; zero and fractions rejected; no-ops
  never publish;
- exactly-once per operation id via the durable Coin op ledger
  (`src/lib/coin-op-ledger.ts`): `prepared → publishing → applied /
  ambiguous / failed`, one-way doors, read-back-verified persists, **no
  record ⇒ no publish**;
- queued cross-tab Web Lock (`src/lib/cross-tab-op-lock.ts`) + the shared
  per-tab inventory write chain;
- fresh newest-event read (raw, for `created_at`) before every build;
  deterministic latest selection;
- `created_at = max(now, previous + 1)` — no same-second ties;
- **strict publish**: a timeout or unclassifiable error is `ambiguous`, never
  success; ambiguity reconciles read-only (balance vs recorded
  `balanceBefore`) and never blind-retries;
- read-back verification (`applied.verified`);
- unrelated inventory entries ride the canonical builder untouched;
- optional `grantLines`: item grants in the SAME replacement event — shop
  purchases are now atomic (charge + items in one event), retiring the old
  "items granted but coins not charged" leak.

Reads: `useCoinBalance()` (from the canonical inventory query; `null` while
unknown — an unavailable balance is never a fake zero).

**Honest limits:** ledger and locks are per browser profile; cross-device
gives no exactly-once (bounded: op ids never leave the device that minted
them). Nothing here is server-authoritative or cheat-proof.

## 3. Legacy bootstrap (kind:11125 → kind:31633)

`src/inventory/useCoinBootstrap.ts`, fixed op id `legacy-coin-bootstrap`:

- idempotent (durable ledger), refresh-safe, fresh reads of BOTH sides,
  serialized through the wallet, read-back verified, ambiguous surfaced;
- an already-populated inventory with no local record is treated as
  migrated-elsewhere and NEVER re-credited (the cross-device guard);
- zero/invalid/missing legacy values are recorded as durable no-ops;
- afterwards the old `coins` tag stays on the profile **verbatim as
  history**: it left the managed tag set (`blobbi-parsers.ts`), rides the
  unknown-tag passthrough on every republish, is read by nothing but the
  bootstrap, and is displayed nowhere. No summing of legacy + inventory.

**New players:** profile creation writes NO `coins` tag. The initial
`INITIAL_BLOBBONAUT_COINS` (200) allocation is a wallet grant with fixed op
id `initial-coin-grant` after the profile publish in `useFirstEggAdoption` —
exactly-once across retries, and a partially-failed adoption can re-run
`finalize` safely.

## 4. Production cutover (complete)

| Surface | Now |
|---|---|
| HUD chip (`BlobbiInfoModal`) | `useCoinBalance` + bootstrap state; official artwork w/ 🪙 fallback; loading/ambiguous/error states; no `?? 0` |
| Food Shop / batch + single purchases | ONE atomic wallet spend (`grantLines`); affordability from the canonical balance; ambiguous surfaced, never retried |
| Arcade Pass | wallet spend (op per attempt); ambiguous grants no pass and says so honestly |
| Mine payout | wallet grant, op id minted at session start; states granting/applied/ambiguous/failed+retry; fresh status re-read on cave entry |
| `useCoinsMutation` (old 11125 writer) | **deleted** |
| `useUpdateOwnerProfile` / `useCreateOwnerProfile` | no coin fields; update refuses an empty cache base (no more tag wipes / fabricated profiles) |
| `useSetCurrentCompanion` | selects the NEWEST profile (sorted) before republishing — the stale-rollback hazard is closed |
| `useOptimizedStatus.updateOwnerCoins` | removed |
| Contract tests | `src/inventory/coin-cutover.contract.test.ts` pins: no production `['coins', …]` authoring, no dual-read fallback, wallet-only mutations, writer stays deleted |

## 5. Beach Treasure Hunt rewards (provisional)

**Access:** free — no entry fee, no energy, no consumables; the shack never
locks. **Limited:** rewards, 10 rewarded hunts per UTC-day window
(`src/beach/rewards/policy.ts`); unlimited practice afterwards, clearly
labeled.

**Round eligibility:** started as a rewarded hunt (slot reserved at START,
cross-tab atomic), legitimately finished (time expired / shovel spent / all
found / explicit end past the floor), ≥ 1 accepted dig AND ≥ 20 s active —
except a full all-targets clear, which qualifies at any speed. Abandoned
rounds earn nothing.

**Abandonment rule (documented in the UI):** an abandoned hunt consumes its
slot only after the participation floor was crossed; an immediate close
releases it. Participation is written to the durable ledger during play, so
a refresh applies the same rule.

**Formula** (`src/beach/rewards/coin-reward.ts`, deterministic, integer):
`total = min(25, base 4 + rawCleanupValue×1 + rawTreasureValue×1)`.
Litter contributes positively (1/unit); valuables more (2–6/unit). No
multipliers, no jackpot, no randomness after generation, no item value.

**Simulated economics** (500 seeded rounds, deterministic 5-perfect-dig
player — the competent-play ceiling; pinned by
`src/beach/rewards/coin-reward.test.ts`):

| min | p10 | p25 | median | p75 | p90 | max | mean |
|---|---|---|---|---|---|---|---|
| 9 | 12 | 14 | 16 | 18 | 20 | 25 (cap) | 15.9 |

All-miss valid floor: 4. Realistic play (1–2 misses typical) lands in the
approved 12–15 band; each miss forgoes ≈ 2.4 expected Coins. Ceilings:
≈ 8–9 Coins/min while rewarded slots last; hard daily maximum 10 × 25 = 250,
typical ≈ 120–160. Tuned against shop prices (10–150), NOT against the old
Mine's exploitable rates.

**Special candidate:** generation disabled in the production UI policy
(special slot 0). The pure model keeps the concept; no item reward is
granted or implied.

**Exactly-once pipeline:** window slot reservation (Beach ledger,
`src/lib/beach-reward-ledger.ts`: `reserved → finalized → applied /
ambiguous / abandoned`, released-when-early) → amount finalized durably →
wallet grant under the SAME op id → outcome recorded. Refresh mid-gameplay
abandons the round (per the rule) but a FINALIZED reward intent survives and
resumes; `ambiguous` reconciles read-only; unresolved ops surface on the
intro with explicit recovery actions. The window key is monotonic (never
moves back past a window with operations), blunting clock-rollback farming.

**Provisional authorization**
(`src/beach/rewards/provisional-authorization.ts`): the TEMPORARY,
client-trusted layer that verifies eligibility, fixes the amount and invokes
the wallet. The `TreasureHuntRewardAuthorizer` interface is the replacement
seam: a future issuer-grant flow (request → verify official grant → apply)
swaps in WITHOUT touching the game model, result calculation, reward
formula, HUD, shop spending or the balance reader. It is never called an
official grant anywhere.

## 6. Trust model, stated once more

The Coin item is real and issuer-signed. Balances and rewards are
self-published by the player's client. Ledgers, locks, fresh reads,
monotonic timestamps and read-backs protect **operational correctness**
(exactly-once, no stale clobbering, no accidental duplicates, refresh
safety). They do NOT prove honest play; a modified client can publish any
balance. Client-side daily limits can be manipulated by a determined user.
None of this is server-authoritative, cheat-proof or cryptographically
guaranteed, and no UI copy claims otherwise.

## 7. Operational recovery states

| State (Coin op / Beach op) | Meaning | Recovery |
|---|---|---|
| `failed` / `finalized` | provably unsent | safe retry (same op id) |
| `publishing` | crashed mid-flight | treated as possibly-published → reconcile |
| `ambiguous` | may have landed | read-only reconcile; UI surfaces; never blind retry |
| `applied` | done (verified or unverified read-back) | terminal |
| Beach `reserved` (stale) | refresh killed the round | consumed/released per the participation rule |

Dev simulation: `/dev/treasure-hunt` injects a fully MOCKED reward service
(in-memory; publishes nothing) with selectable grant/recovery outcomes
(applied / timeout-ambiguous / fail-before-publish) and a simulated refresh —
no real publishing exists on that route.
