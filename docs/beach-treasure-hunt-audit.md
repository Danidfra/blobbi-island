# Beach Treasure Hunt — Repository Audit and Implementation Plan (Beach 0)

Status: **implemented through Beach 2 (provisional rewards)** — see
`docs/blobbi-coin-cutover.md` for the reward system. This document remains
the audit-time reference.

Original status: audit only — no implementation approved yet.
Companion document: `docs/coin-economy-migration-audit.md` (Coin economy and migration).

This document records what actually exists in the repository today, verified at the
commit below, and proposes — without implementing — the architecture and phasing for
a metal-detector treasure-hunting minigame launched from a shack on the existing Beach.

---

## 1. Repository state (verified)

| Item | Value |
|---|---|
| Repository path | `/Users/filemon/Developer/blobbi-island` |
| Remotes | `origin` `git@github.com:Danidfra/blobbi-island.git`; `nostr` `nostr://npub1l6uga…/relay.ngit.dev/blobbi-island` |
| Branch | `production` |
| HEAD | `305087b8f9d6f006bd38a3804ee76d61d1e3b371` — **`305087b` is still HEAD** (`feat(dev): simulation-only /dev/equipment … (Phase 9.5b)`) |
| Upstream | `nostr/production`, **ahead 6 / behind 0** |
| Working tree | clean |
| Node | v22.17.0 installed — **note:** `package.json` `engines` requires `>=24 <25` |
| Package manager | npm 11.12.1 (`package-lock.json` present; workspaces `packages/*`) |
| Test command | `npm test` = `tsc -p tsconfig.app.json --noEmit && npm run typecheck --workspaces --if-present && eslint && vitest run && vite build` |
| Test baseline | **219 test files / 4414 tests, all passing, zero skips** (vitest run at this HEAD) |
| Recent relevant commits | `305087b` dev/equipment harness, `6302fa3` lab hardening + max_stack, `e3686f0` Inventory & Equipment Lab, `84f7912` kind:31634 effect activation |

---

## 2. Beach scene findings

### 2.1 What the Beach is today

The Beach has **no dedicated component**. It is data entries plus one 17-line JSX branch:

| Concern | Location | Value |
|---|---|---|
| Location id | `src/lib/location-types.ts:1` | `'beach'` |
| Background | `src/lib/location-backgrounds.ts:6` | `beach-open.webp` |
| Walk boundary | `src/lib/location-boundaries.ts:32-37` | `arch`, top 74.9, bottom 76.9, curvature 6 |
| Spawn | `src/lib/location-initial-position.ts:18` | `{ x: 50, y: 81.9 }` (no exit-position entries reference the beach) |
| Blobbi size | `src/lib/location-blobbi-sizes.ts:12` | `'lg'` |
| Z-bands | `src/lib/interactive-elements-config.ts:114-120` | two bands: y ≥ 80 → z25, y ≤ 80 → z15 |
| Scene JSX | `src/components/blobbi/InteractiveElements.tsx:679-695` | the whole scene |
| Registry | `src/lib/interactive-elements-config.ts:247-253` | one element: `boat` |
| Config test | `src/lib/interactive-elements-config.test.ts:138-141` | asserts the beach has **exactly one** element |

The only object is the **boat** (`InteractiveElements.tsx:684-690`), footprint roughly
x 18–32 / y 34–60. It is a **dead affordance**: no `requestInteraction`, its `onClick`
only logs (`docs/blobbi-actor-ui-audit.md:431`). Its wrapper uses viewport breakpoints
(`top-[34%] sm:top-[39%]`, `size-24 … lg:size-36`) — the documented anti-pattern that
newer scenes (mine cave, town streetlights, arcade) avoid by using breakpoint-free
percent placement from a `src/lib/<place>-config.ts` module.

Also noted: the branch condition tests `backgroundFile === 'beach.png'` (line 680),
a file that does not exist — dead condition.

### 2.2 Coordinate system, rendering, layering

