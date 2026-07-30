import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
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
import { Position } from '@/lib/types';
import type { LocalActiveState, AttentionState } from '@/lib/gaze';
import { attentionTargetPosition, LOCAL_GAZE_KEY } from '@/lib/gaze';
import { Boundary, constrainPosition } from '@/lib/boundaries';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/components/shell/VirtualWorld';
import {
  resolveBlobbiScale,
  resolveBlobbiZIndex,
  resolveSeatedRender,
} from '@/lib/blobbi-world-render';
import { MOVEMENT_SNAP_PX, actorVisualFocusPoint } from '@/lib/blobbi-ground';
import { BlobbiActor } from './BlobbiActor';
import type { BlobbiRenderVisual } from './BlobbiRendererView';

interface MovementDirection {
  x: number;
  y: number;
}

export interface MovableBlobbiRef {
  goTo: (position: Position, immediate?: boolean) => void;
  getCurrentPosition?: () => Position;
}

export interface MovableBlobbiProps {
  containerRef: React.RefObject<HTMLElement>;
  isVisible?: boolean;
  /**
   * Hide ONLY the Blobbi's visual representation (sprite, ground shadow and
   * trail) while keeping everything else alive: the movement animation, the
   * logical world position, the world-click listener, gameplay state and the
   * presence/chat anchor element.
   *
   * This is how "hidden inside a hiding spot" (e.g. a Town bush) is rendered:
   * nothing of the Blobbi is painted, so removing the bush art in DevTools
   * reveals empty ground instead of a Blobbi sitting behind it. Distinct from
   * `isVisible`, which unmounts the character *and* its input handling.
   */
  visualHidden?: boolean;
  initialPosition?: Position;
  movementSpeed?: number;
  boundary?: Boundary;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showTrail?: boolean;
  backgroundFile?: string;
  onMoveStart?: (destination: Position) => void;
  onMoveComplete?: (position: Position) => void;
  onWakeUp?: () => void;
  onBlobbiClick?: () => void;
  isSleeping?: boolean;
  isAttachedToBed?: boolean;
  /**
   * Id of the theater seat the local player currently occupies, or null.
   *
   * This is the ONLY seating input the renderer takes: everything visual about
   * sitting — the pinned position, the rear-facing view, the per-row scale, the
   * suppressed ground shadow and float — is derived from it via
   * `resolveSeatedRender`, so local and (later) remote seated Blobbis cannot
   * diverge. It replaces the old `_isSeated` / `eyesClosed` / `isAttachedToChair`
   * / `sitZIndexOffset` prop cluster, none of which was ever set to a non-default
   * value because the arrival callback that fed them never fired.
   */
  seatedIn?: string | null;
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
      visualHidden = false,
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
      isSleeping = false,
      isAttachedToBed = false,
      seatedIn = null,
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
    const [position, setPosition] = useState<Position>(initialPosition);
    // 🔒 refs para evitar recriar animação e estourar hooks
    const targetRef = useRef<Position>(initialPosition);
    const [isMoving, setIsMoving] = useState(false);
    const isMovingRef = useRef(false);
    // garante que state e ref fiquem em sincronia
    useEffect(() => { isMovingRef.current = isMoving; }, [isMoving]);
    const [direction, setDirection] = useState<MovementDirection>({ x: 0, y: 0 });
    const [trail, setTrail] = useState<Position[]>([]);
    const animationRef = useRef<number>();
    const lastTimeRef = useRef<number>();
    const justCompletedRef = useRef(false);
    const blobbiRef = useRef<HTMLDivElement>(null);
    const { isPositionBlocked } = useMovementBlocker();
    const { isPhotoBoothOpen } = usePhotoBooth();
    // Subtle idle eye micro-movements (only active while standing still).
    const idleGaze = useIdleGaze(!isMoving);

