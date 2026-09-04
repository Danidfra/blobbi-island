# Blobbi Actor UI Audit: Movement, Positioning, Depth, Shadow, and Rendering

> **Status (Phase 3, 2026-07):** superseded as the current contract by
> [`blobbi-actor-architecture.md`](./blobbi-actor-architecture.md), which documents
> the consolidated post-Phase-3 architecture. This document remains as the
> historical record/derivation it describes.

_Audit date: 2026-07-29. Branch: `production` (clean, HEAD `a38620a`). No production behavior was changed for this audit._

> **Phase 0 status:** the safety baseline described in §20 has been implemented; see
> `docs/blobbi-actor-position-migration-notes.md` for the ground-anchor migration
> guard checklist and the positional inconsistencies recorded while adding the
> validation tests.

Evidence tags used throughout:

- **[confirmed]**: read directly from repository code.
- **[likely]**: strongly implied by code, not exercised/verified at runtime.
- **[inference]**: architectural interpretation.
- **[recommendation]**: proposed direction, not current behavior.

---

## 1. Executive summary

The Blobbi "actor" is not a distinct architectural entity today. It is an emergent behavior of one large component, `MovableBlobbi` (`src/components/blobbi/MovableBlobbi.tsx`), which simultaneously owns: input capture, click-to-move animation, percent↔pixel conversion, boundary clamping, depth scaling, z-index resolution, the ground shadow, the float animation, gaze orchestration, seating/hiding/sleep presentation, and the chat-bubble portal anchor. The visual body is delegated to `CurrentBlobbiDisplay`, which fetches its own data via hooks and renders an inline SVG plus an accessory overlay.

Key confirmed findings:

1. **The logical position is the sprite-box CENTER, not a ground point.** The positioned anchor uses `left/top` percentages with `transform: translate(-50%, -50%)` (`MovableBlobbi.tsx:583-590`). A click therefore aligns the clicked point with the middle of the Blobbi's body, the reported destination-alignment bug is a direct, structural consequence, not a math error.
2. **There is no ground/foot anchor concept anywhere.** No `groundAnchor`, `footAnchor`, `pivot`, or equivalent exists in the codebase; a handful of magic offsets (`bedPosition.y - 5`, seat `interactionTarget` fractions, exit-door coordinates) approximate one ad hoc.
3. **The shadow floats because it is anchored to the UNSCALED box while the body scales toward its center.** The sprite wrapper scales with `transformOrigin: 'center center'`; the shadow sits at `top: 100%` of the unscaled anchor box. At depth scale *s*, the visible feet rise by `(1 − s) · H/2` but the shadow stays put, at the back of `nostr-station-open` (s = 0.6, `xl` box ≈ 128 px) that is a ~26 px gap. Exact analysis in §9.
4. **Local and remote players share the depth/z/seat math** (`src/lib/blobbi-world-render.ts`) **and the leaf renderer** (`CurrentBlobbiDisplay`), but the actor wrapper is duplicated: `MovableBlobbi` (local) vs `RemoteBlobbiSprite` inside `MultiplayerLayer.tsx` (remote), with byte-identical shadow markup maintained in both.
5. **Presence publishes the center-point percent coordinates with no version marker**: changing position semantics to bottom-center is a protocol-compatibility event that must be explicitly migrated (§12).
6. **Movement, boundaries, and interactions all validate only the center point** against percent-space shapes; the Blobbi's rendered extent and depth scale are never considered.
7. **The renderer is not yet safe for user-positioned accessories** in world contexts: the existing `AccessoryOverlay` works for static portraits, but body-relative stability under depth scaling, stage changes, and float animation depends on details audited in §13.
8. Validation: `tsc --noEmit` clean; ESLint 0 errors (18 pre-existing warnings); **3287/3287 tests pass** (144 files); `vite build` succeeds. See §22.

---

## 2. Current architecture overview

Plain-language description **[confirmed]**:

- The world is a **fixed 1046×697 design-space** (`VirtualWorld.tsx`, `WORLD_WIDTH`/`WORLD_HEIGHT`), rendered at that fixed size and uniformly scaled by a single CSS `transform: scale()` to fit the viewport. Everything inside, background art, interactive elements, the Blobbi, remote players, shares this one scaled layer. UI/HUD/modals render outside it.
- Within the world, virtually all positions are **percentages (0–100) of the world container**, stored as `Position { x, y }` (`src/lib/types.ts:4-7`).
- `PlayingView` (`src/components/blobbi/PlayingView.tsx`) is the per-room orchestrator: it derives the background file, boundary, initial position, and Blobbi size from the current location; mounts `MovableBlobbi` (keyed by location, so room changes remount the actor), `InteractiveElements`, `Furniture` (home only), and `MultiplayerLayer`; and owns seat/hide/sleep state.
- `MovableBlobbi` owns the movement loop (rAF, constant speed in world px/s), converts clicks to percent targets, clamps against the room `Boundary`, and renders the three-layer actor DOM (anchor → scale wrapper → float wrapper → body) plus a sibling shadow.
- `CurrentBlobbiDisplay` (`src/components/blobbi/CurrentBlobbiDisplay.tsx`) loads/derives an inline SVG for the current (or overridden) Blobbi, applies gaze markup, and stacks `AccessoryOverlay` on top.
- Remote players are rendered by `MultiplayerLayer` → `RemoteBlobbiSprite`, which mirrors `MovableBlobbi`'s DOM shape and reuses `CurrentBlobbiDisplay` with `visualOverride`.

---

## 3. Relevant file and component map

| Area | File | Role |
|---|---|---|
| Actor (local) | `src/components/blobbi/MovableBlobbi.tsx` | Movement loop, input, clamping, scale/z resolution, shadow, gaze wiring, seat/hide/sleep presentation |
| Body renderer | `src/components/blobbi/CurrentBlobbiDisplay.tsx` | SVG load + gaze markup + accessory overlay; per-size Tailwind boxes |
| SVG generation | `src/lib/loadBlobbiSvg.ts`, `src/blobbi/**` (core, baby-blobbi, adult-blobbi, ui) | Stage-specific SVG builders, colors, patterns, expressions |
| Accessories | `src/components/blobbi/AccessoryOverlay.tsx` (+ panels/modals) | Slot-based `<img>` overlay on the display box |
| World container | `src/components/shell/VirtualWorld.tsx` | Fixed 1046×697 design space, uniform scale-to-fit |
| Room shell | `src/components/blobbi/PlaceBackground.tsx` | Letterbox fill, sky layers, `data-world-surface` click layer (= `containerRef`) |
| Room orchestrator | `src/components/blobbi/PlayingView.tsx` | Per-room wiring; seat/hide/sleep state; furniture; multiplayer mount |
| Boundary math | `src/lib/boundaries.ts` | `Boundary` union (rectangle/semicircle/arch/composite), `constrainPosition` |
| Boundary data | `src/lib/location-boundaries.ts` | Per-background walkable shapes (percent space) |
| Blockers | `src/contexts/MovementBlockerContext.tsx`, `src/components/blobbi/MovementBlocker.tsx` | Runtime percent-rect no-go zones (furniture, props) |
| Depth scale | `src/lib/location-scaling-config.ts` + `resolveBlobbiScale` in `src/lib/blobbi-world-render.ts` | Linear y-ramp per background |
| Z-order | `backgroundZIndexConfigs` + `calculateBlobbiZIndex` in `src/lib/interactive-elements-config.ts` | Y-band → z-index per background |
| Shared render math | `src/lib/blobbi-world-render.ts` | `resolveBlobbiScale`, `resolveBlobbiZIndex`, `resolveSeatedRender` (local+remote) |
| Sizes | `src/lib/location-blobbi-sizes.ts` | Per-location `sm/md/lg/xl` |
| Spawns/exits | `src/lib/location-initial-position.ts` | Initial + exit-door positions, arcade spawns |
| Interactions | `src/components/blobbi/InteractiveElements.tsx`, `InteractiveElement.tsx`, `src/hooks/usePendingInteraction.ts`, `src/hooks/useCancelInteractionOnWorldClick.ts` | Walk-to-interact |
| Seats | `src/lib/theater-seats-config.ts`, `src/lib/theater-occupancy.ts` | Seat rects, cushion anchor, per-row scale |
| Hiding | `src/components/blobbi/TownBush.tsx`, `src/lib/town-bushes-config.ts` | Bush hide spots |
| Multiplayer | `src/components/blobbi/MultiplayerLayer.tsx`, `src/hooks/useIslandPresence.ts`, `src/lib/multiplayer.ts` | Presence kind 31950, remote animation, `RemoteBlobbiSprite` |
| Gaze | `src/lib/gaze.ts`, `src/hooks/useIdleGaze.ts`, `applyGazeMarkup` in `src/blobbi/ui/lib/svg` | Eye direction system |
| Furniture | `src/components/blobbi/Furniture.tsx` | Draggable props (bed/chest/fridge) with own percent conversion |
| Secondary actor mounts | `src/components/blobbi/PhotoBoothModal.tsx`, `MultiplayerExample.tsx` | Independent `MovableBlobbi` instances outside the world |
| Debug | `src/components/blobbi/BoundaryVisualizer.tsx`, `DebugOverlaysContext` | Read-only boundary overlay (decoupled from runtime) |

