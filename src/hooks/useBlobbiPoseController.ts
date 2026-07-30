/**
 * useBlobbiPoseController — the LOCAL player's pose orchestration (Phase 3).
 *
 * Owns the state that decides the local Blobbi's {@link BlobbiActorPose}
 * (sleeping on the bed / seated in a theater seat / hidden in a bush /
 * standing) and every transition into and out of those poses, so PlayingView
 * stays a room orchestrator instead of the implementation site for each
 * interaction:
 *
 *  - SEAT: `sitInSeat(seatId)` fires on CONFIRMED ARRIVAL (from
 *    `TheaterSeat`); the stored position snaps to the seat's pose anchor so
 *    presence publishes the exact point every client draws.
 *  - BED: `requestBedSleep()` routes through the SAME pending-interaction
 *    system doors/seats/machines use — walk to the boundary-clamped ground
 *    target beside the bed, then, on confirmed arrival, snap to the sleep
 *    pose. No coordinate checks in movement callbacks; the flow is inherently
 *    home-only because only the home's bed calls it. Dragging the bed while
 *    asleep re-snaps; any movement or wake detaches.
 *  - HIDE: `hideInSpot(spotId)` fires on confirmed arrival (from `TownBush`).
 *  - Any movement start clears all three (stand up / reveal / wake) — the
 *    exact rule PlayingView applied inline before.
 *  - Changing location resets everything (the actor remounts at the new
 *    room's spawn).
 *
 * Pose is presentation state; positions still live in the movement
 * controller. The two meet only at the explicit `snapTo` calls here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MovableBlobbiRef } from '@/components/blobbi/MovableBlobbi';
import type { GroundPosition, PoseAnchor } from '@/lib/spatial-intent';
import type { Boundary } from '@/lib/boundaries';
import type { BlobbiActorPose } from '@/lib/blobbi-pose';
import { STANDING_POSE } from '@/lib/blobbi-pose';
import { getBedSleepPose, getBedWalkTarget } from '@/lib/bed-arrival';
import { resolveSeatedRender } from '@/lib/blobbi-world-render';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';

export interface BlobbiPoseControllerOptions {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Location key — changing it resets every pose and cancels pending walks. */
  currentLocation: string;
  /** The room's walk boundary (clamps the bed's walk-approach target). */
  boundary: Boundary;
  /** Initial furniture position of the bed (home only). */
  initialBedPosition?: GroundPosition;
  /** Forwarded movement callbacks (PlayingView mirrors its presence position). */
  onMoveStart?: (destination: GroundPosition) => void;
  onMoveComplete?: (position: GroundPosition) => void;
}

export interface BlobbiPoseController {
  /** The local actor's current pose — hand to `MovableBlobbi`. */
  pose: BlobbiActorPose;
  /** Seat currently occupied (presence + seat occupancy wiring), or null. */
  sittingIn: string | null;
  /** Hiding spot currently occupied (presence wiring), or null. */
  hiddenIn: string | null;
  /** The bed's furniture position (home only). */
  bedPosition: GroundPosition;
  /** Movement callbacks to hand to `MovableBlobbi` (they forward to options). */
  handleMoveStart: (destination: GroundPosition) => void;
  handleMoveComplete: (position: GroundPosition) => void;
  /** Wake/stand/reveal without moving (Blobbi click, world tap while asleep). */
  handleWakeUp: () => void;
  /** Confirmed-arrival seat entry (from TheaterSeat via InteractiveElements). */
  sitInSeat: (seatId: string) => void;
  /** Confirmed-arrival hide entry (from TownBush via InteractiveElements). */
  hideInSpot: (spotId: string) => void;
  /** Bed clicked: walk over, then sleep on arrival (pending interaction). */
  requestBedSleep: () => void;
  /** Bed dragged: move it, and re-snap the sleeper onto it. */
  handleBedPositionChange: (position: GroundPosition) => void;
}

