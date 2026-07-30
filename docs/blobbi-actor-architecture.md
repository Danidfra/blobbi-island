# Blobbi Actor Architecture (post-Phase 3)

The consolidated architecture for the Blobbi actor, movement, and interaction
systems. This is the CURRENT contract; the Phase 0–2 documents remain as
historical derivations and point here.

```
world/input controllers        PlayingView (room orchestrator)
        │                      ├── useBlobbiPoseController   (local pose + transitions)
        │                      ├── usePendingInteraction     (walk-to-interact lifecycle)
        │                      └── MultiplayerLayer          (presence + remote actors)
        ▼
canonical movement & interaction APIs
        │   useBlobbiMovementController · resolveElementApproachTarget
        │   shouldTriggerWorldMove · world-coordinates · blobbi-pose
        ▼
BlobbiActor            (shared ground-anchor actor primitive)
        ▼
BlobbiRendererView     (pure visual renderer)
```

## 1. World coordinate systems

Three systems, one conversion module — `src/lib/world-coordinates.ts`:

| system | units | used for |
| --- | --- | --- |
| world percent | `{x, y}` 0..100 of the world surface | all stored positions, boundaries, targets, anchors |
| world-design px | fixed **1046 × 697** design space | movement speed, distances, arrival thresholds |
| viewport (client) px | what pointer events report | input only; converted immediately |

Rules:

- `WORLD_WIDTH` / `WORLD_HEIGHT` are defined **only** in `world-coordinates.ts`.
  `VirtualWorld` (the uniform-scale renderer), the theater/arcade configs, and
  the map all import them.
- Percent deltas are anisotropic; every distance/threshold decision converts
  through the design space first (`worldDistancePx`).
- Conversions never clamp. Boundary clamping is an explicit, separate call
  (`constrainPosition`, `src/lib/boundaries.ts`).
- `getBoundingClientRect()` returns post-transform rects, so client→percent
  math is invariant under the uniform world scale.

## 2. Ground-position contract

Unchanged from Phase 2 (`src/lib/blobbi-ground.ts`):

- A stored actor `Position` is the **ground-contact point** (where the feet
  touch the floor), in world percent.
- The visual rig grows upward from it (`translate(-50%, -100%)`, scaling
  around `bottom center`); the shadow is centered on it; boundaries constrain
  it; interaction targets are ground points.
- The kind 31950 presence **wire** still carries legacy CENTER points;
  conversion happens only in `src/lib/presence-ground.ts`
  (`groundToWireCenter` / `wireCenterToGround`).
- `blobbiHalfHeightPercent` is the single source of the center↔ground offset;
  the theater seat pose and the arcade ground offset derive from it.

## 3. Movement controller

`src/hooks/useBlobbiMovementController.ts` — the local player's movement
engine, extracted from `MovableBlobbi`:

- current ground position, walk target, `isMoving`, heading, optional trail;
- the rAF integration loop (fixed design px/s → viewport-independent speed);
- `goTo(target)` — walk; the **target** is not clamped, each **step** is;
- `snapTo(pose)` — immediate, boundary-bypassing pose snap (the ONLY way a
  pose anchor enters the world), cancels any active walk, completes once;
- `stop()` — cancel in place, no completion.

Lifecycle guarantees (tested in `useBlobbiMovementController.test.tsx`): one
rAF loop at most; retargeting redirects rather than stacks; callbacks are read
through refs so parent re-renders/prop churn never restart, stall or
double-complete a walk; unmount cancels the loop. Historical contract kept: a
blocker collision ends the walk in place but reports the *target* to
`onMoveComplete`.

## 4. BlobbiActor

`src/components/blobbi/BlobbiActor.tsx` — the shared Island-side actor
primitive for local AND remote players. Owns the ground-anchor DOM geometry
(anchor box, scale rig, float wrapper, ground shadow, label slot, debug
markers) and nothing else: no input, no movement, no presence, no pose logic.
Same props in → same geometry out, whoever mounts it.

## 5. BlobbiRendererView