    // ---------------------------------------------------------------------
    // Per-frame attention tick.
    //
    // The eyeOffset is computed every *render* from localAttentionRef +
    // livePositionsRef. But while standing still, the only thing that drives
    // re-renders is useIdleGaze — and that intentionally STOPS emitting new
    // offsets (returns the previous reference, so React bails out) whenever it
    // is holding a gaze point (the majority of the time, 0.8–2.5s per hold).
    // During those holds MovableBlobbi does not re-render, so the gaze code
    // below never re-reads the watched target's CURRENT live position and the
    // eyes freeze on a stale snapshot — exactly the "start → frozen → final"
    // bug for the local Blobbi watching a moving remote.
    //
    // Fix: while we have an active attention target (i.e. we are watching some
    // Blobbi) drive a dedicated rAF that forces a cheap re-render every frame,
    // independent of idle gaze. This makes the local Blobbi track the target's
    // CURRENT animated position continuously — the same smoothness remotes get
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
        // one render when the target changes — in particular on RELEASE
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
    // moving flag flips — so remotes stop looking once the local Blobbi stops.
    // Also mirror the position into the shared live-positions map under the
    // reserved local key, so remotes watching the local Blobbi track its CURRENT
    // position live (same source MovableBlobbi reads for remotes). Ref writes
    // only — no re-render is triggered by this.
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

    // Movement math runs in FIXED world-design pixels (1046×697): percent
    // positions convert through the design space, never the rendered rect, so
    // speed and arrival are identical at every viewport scale.
    const toWorldPx = useCallback((percentPos: Position): Position => ({
      x: (percentPos.x / 100) * WORLD_WIDTH,
      y: (percentPos.y / 100) * WORLD_HEIGHT,
    }), []);

    const toPercent = useCallback((worldPx: Position): Position => {
      const percentPos = {
        x: (worldPx.x / WORLD_WIDTH) * 100,
        y: (worldPx.y / WORLD_HEIGHT) * 100,
      };
      return constrainPosition(percentPos, boundary);
    }, [boundary]);

    // Pointer events arrive in viewport px; the rendered rect converts them to
    // world percent (invariant under the uniform world scale). The clamped
    // result is the GROUND point the user asked the feet to reach.
    const clientToPercent = useCallback((clientX: number, clientY: number): Position => {
      if (!containerRef.current) return { x: 50, y: 75 };
      const rect = containerRef.current.getBoundingClientRect();
      const percentPos = {
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
      };
      return constrainPosition(percentPos, boundary);
    }, [containerRef, boundary]);