- **World percent** (0–100 x/y, anisotropic) is the stored coordinate for everything:
  ground points, boundaries, spawns, approach targets. Fixed design box
  `WORLD_WIDTH = 1046`, `WORLD_HEIGHT = 697` (`src/lib/world-coordinates.ts:32-33`);
  distances are decided in design px (`worldDistancePx`, `:124-128`).
- `VirtualWorld` (`src/components/shell/VirtualWorld.tsx:48-86`) renders the fixed
  1046×697 box and uniformly scales it with a `ResizeObserver`
  (`scale = min(hostW/1046, hostH/697)`); `getBoundingClientRect()` is post-transform,
  so client→percent math is viewport-invariant.
- Scene layer order (`PlaceBackground.tsx:96-177`): sky z-0 → background img z-[1] →
  `data-world-surface` content z-10 (scene children + actor) → world light z-[20].
- Blobbi z is derived from ground y (`calculateBlobbiZIndex`,
  `interactive-elements-config.ts:276-296`). On the beach: y ≥ 80 → z25, else z15.
  Ties resolve by DOM order; `InteractiveElements` renders before `MovableBlobbi`
  (`PlayingView.tsx:465` vs `:527`), so the Blobbi wins ties.
- The actor anchors bottom-center on the stored ground point
  (`BlobbiActor.tsx:121-129`); the beach has **no `locationScalingConfig` entry**, so
  depth scale is a flat 1.0 everywhere (`docs/blobbi-actor-ui-audit.md:234`).
- Wrappers around scene objects must not add `transform`/`filter`/`opacity`
  (stacking-context trap, `src/lib/mine-cave-config.ts:104-121`). The boat violates
  this today with `-translate-x-1/2`.

### 2.3 Interaction / approach system

Declared per-object via `<InteractiveElement>` with `requestInteraction`
(`src/components/blobbi/InteractiveElement.tsx:161-222`), which resolves an approach
target (`src/lib/approach-target.ts:92-114`), walks the Blobbi there
(`usePendingInteraction.ts:199-256`), and fires the action within
`ARRIVAL_THRESHOLD_PX = 40` (touch 64) design px (`src/lib/blobbi-ground.ts:109-110`).

Documented pitfall: an element mounted above the walkable band derives an unreachable
target; the sanctioned fix is an **explicit `walkTarget`** (precedents:
`ARCADE_COUNTER_STAND_Y = 69.2` in `arcade-room-config.ts:212`;
`mineCaveStructure.approach = { x: 50, y: 82.4 }` in `mine-cave-config.ts:99`).

### 2.4 Recommended shack placement (not implemented)

The occupied region is only the boat (x 18–32, y 34–60); the sand shelf
**x 60–92, y 67–100** is empty. Background inspection: sand runs from ~y 67 down;
walkable band starts at y ≈ 74.9.

Recommendation:

- **Sprite box:** wrapper `absolute right-[14%] bottom-[21%] w-[18%] z-[15]`
  → x ≈ 68–86, base y = 79. Keep rendered height ≤ ~12% of world height so the
  shack stands on sand (top ≈ y 67). No `transform` on the wrapper.
- **Stand point (explicit `walkTarget`):** `{ x: 74, y: 84 }` — ground-anchor
  semantics. Verified: inside the boundary (arch top at x=74 is 74.93), ~252 design px
  from spawn (a real walk), 35 design px from the shack base (inside the arrival
  threshold). At y=84 the player resolves to z25 and correctly stands in front of a
  z-15 shack. The generic aim fraction would land above the boundary and be clamped,
  so the explicit `walkTarget` is required, matching arcade/mine precedent.
- **Config:** follow the modern convention — a `src/lib/beach-shack-config.ts`
  (breakpoint-free percent placement), plus an
  `interactiveElementsConfig` entry `{ id: 'treasure-shack', … }`.
  **Known test impact:** `interactive-elements-config.test.ts:140` pins the beach to
  exactly one element and must be updated in the same change.
