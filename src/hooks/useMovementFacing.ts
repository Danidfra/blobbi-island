/**
 * Which way a walking Blobbi faces, and the turn back to the front once it
 * has arrived.
 *
 * While it moves, a body with profile artwork (V2, V3) turns toward its
 * heading. Before this hook, the last heading stayed after the walk: a
 * Blobbi that had walked left stood facing left for good. Now, once movement
 * has actually finished, it turns back to the front (toward the player),
 * which is its idle pose.
 *
 * "Actually finished" is a short grace after `moving` turns false
 * (`SETTLE_MS`): waypoints of one route never set `moving` false at all, and
 * a destination changed by a fresh tap resumes within the grace, so neither
 * flicks the body to the front and back again. An interrupted walk (`stop`)
 * settles the same way. The same rule serves the local actor and the remote
 * sprites, so every Blobbi on screen returns to the front alike.
 *
 * Pure part: `movementFacingOf`, for tests and for the remote sprites' own
 * bookkeeping; the hook adds the grace timer.
 */
import { useEffect, useRef, useState } from 'react';
import type { BlobbiFacing } from '@blobbi-kit/renderer';

import { facingFromHeading, type MovementHeading } from '@/lib/blobbi-facing';

/** How long after a walk ends the body keeps its heading before turning to the front. */
export const SETTLE_MS = 160;

/**
 * The movement facing to hand the body: its heading while it moves (and for
 * the grace after), none (the front) once it has settled.
 */
export function movementFacingOf(moving: boolean, settled: boolean, heading: MovementHeading | null | undefined): BlobbiFacing | undefined {
  if (!heading) return undefined;
  if (moving || !settled) return facingFromHeading(heading);
  return undefined;
}

/**
 * `moving` and the current heading in; the facing the body renderer should
 * receive out: the heading's while walking, the front once settled.
 */
export function useMovementFacing(moving: boolean, heading: MovementHeading | null | undefined, settleMs = SETTLE_MS): BlobbiFacing | undefined {
  // Settled: the walk ended and the grace has passed
  const [settled, setSettled] = useState(!moving);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (moving) {
      setSettled(false);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettled(true);
    }, settleMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [moving, settleMs]);
  return movementFacingOf(moving, settled, heading);
}