`src/components/blobbi/BlobbiRendererView.tsx` — the pure visual renderer
(body SVG + accessory overlays inside the canonical square renderer box, see
`docs/blobbi-renderer-contract.md`). Unchanged by Phase 3.

## 6. Approach targets

`src/lib/approach-target.ts` — the ONE implementation of "resolve where the
feet should stop for this object":

```ts
resolveElementApproachTarget({
  element,          // live rendered rect
  worldSurface?,    // defaults to closest('[data-world-surface]')
  fraction,         // ObjectFraction inside the element rect
  boundary?,        // explicit walk-boundary clamp
  yOffsetPercent?,  // number | (rawY) => number (e.g. arcade half-body offset)
}) → { target, meta: { raw, clamped, fraction } } | null
```

Consumers and their configuration:

| object | fraction | clamp | offset |
| --- | --- | --- | --- |
| generic door/kiosk (`InteractiveElement`) | `ELEMENT_BASE_FRACTION` (0.5, 0.9) | `walkBoundary` when the room passes it | — |
| Town bush (`TownBush`) | per-bush `config.interactionTarget` | town boundary | — |
| theater seat (`TheaterSeat`) | `SEAT_APPROACH_TARGET` (0.5, 1.05) | theater boundary | — |
| arcade machine (`ArcadeMachine`) | `config.interactionAnchor` | floor boundary | `arcadeMachineGroundOffsetPercent`, applied exactly once |
| chairs (shop / Nostr Station) | `chairConfig.seatAnchor` (default {50, 85} pseudo-sit) | room boundary | — |
| mine/cave, arcade counters | explicit `walkTarget` from config | pre-clamped in config | — |

DOM-free config mirrors (`seatApproachPosition`, `machineAnchorPosition`) are
proven equal to the runtime path by `src/lib/approach-target.test.ts`.
Outputs are always ground-position **approach targets** for
`usePendingInteraction` — never pose anchors.

## 7. Pose anchors

Explicitly modeled visual poses that may sit OFF the walkable floor:

- theater seat cushion: `seatAnchorPosition(seat)` = cushion line +
  `SEAT_CONTACT_RATIO (0.5, derived from the legacy visual)` × seated-scaled
  body height;
- bed sleep pose: `getBedSleepPose(bedPosition)` (`src/lib/bed-arrival.ts`).

Pose anchors are entered only through `snapTo(...)` on confirmed arrival, and
never flow into walking APIs.

## 8. Actor pose model

`src/lib/blobbi-pose.ts`:

```ts
type BlobbiActorPose =
  | { kind: 'standing' }
  | { kind: 'sleeping'; anchor: PoseAnchor }
  | { kind: 'seated'; seatId: string }
  | { kind: 'hidden'; spotId: string };

resolveActorRender(pose, ctx) → {
  renderPosition, scale, zIndex, facing,
  hideShadow, disableFloat, visualHidden, sleeping, seatedIn, hiddenIn,
}
```

One pure resolver decides everything visual about a pose, for local and
remote alike. Seated resolves through `resolveSeatedRender` (unknown /
decorative / lost seat ids fall back to standing — hostile-claim guard);
sleeping keeps the shadow and suppresses float; hidden paints nothing while
the anchor stays mounted. `ctx.suppressFloat` carries caller policy (local
`disableFloating` config; remote `isMoving`, whose positions integrate
per-frame). The standing ground position remains movement state; pose is
presentation state.

## 9. Local and remote adapters

- **Local** — `MovableBlobbi`: world-input adapter
  (`shouldTriggerWorldMove` + wake/stand/reveal policy per pose), local gaze
  adapter (movement heading → attention target → idle gaze), movement
  controller mount, `BlobbiActor` mount. Exposes
  `{ goTo, snapTo, stop, getCurrentPosition }`.
- **Local pose orchestration** — `useBlobbiPoseController` (mounted by
  PlayingView): owns sleeping/seated/hidden state and every transition (seat
  arrival snap, bed pending-interaction walk → sleep snap, hide-on-arrival,
  wake/stand/reveal on movement, reset on location change).