---

## 4. Current DOM / render tree

**[confirmed]** Local player, in-world (from `PlaceBackground.tsx`, `VirtualWorld.tsx`, `MovableBlobbi.tsx:536-640`, `CurrentBlobbiDisplay.tsx`):

```text
PlaceBackground (relative w-full h-full)
├── letterbox fill (blurred bg copy, decorative)
└── VirtualWorld host (relative h-full w-full overflow-hidden)
    └── fixed 1046×697 div, transform: translate(-50%,-50%) scale(worldScale), origin center
        ├── IslandSkyLayer (z-0)
        ├── background <img> (z-[1])
        ├── world-surface div (z-10, data-world-surface)  ← containerRef for ALL percent math
        │   ├── BoundaryVisualizer (debug only)
        │   ├── InteractiveElements / Furniture / MiningGame …
        │   ├── MovableBlobbi:
        │   │   ├── [trail dots]* (absolute, translate(-50%,-50%))
        │   │   └── ANCHOR div  #my-blobbi-anchor .blobbi-character
        │   │       │   absolute; left:x%; top:y%; transform: translate(-50%,-50%);
        │   │       │   zIndex: resolveBlobbiZIndex(pos); filter: drop-shadow(0 8px 16px …);
        │   │       │   transition-all duration-200 (disabled while moving)
        │   │       ├── SCALE wrapper, transform: scale(dynamicScale); origin: center center
        │   │       │   └── FLOAT wrapper, .animate-float unless sleeping/seated/disabled
        │   │       │       └── CurrentBlobbiDisplay (size box: xl = h-24 w-24 md:h-32 md:w-32)
        │   │       │           ├── inline SVG body (dangerouslySetInnerHTML; gaze markup)
        │   │       │           └── AccessoryOverlay (absolute inset-0; slot <img>s)
        │   │       └── SHADOW div, absolute top-full left-1/2 h-1.5 rounded-full
        │   │               width by size (xl: w-8 md:w-10)
        │   │               transform: translateX(-50%) scale(dynamicScale); origin center
        │   └── MultiplayerLayer (absolute inset-0)
        │       └── per player: RemoteBlobbiSprite, same 3-layer shape + shadow + name label
        └── IslandWorldLight (z-[20])
```

Notable structural facts **[confirmed]**:

- The anchor div deliberately carries **no scale**: it is the chat-bubble portal target and must stay stable (`MovableBlobbi.tsx:586` comment, `resolveSeatedRender` docstring in `blobbi-world-render.ts:119-122`).
- The anchor box has the size of the **unscaled** `CurrentBlobbiDisplay` box; the shadow and (for remotes) the name label hang off this box, not off the scaled body.
- There are **two shadows**: the radial-gradient ground ellipse and a `filter: drop-shadow(0 8px 16px rgba(0,0,0,0.15))` on the anchor (`MovableBlobbi.tsx:588`). The filter tracks the scaled body's painted pixels but its 8 px offset/16 px blur are fixed, at depth scale 0.5 the drop-shadow is proportionally twice as large relative to the body. The ellipse does not track the scaled body at all (§9).
- **Four nested transform layers** act on the body: anchor `translate(-50%,-50%)` → depth `scale()` → float `translateY` (fixed −4 px keyframe, *inside* the scale, so the bob amplitude is not proportional to the drawn creature) → `scale-105` while moving; each accessory adds a fifth.
- The painted SVG inside `CurrentBlobbiDisplay` (transparent mode) is **larger than its layout box**: at `lg` an 80 px SVG sits in a 64 px box, so "box bottom" ≠ "feet" even at scale 1. The non-transparent branch's inner sizes use `h-14 w-14 md:h-18 md:w-18`, and `h-18`/`w-18` are **not defined in the Tailwind scale** (not extended in `tailwind.config.ts`), those classes are silent no-ops.

**Body renderer internals** **[confirmed]** (`src/blobbi/**`, `src/lib/loadBlobbiSvg.ts`):

