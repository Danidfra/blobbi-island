import type { Position } from '@/lib/types';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import { worldDistancePx, ARRIVAL_THRESHOLD_PX } from '@/lib/blobbi-ground';

/**
 * Background file of the ONLY room that contains the bed. This is the same
 * condition PlayingView uses to mount the bed <Furniture>, so "the bed-arrival
 * check may run" and "a bed exists in this room" cannot drift apart. The
 * background is resolved 1:1 from the canonical LocationId ('home') via
 * LOCATION_BACKGROUNDS.
 */
export const BED_ROOM_BACKGROUND = 'home-inside.png';

/**
 * Vertical offset of the SLEEPING POSE ANCHOR below the bed's (center-anchored)
 * furniture position, in world percent.
 *
 * This is an explicit POSE ANCHOR, not a standing ground point: while asleep
 * the Blobbi lies ON the bed, so its ground anchor sits slightly below the
 * bed sprite's center (the legacy center-era pose was `bedY - 5`; its visual
 * equivalent under ground semantics is `bedY - 5 + halfBody(xl, scale 1) =
 * bedY + 4.2`). Snapping to it uses `goTo(..., immediate)`, which deliberately
 * bypasses the walk boundary — the bed surface is not walkable floor.
 */
export const BED_SLEEP_POSE_Y_OFFSET = 4.2;

/** The pose anchor the Blobbi is pinned to while sleeping on the bed. */
export function getBedSleepPose(bedPosition: Position): Position {
  return { x: bedPosition.x, y: bedPosition.y + BED_SLEEP_POSE_Y_OFFSET };
}

/**
 * The GROUND point the Blobbi walks to before climbing on: the sleep pose
 * clamped into the room's walk boundary (the bed may sit above the walkable
 * floor band, so the approach stops at the nearest floor point beside it).
 */
export function getBedWalkTarget(bedPosition: Position, boundary: Boundary): Position {
  return constrainPosition(getBedSleepPose(bedPosition), boundary);
}

/**
 * Whether a completed move counts as "arrived at the bed".
 *
 * Compared against the WALK TARGET (a reachable ground point), using the
 * shared isotropic world-px distance model, and gated to the room that
 * actually has a bed. On arrival the caller snaps to the sleep pose.
 */
export function isBedArrival(
  position: Position,
  walkTarget: Position,
  backgroundFile: string,
): boolean {
  if (backgroundFile !== BED_ROOM_BACKGROUND) return false;
  return worldDistancePx(position, walkTarget) <= ARRIVAL_THRESHOLD_PX;
}
