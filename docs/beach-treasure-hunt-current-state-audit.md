# Beach Treasure Hunt: Current-State Audit

Audit-only. No production code was changed, nothing published.

- **Branch:** `production` · **HEAD:** `24fa40ef807e111733115f8c3b3fa5bd0888199d`
- **Working tree:** clean · `nostr/production` = HEAD · `origin/main` 23 behind
- **Validation:** `npm test` → exit 0 (239 files / 4690 tests passed)
- Companion: [`coin-economy-current-state-audit.md`](coin-economy-current-state-audit.md)

---

## 1. Verdict

> **Complete and reward-connected.**
>
> The minigame is fully implemented end-to-end, entry point, gameplay,
> results: and its Coin payout is settled through the canonical kind:31633
> Coin wallet. The one unconnected piece, the rare-item ("special") reward, is
> **deliberately gated off in production**, not missing by accident.

Roughly 7 160 lines across 48 files landed in `e9a48a3` (gameplay) and were
connected to the economy in `038fc5d` (rewards). Every module below is reached
from a production route; nothing is dead or unwired.

---

## 2. Architecture

Three strictly separated layers, in the same discipline as the Arcade:

| Layer | Location | Purity |
|---|---|---|
| **Model** | `src/beach/treasure-hunt/` (10 modules + 6 test files) | Pure. No React, DOM, timers, audio, Nostr or storage. A round is reproducible from `(seed, policy, actions)` |
| **Reward** | `src/beach/rewards/` + `src/lib/beach-reward-ledger.ts` + `src/hooks/useTreasureHuntRewards.ts` | Pure calculation, separated from provisional authorization, separated from the wallet |
| **View** | `src/components/blobbi/beach/` | `TreasureHuntModal.tsx` (29 lines) is the production wrapper that injects the real reward service; `TreasureHuntModalView.tsx` (525 lines) imports **no** wallet/ledger/relay code, which is what lets the dev harness and tests drive the full flow with an in-memory fake, a boundary held by the import graph, not by convention |

---

