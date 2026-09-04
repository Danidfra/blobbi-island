/**
 * MovableBlobbi: the LOCAL player's actor wrapper (Phase 3 shape).
 *
 * A thin composition of three consolidated pieces:
 *
 *  - `useBlobbiMovementController`: movement state, the rAF walk loop,
 *    `goTo`/`snapTo`/`stop` (src/hooks/useBlobbiMovementController.ts);
 *  - the shared world-input policy, which taps mean "walk there"
 *    (src/lib/world-input.ts);
 *  - the shared pose resolver, what the current {@link BlobbiActorPose}
 *    means visually, identical for local and remote actors
 *    (src/lib/blobbi-pose.ts);
 *
 * plus the LOCAL-only gaze adapter (own movement heading → attention target →
 * idle gaze) and the `BlobbiActor` mount. This component owns no movement
 * math, no coordinate conversion, no seat/bed/hiding specifics.
 */
import { usePhotoBooth } from '@/hooks/usePhotoBooth';
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { cn } from '@/lib/utils';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { useIdleGaze } from '@/hooks/useIdleGaze';
import { useBlobbiMovementController } from '@/hooks/useBlobbiMovementController';
import type { GroundPosition, PoseAnchor } from '@/lib/spatial-intent';
import type { Position } from '@/lib/types';
import type { LocalActiveState, AttentionState } from '@/lib/gaze';
import { attentionTargetPosition, LOCAL_GAZE_KEY } from '@/lib/gaze';
import { Boundary, constrainPosition } from '@/lib/boundaries';
import { shouldTriggerWorldMove } from '@/lib/world-input';
import { clientPointToWorldPercent } from '@/lib/world-coordinates';
import { resolveBlobbiScale } from '@/lib/blobbi-world-render';
import { actorVisualFocusPoint } from '@/lib/blobbi-ground';
import { resolveActorRender, STANDING_POSE, type BlobbiActorPose } from '@/lib/blobbi-pose';
import { BlobbiActor } from './BlobbiActor';
import type { BlobbiRenderVisual } from '@blobbi/react';

export interface MovableBlobbiRef {
  /** Walk to a ground target through the movement system. */
  goTo: (target: GroundPosition) => void;
  /**
   * Snap immediately to an explicit pose anchor (seat cushion, bed sleep pose,
   * dev spawn). Bypasses the walk boundary, the EXPLICIT special-pose entry
   * point; never use it for ordinary movement.
   */
  snapTo: (pose: PoseAnchor) => void;
  /** Cancel any active walk in place. */
  stop: () => void;
  getCurrentPosition: () => GroundPosition;
}

export interface MovableBlobbiProps {
  containerRef: React.RefObject<HTMLElement>;
  isVisible?: boolean;
  /**
   * What the actor is doing (standing / sleeping / seated / hidden): ONE
   * coherent presentation description, resolved through the same
   * `resolveActorRender` the remote layer uses so local and remote actors
   * cannot diverge. Owned by the room orchestrator (PlayingView); this
   * component only renders it and adapts input to it:
   *
   *  - `sleeping`: a world tap wakes (`onWakeUp`) instead of walking;
   *  - `seated` / `hidden`: a world tap wakes/stands/reveals AND walks;
   *  - `hidden` paints nothing while keeping the anchor (chat-bubble portal,
   *    logical position, input) alive.
   */
  pose?: BlobbiActorPose;
  initialPosition?: GroundPosition;
  movementSpeed?: number;
  boundary?: Boundary;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showTrail?: boolean;
  backgroundFile?: string;
  onMoveStart?: (destination: GroundPosition) => void;
  onMoveComplete?: (position: GroundPosition) => void;
  onWakeUp?: () => void;
  onBlobbiClick?: () => void;
  scaleByYPosition?: boolean;
  disableFloating?: boolean;
  anchorId?: string;
  /**
   * Explicit visual for the body renderer instead of the local companion.
   * Used by dev harnesses; production mounts leave it undefined.
   */
  visualOverride?: BlobbiRenderVisual;
  /**
   * Shared ref holding the local Blobbi's attention *decision* (which Blobbi to
   * look at). Combined with {@link livePositionsRef} the eyes resolve the
   * target's CURRENT position each frame, so gaze follows a moving target
   * smoothly. This is the identity-based half of the single attention system;
   * the position half is {@link livePositionsRef}.
   */
  localAttentionRef?: React.MutableRefObject<AttentionState>;
  /**
   * Shared map (key -> current percent position) of every gaze candidate. Read
   * together with {@link localAttentionRef} to resolve the live gaze-target
   * position. The local Blobbi's target is keyed under {@link LOCAL_GAZE_KEY}.
   */
  livePositionsRef?: React.MutableRefObject<Map<string, Position>>;
  /**
   * Optional shared ref the local Blobbi writes each frame with its current
   * position + activity (e.g. `isMoving`). MultiplayerLayer reads it so remote
   * Blobbis can treat the local player as a nearby *active* gaze target and
   * look at it while it walks (or, later, emotes/acts) nearby.
   */
  localActiveRef?: React.MutableRefObject<LocalActiveState | null>;
}