    const getDistance = (pos1: Position, pos2: Position): number => {
      const dx = pos2.x - pos1.x;
      const dy = pos2.y - pos1.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getDynamicZIndex = useCallback(
      (currentPos: Position): number => resolveBlobbiZIndex(currentPos, backgroundFile),
      [backgroundFile],
    );

    const getDynamicScale = useCallback(
      (currentPos: Position): number =>
        scaleByYPosition ? resolveBlobbiScale(currentPos, backgroundFile, boundary) : 1,
      [scaleByYPosition, backgroundFile, boundary],
    );

    const animateMovement = useCallback(
      (timestamp: number) => {
        if (!lastTimeRef.current) {
          lastTimeRef.current = timestamp;
        }
        const deltaTime = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        let reached = false;
        setPosition(currentPos => {
          const currentPixelPos = toWorldPx(currentPos);
          const target = targetRef.current;
          const targetPixelPos = toWorldPx(target);
          const distance = getDistance(currentPixelPos, targetPixelPos);

          if (distance < MOVEMENT_SNAP_PX) {
            reached = true;
            return target;
          }

          const dx = targetPixelPos.x - currentPixelPos.x;
          const dy = targetPixelPos.y - currentPixelPos.y;
          // `movementSpeed` is world-design px/s and this loop integrates in
          // world-design px, so no viewport correction is needed: the same
          // world distance takes the same time at every screen size.
          const moveDistance = movementSpeed * deltaTime;
          const directionLength = Math.sqrt(dx * dx + dy * dy);
          const normalizedDx = dx / directionLength;
          const normalizedDy = dy / directionLength;

          // só atualiza direção se mudar o suficiente (evita rerenders)
          setDirection(prev => {
            const EPS = 0.001;
            if (Math.abs(prev.x - normalizedDx) < EPS && Math.abs(prev.y - normalizedDy) < EPS) {
              return prev;
            }
            return { x: normalizedDx, y: normalizedDy };
          });

          const newPixelPos = {
            x: currentPixelPos.x + normalizedDx * moveDistance,
            y: currentPixelPos.y + normalizedDy * moveDistance,
          };
          const newPercentPos = toPercent(newPixelPos);

          if (isPositionBlocked(newPercentPos.x, newPercentPos.y)) {
            reached = true;
            return currentPos;
          }

          if (showTrail) {
            setTrail(prevTrail => {
              if (prevTrail[0] && prevTrail[0].x === currentPos.x && prevTrail[0].y === currentPos.y) {
                return prevTrail;
              }
              return [currentPos, ...prevTrail.slice(0, 4)];
            });
          }

          return newPercentPos;
        });

        if (reached) {
          if (!justCompletedRef.current) {
            justCompletedRef.current = true;
            setIsMoving(false);
            onMoveComplete?.(targetRef.current);
            setTimeout(() => { justCompletedRef.current = false; }, 0);
          }
          return;
        }
        if (isMovingRef.current) {
          animationRef.current = requestAnimationFrame(animateMovement);
        }
      },
      [
        movementSpeed,
        toWorldPx,
        toPercent,
        onMoveComplete,
        showTrail,
        isPositionBlocked,
      ]
    );

    /**
     * Start (or restart) the movement rAF loop.
     *
     * Historically the loop was only (re)started by the effect below, which
     * fires when `animateMovement`'s identity changes — which in PlayingView
     * happened to occur on every parent re-render triggered by `onMoveStart`.
     * A host with stable callbacks got no re-render and the walk silently
     * never started. Movement start is now explicit and self-contained.
     */
    const startAnimation = useCallback(() => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      lastTimeRef.current = undefined;
      animationRef.current = requestAnimationFrame(animateMovement);
    }, [animateMovement]);

    useEffect(() => {
      // Keep an in-flight walk running across `animateMovement` identity
      // changes (boundary/callback prop updates mid-walk).
      if (isMovingRef.current) {
        lastTimeRef.current = undefined;
        animationRef.current = requestAnimationFrame(animateMovement);
      }
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [animateMovement]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !isVisible) return;

      const isPrimaryPointer = (ev: MouseEvent | PointerEvent) =>
        (!('button' in ev) || ev.button === 0) &&
        !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;

      const shouldTriggerWorldMove = (ev: MouseEvent | TouchEvent): boolean => {
        if (isPhotoBoothOpen) return false;

        if (blobbiRef.current?.contains(ev.target as Node)) return false;

        const path = (ev as MouseEvent & { composedPath?: () => Element[] }).composedPath?.();
        const chain: Element[] =
          path?.filter((n) => n instanceof Element) as Element[] ??
          (ev.target instanceof Element ? [ev.target] : []);

        const BLOCK_UI_SELECTOR = [
          '[data-block-move]',
          '[data-overlay]',
          '[role="dialog"]',
          '[aria-modal="true"]',
          '[role="menu"]',
          '[role="button"]',
          'button',
          'a[href]',
          'input, textarea, select',
          '.modal',
          '.drawer',
          '.popover',
          '.tooltip',
          '.map-ui'
        ].join(',');

        for (const el of chain) {
          if (el.matches?.(BLOCK_UI_SELECTOR)) return false;
          if (el !== container && el.hasAttribute?.('data-world-surface')) return false;
        }

        if (!(ev.target instanceof Node) || !container.contains(ev.target)) return false;

        if (ev instanceof MouseEvent && !isPrimaryPointer(ev)) return false;

        return true;
      };

      const handlePointer = (event: MouseEvent | TouchEvent) => {
        if (blobbiRef.current?.contains(event.target as Node)) {
          onWakeUp?.();
          onBlobbiClick?.();
          return;
        }


        if (!shouldTriggerWorldMove(event)) return;

        onWakeUp?.();

        if (isAttachedToBed) {
          onWakeUp?.();
          return;
        }
        if (seatedIn) {
          onWakeUp?.();
        }

        let clientX: number, clientY: number;
        if (event instanceof MouseEvent) {
          clientX = event.clientX;
          clientY = event.clientY;
        } else {
          const touch = event.touches[0] || event.changedTouches[0];
          clientX = touch.clientX;
          clientY = touch.clientY;
        }

        const newTarget = clientToPercent(clientX, clientY);

        if (isPositionBlocked(newTarget.x, newTarget.y)) return;

        targetRef.current = newTarget;
        setIsMoving(true);
        isMovingRef.current = true;
        startAnimation();
        onMoveStart?.(newTarget);
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
      startAnimation,
      onMoveStart,
      onWakeUp,
      onBlobbiClick,
      isAttachedToBed,
      seatedIn,
      isPositionBlocked,
      isPhotoBoothOpen
    ]);