- Asset home: `public/assets/locations/beach/` (exists; currently only `boat.png`).
  Minigame-only art: `public/assets/minigames/treasure-hunt/` via a helper in
  `src/lib/asset-paths.ts` (module policy, `docs/asset-organization.md`).

### 2.5 Path conflicts

None. No `src/beach/`, no `src/components/blobbi/beach/`, no `beach-*-config.ts`,
no treasure assets. Directory conventions that exist and that the proposal matches:

- Pure game logic: `src/<domain>/<game>/` — e.g. `src/arcade/hockey/{physics,match,ai,…}.ts`
  with colocated `*.test.ts`. → `src/beach/treasure-hunt/` fits exactly.
- Per-location components: `src/components/blobbi/theater/`, `src/components/blobbi/arcade/…`
  → `src/components/blobbi/beach/` fits the precedent.
- `@/` aliases to `./src` (`vite.config.ts:64`) — no config change needed.

---

## 3. Contained-game pattern findings

### 3.1 How the existing games are built

| Game | Controller | Surface | Pure logic | Shell |
|---|---|---|---|---|
| Air Hockey | `arcade/hockey/AirHockeyMachine.tsx` | canvas `AirHockeyTable.tsx` | `src/arcade/hockey/*` | `ArcadeGameShell` |
| Pool | `arcade/pool/PoolMachine.tsx` | canvas `PoolTable.tsx` | `src/arcade/pool/*` | `ArcadeGameShell` |
| Dance | `arcade/dance/DanceMachine.tsx` | DOM `BlobbiDanceGame.tsx` | `src/arcade/dance/*` | `ArcadeGameShell` |
| Mine | `src/components/blobbi/MiningGame.tsx` | inline | **none** | **none** |
| Theater | in-world panel | — | `lib/theater-*` | none (not a modal) |

Key mechanisms (all verified):

- **Island movement pause:** no global flag. Structural suppression via
  `BLOCK_UI_SELECTOR` in `src/lib/world-input.ts:30-45` (`[data-block-move]`,
  `[role="dialog"]`, `[aria-modal="true"]`, …) + Radix modal `Dialog` portaled outside
  `[data-world-surface]` (`ArcadeGameShell.tsx:172-205`). Pending walk-to-interactions
  cancel via `useCancelInteractionOnWorldClick`.
- **Actor hiding:** no game hides the actor today (arcade shells simply cover the
  stage at z-40). The sanctioned mechanism exists: pose `{ kind: 'hidden' }`
  (`src/lib/blobbi-pose.ts:49`, consumed by `BlobbiActor.tsx:62,108,127,131`,
  state in `useBlobbiPoseController.ts:88,186-189`). The Beach spec's
  "actor hidden during gameplay" is satisfied by the shell covering the scene;
  the hidden pose is available if the scene stays partially visible.
- **Shell:** `ArcadeGameShell` (`src/components/blobbi/arcade/ArcadeGameShell.tsx`) is
  the reusable contained shell: one Radix Dialog with `surface: 'catalogue'|'game'|'notice'`,
  portaled into the stage overlay host (`StageOverlayContext`, provided by
  `BlobbiFrame.tsx:120-122,154-155`), sized against the stage not the viewport,
  **renders nothing when closed** (`:52-57`) so no timer/audio/listener can outlive it.
- **Escape:** closes the shell via Radix `onOpenChange` (`:174-176`); games must never
  swallow Escape (`arcade-input-map.ts:53,66`, pinned by tests).
- **Abandonment:** deliberately **no confirm dialog** anywhere. Mid-run dismiss is an
  abort recorded by the lifecycle reducer (`arcade-machine-state.ts:288-299,344-346`)
  and communicated as copy ("Leave … and end this match"), not a pre-confirm.
- **Mobile:** no rotate prompt exists anywhere; the house style is adaptive layout —
  `useImmersive` (feature-based coarse-pointer detection, `useImmersive.tsx:42-57`) +
  expanded near-fullscreen presentation only while a run is live
  (`AirHockeyMachine.tsx:260,359,366-379`), safe-area padding, `overflow-hidden`
  while playing.
