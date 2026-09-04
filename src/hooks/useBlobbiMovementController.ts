/**
 * useBlobbiMovementController: the local Blobbi's canonical movement engine
 * (Phase 3).
 *
 * Extracted from `MovableBlobbi` so the component is an input/gaze adapter and
 * actor mount, while everything about MOVING lives here:
 *
 *  - the current GROUND position (world percent) and the walk target;
 *  - the rAF integration loop (fixed world-design px, viewport-independent);
 *  - `goTo` (boundary-stepped walking), `snapTo` (explicit pose snap that
 *    bypasses the walk boundary), `stop`;
 *  - movement lifecycle: start/complete callbacks, blocker collisions,
 *    retargeting, cancellation, unmount cleanup.
 *
 * Lifecycle guarantees (tested in useBlobbiMovementController.test.tsx):
 *
 *  - at most ONE rAF loop is ever active; retargeting mid-walk redirects the
 *    existing loop instead of stacking a second one;
 *  - movement runs to completion without any parent re-render (callbacks are
 *    read through refs, so prop-identity churn never restarts or stalls a
 *    walk);
 *  - `onMoveComplete` fires exactly once per arrival;
 *  - `snapTo` during an active walk cancels the walk safely, then completes;
 *  - unmount cancels the rAF loop.
 *
 * Boundary semantics (unchanged from the historical component): `goTo` does
 * NOT clamp its target; each animation STEP is clamped, so an unreachable
 * target makes the walk slide along the boundary edge (interaction targets are
 * pre-clamped by `resolveElementApproachTarget` for exactly this reason).
 * `snapTo` deliberately bypasses the boundary: pose anchors (seat cushions,
 * the bed) are not walkable floor.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroundPosition, PoseAnchor } from '@/lib/spatial-intent';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import {
  designPxToWorldPercent,
  worldPercentToDesignPx,
  worldDistancePx,
} from '@/lib/world-coordinates';
import { MOVEMENT_SNAP_PX } from '@/lib/blobbi-ground';
import { planRoute } from '@/lib/blobbi-route';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';

export interface MovementDirection {
  x: number;
  y: number;
}

export interface BlobbiMovementControllerOptions {
  initialPosition?: GroundPosition;
  /** Walk speed in world-design px/s (same world distance = same time at every viewport). */
  movementSpeed?: number;
  boundary: Boundary;
  /** Keep a short trail of recent ground points (historical floor markers). */
  showTrail?: boolean;
  onMoveStart?: (destination: GroundPosition) => void;
  onMoveComplete?: (position: GroundPosition) => void;
}

export interface BlobbiMovementController {
  /** Current GROUND position (world percent). */
  position: GroundPosition;
  isMoving: boolean;
  /** Normalized walk heading while moving (drives movement gaze). */
  direction: MovementDirection;
  /** Recent ground points, newest first (empty unless `showTrail`). */
  trail: GroundPosition[];
  /** Walk toward a ground target. Ignored if the target is inside a blocker. */
  goTo: (target: GroundPosition) => void;
  /**
   * Snap immediately to an explicit pose anchor / spawn point, cancelling any
   * active walk and firing `onMoveComplete` once. Bypasses the walk boundary,
   * the EXPLICIT special-pose entry point (seats, bed, dev harness).
   */
  snapTo: (pose: PoseAnchor) => void;
  /** Cancel any active walk in place (no completion callback). */
  stop: () => void;
  /** Ref-style read of the current position (stable identity). */
  getCurrentPosition: () => GroundPosition;
}

const DEFAULT_INITIAL: GroundPosition = { x: 50, y: 75 };

