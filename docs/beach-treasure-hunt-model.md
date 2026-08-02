# Beach Treasure Hunt — the pure game model (Beach 1A)

`src/beach/treasure-hunt/` is the deterministic, framework-free simulation
behind the future Beach metal-detector minigame. It follows the same purity
contract as `src/arcade/hockey/`: no React, no DOM, no timers, no audio, no
Nostr, no storage — a round is reproducible from `(seed, policy, actions)`.
Background and phasing: `docs/beach-treasure-hunt-audit.md`.

## Coordinates

Normalized logical coordinates over a rectangular sand field: `x` in
`0..fieldWidth`, `y` in `0..fieldHeight` (both `1` by default). The UI maps
pointer events into this space later; the model never sees pixels. Invalid
points are **rejected, never clamped** — a silently-moved dig would lie to
the player.

## Seeds

The public seed is a string, hashed to a uint32 with FNV-1a
(`treasureSeedFrom`) and threaded through mulberry32 (`nextRandom`) — the
same pair `hockey/match.ts` and `pool/rack.ts` carry, copied so the beach
does not depend on arcade modules. Same seed + same policy → identical
composition, categories, kinds, ids and positions. Nothing calls
`Math.random()` (pinned by a test that poisons it).

## Policy

Every tunable number lives in `policy.ts` (`DEFAULT_TREASURE_HUNT_POLICY`):
field bounds, 120 s duration, 9 targets, 5 shovel uses, category composition
ranges, edge padding, minimum separation, initial-coil exclusion, detection
and dig radii, the signal curve, per-kind unit values, and the placement
attempt budget. `validateTreasureHuntPolicy` throws on invalid configuration
(a bug at the call site); nothing is silently clamped.

## Generation

`generateTreasureTargets` draws a composition from the valid combination
list, shuffles category order, and rejection-samples positions under the
constraints (padding, separation, exclusion). If a seed cannot satisfy a
tight-but-valid policy within the attempt budget it returns a typed
`{ ok: false, failure: { code: 'placement-exhausted' } }` — a round never
quietly has fewer targets than the policy says. `validateTargetLayout`
re-checks any layout from the outside.

## Detector signal

`evaluateDetectorSignal(coil, targets, policy)` returns
`{ intensity, nearestTargetId, nearestDistance, activeTargetCount }` and
never a target coordinate. Per target: silent at/beyond `detectionRadius`,
saturated to `signalWeight` at/inside `signalSaturationDistance`, otherwise
`w · ((R−d)/(R−S))^k`. **Overlap rule: strongest wins** (maximum, not sum) —
summing would let two far targets impersonate one close one. The pure value
carries no random noise; audio/visual wobble is presentation, layered later.

## Digging

`resolveDig` rejects non-finite (`invalid-position`) and outside-field
(`out-of-field`) points and empty budgets (`no-shovel-uses`) — rejections
consume nothing. A valid attempt consumes exactly one use; only the
**closest** unresolved target within its own `digRadius` is revealed, ties
resolving to placement order. A found target is never eligible again.

## Lifecycle

`ready ──start──► searching ──(end)──► finished`, driven by the pure
`treasureHuntReducer` over semantic actions (`start`, `move-detector`,
`dig`, `advance-time`, `end-round`). Time advances only by explicit positive
finite deltas, capped at the duration. Rejected actions return the same
state reference; a finished round is inert, so a round ends exactly once.
End reasons: `time-expired`, `no-shovel-uses`, `all-targets-found`,
`ended-by-player`. **Precedence** when one dig triggers two conditions:
`all-targets-found` outranks `no-shovel-uses` (success beats running out);
`time-expired` can only arise from `advance-time`, which triggers nothing
else.

## Result

`buildTreasureHuntResult` projects a **finished** round (unfinished throws)
into an economy-neutral `TreasureHuntResult`: end reason, duration, dig
statistics, finds grouped by category, `rawCleanupValue` /
`rawTreasureValue` in abstract units, and `specialCandidateFound`.

**Units are not Coins.** Mapping units to Coins is the reward boundary
(`src/beach/rewards/` + `docs/blobbi-coin-cutover.md`) — this model still
grants nothing, mutates nothing, and publishes nothing. The special
candidate remains a model concept only; the production policy disables its
generation and no item is granted.

## Round identity

`roundId` is a deterministic FNV-1a hash of `(seed, roundKey)` — a
simulation label for logs, tests and the dev harness. It is **not** a
redemption receipt: Beach 2 introduces a separate durable
reward-redemption identity (ledger-backed, exactly-once) on top of it.

## Trust

The model runs in the client. Determinism and validation protect against
bugs and accidental duplication — they are not cryptographic anti-cheat.
The economy remains trusted to the official client, exactly as documented
in the audit.

## Deferred

Beach 1B: shack placement, contained shell/UI, pointer capture, audio, the
`/dev/treasure-hunt` harness. Beach 2: durable rewards (Coin grant via the
canonical balance API, rare item grant, exactly-once redemption). Beach 3:
art, sound, measured balancing of the policy values.