export function useBlobbiPoseController({
  blobbiRef,
  currentLocation,
  boundary,
  initialBedPosition = { x: 75, y: 70 },
  onMoveStart,
  onMoveComplete,
}: BlobbiPoseControllerOptions): BlobbiPoseController {
  const [bedPosition, setBedPosition] = useState<GroundPosition>(initialBedPosition);
  const [isSleeping, setIsSleeping] = useState(false);
  const [sittingIn, setSittingIn] = useState<string | null>(null);
  const [hiddenIn, setHiddenIn] = useState<string | null>(null);

  // The bed walk shares the canonical pending-interaction lifecycle: replaced
  // by any newer interaction, cancelled by world taps and location changes,
  // stall-fired when a blocker stops the walk short.
  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: currentLocation,
  });
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  // Leaving the location abandons any pose (the Blobbi respawns at the new
  // location's entry point and MovableBlobbi is remounted by key).
  useEffect(() => {
    setIsSleeping(false);
    setSittingIn(null);
    setHiddenIn(null);
  }, [currentLocation]);

  const latest = useRef({ onMoveStart, onMoveComplete, boundary, bedPosition, isSleeping });
  latest.current = { onMoveStart, onMoveComplete, boundary, bedPosition, isSleeping };

  const handleMoveStart = useCallback((destination: GroundPosition) => {
    // Any movement — a ground click, a walk-to-interact, another bush or seat
    // — means the player is leaving whatever pose they were in: reveal, stand
    // up, wake. Seat-to-seat and bush-to-bush transitions route through here
    // (the walk starts first), so the old pose clears before the new arrival
    // sets the next one. MultiplayerLayer publishes the same transition.
    setHiddenIn(null);
    setSittingIn(null);
    setIsSleeping(false);
    latest.current.onMoveStart?.(destination);
  }, []);

  const handleMoveComplete = useCallback((position: GroundPosition) => {
    latest.current.onMoveComplete?.(position);
  }, []);

  const handleWakeUp = useCallback(() => {
    setIsSleeping(false);
  }, []);

  /**
   * Fired by <TheaterSeat> on CONFIRMED ARRIVAL, never on click.
   *
   * The snap target comes from the seat CONFIGURATION rather than the rendered
   * rect, so the Blobbi lands on exactly the point every other client will
   * later draw it at — no sub-pixel divergence between who is sitting and
   * where they appear to be sitting.
   */
  const sitInSeat = useCallback(
    (seatId: string) => {
      const seated = resolveSeatedRender(seatId);
      if (!seated) return;
      setSittingIn(seatId);
      blobbiRef.current?.snapTo(seated.position);
    },
    [blobbiRef],
  );

  const hideInSpot = useCallback((spotId: string) => {
    setHiddenIn(spotId);
  }, []);

  /**
   * Walk to the GROUND point beside/below the bed (the sleep pose clamped into
   * the walk boundary), then — on CONFIRMED ARRIVAL — snap onto the bed's
   * sleep POSE anchor: an explicit exception that bypasses the walk boundary
   * (the bed is not floor). Arrival is the pending-interaction system's, so a
   * redirected or cancelled walk never puts the Blobbi to sleep.
   */
  const requestBedSleep = useCallback(() => {
    const { boundary, bedPosition } = latest.current;
    pendingInteraction.requestInteraction({
      target: getBedWalkTarget(bedPosition, boundary),
      action: () => {
        setIsSleeping(true);
        blobbiRef.current?.snapTo(getBedSleepPose(latest.current.bedPosition));
      },
    });
  }, [pendingInteraction, blobbiRef]);

  const handleBedPositionChange = useCallback(
    (position: GroundPosition) => {
      setBedPosition(position);
      // A sleeping Blobbi is attached to the bed: dragging the bed drags the
      // sleeper, re-snapped (no animation) onto the moved sleep pose.
      if (latest.current.isSleeping) {
        blobbiRef.current?.snapTo(getBedSleepPose(position));
      }
    },
    [blobbiRef],
  );

  const pose = useMemo<BlobbiActorPose>(() => {
    if (isSleeping) {
      return { kind: 'sleeping', anchor: getBedSleepPose(bedPosition) as PoseAnchor };
    }
    if (sittingIn) return { kind: 'seated', seatId: sittingIn };
    if (hiddenIn) return { kind: 'hidden', spotId: hiddenIn };
    return STANDING_POSE;
  }, [isSleeping, sittingIn, hiddenIn, bedPosition]);

  return {
    pose,
    sittingIn,
    hiddenIn,
    bedPosition,
    handleMoveStart,
    handleMoveComplete,
    handleWakeUp,
    sitInSeat,
    hideInSpot,
    requestBedSleep,
    handleBedPositionChange,
  };
}