## 3. Feature checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Beach interactable / shack entry | **COMPLETE** | `interactive-elements-config.ts:255-258` (`treasure-shack`), `InteractiveElements.tsx:703`, `TreasureHuntShack.tsx`, `beach-shack-config.ts` (explicit stand point `{x:74,y:84}` inside the walkable arch, mirrored art, z-15), `InteractiveElements.beach-shack.test.tsx` (184 lines) |
| 2 | Intro / how-to-play modal | **COMPLETE** | `TreasureHuntIntro.tsx` (162 lines): rules, controls, and the reward/practice mode distinction |
| 3 | Start Hunt flow | **COMPLETE** | `TreasureHuntModalView.tsx`, `intro → playing` with slot reservation at Start |
| 4 | Dedicated gameplay scene | **COMPLETE** | `TreasureHuntGame.tsx` (679 lines) inside `ArcadeGameShell` (shared containment/immersive shell) |
| 5 | Blobbi hidden/paused during play | **COMPLETE** | `onActorSuppressionChange`: **local-only**, applied during `searching`/`results` but not `intro`; explicitly never wired to the published hidden pose so remote players still see the Blobbi at the shack (`PlayingView.tsx:140-146`, `InteractiveElements.tsx:68`) |
| 6 | Draggable detector | **COMPLETE** | `TreasureHuntGame.tsx`, coil follows the clamped pointer mapping |
| 7 | Pointer + touch handling | **COMPLETE** | `preventDefault` + cached rect + `setPointerCapture` (`:242`), all four terminators (`up`/`cancel`/`lostpointercapture`/`blur`), `touch-none select-none` (`:398`), `[data-treasure-field]` CSS rule (`index.css:1084`). 423-line dedicated pointer test |
| 8 | Signal from proximity | **COMPLETE** | `detector.ts` `evaluateDetectorSignal`: intensity + nearest distance only; **never leaks target coordinates** |
| 9 | Visual signal feedback | **COMPLETE** | `signalDisplayState` in `treasure-hunt-config.ts`; meter + coil glow |
| 10 | Audio / beep feedback | **COMPLETE** | `detector-audio.ts` (152 lines): no standing oscillator, self-terminating blips, interval doubles as anti-machine-gun throttle, pitch/cadence scale with intensity. Shares the one arcade `AudioContext` and the one persisted mute |
| 11 | Shovel tool | **COMPLETE** | tool toggle + `SHOVEL_CURSOR`, dig animation (`treasure-shovel-dig`) |
| 12 | Limited shovel uses | **COMPLETE** | `policy.shovelUses` → `round.shovelUsesRemaining`; exhaustion is an end reason |
| 13 | Digging near a target | **COMPLETE** | `digging.ts`, per-target `digRadius`; a target can never be dug twice (unit-tested) |
| 14 | Empty digs | **COMPLETE** | `DigResolution` `miss` consumes exactly one use; a **rejected** attempt (invalid/out-of-field/no uses) consumes zero; never silently clamped |
| 15 | Target generation | **COMPLETE** | `generator.ts` (223 lines) + 190-line test |
| 16 | Seeded deterministic generation | **COMPLETE** | `random.ts`, `round.seed`; harness accepts a seed override |
| 17 | Litter finds | **COMPLETE** | `category: 'litter'`, `rawCleanupValue` (cleanup framing) |
| 18 | Valuable finds | **COMPLETE** | `category: 'valuable'`, `rawTreasureValue` |
| 19 | Rare item finds | **PARTIAL, deliberately disabled in production** | The model fully supports `category: 'special'`, but `TREASURE_HUNT_UI_POLICY` sets `special.minCount = maxCount = 0` (`treasure-hunt-config.ts:105-115`) with the reason stated inline: the current reward policy grants Coins only, so generating a "special" would imply an item reward the product does not grant. Production rounds resolve to 5 litter + 4 valuables |
| 20 | Round timer / end conditions | **COMPLETE** | Four end reasons: `time-expired`, `no-shovel-uses`, `all-targets-found`, `ended-by-player`; drift-resistant `useFixedStepLoop` |
| 21 | Results screen | **COMPLETE** | `TreasureHuntResults.tsx` (206 lines): finds breakdown + reward phase |
| 22 | Cleanup reward calculation | **COMPLETE** | `coin-reward.ts` `cleanupCoins = rawCleanupValue × 1` |
| 23 | Treasure Coin reward calculation | **COMPLETE** | `treasureCoins = rawTreasureValue × 1`, `base 4`, capped at 25, `capped` surfaced honestly |
| 24 | **Real Coin settlement** | **COMPLETE** | `provisional-authorization.ts:113` → `coin-wallet.grantCoins`: the canonical kind:31633 writer, same one the Mine, shops and Pass use |
| 25 | Real item grant settlement | **NOT IMPLEMENTED (by design)** | `specialCandidateFound` is candidacy only (`result.ts:16`, `types.ts:151`); no `grantLines` used. The wallet's `grantLines` is the ready-made seam for this |
| 26 | Reward cap / anti-repeat / round-id | **COMPLETE** | `maxCoinsPerRound: 25`; `rewardedHuntsPerWindow: 10` per UTC day; one `opId` from reservation → grant; `roundKey` recorded; **two** durable ledgers (Beach slot/amount + wallet exactly-once); monotonic-window guard against naive clock rollback; minimum participation (≥1 dig **and** ≥20 s, waived on `all-targets-found`) |
| 27 | Dev harness | **COMPLETE** | `/dev/treasure-hunt` (`AppRouter.tsx:134`, `DevTreasureHunt.tsx` 441 lines): seed/policy/overlay controls, mock reward service, simulation-only; `dev-routes.test.ts` asserts it is dev-gated, and the view layer's import graph proves it cannot write |
| 28 | Asset registry / final assets | **COMPLETE** | Final art committed, not placeholders: `treasure-shack.webp`, `sand-playfield.webp`, `dug-hole.webp`, `metal-detector.svg`, `shovel.svg`. Single registry `TREASURE_HUNT_ASSETS`; components never hardcode a path. Detector calibration derives the sensing point from the SVG viewBox so artwork padding can change without touching detector math |
| 29 | Mobile behavior | **COMPLETE** | `touch-none`, pointer capture, `[data-treasure-field]` CSS, isotropic field units (a field unit is the same pixel count in x and y, so drags feel identical in both axes), missing-pointer-API environments degrade to "coarse" rather than crashing (`:108`) |
| 30 | Reduced-motion / audio cleanup | **COMPLETE** | `useReducedMotion` + harness override; `@media (prefers-reduced-motion: reduce)` blocks for the shack hop and shovel dig (`index.css:1136-1150`); audio `dispose()` releases every node, and Web Audio absent yields a working **silent** engine, a run is never refused for lack of audio |