- **Timers:** `useFixedStepLoop` (`src/arcade/useFixedStepLoop.ts:99-153`) — rAF +
  accumulator, `maxCatchUpMs = 250` (throttled/hidden tab cannot avalanche), clears
  its accumulator on pause, callbacks behind refs.
- **Interruption:** `useArcadeInterruption` (`src/arcade/useArcadeInterruption.ts:60-86`)
  — `visibilitychange→hidden` and `window blur`, no auto-resume by design.
- **Audio lifecycle:** engines built inside the Start click, disposed by the
  controller on unmount (`AirHockeyMachine.tsx:192-226`); shared per-document
  `AudioContext` via `ensureArcadeAudio()` (`src/arcade/audio/arcade-audio.ts:73-83`).
- **Reduced motion:** `useReducedMotion` (`src/hooks/useReducedMotion.ts`) —
  decoration only, never gameplay timing; CSS backstop in `index.css:1081-1098`.
- **Error handling:** no error boundaries; the pattern is *refuse, don't throw*
  (null-returning resolvers + visible `launchError`), and degrade (silent audio,
  canvas failure tolerated).

**Mine is the anti-pattern**, despite the thematic similarity: no shell, no lifecycle,
no cleanup, its click surface leaks into world click-to-move
(`MiningGame.tsx:218-222` has no `data-block-move`), raw pixel coordinates that drift
on resize (`:86-92`), inline `Math.random()` (`:114-123`), a Nostr publish **per
click** (`:103-106`), and no tests. Do not model the Beach game on it.

### 3.2 Recommended pattern for Beach Treasure Hunt

Reuse the arcade stack's mechanisms, but **do not register the game as an arcade
machine** — the spec launches it from a Beach shack, not the arcade room, and tying
it to `arcade-machines-config`/`catalogue.ts` would put a beach activity behind
arcade concepts (and the Arcade Pass). Concretely:

1. **Shell:** either mount `ArcadeGameShell` directly from the Beach (it only needs
   the stage overlay host, which `BlobbiFrame` provides globally), or extract its
   containment/Escape/pause/focus behavior into a shared shell if arcade branding
   (title bar copy, `data-arcade-*` attributes) is undesirable on the beach.
   **Recommendation:** start with `ArcadeGameShell` as-is behind a thin
   `TreasureHuntShell` wrapper; extract a generic shell only if friction appears.
   The containment tests (`ArcadeGameShell.containment.test.tsx`) already protect it.
2. **Lifecycle:** reuse the `arcade-machine-state.ts` reducer shape
   (`preview → countdown → playing → paused → results`, abort reasons) — either the
   module itself or a beach copy of the same shape. Render purely from
   `lifecycle.status`; no second phase enum.
3. **Clock:** `useFixedStepLoop` with `onStep` only decrementing `remainingMs` in the
   pure reducer and updating the detector signal. Pointer-driven reducer state is
   sufficient; **no physics loop is needed** — the fixed-step loop is used here only
   as a drift-free, pause-safe countdown/tick source, which is precisely what a 120 s
   round needs (a naive `setInterval` drifts and a background tab cheats).
4. **Interruption:** `useArcadeInterruption`, Air Hockey policy — pause on both
   `hidden` and `blur` (no external audio clock to desync, so abort-on-hidden is
   unnecessary).
