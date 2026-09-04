import type { Position } from '@/lib/types';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';

/**
 * Vertical offset of the SLEEPING POSE ANCHOR below the bed's (center-anchored)
 * furniture position, in world percent.
 *
 * This is an explicit POSE ANCHOR, not a standing ground point: while asleep
 * the Blobbi lies ON the bed, so its ground anchor sits slightly below the
 * bed sprite's center (the legacy center-era pose was `bedY - 5`; its visual
 * equivalent under ground semantics is `bedY - 5 + halfBody(xl, scale 1) =
 * bedY + 4.2`). Snapping to it uses `goTo(..., immediate)`, which deliberately
 * bypasses the walk boundary, the bed surface is not walkable floor.
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

// Phase 3 note: the coordinate-based arrival check (`isBedArrival`) is gone.
// The bed walk routes through the canonical pending-interaction system
// (useBlobbiPoseController.requestBedSleep): arrival is the interaction
// system's confirmed arrival at the walk target, and the flow is inherently
// home-only because only the home's bed can request it. Movement completions
// near the bed no longer put anyone to sleep.