**Score: 28 COMPLETE, 1 deliberately-gated PARTIAL, 1 by-design NOT IMPLEMENTED, 0 DEAD/UNWIRED.**

---

## 4. Reward settlement, in detail

```
Start
 └─ reserveRewardedHunt(roundKey)         cross-tab lock; daily slot; mints opId
      ├─ slot available ─► REWARDED hunt
      └─ no slot / logged out ─► PRACTICE hunt   (fully playable, pays nothing)

round runs
 └─ reportParticipation(opId, {digs, activeSeconds})     refresh-safe

finish
 ├─ buildTreasureHuntResult(round)        pure; throws on an unfinished round
 └─ authorizeReward(result, opId)
      ├─ rewardEligibility()              re-checked even on resume, a reservation is never authorization
      ├─ calculateTreasureHuntReward()    pure, deterministic, capped
      ├─ finalizeBeachReward()            amount fixed DURABLY before any publish
      └─ wallet.grantCoins({opId, …})     canonical kind:31633 writer
```

- **Coin write path:** canonical. Same `opId` from reservation to Coins, so the
  Beach ledger and the wallet ledger agree on one logical operation.
- **Item write path:** none (§3 item 25).
- **Atomicity:** one value write, so partial settlement is not reachable. Had an
  item reward existed, `grantLines` would put both sides in one event.
- **Failure semantics:**
  - provably-unsent (signer, ledger, cap) → `failed`, op stays `finalized`,
    retry is safe;
  - publish timeout/unknown → `ambiguous`, recorded durably, resolved by
    **read-only** reconciliation, never a blind re-publish;
  - `already-applied` → idempotent success, no publish.
- **Refresh mid-round:** startup recovery abandons stale reservations
  (>10 min) applying the participation rule, and surfaces `pendingOps` for
  explicit recovery of `finalized`/`ambiguous` operations.
- **Practice mode** is fully playable and pays nothing, playing is free, only
  *rewards* are rate-limited.

### Trust model

Stated accurately and repeatedly in the source: this is a **provisional,
client-trusted** issuance path. The ledgers, locks, fresh reads and read-backs
give exactly-once application and refresh-safety; they are **not** cheat
protection. `TreasureHuntRewardAuthorizer` is the documented seam a future
issuer-grant flow replaces; the model, formula, HUD, shop and balance reader all
sit on the far sides of it and would not change.

---

## 5. Test coverage

| Area | File | Size |
|---|---|---|
| Generator | `generator.test.ts` | 190 |
| Reducer | `reducer.test.ts` | 311 |
| Detector | `detector.test.ts` | 163 |
| Digging | `digging.test.ts` | 111 |
| Policy | `policy.test.ts` | 182 |
| Result | `result.test.ts` | 160 |
| Coin reward math | `coin-reward.test.ts` | 175 |
| Provisional authorization | `provisional-authorization.test.ts` | 178 |
| Beach reward ledger | `beach-reward-ledger.test.ts` | 127 |
| Modal / full flow | `TreasureHuntModal.test.tsx` | 591 |
| Pointer + touch | `TreasureHuntGame.pointer.test.tsx` | 423 |
| Field transform | `field-transform.test.ts` | 138 |
| UI config | `treasure-hunt-config.test.ts` | 215 |
| Shack interactable | `InteractiveElements.beach-shack.test.tsx` | 184 |
| Dev harness | `DevTreasureHunt.test.tsx` | 99 |

All green in the focused run (43 files / 537 tests) and in the full suite.

---

## 6. Gaps and open product decisions

Neither is a defect:

1. **Rare-item reward.** The model supports `special` targets; production
   generates none, because granting a real kind:31632 item would need the
   grant path (`grantLines`), an item choice, drop odds, and an anti-farm
   policy. Turning it on is a product decision, and the seam exists.
2. **No Beach Coin sink.** The Beach only produces Coins. If economy balancing
   is next, note the asymmetry with the Mine, which has no income cap at all
   (see the Coin audit §10.2) while the Beach is bounded three ways.

---

## 7. Recommended next phase (Beach-specific)

**None.** The Beach is done for its current scope. The one repository-wide gap
worth fixing next is not on the Beach; it is serializing the two Arcade Ticket
writers onto the shared kind:31633 write path, detailed in
[`coin-economy-current-state-audit.md`](coin-economy-current-state-audit.md) §13.

If the Beach is revisited later, the natural next step is the rare-item reward
(item 25 + item 19 together), not more gameplay.
