import type { Position } from '@/lib/types';

/**
 * Minimal shape needed to decide whether a Blobbi is an eligible gaze target.
 *
 * "Active" currently means *moving*, but this is intentionally an object (not a
 * bare boolean) so additional activity sources — emotes, animations, actions —
 * can be added later without touching every call site. Extend this interface
 * and {@link isBlobbiActive} together when new activity kinds are introduced.
 */
export interface BlobbiActivity {
  isMoving: boolean;
  // Future activity flags (uncomment / add as features land):
  // isEmoting?: boolean;
  // isAnimating?: boolean;
  // isActing?: boolean;
}

/**
 * Single source of truth for "is this Blobbi doing something worth looking at".
 *
 * A nearby Blobbi should only be a gaze target while it is active. Today that
 * is purely `isMoving`; future activity flags should be OR'd in here so the
 * gaze rules pick them up everywhere automatically. This is what prevents a
 * Blobbi from staring forever at a neighbour that is just standing still.
 */
export function isBlobbiActive(activity: BlobbiActivity): boolean {
  return (
    activity.isMoving === true
    // || activity.isEmoting === true
    // || activity.isAnimating === true
    // || activity.isActing === true
  );
}

/**
 * Snapshot of the local player as a potential gaze target for remote Blobbis.
 * Written by MovableBlobbi every frame (via a ref to avoid re-renders) and read
 * by MultiplayerLayer's throttled gaze pass so remotes can notice and look at
 * the local Blobbi when it walks (or, later, emotes/acts) nearby.
 */
export interface LocalActiveState extends BlobbiActivity {
  position: Position;
}