export const MovableBlobbi = forwardRef<MovableBlobbiRef, MovableBlobbiProps>(
  (
    {
      containerRef,
      isVisible = true,
      pose = STANDING_POSE,
      initialPosition = { x: 50, y: 75 },
      movementSpeed = 120,
      boundary = { shape: 'rectangle', x: [0, 100], y: [60, 100] },
      size = "lg",
      className,
      showTrail = false,
      backgroundFile,
      onMoveStart,
      onMoveComplete,
      onWakeUp,
      onBlobbiClick,
      scaleByYPosition = false,
      disableFloating = false,
      anchorId,
      visualOverride,
      localAttentionRef,
      livePositionsRef,
      localActiveRef,
    },
    ref
  ) => {
    const blobbiRef = useRef<HTMLDivElement>(null);
    const { isPhotoBoothOpen } = usePhotoBooth();

    const { position, isMoving, direction, trail, goTo, snapTo, stop, getCurrentPosition } =
      useBlobbiMovementController({
        initialPosition,
        movementSpeed,
        boundary,
        showTrail,
        onMoveStart,
        onMoveComplete,
      });

    // Subtle idle eye micro-movements (only active while standing still).
    const idleGaze = useIdleGaze(!isMoving);

    // ---------------------------------------------------------------------
    // Per-frame attention tick.
    //
    // The eyeOffset is computed every *render* from localAttentionRef +
    // livePositionsRef. But while standing still, the only thing that drives
    // re-renders is useIdleGaze, and that intentionally STOPS emitting new
    // offsets (returns the previous reference, so React bails out) whenever it
    // is holding a gaze point (the majority of the time, 0.8–2.5s per hold).
    // During those holds MovableBlobbi does not re-render, so the gaze code
    // below never re-reads the watched target's CURRENT live position and the
    // eyes freeze on a stale snapshot, exactly the "start → frozen → final"
    // bug for the local Blobbi watching a moving remote.
    //
    // Fix: while we have an active attention target (i.e. we are watching some
    // Blobbi) drive a dedicated rAF that forces a cheap re-render every frame,
    // independent of idle gaze. This makes the local Blobbi track the target's
    // CURRENT animated position continuously, the same smoothness remotes get
    // from the parent's per-frame re-render cascade. Idle gaze is untouched.
    const [, forceGazeFrame] = useState(0);
    useEffect(() => {
      // Only needed while standing still: while moving, the movement animation
      // already re-renders every frame and gaze follows the heading.
      if (isMoving || !localAttentionRef || !livePositionsRef) return;

      let raf: number;
      let lastTargetKey = localAttentionRef.current.targetKey;
      const tick = () => {
        const targetKey = localAttentionRef.current.targetKey;
        const targetChanged = targetKey !== lastTargetKey;
        lastTargetKey = targetKey;

        // Force a re-render so the gaze resolution (eyeOffset) below re-reads
        // the target's CURRENT live position every frame. Also force exactly
        // one render when the target changes, in particular on RELEASE
        // (targetKey -> null): without it nothing re-renders the component, so
        // the eyes would keep the stale attention direction until the next
        // idle-gaze emission (up to ~2.5s). When there is no active target and
        // nothing changed we let idle gaze drive things and don't force renders.
        if (targetKey || targetChanged) {
          forceGazeFrame((n) => (n + 1) & 0xffff);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [isMoving, localAttentionRef, livePositionsRef]);

    // Publish the local Blobbi's position + activity to the shared ref so
    // MultiplayerLayer can treat it as a nearby gaze target for remotes.
    // Updates whenever position changes (every frame while moving) or when the
    // moving flag flips, so remotes stop looking once the local Blobbi stops.
    // Also mirror the position into the shared live-positions map under the
    // reserved local key, so remotes watching the local Blobbi track its CURRENT
    // position live (same source MovableBlobbi reads for remotes). Ref writes
    // only: no re-render is triggered by this.
    useEffect(() => {
      if (localActiveRef) {
        localActiveRef.current = {
          position,
          isMoving,
          // Future activity flags (emotes/animations/actions) can be added here.
        };
      }
      livePositionsRef?.current.set(LOCAL_GAZE_KEY, position);
    }, [localActiveRef, livePositionsRef, position, isMoving]);

    // Clear the shared local-active snapshot on unmount so remotes don't keep
    // gazing at a Blobbi that left the scene.
    useEffect(() => {
      const livePositions = livePositionsRef?.current;
      return () => {
        if (localActiveRef) localActiveRef.current = null;
        livePositions?.delete(LOCAL_GAZE_KEY);
      };
    }, [localActiveRef, livePositionsRef]);

    // Pointer events arrive in viewport px; the rendered rect converts them to
    // world percent (invariant under the uniform world scale). The clamped
    // result is the GROUND point the user asked the feet to reach.
    const clientToPercent = useCallback((clientX: number, clientY: number): GroundPosition => {
      const rect = containerRef.current?.getBoundingClientRect();
      const raw = rect ? clientPointToWorldPercent(clientX, clientY, rect) : null;
      return constrainPosition(raw ?? { x: 50, y: 75 }, boundary);
    }, [containerRef, boundary]);

    // Latest pose for the input handler without re-binding listeners.
    const poseRef = useRef(pose);
    poseRef.current = pose;

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !isVisible) return;

      const handlePointer = (event: MouseEvent | TouchEvent) => {
        if (blobbiRef.current?.contains(event.target as Node)) {
          onWakeUp?.();
          onBlobbiClick?.();
          return;
        }

        // Caller-specific guard (photo-booth mode), then the shared world-move
        // policy (src/lib/world-input.ts) MultiplayerLayer also consults.
        if (isPhotoBoothOpen) return;
        if (!shouldTriggerWorldMove(event, container)) return;

        onWakeUp?.();

        // Asleep on the bed: a world tap wakes the Blobbi and nothing more,
        // the pose transition is the orchestrator's job, not a walk.
        if (poseRef.current.kind === 'sleeping') return;

        let clientX: number, clientY: number;
        if (event instanceof MouseEvent) {
          clientX = event.clientX;
          clientY = event.clientY;
        } else {
          const touch = event.touches[0] || event.changedTouches[0];
          clientX = touch.clientX;
          clientY = touch.clientY;
        }

        goTo(clientToPercent(clientX, clientY));
      };

      container.addEventListener('pointerdown', handlePointer as EventListener, { passive: true });
      container.addEventListener('touchstart', handlePointer as EventListener, { passive: true });

      return () => {
        container.removeEventListener('pointerdown', handlePointer as EventListener);
        container.removeEventListener('touchstart', handlePointer as EventListener);
      };
    }, [
      containerRef,
      isVisible,
      clientToPercent,
      goTo,
      onWakeUp,
      onBlobbiClick,
      isPhotoBoothOpen,
    ]);

    useImperativeHandle(ref, () => ({ goTo, snapTo, stop, getCurrentPosition }), [
      goTo,
      snapTo,
      stop,
      getCurrentPosition,
    ]);

    if (!isVisible) return null;

    // The complete visual consequence of the current pose, from the SAME pure
    // resolver the remote layer uses (src/lib/blobbi-pose.ts).
    const render = resolveActorRender(pose, {
      groundPosition: position,
      backgroundFile,
      boundary,
      scaleByYPosition,
      suppressFloat: disableFloating,
    });

    // Depth scale at an arbitrary point (gaze endpoints convert ground → body
    // center with each point's own depth scale).
    const depthScaleAt = (pos: Position): number =>
      scaleByYPosition ? resolveBlobbiScale(pos, backgroundFile, boundary) : 1;

    // Gaze priority (self-intent first):
    //   1. own movement  → look where it is walking
    //   2. attention      → look at the selected active target (identity from
    //      localAttentionRef, live position from livePositionsRef)
    //   3. idle           → organic idle gaze
    // Future self-intent (interactions/actions/emotes) slots in at step 1 with
    // its own gaze rule; external attention only takes over when idle.
    // While standing still, useIdleGaze drives ~60fps re-renders, so the
    // attention target's *live* position is read fresh without an extra loop.
    let eyeOffset: { x: number; y: number };
    if (isMoving) {
      eyeOffset = { x: direction.x, y: direction.y };
    } else {
      const attentionTarget =
        localAttentionRef && livePositionsRef
          ? attentionTargetPosition(
              localAttentionRef.current,
              livePositionsRef.current,
              LOCAL_GAZE_KEY,
            )
          : null;
      if (attentionTarget) {
        // Ground → visual body centers: eyes meet bodies, not feet. Both
        // endpoints convert with the room's size token and each point's own
        // depth scale, so the vector never mixes center and ground semantics.
        const myFocus = actorVisualFocusPoint(position, size, render.scale);
        const targetFocus = actorVisualFocusPoint(
          attentionTarget,
          size,
          depthScaleAt(attentionTarget),
        );
        const tx = targetFocus.x - myFocus.x;
        const ty = targetFocus.y - myFocus.y;
        const len = Math.hypot(tx, ty) || 1;
        eyeOffset = { x: tx / len, y: ty / len };
      } else {
        eyeOffset = idleGaze;
      }
    }

    return (
      <>
        {showTrail && !render.visualHidden &&
          trail.map((trailPos, index) => (
            // Trail dots mark the HISTORICAL GROUND PATH: each dot is centered
            // on a past ground point (a floor marker, not a body marker).
            <div
              key={index}
              className="absolute z-10 pointer-events-none"
              style={{
                left: `${trailPos.x}%`,
                top: `${trailPos.y}%`,
                transform: 'translate(-50%, -50%)',
                opacity: Math.max(0, 1 - (index + 1) * 0.2),
                transition: 'opacity 0.3s ease-out',
              }}
            >
              <div
                className={cn(
                  "rounded-full bg-primary/20",
                  size === "xl" && "w-4 h-4",
                  size === "lg" && "w-3 h-3",
                  size === "md" && "w-2 h-2",
                  size === "sm" && "w-1.5 h-1.5"
                )}
              />
            </div>
          ))}
        {/* Shared ground-anchor actor. While hidden the anchor stays mounted
            (chat-bubble portal + logical world position); everything visible
            is suppressed inside BlobbiActor. */}
        <BlobbiActor
          ref={blobbiRef}
          anchorId={anchorId}
          position={render.renderPosition}
          size={size}
          scale={render.scale}
          zIndex={render.zIndex}
          seatedIn={render.seatedIn}
          hiddenIn={render.hiddenIn}
          visualHidden={render.visualHidden}
          hideShadow={render.hideShadow}
          disableFloat={render.disableFloat}
          isMoving={isMoving}
          className={cn(
            onBlobbiClick && !render.visualHidden ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
            className
          )}
        >
          <CurrentBlobbiDisplay
            size={size}
            showFallback={true}
            transparent={true}
            isSleeping={render.sleeping}
            facing={render.facing}
            eyeOffset={eyeOffset}
            visualOverride={visualOverride}
            className={cn(isMoving && "scale-105")}
          />
        </BlobbiActor>
      </>
    );
  }
);

MovableBlobbi.displayName = "MovableBlobbi";
