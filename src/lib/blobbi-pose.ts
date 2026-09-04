/**
 * The Blobbi actor pose model (Phase 3).
 *
 * A pose describes WHAT the actor is doing; {@link resolveActorRender} is the
 * single pure resolver that turns a pose + room context into everything the
 * visual actor needs (render position, scale, z-index, facing, shadow, float,
 * hidden). Both wrappers consume it:
 *
 *  - local: `MovableBlobbi` receives a pose from PlayingView's state
 *    (`sittingIn`/`hiddenIn`/bed sleep) and renders through this resolver;
 *  - remote: `MultiplayerLayer` derives a pose from presence fields
 *    (`seatId` won via occupancy, `hiddenIn`) and renders through the SAME
 *    resolver: so a seated/hidden remote can never be drawn differently from
 *    the seated/hidden local player.
 *
 * The pose is presentation state, not movement state: the movement
 * controller's stored GROUND position stays the source of truth for where the
 * actor is, and pose anchors (seat cushion, bed) are explicit exceptions
 * entered only through `snapTo(...)`.
 *
 * Deliberately NOT a state machine framework, a discriminated union and one
 * pure function are all the coherence this needs.
 */

import type { GroundPosition, PoseAnchor } from '@/lib/spatial-intent';
import type { Boundary } from '@/lib/boundaries';
import {
  resolveBlobbiScale,
  resolveBlobbiZIndex,
  resolveSeatedRender,
} from '@/lib/blobbi-world-render';

export type BlobbiActorPose =
  /** On the floor, standing or walking. */
  | { kind: 'standing' }
  /**
   * Asleep on an explicitly modeled pose anchor (the bed). The movement
   * position has been snapped to `anchor` via `snapTo`; the anchor is carried
   * for consumers that need the pose point without reading movement state.
   */
  | { kind: 'sleeping'; anchor: PoseAnchor }
  /**
   * Seated in a known seat. Everything visual (pose anchor, per-row scale,
   * facing, seated z, no shadow, no float) resolves from the seat id alone via
   * `resolveSeatedRender`. An unknown/decorative/stale id renders as standing.
   */
  | { kind: 'seated'; seatId: string }
  /** Inside a hiding spot: the positioned anchor stays mounted, nothing is painted. */
  | { kind: 'hidden'; spotId: string };

export const STANDING_POSE: BlobbiActorPose = { kind: 'standing' };

export interface ActorRenderContext {
  /** The stored/current GROUND position from the movement system. */
  groundPosition: GroundPosition;
  /** Room background file (depth ramp + z-band lookup key). */
  backgroundFile?: string;
  /** Room walk boundary (maps y onto the depth ramp). */
  boundary?: Boundary;
  /** Whether this room applies its perspective depth ramp (local prop parity). */
  scaleByYPosition?: boolean;
  /**
   * Caller-specific float suppression, OR-ed with what the pose itself
   * demands: the local wrapper passes its `disableFloating` config, the remote
   * wrapper passes `isMoving` (remote positions integrate per-frame and must
   * not bob mid-walk).
   */
  suppressFloat?: boolean;
}

/** Everything the visual actor derives from a pose. Feed to `BlobbiActor`. */
export interface ActorRender {
  /** Where the actor is DRAWN: the pose anchor while seated, the ground position otherwise. */
  renderPosition: GroundPosition | PoseAnchor;
  /** Combined visual scale (depth ramp × seat scale). */
  scale: number;
  zIndex: number;
  facing: 'front' | 'back';
  hideShadow: boolean;
  disableFloat: boolean;
  /** Paint nothing while keeping the anchor mounted (hiding spots). */
  visualHidden: boolean;
  /** Eyes closed / sleeping body rendering. */
  sleeping: boolean;
  /** Seat id for the actor's data attribute, or null. */
  seatedIn: string | null;
  /** Hiding-spot id for the actor's data attribute, or null. */
  hiddenIn: string | null;
}

/**
 * Resolve the complete visual consequence of a pose. Pure, same inputs, same
 * output, for local, remote, tests and dev harnesses alike.
 */
export function resolveActorRender(
  pose: BlobbiActorPose,
  ctx: ActorRenderContext,
): ActorRender {
  const { groundPosition, backgroundFile, boundary, scaleByYPosition = false, suppressFloat = false } = ctx;

  const depthScaleAt = (pos: GroundPosition): number =>
    scaleByYPosition ? resolveBlobbiScale(pos, backgroundFile, boundary) : 1;

  if (pose.kind === 'seated') {
    const seated = resolveSeatedRender(pose.seatId);
    if (seated) {
      // A seated Blobbi is DRAWN at the seat's pose anchor (same rule local and
      // remote), regardless of the stored walking position.
      return {
        renderPosition: seated.position,
        scale: depthScaleAt(seated.position) * seated.scale,
        zIndex: seated.zIndex,
        facing: seated.facing,
        hideShadow: seated.hideShadow,
        disableFloat: seated.disableFloat || suppressFloat,
        visualHidden: false,
        sleeping: false,
        seatedIn: seated.seat.id,
        hiddenIn: null,
      };
    }
    // Unknown / decorative / stale seat id: a hostile or outdated claim can
    // never pin an actor to an off-world chair, render standing instead.
  }

  const standing: ActorRender = {
    renderPosition: groundPosition,
    scale: depthScaleAt(groundPosition),
    zIndex: resolveBlobbiZIndex(groundPosition, backgroundFile),
    facing: 'front',
    hideShadow: false,
    disableFloat: suppressFloat,
    visualHidden: false,
    sleeping: false,
    seatedIn: null,
    hiddenIn: null,
  };

  switch (pose.kind) {
    case 'sleeping':
      // The ground shadow stays (the bed sits on the floor); the float bob is
      // suppressed so the body rests on the mattress.
      return { ...standing, disableFloat: true, sleeping: true };
    case 'hidden':
      return { ...standing, visualHidden: true, hiddenIn: pose.spotId };
    default:
      return standing;
  }
}
