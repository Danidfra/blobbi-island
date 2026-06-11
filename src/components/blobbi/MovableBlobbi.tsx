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
import type { LocalActiveState } from '@/lib/gaze';
import { Boundary, constrainPosition } from '@/lib/boundaries';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';

interface MovementDirection {
  x: number;
  y: number;
}

export interface MovableBlobbiRef {
  goTo: (position: Position, immediate?: boolean) => void;
  getCurrentPosition?: () => Position;
}

import { locationScalingConfig } from '@/lib/location-scaling-config';

export interface MovableBlobbiProps {
  containerRef: React.RefObject<HTMLElement>;
  isVisible?: boolean;
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
  _isSeated?: boolean;
  eyesClosed?: boolean;
  isAttachedToChair?: boolean;
  sitZIndexOffset?: number;
  scaleByYPosition?: boolean;
  disableFloating?: boolean;
  anchorId?: string;
  /**
   * Optional shared ref holding a nearby gaze target (percent coords) for the
   * local Blobbi — typically the nearest moving remote Blobbi. When set, the
   * eyes glance toward it with top priority over movement/idle gaze.
   */
  gazeTargetRef?: React.RefObject<Position | null>;
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
      _isSeated = false,
      eyesClosed = false,
      isAttachedToChair = false,
      sitZIndexOffset = 0,
      scaleByYPosition = false,
      disableFloating = false,
      anchorId,
      gazeTargetRef,
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

    // Publish the local Blobbi's position + activity to the shared ref so
    // MultiplayerLayer can treat it as a nearby gaze target for remotes.
    // Updates whenever position changes (every frame while moving) or when the
    // moving flag flips — so remotes stop looking once the local Blobbi stops.
    useEffect(() => {
      if (!localActiveRef) return;
      localActiveRef.current = {
        position,
        isMoving,
        // Future activity flags (emotes/animations/actions) can be added here.
      };
    }, [localActiveRef, position, isMoving]);

    // Clear the shared local-active snapshot on unmount so remotes don't keep
    // gazing at a Blobbi that left the scene.
    useEffect(() => {
      return () => {
        if (localActiveRef) localActiveRef.current = null;
      };
    }, [localActiveRef]);