export function useBlobbiMovementController({
  initialPosition = DEFAULT_INITIAL,
  movementSpeed = 120,
  boundary,
  showTrail = false,
  onMoveStart,
  onMoveComplete,
}: BlobbiMovementControllerOptions): BlobbiMovementController {
  const [position, setPosition] = useState<GroundPosition>(initialPosition);
  const [isMoving, setIsMoving] = useState(false);
  const [direction, setDirection] = useState<MovementDirection>({ x: 0, y: 0 });
  const [trail, setTrail] = useState<GroundPosition[]>([]);

  const positionRef = useRef(position);
  positionRef.current = position;
  const targetRef = useRef<GroundPosition>(initialPosition);
  /**
   * The waypoints still to walk, the LAST of which is the caller's real target.
   *
   * A straight walk is a one-entry route, so the ordinary case is exactly what
   * it always was. When furniture is in the way the planner puts corner
   * waypoints in front of it, and the loop retargets through them without ever
   * completing, `onMoveComplete` and every pending interaction belong to the
   * final entry alone.
   */
  const routeRef = useRef<GroundPosition[]>([]);
  const isMovingRef = useRef(false);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>();
  const justCompletedRef = useRef(false);

  const { blockers, isPositionBlocked } = useMovementBlocker();

  // Latest-ref pattern for everything the rAF loop reads: the loop's identity
  // stays STABLE across parent re-renders and prop churn, so an in-flight walk
  // is never restarted, stalled, or double-completed by React updates, the
  // historical failure mode this controller exists to prevent.
  const optionsRef = useRef({ movementSpeed, boundary, showTrail, onMoveStart, onMoveComplete, isPositionBlocked, blockers });
  optionsRef.current = { movementSpeed, boundary, showTrail, onMoveStart, onMoveComplete, isPositionBlocked, blockers };

  const cancelFrame = useCallback(() => {
    if (animationRef.current !== undefined) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = undefined;
    }
  }, []);

  const complete = useCallback((finalPosition: GroundPosition) => {
    if (justCompletedRef.current) return;
    justCompletedRef.current = true;
    setIsMoving(false);
    isMovingRef.current = false;
    optionsRef.current.onMoveComplete?.(finalPosition);
    // Release the guard on the next tick: the completion may synchronously
    // trigger a pose snap (bed, seat) whose own completion must still fire.
    setTimeout(() => {
      justCompletedRef.current = false;
    }, 0);
  }, []);

  const animateMovement = useCallback(
    (timestamp: number) => {
      const { movementSpeed, boundary, showTrail, isPositionBlocked } = optionsRef.current;

      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }
      const deltaTime = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      let reached = false;
      setPosition((currentPos) => {
        const target = targetRef.current;
        const distance = worldDistancePx(currentPos, target);

        if (distance < MOVEMENT_SNAP_PX) {
          // A waypoint, or the destination? Advancing keeps the walk in one
          // continuous motion: no pause at a corner, and no completion until
          // the route is spent.
          if (routeRef.current.length > 1) {
            routeRef.current = routeRef.current.slice(1);
            targetRef.current = routeRef.current[0];
            return target;
          }
          reached = true;
          return target;
        }

        // Movement math runs in FIXED world-design pixels (1046×697): percent
        // positions convert through the design space, never the rendered rect,
        // so speed and arrival are identical at every viewport scale.
        const currentPixelPos = worldPercentToDesignPx(currentPos);
        const targetPixelPos = worldPercentToDesignPx(target);
        const dx = targetPixelPos.x - currentPixelPos.x;
        const dy = targetPixelPos.y - currentPixelPos.y;
        const moveDistance = movementSpeed * deltaTime;
        const directionLength = Math.hypot(dx, dy);
        const normalizedDx = dx / directionLength;
        const normalizedDy = dy / directionLength;

        // Only update the heading when it changes enough (avoids re-renders).
        setDirection((prev) => {
          const EPS = 0.001;
          if (Math.abs(prev.x - normalizedDx) < EPS && Math.abs(prev.y - normalizedDy) < EPS) {
            return prev;
          }
          return { x: normalizedDx, y: normalizedDy };
        });

        const newPercentPos = constrainPosition(
          designPxToWorldPercent({
            x: currentPixelPos.x + normalizedDx * moveDistance,
            y: currentPixelPos.y + normalizedDy * moveDistance,
          }),
          boundary,
        );

        if (isPositionBlocked(newPercentPos.x, newPercentPos.y)) {
          // Still blocked with a route in hand: the geometry moved under us
          // (a blocker mounted mid-walk), or the clearance was not enough for
          // this step. Stopping safely is right, but the destination is kept
          // so the caller's pending interaction can still decide for itself.
          reached = true;
          return currentPos;
        }

        if (showTrail) {
          setTrail((prevTrail) => {
            if (prevTrail[0] && prevTrail[0].x === currentPos.x && prevTrail[0].y === currentPos.y) {
              return prevTrail;
            }
            return [currentPos, ...prevTrail.slice(0, 4)];
          });
        }

        return newPercentPos;
      });

      if (reached) {
        animationRef.current = undefined;
        routeRef.current = [];
        complete(targetRef.current);
        return;
      }
      if (isMovingRef.current) {
        animationRef.current = requestAnimationFrame(animateMovement);
      }
    },
    [complete],
  );

  /** Start (or restart) the single movement rAF loop. */
  const startAnimation = useCallback(() => {
    cancelFrame();
    lastTimeRef.current = undefined;
    animationRef.current = requestAnimationFrame(animateMovement);
  }, [animateMovement, cancelFrame]);

  // Unmount: cancel the loop. `animateMovement` is stable (latest-ref), so
  // this effect runs exactly once, an in-flight walk survives every parent
  // re-render and dies with the component.
  useEffect(() => cancelFrame, [cancelFrame]);

  const goTo = useCallback(
    (target: GroundPosition) => {
      const { isPositionBlocked, boundary, blockers } = optionsRef.current;
      // Walking into furniture is still refused outright, unchanged.
      if (isPositionBlocked(target.x, target.y)) return;

      /*
        Plan once, here, rather than reacting frame by frame. The route is
        `[target]` whenever the way is clear, so an unobstructed walk is
        byte-for-byte the old behaviour; when something is in the way it is the
        corner waypoints to walk through first. `null` means the planner found
        no way round at all, and the honest response is not to set off: the old
        code would have walked into the obstacle and stopped there, which looks
        like the game ignoring the click.
      */
      const route = planRoute(
        positionRef.current,
        target,
        boundary,
        // The context stores `{ id, rect }`; the planner only wants geometry.
        blockers.map((blocker) => blocker.rect),
      );
      if (!route) return;

      routeRef.current = route;
      targetRef.current = route[0];
      setIsMoving(true);
      isMovingRef.current = true;
      startAnimation();
      // The caller asked for the DESTINATION, and that is what presence and the
      // pose controller are told; never an internal waypoint.
      optionsRef.current.onMoveStart?.(target);
    },
    [startAnimation],
  );

  const snapTo = useCallback(
    (pose: PoseAnchor) => {
      if (optionsRef.current.isPositionBlocked(pose.x, pose.y)) return;
      cancelFrame();
      routeRef.current = [];
      targetRef.current = pose;
      setPosition(pose);
      setIsMoving(false);
      isMovingRef.current = false;
      optionsRef.current.onMoveComplete?.(pose);
    },
    [cancelFrame],
  );

  const stop = useCallback(() => {
    cancelFrame();
    setIsMoving(false);
    isMovingRef.current = false;
    // Drop the whole route, not just the leg in progress: a cancelled walk must
    // not resume toward a destination the player has changed their mind about.
    routeRef.current = [];
    targetRef.current = positionRef.current;
  }, [cancelFrame]);

  const getCurrentPosition = useCallback(() => positionRef.current, []);

  return { position, isMoving, direction, trail, goTo, snapTo, stop, getCurrentPosition };
}