    useImperativeHandle(ref, () => ({
      goTo: (newTarget, immediate = false) => {
        if (isPositionBlocked(newTarget.x, newTarget.y)) {
          return;
        }
        targetRef.current = newTarget;
        if (immediate) {
          // Immediately snap to position without animation
          setPosition(newTarget);
          setIsMoving(false);
          isMovingRef.current = false;
          onMoveComplete?.(newTarget);
        } else {
          setIsMoving(true);
          isMovingRef.current = true;
          startAnimation();
          onMoveStart?.(newTarget);
        }
      },
      getCurrentPosition: () => position,
    }));

    if (!isVisible) return null;

    // Everything the seat changes about how this Blobbi is drawn, resolved from
    // the seat id alone (shared with the remote renderer). A seated Blobbi is
    // DRAWN at the seat's pose anchor (same rule as remotes), regardless of the
    // stored walking position — PlayingView still snaps the stored position for
    // presence, but rendering no longer depends on that side effect.
    const seated = resolveSeatedRender(seatedIn);
    const renderPos = seated ? seated.position : position;
    const dynamicScale = getDynamicScale(renderPos) * (seated?.scale ?? 1);
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
        const myFocus = actorVisualFocusPoint(position, size, dynamicScale);
        const targetFocus = actorVisualFocusPoint(
          attentionTarget,
          size,
          getDynamicScale(attentionTarget),
        );
        const tx = targetFocus.x - myFocus.x;
        const ty = targetFocus.y - myFocus.y;
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        eyeOffset = { x: tx / len, y: ty / len };
      } else {
        eyeOffset = idleGaze;
      }
    }

    return (
      <>
        {showTrail && !visualHidden &&
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
        {/* Shared ground-anchor actor. While `visualHidden` the anchor stays
            mounted (chat-bubble portal + logical world position); everything
            visible is suppressed inside BlobbiActor. */}
        <BlobbiActor
          ref={blobbiRef}
          anchorId={anchorId}
          position={renderPos}
          size={size}
          scale={dynamicScale}
          zIndex={seated ? seated.zIndex : getDynamicZIndex(renderPos)}
          seatedIn={seated?.seat.id ?? null}
          visualHidden={visualHidden}
          hideShadow={!!seated?.hideShadow}
          disableFloat={isSleeping || disableFloating || !!seated?.disableFloat}
          isMoving={isMoving}
          className={cn(
            onBlobbiClick && !visualHidden ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
            className
          )}
        >
          <CurrentBlobbiDisplay
            size={size}
            showFallback={true}
            transparent={true}
            isSleeping={isSleeping}
            facing={seated?.facing ?? 'front'}
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