    const getPixelPosition = useCallback((percentPos: Position): Position => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (percentPos.x / 100) * rect.width,
        y: (percentPos.y / 100) * rect.height,
      };
    }, [containerRef]);

    const getPercentPosition = useCallback((pixelPos: Position): Position => {
      if (!containerRef.current) return { x: 50, y: 75 };
      const rect = containerRef.current.getBoundingClientRect();
      const percentPos = {
        x: (pixelPos.x / rect.width) * 100,
        y: (pixelPos.y / rect.height) * 100,
      };
      return constrainPosition(percentPos, boundary);
    }, [containerRef, boundary]);

    const getDistance = (pos1: Position, pos2: Position): number => {
      const dx = pos2.x - pos1.x;
      const dy = pos2.y - pos1.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getDynamicZIndex = useCallback((currentPos: Position): number => {
      if (!backgroundFile) return 20;
      const baseZIndex = calculateBlobbiZIndex(currentPos.y, backgroundFile);
      // Apply sitZIndexOffset when attached to chair
      return isAttachedToChair ? baseZIndex + sitZIndexOffset : baseZIndex;
    }, [backgroundFile, isAttachedToChair, sitZIndexOffset]);

    const getDynamicScale = useCallback((currentPos: Position): number => {
      const scalingConfig = backgroundFile ? locationScalingConfig[backgroundFile] : undefined;

      if (!scaleByYPosition || !scalingConfig) {
        return 1;
      }

      const { initialScale, finalScale } = scalingConfig;

      // Get the Y boundaries for scaling calculation based on boundary shape
      let minY: number, maxY: number;

      if (boundary.shape === 'rectangle') {
        minY = boundary.y[0]; // Top of allowed movement area
        maxY = boundary.y[1]; // Bottom of allowed movement area
      } else if (boundary.shape === 'semicircle' || boundary.shape === 'arch') {
        minY = boundary.top;
        maxY = boundary.bottom;
      } else if (boundary.shape === 'composite') {
        // For composite boundaries, find the overall min/max Y values
        minY = Math.min(...boundary.areas.map(area => {
          if (area.type === 'rectangle') return area.y[0];
          if (area.type === 'circle') return area.cy - area.r;
          if (area.type === 'triangle') return Math.min(...area.points.map(p => p.y));
          return 100;
        }));
        maxY = Math.max(...boundary.areas.map(area => {
          if (area.type === 'rectangle') return area.y[1];
          if (area.type === 'circle') return area.cy + area.r;
          if (area.type === 'triangle') return Math.max(...area.points.map(p => p.y));
          return 0;
        }));
      } else {
        // Fallback to full screen height
        minY = 0;
        maxY = 100;
      }

      // Clamp the position within the boundary
      const clampedY = Math.max(minY, Math.min(maxY, currentPos.y));

      // Calculate the interpolation factor (0 = top, 1 = bottom)
      const factor = (maxY - minY) > 0 ? (clampedY - minY) / (maxY - minY) : 0;

      // Interpolate between finalScale (top) and initialScale (bottom)
      return finalScale + (initialScale - finalScale) * factor;
    }, [scaleByYPosition, backgroundFile, boundary]);

    const animateMovement = useCallback(
      (timestamp: number) => {
        if (!lastTimeRef.current) {
          lastTimeRef.current = timestamp;
        }
        const deltaTime = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        let reached = false;
        setPosition(currentPos => {
          const currentPixelPos = getPixelPosition(currentPos);
          const target = targetRef.current;
          const targetPixelPos = getPixelPosition(target);
          const distance = getDistance(currentPixelPos, targetPixelPos);

          if (distance < 2) {
            reached = true;
            return target;
          }

          const dx = targetPixelPos.x - currentPixelPos.x;
          const dy = targetPixelPos.y - currentPixelPos.y;
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
          const newPercentPos = getPercentPosition(newPixelPos);

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
        getPixelPosition,
        getPercentPosition,
        onMoveComplete,
        showTrail,
        isPositionBlocked,
      ]
    );

    useEffect(() => {
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
        if (isAttachedToChair) {
          onWakeUp?.();
        }

        const rect = container.getBoundingClientRect();
        let clientX: number, clientY: number;
        if (event instanceof MouseEvent) {
          clientX = event.clientX;
          clientY = event.clientY;
        } else {
          const touch = event.touches[0] || event.changedTouches[0];
          clientX = touch.clientX;
          clientY = touch.clientY;
        }

        const clickX = clientX - rect.left;
        const clickY = clientY - rect.top;
        const newTarget = getPercentPosition({ x: clickX, y: clickY });

        if (isPositionBlocked(newTarget.x, newTarget.y)) return;

        targetRef.current = newTarget;
        setIsMoving(true);
        isMovingRef.current = true;
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
      getPercentPosition,
      onMoveStart,
      onWakeUp,
      onBlobbiClick,
      isAttachedToBed,
      isAttachedToChair,
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
          onMoveStart?.(newTarget);
        }
      },
      getCurrentPosition: () => position,
    }));

    if (!isVisible) return null;

    const shouldFlip = direction.x < 0;
    const dynamicScale = getDynamicScale(position);
    // Gaze priority: nearby moving Blobbi -> movement heading -> idle.
    // While standing still, useIdleGaze drives ~60fps re-renders, so reading
    // the nearby target ref here tracks a moving Blobbi smoothly without an
    // extra animation loop.
    const nearbyTarget = gazeTargetRef?.current ?? null;
    let eyeOffset: { x: number; y: number };
    if (nearbyTarget) {
      const tx = nearbyTarget.x - position.x;
      const ty = nearbyTarget.y - position.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      eyeOffset = { x: tx / len, y: ty / len };
    } else if (isMoving) {
      eyeOffset = { x: direction.x, y: direction.y };
    } else {
      eyeOffset = idleGaze;
    }

    return (
      <>
        {showTrail &&
          trail.map((trailPos, index) => (
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
                  size === "xl" && "w-4 h-4 md:w-5 md:h-5",
                  size === "lg" && "w-3 h-3 md:w-4 md:h-4",
                  size === "md" && "w-2 h-2 md:w-3 md:h-3",
                  size === "sm" && "w-1.5 h-1.5 md:w-2 md:h-2"
                )}
              />
            </div>
          ))}
        <div
          ref={blobbiRef}
          id={anchorId}
          className={cn(
            "absolute transition-all duration-200 ease-out blobbi-character",
            onBlobbiClick ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
            isMoving && "transition-none",
            className
          )}
          style={{
            left: `${position.x}%`,
            top: `${position.y}%`,
            // ⬇️ wrapper externo SEM scale/flip — serve de âncora p/ a bolha
            transform: `translate(-50%, -50%)`,
            filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))',
            zIndex: getDynamicZIndex(position),
          }}
        >
          {/* ⬇️ wrapper interno recebe scale/flip */}
          <div
            className="relative"
            style={{
              transform: `scale(${dynamicScale}) ${shouldFlip ? 'scaleX(-1)' : ''}`,
              transformOrigin: 'center center',
            }}
          >
            <div
              className={cn(
                !isSleeping && !disableFloating && "animate-float",
                "transition-transform duration-1000 ease-in-out"
              )}
            >
              <CurrentBlobbiDisplay
                size={size}
                showFallback={true}
                transparent={true}
                isSleeping={isSleeping}
                eyesClosed={eyesClosed}
                eyeOffset={eyeOffset}
                className={cn(isMoving && "scale-105")}
              />
            </div>
          </div>
          <div
            className={cn(
              "absolute top-full left-1/2 h-1.5 rounded-full",
              size === "xl" && "w-8 md:w-10",
              size === "lg" && "w-6 md:w-8",
              size === "md" && "w-4 md:w-6",
              size === "sm" && "w-3 md:w-4"
            )}
            style={{
              background: "radial-gradient(ellipse, rgba(0, 0, 0, 0.2) 0%, transparent 70%)",
              transform: `translateX(-50%) scale(${dynamicScale})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </>
    );
  }
);

MovableBlobbi.displayName = "MovableBlobbi";
