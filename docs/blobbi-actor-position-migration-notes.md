# Blobbi Actor Position — Migration Guard Notes

_Companion to `docs/blobbi-actor-ui-audit.md`. Established during Phase 0; **the
Phase 2 migration described here has been IMPLEMENTED** (2026-07-29) — see
`docs/blobbi-ground-anchor-implementation.md` for the implemented architecture,
formulas, and debugging guide._

## Implemented semantics (Phase 2 final)

- **Stored actor position = GROUND-CONTACT POINT** (`src/lib/blobbi-ground.ts`):
  anchor `translate(-50%, -100%)`, rig scales around `bottom center`, shadow
  centered on the point. Shared by local and remote via `BlobbiActor`.
- **Boundaries, spawns, exits, walk targets, z-bands** all consume ground
  points (center-era values shifted by the depth-scaled half body height).
- **Pose anchors are explicit exceptions** reached via boundary-bypassing
  `goTo(..., immediate)`: theater seats (`seatAnchorPosition` = cushion +
  half seated body) and the bed (`getBedSleepPose`; approach via
  `getBedWalkTarget`). Hiding keeps the walked-to ground point.
- **Distance/arrival**: isotropic world-design px (`worldDistancePx`,
  `ARRIVAL_THRESHOLD_PX = 40`, touch 64, movement snap 2 px) — viewport
  independent, below the theater seat half-pitch.
- **Wire compatibility**: kind 31950 still carries legacy CENTER points;
  conversion happens ONLY in `buildPresence31950` (out) and
  `processPresenceEvent` (in) via `src/lib/presence-ground.ts`.
- The Phase 0 center-anchor pin tests were REPLACED by
  `MovableBlobbi.ground-anchor.test.tsx`.

## The rule

> **A click-to-move ground-anchor fix must not be shipped by changing only the
> actor transform or subtracting a visual offset. The boundaries and every
> positional consumer must be audited under the new semantics.**

Today the stored `Position` of a Blobbi means **the center of the actor box**
(`left/top` + `translate(-50%, -50%)`). A future phase will change it to mean
the **ground/foot anchor** — the bottom-center point where the Blobbi touches
the floor. That is a **coordinated migration**, not a local rendering tweak:
every boundary, spawn, interaction target, threshold, and wire coordinate in
the repository was authored and visually calibrated against center semantics.
Changing what the number *means* without revisiting every consumer will
produce rooms that are subtly (or grossly) wrong one at a time.

## Phase boundaries

- **Phase 0 (done):** preserve current center semantics; establish pinning
  tests (`MovableBlobbi.anchor-semantics.test.tsx`,
  `location-spawn-validation.test.ts`, `bed-arrival.test.ts` /
  `BedArrival.test.tsx`); fix only confirmed positional bugs (bed gate,
  off-floor mall spawn); remove production diagnostics.
- **Phase 1 (done):** renderer box normalized — one size ladder, body box =
  accessory box, no viewport breakpoints inside the world, pure
  `BlobbiRendererView` split out. Still center semantics. See
  `docs/blobbi-renderer-contract.md` for the box contract Phase 2 builds on.
- **Phase 2 (done):** the coordinated ground-anchor migration, executed per the
  checklist below (kept as the historical record of what was audited). The
  Phase 0 pin tests were replaced deliberately as part of it.

## Migration checklist (Phase 2)

Every item below consumes position semantics and must be audited — and where
needed retuned or converted — under ground-anchor meaning:

- [ ] **Boundaries** — every entry in `src/lib/location-boundaries.ts` was
      visually calibrated around the body center. With feet-on-floor
      semantics, walkable y-ranges shift by roughly half the (depth-scaled)
      body height per room; retune room by room, not by a global constant.
- [ ] **Initial positions** — `LOCATION_INITIAL_POSITIONS`
      (`src/lib/location-initial-position.ts`).
- [ ] **Exit positions** — `EXIT_POSITIONS` (same file).
- [ ] **Interaction targets** — `computeBaseCenterTarget`
      (`InteractiveElement.tsx`), `computeBushTarget`, `computeSeatTarget`,
      `computeMachineTarget`, `walkTarget` constants
      (`arcade-room-config.ts`, `mine-cave-config.ts`), legacy
      `chairConfig.seatAnchor` (`InteractiveElements.tsx`).
- [ ] **Movement blockers** — `MovementBlockerContext` rects and the
      furniture blocker math (`Furniture.tsx`).
- [ ] **Seats and beds** — `seatAnchorPosition`
      (`theater-seats-config.ts`), `resolveSeatedRender`
      (`blobbi-world-render.ts`), the bed sleeping offset
      (`src/lib/bed-arrival.ts`).