5. **Rendering:** DOM, not canvas (Dance's choice): dig spots are discrete and few,
   and DOM keeps labels/focus/`aria-live` announcements cheap. The detector is an
   absolutely-positioned game object inside the surface — never an OS cursor.
6. **Dev harness:** `/dev/treasure-hunt` following the `import.meta.env.DEV ? lazy : null`
   convention (`AppRouter.tsx:35-59`) — note `src/dev-routes.test.ts:120-135` pins
   the exact route list and must be updated in the same change.

---

## 4. Pointer, mobile and audio findings

### 4.1 Dragging the detector

Canonical implementation to copy: `AirHockeyTable.tsx:602-671` (Pool has the same
pattern at `PoolTable.tsx:754-843`; a third copy is the right moment to extract a
shared `usePointerDragSurface` hook):

- `preventDefault()` on pointerdown; cache `getBoundingClientRect()` in a ref at
  gesture start (not per-move); store `pointerId`; `setPointerCapture`.
- All four terminators: `onPointerUp`, `onPointerCancel`, `onLostPointerCapture`,
  plus `onBlur` (dropping `onLostPointerCapture` is the stuck-drag bug on mobile
  Safari).
- Optional `pointerType !== 'mouse'` gate so mouse steers on hover while touch
  requires held contact.
- CSS: `touch-none select-none` on the surface plus a scoped rule mirroring
  `index.css:1073-1079` (`touch-action: none`, `overscroll-behavior: contain`,
  tap-highlight/user-select off) — `touch-none` is the load-bearing declaration on
  phones.
- Coordinates: for a plain DOM surface, `clientPointToWorldPercent`-style conversion
  (rect fractions × 100, `world-coordinates.ts:62-72`); for an aspect-locked field,
  port `fitTable`/`toTableUnits` (`hockey-draw.ts:167-200`) so pointer→logical is the
  exact inverse of the render transform. Normalized 0–100 sand coordinates satisfy
  the spec.
- Sizing: `ResizeObserver` + `resize` + `orientationchange` (`AirHockeyTable.tsx:306-379`);
  never measure inside the frame loop.
- Do **not** use the legacy gesture libs (`react-use-gesture` and `@use-gesture/react`
  are both installed — avoid adding usage of either) or the mouse-only
  `PlacementOverlay` pattern.

Known trap: React 18 registers root `touchstart` as passive, so `onTouchStart`
cannot `preventDefault()` — use Pointer Events (`MineCaveEntrance.tsx:105-107`).

### 4.2 Detector beep audio

- Shared context: `ensureArcadeAudio()` **called inside the Start click**
  (`arcade-audio.ts:28-35,73-83`); `silentEngine()` no-op fallback when Web Audio is
  unavailable (`hockey-audio.ts:39-49`) — silence never refuses the run
  (Hockey's rule, `AirHockeyMachine.tsx:200-206`).
- The rising-pitch beep already exists as a pattern: `blip()` in
  `hockey-audio.ts:74-104` — `setValueAtTime(f0)` + `exponentialRampToValueAtTime(f1)`
  with a gain envelope and self-cleaning `osc.onended → disconnect()`. Drive frequency
  and repeat interval from coil→target proximity.
- Rate-limit beeps with Pool's throttle (`COLLIDE_MIN_GAP_S`,
  `pool-audio.ts:57,142-144`) so a fast sweep doesn't machine-gun.
- Mute: master `GainNode` set to 0 (`hockey-audio.ts:133-136`); persisted arcade-wide
  binary mute via `isArcadeMuted()`/`setArcadeMuted()` (`arcade-audio.ts:165-171`);
  copy `HockeySoundToggle.tsx` as the UI. There is **no global volume setting** in
  the app — mute is binary and arcade-scoped; the Beach game should reuse the same
  store rather than invent a second one.
- Dispose in the controller on unmount, rebuild per run via `prepareEngine()`
  (`AirHockeyMachine.tsx:192-226`). `useSfx` (HTMLAudioElement) is unsuitable for
  continuous variable-pitch feedback; acceptable only for one-shot "found it!" stingers.
- Reduced motion must not silence audio (`useReducedMotion.ts:10-19` — decoration
  only). A separate "reduced audio" option does not exist today; if wanted it is a
  new product decision.

---

## 5. Tests and dev-harness findings

- **Baseline:** 219 files / 4414 tests, all green at HEAD `305087b`.
- **/dev conventions:** five routes (`/dev/theater`, `/dev/arcade`, `/dev/rooms`,
  `/dev/equipment`, `/dev/blobbi-effects`), each `import.meta.env.DEV ? lazy(...) : null`
  so build chunks are never emitted. `src/dev-routes.test.ts` enforces: the source
  pattern, the exact route list (:120-135 — must be updated when adding
  `/dev/treasure-hunt`), no dev chunk or `/dev/*` string in `dist/`, and that only
  `AppRouter.tsx` references harnesses.
- **Feature flags:** build-time only, strict `=== 'true'`
  (`src/lib/feature-flags.ts:28-46`); precedent `VITE_ENABLE_LIVE_INVENTORY_LAB` with
  an inline literal comparison at the lazy-import site for dead-code elimination
  (`GameItemTools.tsx:73-80`).
- **Simulation-only harness pattern** (`/dev/equipment` is the canonical model):
  pure local reducer mirroring protocol shapes (`src/lib/dev-equipment-simulation.ts`),
  real resolvers over simulated inputs, and a **transitive import-graph boundary
  test** (`DevEquipment.test.tsx:229-291`) asserting the harness never imports
  mutation hooks/signers, plus a behavioral "nothing moves" test with signer spies
  and a sentinel cache entry. The Beach dev harness must replicate this: forbidden
  imports should include the future reward writer, `useCoinsMutation`,
  `useInventoryMutation`, `useNostrPublish`, `signEvent`.
- **Seeded PRNG precedent:** mulberry32 (`src/arcade/hockey/match.ts:164-177`,
  duplicated in `src/arcade/pool/rack.ts:38-50`), FNV-1a string→seed
  (`hockeySeedFrom`/`poolSeedFrom`), seeded Fisher-Yates (`rack.ts:62-76`), and
  hash-based field sampling (`packages/blobbi-react/src/effects/deterministic.ts`,
  `unitFor(seed, index, field)` — the closest analogue to "seeded target positions").
  There is no shared `src/lib/random.ts`; the treasure-hunt model should carry its
  PRNG state in the game state like `match.ts` does.
- **Pure-model precedent:** `src/arcade/hockey/{physics,match}.ts` (no `Date.now()`,
  no `Math.random()`, no DOM; determinism pinned by tests, e.g. Pool's explicit
  "same seed and same shots give the same frame"). The treasure-hunt model must meet
  the same bar: testable without DOM, React, timers, signer, or relay.
- **Testing:** `fireEvent.pointerDown/Move/Up` with `pointerId`/`pointerType` is the
  established pointer-test idiom (`AirHockeyMachine.test.tsx:759-816`); jsdom needs a
  `setPointerCapture` stub (`PoolMachine.test.tsx:281`). Fake timers idiom:
  `vi.useFakeTimers({ shouldAdvanceTime: true })` + `advanceTimersByTimeAsync`; for
  rAF loops, the hand-driven frame stub (`useFixedStepLoop.test.tsx:20-50`).

---

## 6. Proposed architecture (to be built in Beach 1A/1B — not now)

Paths verified conflict-free and convention-matching:

```
src/beach/treasure-hunt/          # pure model — no DOM, React, timers, signer, relay
  types.ts                        # TargetKind, Target, RoundState, TreasureHuntResult
  policy.ts                       # ALL balance values in one module (see below)
  random.ts                       # mulberry32 + fnv1a seedFrom (hockey/pool shape)
  generator.ts                    # seed → target field (positions, kinds, min-spacing)
  detector.ts                     # coil position → signal strength / beep rate (pure math)
  reducer.ts                      # round lifecycle: tick, move, dig, resolve, end
  result.ts                       # round → TreasureHuntResult (economy-neutral)
  *.test.ts                       # colocated unit tests (hockey/pool precedent)

src/components/blobbi/beach/      # rendering + React control (theater/arcade precedent)
  TreasureHuntShack.tsx           # placed sprite + explicit walkTarget
  TreasureHuntShell.tsx           # thin wrapper over ArcadeGameShell containment
  TreasureHuntIntro.tsx
  TreasureHuntGame.tsx            # surface: drag detector, dig taps, HUD
  TreasureHuntToolDock.tsx        # detector/shovel switch
  TreasureHuntResults.tsx
  detector-audio.ts (or src/beach/treasure-hunt/audio.ts)  # Web Audio beeps,
                                  # built on arcade-audio.ts / hockey-audio.ts shape

src/lib/beach-shack-config.ts     # percent placement + stand point (mine/arcade precedent)
src/pages/DevTreasureHunt.tsx     # /dev/treasure-hunt harness (simulation-only)
public/assets/locations/beach/    # shack sprite
public/assets/minigames/treasure-hunt/  # in-game art (helper in asset-paths.ts)
```

Separation of concerns (all precedented in the repo):

- pure simulation (`src/beach/treasure-hunt/`) — like `src/arcade/hockey/`;
- React controller vs. surface — like `AirHockeyMachine` vs. `AirHockeyTable`;
- audio behind a factory with a silent fallback — like `hockey-audio.ts`;
- reward persistence and Nostr mutations **absent from the game entirely** in V1;
  when added (Beach 2) they live behind a boundary module like
  `arcade-reward-boundary.ts` / `useArcadeReward.ts`, never inside the model.

### 6.1 Policy module (provisional V1 values — not final)

All in `policy.ts`, never hardcoded in components:

- round duration: 120 s; buried targets: 9; shovel uses: 5;
- composition: 4–5 metallic litter, 3–4 ordinary treasure, 0–1 special slot;
- detection radius, dig radius, min target spacing, beep frequency range and
  rate curve — to be tuned in Beach 3.

### 6.2 Result contract (economy-neutral)

```
TreasureHuntResult {
  roundId          // generated per round; future exactly-once key (Beach 2)
  seed
  startedAt / endReason   // completed | time-up | aborted
  digsUsed
  litterFinds[]           // fictional litter items (bottle cap, rusty tab, …)
  ordinaryFinds[]         // fictional trinkets (decorative old coin, shell pendant, …)
  rareCandidate?          // slot only; no item identity in V1
  rawRewardUnits          // abstract units; NO Coin amounts, NO grantCoins()
}
```

The pure game never mutates Coins or inventory. Reward mapping (units → Coins,
rare candidate → kind:31632 address) happens in a later, separate boundary (Beach 2),
after the Coin migration decision (see companion document).

### 6.3 Game rules mapped to code (V1 behavior)

- Detector is a rendered, dragged game object; the **coil** is the sensing point;
  signal = pure function of coil→nearest-unresolved-target distance (`detector.ts`).
  Exact coordinates never surface in the UI (dev overlay only).
- Dig: tap with shovel selected → consumes one use → resolves **only the closest
  unresolved target within the dig radius**; misses stay visible; resolved targets
  cannot be collected twice (reducer invariants, unit-tested).
- Round ends on timer, on shovel exhaustion + explicit finish, or on abandon
  (shell close/Escape → abort, recorded in the result, no confirm dialog —
  house style).
- Litter framed positively ("You helped clean the beach"); summary shows
  Beach cleaned / treasures / rare discovery / total reward separately.
  V1 auto-resolves everything at round end; no selling/museum UI.

---

## 7. Trust model (explicit)

The Beach game is client-run, like every existing minigame:

- Round ids and serialized writes protect against **accidental duplication**
  (double-submit, retry after ambiguous publish) — the arcade claim ledger
  (`useArcadeReward.ts`, `arcade-claim-ledger.ts`) is the existing precedent.
- Fresh reads and read-back reconciliation improve correctness against stale caches.
- **None of this is cryptographic anti-cheat.** The player signs their own events;
  relays accept any well-formed event from that pubkey
  (`authority: 'player'`, `event-registry.ts:421-435`). A modified client can claim
  any result. The initial economy remains trusted to the official client, exactly as
  the Mine and arcade rewards are today. This plan does not claim otherwise.

---

## 8. Risks and unresolved product decisions

Risks:

1. `interactive-elements-config.test.ts:140` and `dev-routes.test.ts:120-135` pin
   counts/lists that the shack and dev route will change — update in the same commits.
2. `ArcadeGameShell` reuse outside the arcade is new ground; its naming/attributes
   are arcade-flavored. Mitigated by wrapping, but a generic-shell extraction may
   become worthwhile.
3. Beach boundary band is shallow (y ≈ 74.9–100); the game surface replaces the scene
   inside the shell, so this only affects the shack approach, which is verified above.
4. No shared drag hook exists yet — the treasure hunt would be the third copy of the
   pointer block; extraction is recommended but optional.
5. Node engine mismatch (installed v22 vs required >=24) — unrelated to the Beach but
   worth resolving before CI surprises.

Open product decisions (not decided here):

- Shack art and name; intro copy.
- Whether the Beach game needs its own mute toggle surfaced or reuses the arcade one
  silently; whether a "reduced audio" option should exist at all.
- Rewarded-round limits (per-day cap? cooldown?) — required before Beach 2.
- The rare item: which kind:31632 definition, rarity gating, drop rate — Beach 2+.
- All Coin questions (name, `d`, issuer, migration) — see companion document; Beach
  reward payout depends on Coin 1/Coin 2 landing first or on paying out via the
  legacy canonical writer (`useCoinsMutation`) in the interim. **Recommendation:**
  do not wire Beach rewards to the legacy profile-coins path; sequence Beach 2 after
  Coin 2 so the Beach's first real payout writes the canonical 31633 Coin.

---

## 9. Phased implementation plan

**Beach 0 (this document):** audit and specification only. ✅

**Beach 1A — pure seeded game model.** `src/beach/treasure-hunt/` per §6: types,
policy, PRNG, generator (min-spacing, composition from policy), detector math,
reducer (dig consumption, closest-target resolution, no double-collect, lifecycle),
result object; colocated unit tests incl. same-seed determinism. No React, no
rewards, no Nostr.

**Beach 1B — contained UI, still no real rewards.** Placeholder shack +
`beach-shack-config.ts` + explicit walkTarget (+ config-test update); shell wrapper
over `ArcadeGameShell`; intro; DOM game surface with pointer-captured detector drag,
tool dock, dig taps; `useFixedStepLoop` tick; `useArcadeInterruption` pause;
detector-audio engine (built in Start click, disposed by controller, arcade mute
store, silent fallback); reduced-motion compliance; results screen showing the pure
result; `/dev/treasure-hunt` harness (fixed seed, target/detection/dig overlays,
unlimited time, configurable shovel uses, forced outcomes, reward success/failure
*simulation*, mute, reduced motion, mobile dimensions, reset without reload;
import-graph boundary test forbidding all write paths; dev-routes test update).

**Coin 1 / Coin 2** — see `docs/coin-economy-migration-audit.md`. Coin product
decision + migration spec, then one coherent cutover. No silent migration.

**Beach 2 — durable rewards** (after Coin 2, recommended): rewarded-round limits;
round ids with exactly-once application (arcade-claim-ledger pattern: durable ledger,
cross-tab Web Lock, ambiguity classification, read-back verification, never
republish); Coin grant via the canonical Coin balance API; rare item grant via the
canonical inventory writer (no new writer); refresh-safe pending result; explicit
failure states.

**Beach 3 — polish:** final art, sound design, animation, measured balancing of the
policy values; extract shared drag hook if not already done.

Scope restrictions honored throughout (no new region, no Mine redesign, no Arcade
Ticket changes, no prize redemption changes, no marketplace, no Coin/Ticket
conversion, no presence changes, no `@blobbi/react` changes, no museum, no
Beach-specific Coin store, no new inventory writer, no dual-write, no publishes from
unflagged dev routes, no event-id identity, no executing item-event behavior).