- **Remote** — `MultiplayerLayer`: derives each player's pose from explicit
  presence fields (`hiddenIn`; `seatId` only when the seat is WON per
  `theater-occupancy`), renders through the same `resolveActorRender` +
  `BlobbiActor`, and animates positions via the presence rAF.

## 10. Presence compatibility boundary

Kind 31950 is unchanged on the wire: `anchor`/`goal` carry legacy CENTER
points; `posAt` interpolation stays in world-design pixels; `hiddenIn` and
`seatId` are explicit fields. Ground↔center conversion lives exclusively in
`src/lib/presence-ground.ts`, called from the publish builder
(`multiplayer.ts`) and ingest (`useIslandPresence`). Nothing in the UI layer
converts wire coordinates.

## 11. Room config ownership

| concern | module |
| --- | --- |
| location → background file | `location-backgrounds.ts` (the ONLY table; multiplayer + dev consume it) |
| background → walk boundary | `location-boundaries.ts` |
| background → depth ramp | `location-scaling-config.ts` |
| background → z bands | `interactive-elements-config.ts` |
| location → room size token | `location-blobbi-sizes.ts` |
| location → spawn/exits | `location-initial-position.ts` |
| per-object interaction config | `theater-seats-config.ts`, `town-bushes-config.ts`, `arcade-machines-config.ts`, `mine-cave-config.ts`, … |

## 12. Adding a new walk-to-interact object

1. Give the object a config: placement + an `ObjectFraction` aim point (and an
   explicit `walkTarget` instead if it hangs on a wall above the floor).
2. In its component: `data-block-move`, stop propagation on
   `pointerdown`/`touchstart`, and on click:

   ```ts
   const target = resolveElementApproachTarget({
     element: event.currentTarget,
     fraction: config.aimFraction,
     boundary: locationBoundaries[ROOM_BACKGROUND],
   })?.target;
   if (target) requestInteraction({ target, touch, action: onArrive });
   ```

3. `onArrive` fires ONLY on confirmed arrival — never open anything on click.
4. If tests need the point without a DOM, add a DOM-free config mirror and a
   parity assertion (see `approach-target.test.ts`).

## 13. Adding a new special actor pose

1. Add a variant to `BlobbiActorPose` and its visual consequence to
   `resolveActorRender` (pure; cover it in `blobbi-pose.test.ts`).
2. Model its anchor explicitly (a `PoseAnchor` helper in config/lib).
3. Enter it in `useBlobbiPoseController`: request → pending-interaction walk
   to a clamped ground target → on arrival, set the pose state and
   `snapTo(anchor)`.
4. Leave it in `handleMoveStart`/`handleWakeUp` (movement always stands
   up/wakes/reveals).
5. If remotes can see it, publish an explicit presence field and map it to the
   pose in `MultiplayerLayer` — never infer it from coordinates.

## 14. What could later move into a shared library

Pure, Island-agnostic modules with no React or room dependencies:
`world-coordinates.ts`, `boundaries.ts`, `spatial-intent.ts`, the arrival
model in `blobbi-ground.ts`, and (with the renderer contract)
`blobbi-render-size.ts` / `BlobbiRendererView`. The pose union and
`approach-target.ts` are near-portable but currently bind to Island config
(`blobbi-world-render`, `[data-world-surface]`).

## 15. What must remain Blobbi Island-specific

Room configuration (backgrounds, boundaries, ramps, z bands, seats, bushes,
machines, spawns), the presence protocol adapter and its wire-compat
conversion, PlayingView/MultiplayerLayer orchestration, the world-input
policy (it encodes this app's DOM conventions), and the dev harnesses.

## Related documents

- `docs/blobbi-renderer-contract.md` — renderer box + accessory space (Phase 1)
- `docs/blobbi-ground-anchor-implementation.md` — ground-anchor derivation (Phase 2)
- `docs/blobbi-actor-position-migration-notes.md` — center→ground migration
- `docs/blobbi-actor-ui-audit.md` — the original audit that motivated Phases 0–3