- [ ] **Hiding** — bush interaction targets (`town-bushes-config.ts`,
      `TownBush.tsx`).
- [ ] **Depth scaling** — `resolveBlobbiScale` y-ramps are calibrated to
      center-y; the transform origin must become `bottom center` for feet to
      stay planted (`blobbi-world-render.ts`, `MovableBlobbi.tsx`,
      `MultiplayerLayer.tsx`).
- [ ] **Z-index** — `backgroundZIndexConfigs` y-band thresholds
      (`interactive-elements-config.ts`) were tuned to center-y.
- [ ] **Shadow** — must move to the anchor's ground point instead of
      `top-full` of the unscaled box (both `MovableBlobbi.tsx` and the
      duplicated markup in `MultiplayerLayer.tsx`).
- [ ] **Gaze / facing vectors** — center-to-center direction math in
      `MovableBlobbi`, `RemoteBlobbiSprite`, `src/lib/gaze.ts`,
      `computeNearbyGaze` radii.
- [ ] **Local and remote rendering** — both actor wrappers
      (`MovableBlobbi.tsx`, `MultiplayerLayer.tsx`), trail dots, name labels,
      chat-bubble portal anchors (`ChatBubblesLayer.tsx`).
- [ ] **Multiplayer wire conversion** — kind 31950 `anchor`/`goal` publish
      center-percent with **no version marker**. Convert at exactly two
      boundaries (publish helpers in `multiplayer.ts` /
      `useIslandPresence.moveTo` on the way out, `processPresenceEvent` on the
      way in) or introduce an explicit new field — mixed-convention clients
      would disagree by ~half a sprite box. Update `NIP.md` and
      `docs/protocol/blobbi-island-event-registry.md` if the wire format
      changes.
- [ ] **Arrival thresholds** — `usePendingInteraction` (5%/8% percent-space),
      `animateMovement`'s 2-screen-px snap, the bed per-axis <2 check: all
      measure distances between points whose meaning changes.
- [ ] **Direction and distance calculations** — anything comparing one Blobbi
      position to another or deriving vectors/angles (gaze, proximity,
      `posAt`, `clampToWalkable` stepping).
- [ ] **Tests** — update the Phase 0 pin tests deliberately; extend
      `location-spawn-validation.test.ts` to assert under the new semantics;
      update `MultiplayerLayer.seating.test.tsx` (pins
      `translate(-50%, -50%)`), `MovableBlobbi.seating.test.tsx`,
      `theater-seats-config.test.ts`.
- [ ] **Visual verification for every room** — the ramps, bands, and
      boundaries are hand-tuned; each of the ~17 backgrounds needs an on-screen
      pass after conversion.

## Unresolved positional inconsistencies (recorded during Phase 0, not fixed)

Found while implementing the validation tests; all are pre-existing and left
unchanged by Phase 0:

1. **Boundary-edge spawns with zero margin** — `stage` `{50, 75}`,
   `mine` `{50, 75}`, and `back-yard` `{50, 75}` sit exactly on their
   boundary's minimum-y edge (`y: 75` vs walkable `y ∈ [75, 98]`). Valid under
   the identity test, but any future boundary retune that moves the edge by
   any amount strands them.
2. **Photo-booth special case keyed by filename** —
   `getBlobbiInitialPosition('photo-booth-inside.png')` special-cases a
   background *filename* where every other key is a canonical `LocationId`.
   The booth also mounts its own `MovableBlobbi` in a 470×705 modal container
   outside `VirtualWorld` (audit §5 C8), where percent space and movement
   speed differ from the world.
3. **Spawn validation cannot see MovementBlockers** — blockers are registered
   at runtime by mounted components (furniture), so the table-driven suite
   validates boundaries only. The home spawn `{50, 75}` currently clears the
   default furniture blockers, but nothing pins that.
4. **Mall door walk targets sit above the walkable strip** — the generic
   door target (`rect.bottom − 10% height`) for mall stores lands below/off
   the 1%-tall middle-level strip `y ∈ [56, 57]`; arrival currently succeeds
   only via `usePendingInteraction`'s stall-forgiveness (`threshold × 1.6`).
   Same pattern as the documented plaza-open door (target y ≈ 55.2 vs
   boundary y ≥ 56). Works today; fragile under any threshold change.
5. **`cave-open`'s walkable band is thinner than the actor** — boundary
   `y ∈ [71, 75.5]` is ~4.5% of room height while an `xl` Blobbi box is ~18%;
   center-anchor semantics make this workable only because the art tolerates
   overlap. Will need explicit attention in the ground-anchor retune.