- The body is an **inline SVG string** injected via `dangerouslySetInnerHTML`: not an `<img>` or layered divs. `loadBlobbiSvg(stage, adultType?, baseColor?, secondaryColor?, eyeColor?, isSleeping?, instanceId?, view)` is a pure, synchronous, 8-positional-parameter pipeline: pick template → regex-replace gradients → uniquify SVG ids per instance → inject gaze markup/styles → optionally strip face blocks for rear view.
- **Stages**: baby = `BABY_BASE_SVG`/`BABY_SLEEPING_SVG` (`viewBox 0 0 100 100`); adult = `ADULT_SVG_MAP`: 16 forms × base/sleeping (`viewBox 0 0 200 200`, 2 809 generated lines). **There is no egg branch, an egg Blobbi renders as a baby**; the only real egg art lives privately inside `BlobbiHatchingCeremony.tsx` (adapted from Ditto's `EggGraphic`).
- Both viewBoxes are square, but the silhouette's **fill fraction differs by stage and by adult form** (baby body spans ~73% of its box; CATTI ~60%; BLOOMI nearly fills it). Nothing normalizes feet position, the box-anchored shadow is a different distance from the visual feet for every stage/form.
- **Colors**: baby = two regex gradient swaps by literal id; adult = 16 hand-written per-form customizer functions keyed to form-specific gradient ids, with fallbacks. `pattern` and `specialMark` exist in the types and `visualOverride` and are **never rendered** (dead fields).
- **Eyes/gaze**: comment blocks (`<!-- Pupils … -->`) are parsed as an API by three subsystems; `applyGazeMarkup` tags pupils and injects a `<style>` translating them by `var(--blobbi-eye-*) × 2px`: 2 *SVG user units*, so **adults get half the relative eye travel of babies** (200 vs 100 viewBox).
- **Sleep** is a separate SVG asset, not a state overlay; eye-color customization is skipped when sleeping. **No expression/emotion/blink system exists anywhere**; `mood` is parsed but never rendered.
- **Animations**: SMIL baked into some adult artwork (e.g. BLOOMI petals, unstoppable, ignores `prefers-reduced-motion`); CSS `@keyframes float`; CSS transition on pupil vars; one `useIdleGaze` rAF loop **per Blobbi on screen**, plus a second rAF loop in `MovableBlobbi` (`forceGazeFrame`) re-rendering the local Blobbi at 60 fps whenever it watches a target.
- **Coupling**: `CurrentBlobbiDisplay` calls `useBlobbis()` + `useBlobbonautProfile()` **unconditionally**: every remote sprite subscribes to the local player's Nostr queries and discards the result; `visualOverride` is a bolted-on escape hatch rather than a pure presentational component.
- **Other renderers**: `MascotBlobbi` (pure, reusable; fixed `instanceId="mascot"` → latent gradient-id collision between two mascots), `BlobbiCard` (third direct `loadBlobbiSvg` call site; has the only proportional shadow), `CurrentBlobbiPreview` (adds `2xl`/`3xl` by fighting `xl` with `!important` overrides). `SimpleBlobbiDisplay` and `FloatingBlobbi` are **dead code, zero importers** (~240 lines, incompatible visual languages).

---

## 5. Coordinate-system map

**[confirmed]** Systems in play:

| # | System | Units | Origin | Where |
|---|---|---|---|---|
| C1 | Viewport/client | CSS px | screen | pointer events (`clientX/Y`) |
| C2 | World design space | px, fixed 1046×697 | world top-left | `VirtualWorld`; art + px-sized objects authored here |
| C3 | Rendered world | CSS px = C2 × worldScale | world top-left on screen | `getBoundingClientRect()` of `containerRef` |
| C4 | World percent | 0–100 of container | world top-left | `Position` everywhere: movement, boundaries, blockers, presence, seats, spawns |
| C5 | Element-local fraction | 0–1 of an element rect | element top-left | seat/bush `interactionTarget` fractions |
| C6 | Actor-local | px inside the anchor box | box top-left/center | shadow offsets, accessory slots, name labels |
| C7 | Presence wire format | percent (C4) in JSON content |, | kind 31950 `anchor`/`goal` |
| C8 | Modal-local percent | 0–100 of a modal box | modal top-left | `PhotoBoothModal`'s own `MovableBlobbi` |

Conversions **[confirmed]**:

- **C1→C4** (click → target): `clickX = clientX − rect.left`, then `getPercentPosition` divides by `rect.width/height` ×100 and clamps via `constrainPosition` (`MovableBlobbi.tsx:435-450, 233-241`). Uniform world scaling cancels out, so this is resize-safe. Duplicated in `Furniture.tsx:58-66` and (as `percentToPixel`/`pixelToPercent` callbacks) in `MultiplayerLayer.tsx:619-629`.
- **C4→C3** (percent → px for stepping): `getPixelPosition` (`MovableBlobbi.tsx:224-231`); same duplication.
- **C2→C3 speed conversion**: `worldScale = rect.width / WORLD_WIDTH`; `movementSpeed` (120) is world px/s, multiplied by `worldScale` per frame (`MovableBlobbi.tsx:292-295`); mirrored in `useIslandPresence.animatePlayers` via `getWorldScale`.
- **C5→C4**: `seatAnchorPosition` / `computeSeatTarget` / `computeBushTarget` convert an element's percent rect + fractional target into a world-percent point.
- **C4 anisotropy**: 1% in x = 10.46 world px; 1% in y = 6.97 world px. Percent-space distance math (arrival thresholds, gaze radii, presence `posAt`) mixes the two axes as if equal **[confirmed]**: a systematic source of ellipse-shaped thresholds and the `posAt` unit bug (§12).
- **C8**: the PhotoBooth mounts `MovableBlobbi` against a 470×705 portrait modal div outside `VirtualWorld` (`PhotoBoothModal.tsx:967-990`). There, `worldScale = 470/1046 ≈ 0.45`, so movement runs at ≈45% speed, and percent space is portrait, same component, different effective coordinate system **[confirmed]**.

No position is persisted to localStorage; position state lives in component state and is reset per room via remount (`key={currentLocation}`, `PlayingView.tsx:606`) **[confirmed]**.

---

## 6. Movement flow, pointer click to rendered position

**[confirmed]** Step by step (`MovableBlobbi.tsx`):

1. `pointerdown`/`touchstart` on the container (`:458-459`, capture-less, passive). `shouldTriggerWorldMove` walks `composedPath()` rejecting UI (`[data-block-move]`, dialogs, buttons, links, inputs, `.modal`… `:386-401`), other world surfaces, non-primary buttons, and the photo-booth-open state.
2. Click point → container-relative px → percent via `getPercentPosition`, which **clamps to the boundary immediately** (`:446-448`). So clicking outside the walkable area walks to the nearest boundary point.
3. `isPositionBlocked(target)` (MovementBlocker rects) rejects blocked targets outright; no pathing around, the move is simply not started (`:450`).
4. `targetRef.current = target; setIsMoving(true)` → rAF loop `animateMovement`:
   - current and target percent → **rendered px** (`getPixelPosition`);
   - step = `movementSpeed × worldScale × dt` toward target, straight line;
   - arrival when rendered-px distance < 2 → snap to exact target (`:276-279`);
   - each intermediate point converts back to percent and is **re-clamped** every frame (`getPercentPosition` calls `constrainPosition`), so the path slides along boundary edges;
   - if an intermediate point hits a MovementBlocker, movement **stops in place** (`:315-318`): this "stall" is what `usePendingInteraction` has to detect and cancel.
5. `onMoveComplete(target)` fires once (guarded by `justCompletedRef`); `PlayingView.handleMoveComplete` records `myPosition` and runs bed-arrival detection (`|Δx|<2 && |Δy|<2` against `sleepingPosition`).
6. Render: `left/top = position %`, `translate(-50%,-50%)`: the target point ends up under the **body center**.

**What point is "the position"** **[confirmed]**: the center of the unscaled anchor box. Nothing accounts for the body's visual height, the depth scale, or the feet. Because depth scale shrinks the body toward the center, the *feet* of the rendered Blobbi sit `scale × H/2` **below** the clicked point (plus float-animation offset), where H is the box height, so the perceived ground contact point moves with scale, size class, and viewport breakpoint (`md:` size doubling).

**Destination storage**: `targetRef` (ref, not state) locally; `PlayingView.myPosition` is set to the **destination at move start** (`handleMoveStart`), meaning mid-walk consumers (presence heartbeats, seat occupancy) see the destination, not the live position **[confirmed]** (see §12).

**Hardcoded visual dimensions**: size classes in `CurrentBlobbiDisplay.sizeClasses` (Tailwind, breakpoint-dependent), shadow widths per size in `MovableBlobbi.tsx:624-628`, per-location size in `location-blobbi-sizes.ts`. Different stages (egg/baby/adult) render different SVGs into the **same box**: so stage changes do not change the anchor geometry, but they do change where the visual feet are inside the box **[likely]** (SVG-dependent; see §14).

---

## 7. Boundary system analysis

Three coexisting systems **[confirmed]**:

1. **`Boundary` shapes** (`src/lib/boundaries.ts`): rectangle / semicircle / arch / composite (rects, circles, triangles), all in world-percent space, keyed by background file in `location-boundaries.ts`. Applied by `constrainPosition`, which is a *clamp-to-nearest-point* function, not a reachability test: for composite shapes it clamps into the **nearest area independently**, so a target on the far side of a gap can clamp into a disconnected area, connectivity is only maintained by the per-frame re-clamping of the walk path.
2. **MovementBlockers** (`MovementBlockerContext`): runtime percent rects registered by furniture and props; a *point-in-rect* rejection test. Blockers stop movement dead rather than steering around.
3. **Z-index bands** (`backgroundZIndexConfigs`): not a boundary, but a parallel per-background y-banded config that must be maintained in lockstep with boundaries for occlusion to look right.

Validation point: **always the center point**: `constrainPosition(percentPos, boundary)` and `isPositionBlocked(x, y)` both take the bare position; the Blobbi's rendered width/height/scale are never considered **[confirmed]**. Consequences:

- Near a lower boundary edge the body's lower half (and shadow) can overlap "unwalkable" art; near an upper edge, the head pokes beyond it. Room authors compensate by tuning boundary numbers to the *visual* size of the Blobbi at that depth, unverifiable and per-room **[inference]**.
- Mouse, touch, `goTo()` (walk-to-interact), and remote-player animation all use the same `constrainPosition` + blocker checks, there is no separate boundary model per input type **[confirmed]**. But the **fallbacks differ**: local falls back to `{rectangle, x:[0,100], y:[60,100]}` (`PlayingView.tsx:170-174`), while the remote path's `createWalkableApi` falls back to "everything walkable" (`multiplayer.ts:437-448`) **[confirmed]**, a room missing a boundary entry behaves differently for local vs remote.
- `goTo(pos, immediate=true)` (seat snap, bed re-attach) **bypasses boundary clamping entirely**: it only checks blockers, then `setPosition(newTarget)` directly (`MovableBlobbi.tsx:479-495`). Seat cushions are outside walkable areas by design, so this is load-bearing **[confirmed]**.
- Room transitions bypass everything: the actor is remounted with a spawn position from `location-initial-position.ts`, unvalidated against the boundary. The arcade spawn bug documented in that file (`ARCADE_ELEVATOR_ALCOVE` comment) is a case where a spawn on a boundary line broke walk-to-interact, evidence that spawn/boundary consistency is only maintained by hand-written tests (`arcade-spawn.test.ts`) **[confirmed]**.

**Debug visualizer coupling**: none, `BoundaryVisualizer` is render-only, reads the same `Boundary` object, and is gated by `DebugOverlaysContext` (`PlayingView.tsx:540`). `MovementBlocker`'s red outline is also display-only; the blocker itself always registers **[confirmed]**.

Concrete per-room inconsistencies **[confirmed]**:

- `photo-booth-inside.png` boundary (`x:[20,68], y:[59,63]`) is used by the PhotoBooth modal in **modal-local** percent space, the same numbers mean different on-screen geometry than they would in-world.
- `cave-inside.png` has a 4.5%-tall walkable strip (`y:[71,75.5]`): with center-anchored positioning the body dwarfs the walkable band; the room works only because the art tolerates overlap **[inference]**.
- `nostr-station-inside.png` and `plaza-inside.webp` model stairs/aisles as many abutting rects/triangles; nearest-point clamping across these can produce corner-cutting between adjacent areas when a click lands in a notch **[likely]**.
- `arcade-minus1.png` contains commented-out leftover areas (`location-boundaries.ts:146-147`): config maintained by trial and error **[inference]**.

## 8. Room-by-room depth scaling comparison

**[confirmed]** `resolveBlobbiScale` (`blobbi-world-render.ts:68-83`): linear ramp on y across the boundary's y-extent. `factor = (y − minY)/(maxY − minY)`; `scale = finalScale + (initialScale − finalScale) × factor`. So **`initialScale` applies at the BOTTOM (front), `finalScale` at the TOP (back)**: the names are misleading. Rooms without an entry return 1 (and the theater is deliberately absent; its depth comes from per-seat `seatedScale` 0.85/0.78/0.72).

`scaleByYPosition` is passed `true` by `PlayingView` and `PhotoBoothModal`; remote players are **always** scaled (`MultiplayerLayer` applies `resolveBlobbiScale` unconditionally) **[confirmed]**.

| Background | Front scale (bottom) | Back scale (top) | Ratio | Boundary y-extent | Notes |
|---|---|---|---|---|---|
| `nostr-station-open.webp` | 1.2 | 0.6 | **2.00×** | 30–95 (composite) | Largest depth variation; worst shadow separation |
| `plaza-inside.webp` | 1.0 | 0.6 | 1.67× | 33–100 (composite) | Two floors share one linear ramp |
| `town-open.webp` | 1.2 | 0.8 | 1.50× | 58–70 (arch) | Steep ramp over only 12% of height |
| `plaza-open.webp` | 1.2 | 0.8 | 1.50× | 56–98 (rect) | Gentle ramp |
| `arcade-minus1.png` | 1.2 | 0.8 | 1.50× | 49–94 (composite) | |
| `mine-open.webp` | 1.6 | 1.2 | 1.33× | 68–98 (composite) | Largest absolute size |
| `shopping-mall-inside.png` | 1.0 | 0.8 | 1.25× | 27–100 (composite) | |
| `clothing-store-inside.png` | 1.2 | 1.0 | 1.20× | 70–90 (composite) | |
| `nostr-station-inside.png` | 1.4 | 1.3 | 1.08× | 50–92 (composite) | Near-flat |
| `arcade-1.png` | 1.2 | 1.2 | 1.00× | 51–100 (composite) | Flat, enlarged |
| `photo-booth-inside.png` | 1.5 | 1.5 | 1.00× | 59–63 (rect) | Flat, enlarged (modal space) |
| `home-inside.png`, `beach-open.webp`, `stage-inside.png`, `cave-inside.png`, `back-yard-open.webp`, `arcade-inside.png`, theater |, |, | 1.00× |, | No scaling entry |

Interaction of scale with other systems **[confirmed]**:

- **Movement speed**: unaffected by depth scale, a far-away (small) Blobbi covers screen distance at the same px/s, reading as faster-than-perspective **[confirmed]**; whether that is desired is an open question (§23).
- **Hitboxes/boundaries/arrival thresholds**: unaffected, the 2 px arrival snap and all clamping ignore scale.
- **Shadow**: width scales (its own `scale(dynamicScale)`), offset does **not** (§9).
- **Accessories**: inside the scaled wrapper, so they scale with the body, correct.
- **Vertical drift from scaling origin**: scaling around `center center` keeps the *center* fixed (that is the stored position) but moves the *feet*, the visual ground contact drifts up as the Blobbi walks back. Because the y-ramp is linear in y, walking straight "into" a room makes the feet trace a shallower path than the click points suggest **[confirmed by geometry, inference on visibility]**.

---

## 9. Shadow implementation analysis

Six distinct implementations exist, with no shared helper **[confirmed]**:

| # | Location | Kind | Sizing | Scales with body? |
|---|---|---|---|---|
| S1 | `MovableBlobbi.tsx:588` (anchor) | `filter: drop-shadow(0 8px 16px rgba(0,0,0,0.15))` | fixed px | Follows painted (scaled) pixels but offset/blur are constant, proportionally *larger* at small depth scales |
| S2 | `MovableBlobbi.tsx:620-635` | ground ellipse div, `absolute top-full left-1/2 h-1.5`, `radial-gradient(ellipse, rgba(0,0,0,0.2), transparent 70%)` | width per size class (`xl: w-8 md:w-10`), then `translateX(-50%) scale(dynamicScale)` | Width yes; **position no**: anchored to the unscaled box bottom |
| S3 | `MultiplayerLayer.tsx:1628` | drop-shadow filter | fixed px | Copy-paste of S1 |
| S4 | `MultiplayerLayer.tsx:1696-1712` | ground ellipse | identical | Copy-paste of S2 (comment: "same as MovableBlobbi") |
| S5 | `MascotBlobbi.tsx:58` | `drop-shadow-[0_10px_18px_…]` | fixed px | No scale container |
| S6 | `BlobbiCard.tsx:120-128` | drop-shadow + real contact ellipse `h-2 w-[64%]` | **width relative to art** | The only proportional shadow in the codebase |

S2/S4 are suppressed while seated (`resolveSeatedRender.hideShadow: true`) or `visualHidden`; S1/S3 while hidden. The `radial-gradient` string is duplicated byte-for-byte across the two files. The float animation (`animate-float`) moves the body wrapper only, never the shadow, an intentional hover effect per `MOVEMENT_SYSTEM.md`. No shadow belongs to the SVG sprite itself **[confirmed]**.

**Exact cause of the floating-Blobbi-at-the-back problem** **[confirmed]**:

The anchor box (height H = unscaled `CurrentBlobbiDisplay` box, e.g. 128 px for `xl` at `md:` breakpoints) is centered on the stored position. Two children hang off it:

- the **body**, scaled by `s = dynamicScale` around the box center → its rendered bottom edge sits at `center + s·H/2`;
- the **shadow**, positioned at `top: 100%` of the box → its center sits at `center + H/2` (plus half its own 6 px height), regardless of `s`.

Vertical gap between rendered feet and shadow = `(1 − s) · H/2`. Examples: `nostr-station-open` back wall (`s = 0.6`, `xl`): ≈ 26 px in world units; `plaza-inside` upper floor (`s = 0.6`, `lg` box 80 px): ≈ 16 px. The shadow's `scale(dynamicScale)` shrinks its **width** correctly but, because its transform-origin is its own center and its position is fixed at box-bottom, it never moves up with the feet. Result: small Blobbi, correctly small shadow, but too far below → the Blobbi appears to levitate, worst in the rooms with ratio ≥ 1.5× (table above).

Additional contributors **[confirmed]**: the inner SVG paints larger than its layout box (so even at `s = 1` the true feet are near/under the box bottom, partially masking the issue at the front and exaggerating the *relative* change toward the back), and `animate-float` adds a periodic vertical offset the shadow ignores.

---

## 10. Interaction-anchor analysis

**[confirmed]** Interaction destinations are defined in **five different styles**, all producing world-percent points aimed at the Blobbi's *center*:

1. **Live-rect base point**: `computeBaseCenterTarget(el, walkBoundary?)` (`InteractiveElement.tsx:24`): `x = rect center`, `y = rect.bottom − rect.height × 0.1` (magic 10%). Used by all generic doors/kiosks. Boundary clamping is **opt-in via `walkBoundary` and only `ArcadeRoom` passes it**, town/home/plaza/shop doors compute unclamped targets that merely happen to land on walkable ground.
2. **Live-rect fractional target**: three near-identical private copies: `computeBushTarget` (`TownBush.tsx:25`, default `{0.5, 0.5}`), `computeSeatTarget` (`theater/TheaterSeat.tsx:21`, `SEAT_CUSHION_TARGET {0.5, 0.2}`), `computeMachineTarget` (`arcade/ArcadeMachine.tsx:59`, `FRONT_OF_MACHINE {0.5, 0.9}`, `NEAR_EDGE_OF_TABLE {0.5, 0.95}`). Each clamps to the room boundary.
3. **Explicit config point**: `walkTarget` prop / constants: `ARCADE_COUNTER_STAND_Y = 60`, ticket counter `{24, 60}`, prize counter `{80, 60}`, `arcadeElevatorStandPoint` per floor, mine cave `approach {50, 71}` (`arcade-room-config.ts:212-254`, `mine-cave-config.ts:99`).
4. **Legacy chair anchor**: `handleChairClick` + `chairConfig.seatAnchor {xPercent, yPercent}` (`InteractiveElements.tsx:98`; shop `{50,25}`, nostr `{50,38}`), which resolves its container via the fragile class selector `closest('.w-full.h-full.relative')` and calls `goTo` directly, *and opens the modal immediately without waiting for arrival*.
5. **Config-only seat anchor**: `seatAnchorPosition(seat)` (`theater-seats-config.ts:245`), used for the seated *snap*, not the walk.

**Pending-interaction flow** (`usePendingInteraction.ts`) **[confirmed]**: single pending `{token, target, action, threshold, onCancel, stallFrames}`; a rAF poll compares `getCurrentPosition()` to the target with **Euclidean distance in percent space**, threshold 5 (8 on touch). Stall handling: 12 frames moving < 0.15% fires the action anyway if within `threshold × 1.6`, else cancels. If already within threshold, the action fires **synchronously inside `requestInteraction`** (documented foot-gun in `MineCaveEntrance.tsx:140-149`).

**Arrival-test inconsistency** **[confirmed]**: four different metrics coexist:

| Consumer | Metric | Units | Tolerance |
|---|---|---|---|
| `usePendingInteraction` | Euclidean | percent (anisotropic) | 5 / 8; ×1.6 on stall |
| `MovableBlobbi.animateMovement` | Euclidean | **rendered screen px** | 2 |
| Bed check (`PlayingView.handleMoveComplete`) | per-axis abs | percent | 2 |
| Presence-move broadcast gate | Euclidean | percent | resolvedThreshold |

Notes: 5% of x ≈ 52 world px but 5% of y ≈ 35 world px (elliptical tolerance); the movement loop's 2 px test is the only *viewport-scaled* one (2 screen px = 4 world px at scale 0.5), whereas speed **is** world-scale-corrected, an internal inconsistency.

**Seats** **[confirmed]**: walk target comes from the *live rect*, seated snap comes from *config* (`seatAnchorPosition`): two sources of truth per seat. On arrival, `PlayingView.handleSitInSeat` snaps with `goTo(seated.position, true)` (bypassing boundaries; cushions are off-boundary by design). `MovableBlobbi` consumes `seated.scale/facing/hideShadow/disableFloat` but **ignores `seated.position`** (correct only because PlayingView snapped); `MultiplayerLayer` renders remotes *at* `seated.position`. Seat pitch (96 px ≈ 9.18% of width, half-pitch 4.59%) is smaller than the 5% threshold, so clicking an adjacent seat teleport-snaps without walking **[confirmed]**.

**Beds** **[confirmed]**: a second, older walk-then-act system: `handleBedClick` → raw `goTo(sleepingPosition)` where `sleepingPosition = {bed.x, bed.y − 5}` (magic −5); arrival detected in `handleMoveComplete` with per-axis |Δ| < 2. **Bug: the check is not gated on the home room.** `bedPosition` defaults to `{75, 70}` in every room, so completing any walk at ≈(75, 65) in rooms whose walkable area contains it (e.g. `plaza-inside`, `nostr-station-open`) sets `isSleeping`/`isAttachedToBed`, and `isAttachedToBed` swallows the next world click (`MovableBlobbi.tsx:427-430`).

**Hiding** **[confirmed]**: bushes don't snap, the Blobbi keeps the clamped walk position; `hiddenIn` just sets `visualHidden` (anchor stays mounted for chat portals).

**Doors/exits/transitions** **[confirmed]**: interactive doors walk first via `requestInteraction`; but `BackArrow` (every interior) and `MapModal` teleport with no walk. Room transitions remount `MovableBlobbi` (`key={currentLocation}`) at a spawn from `location-initial-position.ts`: **never validated against boundaries**. Concrete instance: `EXIT_POSITIONS['shop:clothing-store-inside'] = {55, 40}` is outside every walkable area of `shopping-mall-inside.png`; the Blobbi spawns off-floor and snaps back on the first movement frame **[confirmed]**.

**Cancellation** **[confirmed]**: `useCancelInteractionOnWorldClick` binds capture-phase `pointerdown`/`touchstart` on `[data-world-surface]` (resolved via `document.querySelector`), cancelling any pending interaction on ground clicks not marked `data-block-move`. The `data-block-move` contract is enforced with **three separately-maintained selector lists** (`MovableBlobbi.shouldTriggerWorldMove`, `MultiplayerLayer`'s presence click filter, the cancel hook).

---

## 11. Drag and autonomous movement analysis

**[confirmed]**

- **The Blobbi itself is not draggable** anywhere. Drag exists for: `Furniture` (bed/chest/fridge, `react-use-gesture` `useDrag`, own percent conversion copy, `Furniture.tsx:49-89`), photo-booth accessories (`PhotoBoothModal`), accessory editing (`AccessoryOverlay`, **mouse events only**: no touch/pointer support), and `FoodItem`/`ChestModal` item drags.
- **No autonomous wandering exists** for the local or remote Blobbi. Remote motion is presence-driven interpolation only; the only "AI" movement in the repo is the arcade air-hockey opponent (`src/arcade/hockey/ai.ts`), unrelated to the actor.
- **Movement models in play**: (1) local rAF loop in `MovableBlobbi`; (2) remote rAF loop in `useIslandPresence.animatePlayers`: a *separate implementation* of constant-speed stepping with its own clamping (walkable API + blockers + micro-stepping) and 0.1%-quantized state updates; (3) `goTo(…, immediate)` teleports (seats, bed re-attach, photo booth); (4) room-transition remounts. Models 1 and 2 duplicate the percent↔px conversion and the world-scale speed correction **[confirmed]**.
- **Bed dragging while attached** re-snaps the Blobbi each frame with `goTo(newSleepingPosition, true)` (`PlayingView.handleBedPositionChange`): bypassing boundaries, driven by the bed's own clamped drag.
- **Duplicated state**: the local position exists as `MovableBlobbi.position` (state), `targetRef`, `PlayingView.myPosition` (destination-at-move-start, *not* live), `useIslandPresence.myPosRef`, and `livePositionsRef[LOCAL_GAZE_KEY]` (live, per-frame). Consumers disagree about which is "the" position **[confirmed]**; mid-walk publishes (heartbeat/sit) use the destination (§12).
- Special cases: sleeping/`isAttachedToBed` swallows world clicks (wake-only); `seatedIn` wakes + stands on any world click; `visualHidden` keeps input alive but paints nothing; photo-booth suppresses world moves globally via `isPhotoBoothOpen`.

---

## 12. Multiplayer implications

**[confirmed]** (full detail cross-checked against `multiplayer.ts`, `useIslandPresence.ts`, `MultiplayerLayer.tsx`):

- **Wire format**: kind `31950` (addressable, NIP-40 expiration 35 s). All coordinates live in JSON `content`: `anchor {x, y, ts}` and `goal {from, to, v, ts}`: **world-percent values (0–100), implicitly the sprite-box center**. No tag-based coordinates; no version marker; nothing in `NIP.md` states which body point the coordinates represent.
- **Published from**: `publishPresenceLogin`, `publishMove`, `publishHide`, `publishSit`, `publishActivity`, `publishHeartbeat` (`multiplayer.ts:485-807`). Because `PlayingView.handleMoveStart` sets `myPosition` to the **destination** at walk start, mid-walk heartbeats/sits publish the destination, not the live position, remotes snap a walking Blobbi to its endpoint when a heartbeat lands mid-walk **[confirmed]**.
- **Unit bug**: `goal.v` is `DEFAULT_SPEED_PX = 120` world px/s, but `posAt` (`multiplayer.ts:352-374`) divides a **percent-space** distance by it, the computed walk duration is meaningless (~always returns `goal.to`). Real remote motion instead comes from the rAF loop, which converts to rendered px correctly.
- **Remote rendering**: `RemoteBlobbiSprite` mirrors `MovableBlobbi`'s DOM (anchor `translate(-50%,-50%)` → scale wrapper → float wrapper → `CurrentBlobbiDisplay` + byte-identical shadow) but: no 200 ms position transition (local eases, remote jumps on non-walk repositioning), `showAccessories={false}` (remotes never show accessories), depth scaling applied **unconditionally** while local requires the `scaleByYPosition` opt-in, and sleeping is **not in the protocol** at all, a sleeping player appears awake, standing at the bed offset, to everyone else.
- **Boundary reconstruction**: remote targets are re-clamped locally via `createWalkableApi` → `constrainPosition` with a *different* fallback (everything walkable) than the local fallback rectangle; three separately-maintained location→background maps feed these paths (`location-backgrounds.ts`, `multiplayer.ts:456-473`, `MultiplayerLayer.tsx:1467-1484`): currently in agreement, enforced by nothing.
- **Center→ground migration impact**: mixed-convention clients would disagree by half a sprite box (~7–9% of world height for `xl`). Since there is no version field, migration requires either a new content field (e.g. `ground {x,y}` alongside `anchor`) or an explicit `anchorMode`/`v` marker, plus updates to `NIP.md` and `docs/protocol/blobbi-island-event-registry.md`. The lowest-blast-radius strategy **[recommendation]**: keep the wire format center-based and convert at exactly two boundaries, the publish helpers on the way out and `processPresenceEvent` on the way in, so all internal logic can move to ground-anchor semantics without a protocol change; a wire migration can follow later, independently.
- Tests currently pin the center semantics (`MultiplayerLayer.seating.test.tsx` asserts `transform === 'translate(-50%, -50%)'` and seat-anchor `left/top`), so any anchor change must update these deliberately.

---

## 13. Accessory-readiness analysis

An accessory system already exists and renders, `src/components/blobbi/test-accessories.md` is out of date (it claims no visual rendering and headwear/eyewear only) **[confirmed]**.

**Current mechanics** **[confirmed]**:

- `AccessoryOverlay` mounts as `absolute inset-0` inside `CurrentBlobbiDisplay`'s outer box. Each accessory: `left/top` = stored `x/y` **percent of that box**, `transform: translate(-50%,-50%) scale(s) rotate(r) [scaleX(-1)]`, and an `<img>` whose size is **fixed CSS px**: `baseSize = 60 × sizeMultiplier`.
- Persistence is Nostr-only: kind `31124` `equip` tags `['equip', code, 'x', …, 'y', …, 'scale', …, 'rot', …, 'flipX', …, 'refw', …, 'refh', …, 'form', …, 'url', …, 'ver', '1']`; inventory in kind `11125`/`31125` `inv` tags. No localStorage.
- Editing happens in `BlobbiInfoModal` (drag = **mouse events only**, wheel = scale, shift-wheel = rotate, plus sliders and a numeric panel), positions clamped to `[5, 95]` percent.

**Why the current renderer is NOT yet safe for user-positioned accessories in the world** **[confirmed]**:

1. **The percent box is not the body box.** `CurrentBlobbiDisplay` has two size ladders: the outer box (`sizeClasses`, e.g. `lg`: 64/80 px) that accessory percentages map onto, and the inner SVG div (`lg`: 80/96 px) that paints the body, for `lg` (the default world size) the body **overflows the accessory coordinate space by 20–25%**. Stored positions are therefore relative to a box that doesn't match the visible body, and the mismatch changes at the 768 px `md:` breakpoint.
2. **Three hand-tuned multiplier tables disagree.** `CurrentBlobbiDisplay` (`sm:0.3 … xl:1.0`) vs `CurrentBlobbiPreview` (`sm:0.4 … 3xl:2.2`) vs the fixed 60 px base. The editor renders `xl` at multiplier 1.0; the world often renders `lg` at 0.7, accessory-to-body ratio varies from 0.44 to 0.54 across contexts, so **what the user positions in the editor is not what renders in the world**.
3. **The viewport `md:` breakpoint cuts across the world transform.** Body and box sizes step discretely at 768 px viewport width while the world scales continuously, accessories and body drift at the breakpoint (same root cause as §8's size jump).
4. **`refw`/`refh`: the intended normalization anchor, are written to every tag and read by nothing** (dead fields).
5. **Precision loss**: `parseEquipTags` reads `x`/`y` with `parseInt`, truncating drag-produced floats on every round-trip; the two parsers even have different defaults (`x:'50'` vs `x:'5'`).
6. **Paint order is relay tag order**: no slot-based layering (a `back` item can paint over `headwear`); in-world (static) items have no z-index at all and rely on DOM order.
7. **`transition-all duration-200` on each accessory** makes them lag the body during per-frame movement/scale updates (the body's own transition is disabled while moving; the accessories' is not).
8. **Remote players render no accessories** (`showAccessories={false}` in `RemoteBlobbiSprite`).

**What already works in the world context** **[confirmed]**: transform inheritance is correct, accessories sit inside the depth-scaled wrapper, so world scale, depth scale, seat scale, and the moving `scale-105` all apply to body + accessories together; there is no clipping between the accessory and the stage edge; rear view hides face slots (`REAR_VIEW_HIDDEN_SLOTS`); the night-grade opt-out (`data-island-world-grade="exclude"`) exists specifically so accessory `<img>`s don't darken separately from the SVG body.

**Readiness verdict** **[inference]**: the transform chain is sound; the coordinate *space* is not. Before user-positioned accessories can be trusted to stay attached, the renderer needs (a) one box that is both the body's layout box and the accessory percent space, (b) accessory size expressed relative to that box instead of fixed px, (c) removal of viewport breakpoints from body sizing (size in world px), and (d) slot-ordered painting. SVG- vs image-based bodies do not need different strategies as long as both paint into that one normalized box.

---

## 14. Expression and renderer reuse analysis

**What exists today** **[confirmed]**:

- **Gaze** is the only "expression" system: `src/lib/gaze.ts` (pure, deterministic attention resolution with priorities, hold timers, and an acquisition-only radius, the best-factored module in the visual system), `useIdleGaze` (per-Blobbi rAF micro-movements), and `applyGazeMarkup` (SVG-side pupil tagging + CSS-variable translation).
- **Sleep** = alternate SVG asset per stage/form. **Facing** = front/rear markup derivation (`applyRearView`). That is the complete state vocabulary.
- **No emotions, moods, blinks, or mouth states exist.** `mood`, `pattern`, `specialMark` are parsed/typed and never rendered, reserved capacity, not features.
- **Two competing domain models**: `src/blobbi/core/types/blobbi.ts` (`BlobbiLifeStage`, `BlobbiVisualTraits`, guards) is not what renderers consume; they use `useBlobbis`'s parallel `Blobbi` interface. The "portable core" types are effectively decorative **[confirmed]**.

**Ditto and blobbi-kit** **[confirmed]**:

- `@blobbi-kit/core` / `@blobbi-kit/react` (v0.3) are real dependencies but export **domain/protocol logic and hooks only; no components, no SVG**. The renderer's single import from it is `hexToHsl`/`hslToHex` in the adult customizer.
- Ditto is **not a dependency**; it is a copy-paste ancestor (`loadBlobbiSvg.ts` header, `BlobbiHatchingCeremony` adapted from Ditto's `EggGraphic`, egg animations in `index.css`). Nothing further should be copied during stabilization per scope.
- **Three color-manipulation implementations** coexist: `src/blobbi/ui/lib/svg/colors.ts` (bit-twiddling lighten/darken), blobbi-kit's `color-guardrails`, and `BlobbiHatchingCeremony`'s local `createColorVariants`.

**Reusable now (pure, props-in/visuals-out)** **[confirmed]**: all of `src/blobbi/ui/lib/svg/*`, `src/blobbi/{baby,adult}-blobbi/**`, `loadBlobbiSvg`, `gaze.ts`, `blobbi-world-render.ts` (pure math over config singletons), `MascotBlobbi`.

**Island-coupled** **[confirmed]**: `CurrentBlobbiDisplay` (unconditional Nostr hooks; the only real renderer), `MovableBlobbi` (movement + rendering fusion), `MultiplayerLayer`/`RemoteBlobbiSprite` (inline copy of the wrapper DOM), `AccessoryOverlay` (equipment subscriptions, fixed px sizing).

**Library candidates vs Island-resident** **[inference]**: the string pipeline + gaze math + a future pure `BlobbiRendererView` (+ normalized accessory slots) are library-shaped; the comment-block markup convention would need to be formalized (it is the de-facto renderer API, artwork edits to comment labels silently break gaze/rear-view, currently guarded only by `rear-view.test.ts`). Everything touching rooms, movement, presence, and equipment persistence stays in the Island.

---

## 15. Duplicated logic and competing systems

**[confirmed]** Ranked by refactor impact:

1. **Two actor wrappers**: `MovableBlobbi` vs `RemoteBlobbiSprite` (`MultiplayerLayer.tsx:90-184`, `1610-1726`): parallel DOM, byte-identical shadow markup, separately maintained. The scale/z/seat *math* was already unified into `blobbi-world-render.ts` after a past divergence (its docstring documents the incident); the *markup* was not.
2. **Two movement integrators**: `MovableBlobbi.animateMovement` vs `useIslandPresence.animatePlayers`: both do constant-speed stepping with world-scale correction, with different clamping strategies, arrival tests, and quantization.
3. **Two walk-then-act systems**: `usePendingInteraction` (tokens, thresholds, stall, cancel) vs legacy `goTo` + `onMoveComplete` (bed, `handleChairClick`, which doesn't even wait for arrival).
4. **Five rect→world-target functions**: `computeBaseCenterTarget`, `computeBushTarget`, `computeSeatTarget`, `computeMachineTarget`, `handleChairClick`'s inline version (fragile class-string container lookup).
5. **Four percent↔pixel conversion copies**: `MovableBlobbi`, `Furniture`, `MultiplayerLayer` callbacks, `PhotoBoothModal` internals.
6. **Three location→background maps**: `location-backgrounds.ts`, `getBackgroundFileForLocation` (`multiplayer.ts:456-473`), inline map in `MultiplayerLayer.tsx:1467-1484`.
7. **Three `data-block-move`/UI-blocking selector lists**: `MovableBlobbi.shouldTriggerWorldMove`, `MultiplayerLayer` presence filter, `useCancelInteractionOnWorldClick`.
8. **Four arrival metrics** (§10 table).
9. **Four size/multiplier ladders** for body/accessory proportions, `sizeClasses`, inner SVG classes, `CurrentBlobbiDisplay` accessory multipliers, `CurrentBlobbiPreview` multipliers.
10. **Two boundary fallbacks**: local rectangle `y:[60,100]` vs remote "everything walkable".
11. **Aspect ratio derived twice**: `WORLD_ASPECT` (`VirtualWorld.tsx:13`) and `STAGE_ASPECT` (`BlobbiStage.tsx:27`).
12. **Near-dead config**: `interactiveElementsConfig` (14 elements with `yPosition`/`chairConfig` fields consumed by nothing except its z-index sibling); unused `seatedOffset` on all 28 theater seats; dead `ANIMATION_INTERVAL_MS`; dead `refw`/`refh`; unrendered `pattern`/`specialMark`/`mood`.
13. **Five incompatible size tables** across `CurrentBlobbiDisplay`, `SimpleBlobbiDisplay`, `FloatingBlobbi`, `CurrentBlobbiPreview`, `MascotBlobbi`.
14. **Gaze-priority block written twice**: the `isMoving → attention → idle` resolution appears verbatim in `MovableBlobbi.tsx:514-534` and `MultiplayerLayer.tsx:147-165`.
15. **Three color-helper implementations** (§14).
16. **Two dead renderers**: `SimpleBlobbiDisplay`, `FloatingBlobbi` (zero importers, ~240 lines).
17. **Two parallel Blobbi domain models**: `src/blobbi/core/types` vs `useBlobbis`'s `Blobbi` interface.

---

## 16. Confirmed bugs and visual inconsistencies

All **[confirmed]** unless noted:

1. **Click-destination misalignment**: clicked point becomes the body *center* (§6). Feet land `≈ scale·H/2` below the click; error varies with size class, breakpoint, and depth scale.
2. **Shadow separation at depth**: gap `= (1 − scale)·H/2` between scaled feet and box-anchored shadow (§9). Worst in `nostr-station-open` (up to ~26 px world units for `xl`).
3. **Bed sleep-check fires in any room**: `handleMoveComplete` compares against a default `sleepingPosition {75, 65}` with no home-gate; walking to that point in `plaza-inside` or `nostr-station-open` puts the Blobbi to sleep and swallows the next click (§10).
4. **Off-floor spawn**: `EXIT_POSITIONS['shop:clothing-store-inside'] = {55, 40}` is outside every walkable area of `shopping-mall-inside.png`; no spawn point is validated against boundaries.
5. **Mid-walk presence publishes the destination**: heartbeat/sit/activity events snap remote copies of a walking Blobbi to its endpoint (§12).
6. **`posAt` unit bug**: percent distance ÷ px/s velocity (§12).
7. **Blobbi size jumps ~20-25% relative to the room at the 768 px viewport breakpoint** while the world scales continuously; accessories mis-align at the same breakpoint (§13, root cause shared).
8. **Editor/world accessory mismatch**: accessories are positioned on a box that differs from the body box, at a different size class and multiplier than the world render (§13).
9. **Accessory drag is mouse-only**: untouchable on the touch devices that get immersive mode.
10. **`parseInt` quantization** of accessory x/y on every save/load round-trip; inconsistent parser defaults (`'50'` vs `'5'`).
11. **Sleeping is invisible to remotes**: appears awake, standing, floating at the bed offset.
12. **Remote players show no accessories.**
13. **Adjacent-seat teleport**: seat half-pitch (4.59%) < interaction threshold (5%), so clicking the next seat snaps without walking.
14. **PhotoBooth movement runs at ≈45% speed**: its `MovableBlobbi` computes `worldScale = modalWidth/1046` against a 470 px modal that is not the world (§5, C8) **[confirmed by code; visual effect likely]**.
15. **Local seated render trusts a side effect**: `MovableBlobbi` ignores `seated.position`; correctness depends on `PlayingView` having snapped (remote renderer uses `seated.position` directly).
16. **Anisotropic percent distances**: all percent-space thresholds are ellipses in world space (1% x = 10.46 px vs 1% y = 6.97 px).
17. **Diagnostic globals shipped in production**: `window.__diagDeltas` (an unbounded array pushed every animation frame) and `__diagEffectRuns` in `MovableBlobbi.tsx:267, 356`, a slow memory leak during long walks **[confirmed code; leak severity inference]**.
18. **Dead affordances**: hover/cursor-pointer elements with no `onClick` (stage little door, furniture store, chill lounge, beach boat `console.log`).
19. **`lg` body overflows its own box**: the transparent-mode inner SVG (`size-20` = 80 px) is larger than the outer container (`h-16` = 64 px); and the default branch's `h-18 w-18 md:h-18` are undefined Tailwind classes (silent no-ops), collapsing that branch's inner box to content size.
20. **Egg stage renders as a baby**: `loadBlobbiSvg` has no egg branch; the only egg art is unreachable from the renderer path (private to `BlobbiHatchingCeremony`).
21. **Adults have half the relative eye travel of babies**: gaze translation is a fixed 2 SVG user units against viewBoxes of 100 vs 200.
22. **Remote sprites run the local player's data hooks**: `CurrentBlobbiDisplay` calls `useBlobbis()`/`useBlobbonautProfile()` unconditionally and discards the results when `visualOverride` is set.
23. **SMIL animations in adult artwork ignore `prefers-reduced-motion`** and cannot be paused.
24. **Fixed-px float bob and drop-shadow inside/around the scale container**: the −4 px bob and 8/16 px drop-shadow don't scale with the body, so both are proportionally exaggerated on small (far) Blobbis.
25. **`MascotBlobbi` uses a fixed `instanceId`**: two mascots on one screen share uniquified gradient ids (latent collision, currently benign because colors are identical).

---

## 17. Architectural risks

1. **Anchor semantics are load-bearing everywhere** **[confirmed]**: `translate(-50%,-50%)` is assumed by movement, boundaries, seats, gaze vectors, chat-bubble portals, name labels, presence, z-band configs, scaling ramps, and tests. Changing it piecemeal will visibly break rooms one at a time; changing it globally requires re-tuning every boundary/spawn/anchor number that was hand-calibrated to center semantics **[inference]**.
2. **Hand-tuned config debt**: boundaries, z-bands, scaling ramps, spawn points, and interaction anchors are independent per-background tables with no cross-validation. Any anchor change invalidates numbers that only look right visually. The arcade-spawn incident shows these regressions ship silently without a pinning test.
3. **Protocol coupling**: position semantics leak into kind 31950 with no version marker (§12).
4. **Duplicated markup drift**: local/remote wrapper duplication is exactly the class of bug the shared-math module was created to prevent, the markup half of that risk is still open.
5. **Viewport breakpoints inside the world**: any px/rem/`md:` sizing inside `VirtualWorld` breaks the single-coordinate-space guarantee; the Blobbi body is the main offender today.
6. **`PlayingView` as a god component** **[inference]**: seat/hide/sleep/bed/session state, modal state, and actor wiring in one 729-line file; each new interaction type has grown a new state + callback pair.

---

## 18. Recommended target architecture

**[recommendation]** The proposed conceptual structure fits, with adjustments. Evaluated against the code:

```text
BlobbiActor (world-side wrapper; one implementation for local AND remote)
├── world position  = GROUND POINT (bottom-center), world-percent
├── anchor element  (unscaled; portal target for bubbles/labels; keep this concept, it works)
│   ├── shadow layer      (positioned AT the ground point; scales width with depth)
│   └── visual rig        (transform-origin: bottom center; scale(depth × seat × stage))
│       └── BlobbiRenderer (pure; from props/visual spec)
│           ├── behind-body attachments (slot: back)
│           ├── body (SVG, stage-specific)
│           ├── patterns / body details        [already inside SVG generation]
│           ├── face & expressions (gaze, sleep, facing)
│           ├── body/front attachments (slot-ordered accessories)
│           └── effects
├── interaction layer (hit area = scaled body bounds, not the box)
└── debug layer (optional; already decoupled; keep as-is)
```

Adoption verdicts:

- **Adopt: ground anchor as the stored position.** Every audited bug in §16 items 1, 2, 8 traces to center-anchoring + center-origin scaling. Bottom-center with `transform-origin: bottom center` on the visual rig makes feet position invariant under depth scale, fixes the shadow by construction (shadow lives at the anchor, not at box-bottom), and makes click-to-move mean "walk feet to here".
- **Adopt: one actor component for local and remote.** The presence layer should feed the same `<BlobbiActor>` used locally, differing only in position source (rAF integrator vs input): the repo already proved this works for the math (`blobbi-world-render.ts`); extend it to markup.
- **Adopt: separating "movement/world" from "renderer".** The seam already exists implicitly: `CurrentBlobbiDisplay` is nearly a pure renderer, spoiled only by its internal data-fetching hooks (`useBlobbis`, `useBlobbonautProfile`) and the accessory box mismatch. Making `visualOverride` the *only* mode (data passed in; a thin local-player wrapper does the fetching) yields the reusable renderer without a library extraction.
- **Change: don't add a separate "interaction layer" component**: the anchor already serves as hit target and portal host; formalize it instead of adding nesting **[inference: extra layers cost stacking-context complexity in a system that depends on z-band occlusion]**.
- **Change: keep shadow OUTSIDE the visual rig** (sibling under the anchor), contrary to the sketch. It must not inherit the float animation or expression transforms; it needs only depth-scale width. The current code got this half-right.
- **Unnecessary complexity to avoid**: per-slot attachment *components* (slots can be data, ordered arrays); a generalized effects tree before any effect exists; physics/pathfinding in the movement model (straight-line + clamp is fine and multiplayer-compatible).
- **Movement/world logic** (boundaries, depth ramps, z-bands, interaction anchors, presence) stays Island-side, parameterized by room config; the renderer must never read location, boundary, or Nostr state.

**Ground-anchor migration math** **[recommendation]**: with positions as ground points, depth scaling becomes `scale` around bottom-center; the perceived-speed question (§23) can then be addressed separately by optionally scaling speed with depth. Presence can stay center-based on the wire initially (convert at publish/ingest, §12): semantics change internally first, protocol later.

---

## 19. Island-specific vs reusable responsibilities

**[recommendation]** Practical split given current code:

| Reusable (future `@blobbi/renderer`) | Stays in Blobbi Island |
|---|---|
| SVG body generation (`src/blobbi/**`, `loadBlobbiSvg`) | Room movement loop, click capture, `goTo` |
| Stage/species visual spec types (`BlobbiVisual`) | Boundaries (`boundaries.ts`, `location-boundaries.ts`, blockers) |
| Gaze markup + eye offset application | Depth ramps, z-bands, per-room size |
| Expression/sleep/facing rendering | Interaction targets, walk-to-interact, seats/beds/hiding |
| Accessory slot rendering + normalized accessory coordinates | Room transitions, spawn/exit points |
| The pure display component (today: `CurrentBlobbiDisplay` minus its hooks) | Presence protocol, remote interpolation, occupancy |
| Actor-local layering (behind/body/front/effects) | Chat bubbles, name labels, HUD, world grading |
| A documented "body bounding box" contract for attachment points | `VirtualWorld` scaling, letterboxing, immersive mode |

Verdict on practicality **[inference]**: high. `CurrentBlobbiDisplay` already runs in five contexts (world local, world remote via `visualOverride`, info modal, previews, selection screens): the renderer boundary exists de facto. The two things blocking a clean extraction are the internal data hooks and the box/size-ladder mess (§13). No Ditto code exists in this repo and none should be copied during stabilization.

---

## 20. Suggested implementation phases

**[recommendation]**

- **Phase 0: Pin current behavior + quick hygiene.** Add spawn-vs-boundary validation tests (generalize `arcade-spawn.test.ts`), a shadow-geometry test, and anchor-semantics tests; remove `__diagDeltas`/`__diagEffectRuns`; gate the bed check on `home-inside.png`; fix the off-floor exit spawn. No architecture change.
- **Phase 1: Normalize the renderer box.** One size ladder in world px (no `md:` variants inside the world), body box = accessory box, accessory size as a fraction of the box, slot-ordered painting; delete the dead renderers (`SimpleBlobbiDisplay`, `FloatingBlobbi`) and the no-op `h-18/w-18` classes; collapse the four-branch JSX in `CurrentBlobbiDisplay`. This fixes §16 items 7-8 and 19 and unblocks accessories without touching movement.
- **Phase 2: Ground anchor.** Switch the actor anchor to bottom-center (`translate(-50%, -100%)` on the anchor, `transform-origin: bottom center` on the rig), move the shadow to the anchor point, convert stored/published positions at the presence boundary, adjust boundaries/spawns/anchors per room (mostly `+H/2`-style offsets), update pinned tests. Fixes §16 items 1-2 structurally.
- **Phase 3: Unify the actor.** Extract `<BlobbiActor>` used by both `MovableBlobbi` (input/movement shell) and `MultiplayerLayer` (presence shell); collapse shadow/label/anchor markup duplication; single rect→target helper and arrival metric for interactions.
- **Phase 4: Renderer purity.** `CurrentBlobbiDisplay` → pure `BlobbiRendererView` (props only) + thin `CurrentBlobbiDisplay` wrapper that fetches; define the attachment-point contract; then (later, separate effort) extract to a shared library.

## 21. Files likely to be modified per phase

**[recommendation]**

- **Phase 0**: `src/lib/location-initial-position.ts` (data fix), `src/components/blobbi/PlayingView.tsx` (bed gate), `src/components/blobbi/MovableBlobbi.tsx` (diag removal), new tests beside `src/lib/arcade-spawn.test.ts`.
- **Phase 1**: `src/components/blobbi/CurrentBlobbiDisplay.tsx`, `AccessoryOverlay.tsx`, `CurrentBlobbiPreview.tsx`, `src/components/blobbi/lib/accessory-utils.ts` (float parsing), `BlobbiInfoModal.tsx` (editor box), `src/lib/location-blobbi-sizes.ts` (px-based sizes); delete `SimpleBlobbiDisplay.tsx`, `FloatingBlobbi.tsx`.
- **Phase 2**: `MovableBlobbi.tsx`, `MultiplayerLayer.tsx`, `src/lib/blobbi-world-render.ts`, `src/lib/boundaries.ts` (unchanged math, re-tuned data in `location-boundaries.ts`), `location-initial-position.ts`, `theater-seats-config.ts` (`seatAnchorPosition`), `town-bushes-config.ts`, `arcade-room-config.ts`, `mine-cave-config.ts`, `usePendingInteraction.ts` (thresholds), presence conversion in `useIslandPresence.ts`/`multiplayer.ts`, plus the seating/hiding/movement test files.
- **Phase 3**: new `src/components/blobbi/BlobbiActor.tsx`; shrink `MovableBlobbi.tsx` and `MultiplayerLayer.tsx`; `InteractiveElement.tsx`/`TownBush.tsx`/`TheaterSeat.tsx`/`ArcadeMachine.tsx` (shared target helper); retire `handleChairClick` and the bed's legacy path (`InteractiveElements.tsx`, `PlayingView.tsx`).
- **Phase 4**: `CurrentBlobbiDisplay.tsx` split; `src/blobbi/**` re-exports; consumers (`BlobbiCard`, previews, selection/login screens).

## 22. Tests to add before/during the refactor, and validation results

**Tests to add [recommendation]**:

1. Every spawn and exit position lies inside its room's boundary (table-driven over `LOCATION_INITIAL_POSITIONS` + `EXIT_POSITIONS` × `locationBoundaries`).
2. Shadow geometry: rendered shadow center stays within ε of the rendered body's bottom edge across depth scales (would fail today, pin after Phase 2).
3. Anchor semantics: one explicit test asserting what world point the actor's feet occupy (today: center; post-Phase-2: ground) so migration is a deliberate test change.
4. Accessory round-trip: position survives serialize→parse without quantization; editor box == world box for the same size.
5. Arrival consistency: `usePendingInteraction` and `animateMovement` agree on "arrived" for the same target across world scales.
6. Presence conversion: publish→ingest round-trip preserves the anchor point under both center and ground conventions (Phase 2 gate).
7. Local/remote parity: `MovableBlobbi` and `RemoteBlobbiSprite` produce identical anchor/scale/shadow styles for the same inputs (extends existing seating tests).

**Validation performed for this audit [confirmed]**: no production code was modified:

| Check | Command | Result |
|---|---|---|
| Type check | `tsc -p tsconfig.app.json --noEmit` | ✅ clean |
| Lint | `eslint` | ✅ 0 errors, 18 pre-existing warnings (exhaustive-deps and similar) |
| Tests | `vitest run` | ✅ 3287 passed / 3287, 144 files |
| Build | `vite build` | ✅ success (pre-existing chunk-size warning) |

Existing test coverage relevant to this audit: `MovableBlobbi.test.tsx` (scale wrapper), `MovableBlobbi.seating.test.tsx` / `.hiding.test.tsx`, `MultiplayerLayer.*.test.tsx` (seating/hiding/activity, pins `translate(-50%,-50%)`), `theater-seats-config.test.ts`, `arcade-spawn.test.ts` (the only spawn/boundary validation), `interactive-elements-config.test.ts`, `multiplayer.*.test.ts`, `GazeTracking.integration.test.tsx`.

## 23. Open questions (not resolvable from code)

1. **Should movement speed scale with depth?** Today screen speed is constant regardless of scale; true perspective would slow the Blobbi down as it walks back. Design decision.
2. **Should boundaries constrain the feet or the body extent?** Ground-anchoring makes "feet inside walkable area" natural, but rooms were hand-tuned to center semantics, do we re-tune numbers or apply a global half-height offset per room?
3. **Intended accessory-to-body ratio and slot set**: the multiplier tables disagree; which context (editor `xl` vs world `lg`) reflects design intent?
4. **Is the float animation ("hovering") canon for all stages?** It directly conflicts with a crisp ground-contact model; MOVEMENT_SYSTEM.md describes it as intentional.
5. **Presence protocol migration appetite**: can kind 31950 gain a `ground` field / version marker, and on what compatibility timeline with other clients (if any exist)?
6. **Should remote players ever show accessories/sleep state?** Both are currently local-only; adding them changes event size and fetch patterns.
7. **PhotoBooth's future**: should it render inside a `VirtualWorld` so the actor behaves identically, or is its portrait modal space intentional?
8. **Are the dead affordances (§16.18) planned features or removable?**

