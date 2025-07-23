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
import { Position } from '@/lib/types';
import { Boundary, constrainPosition } from '@/lib/boundaries';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';

interface MovementDirection {
  x: number;
  y: number;
}

export interface MovableBlobbiRef {
  goTo: (position: Position, immediate?: boolean) => void;
}

import { locationScalingConfig } from '@/lib/location-scaling-config';

interface MovableBlobbiProps {
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
  isSleeping?: boolean;
  isAttachedToBed?: boolean;
  scaleByYPosition?: boolean;
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
      isSleeping = false,
      isAttachedToBed = false,
      scaleByYPosition = false,
    },
    ref
  ) => {
    const [position, setPosition] = useState<Position>(initialPosition);
    const [targetPosition, setTargetPosition] = useState<Position>(initialPosition);
    const [isMoving, setIsMoving] = useState(false);
    const [direction, setDirection] = useState<MovementDirection>({ x: 0, y: 0 });
    const [trail, setTrail] = useState<Position[]>([]);
    const animationRef = useRef<number>();
    const lastTimeRef = useRef<number>();
    const blobbiRef = useRef<HTMLDivElement>(null);

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
      return calculateBlobbiZIndex(currentPos.y, backgroundFile);
    }, [backgroundFile]);

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
        minY = Math.min(...boundary.areas.map(area => area.y[0]));
        maxY = Math.max(...boundary.areas.map(area => area.y[1]));
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

        setPosition(currentPos => {
          const currentPixelPos = getPixelPosition(currentPos);
          const targetPixelPos = getPixelPosition(targetPosition);
          const distance = getDistance(currentPixelPos, targetPixelPos);

          if (distance < 2) {
            setIsMoving(false);
            onMoveComplete?.(targetPosition);
            // Snap exactly to the target position
            return targetPosition;
          }

          const dx = targetPixelPos.x - currentPixelPos.x;
          const dy = targetPixelPos.y - currentPixelPos.y;
          const moveDistance = movementSpeed * deltaTime;
          const directionLength = Math.sqrt(dx * dx + dy * dy);
          const normalizedDx = dx / directionLength;
          const normalizedDy = dy / directionLength;

          setDirection({ x: normalizedDx, y: normalizedDy });

          const newPixelPos = {
            x: currentPixelPos.x + normalizedDx * moveDistance,
            y: currentPixelPos.y + normalizedDy * moveDistance,
          };
          const newPercentPos = getPercentPosition(newPixelPos);

          if (showTrail) {
            setTrail(prevTrail => [currentPos, ...prevTrail.slice(0, 4)]);
          }

          return newPercentPos;
        });

        if (isMoving) {
          animationRef.current = requestAnimationFrame(animateMovement);
        }
      },
      [
        targetPosition,
        movementSpeed,
        getPixelPosition,
        getPercentPosition,
        isMoving,
        onMoveComplete,
        showTrail,
      ]
    );

    useEffect(() => {
      if (isMoving) {
        lastTimeRef.current = undefined;
        animationRef.current = requestAnimationFrame(animateMovement);
      }
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [isMoving, animateMovement]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !isVisible) return;

      const handleClick = (event: MouseEvent | TouchEvent) => {
        // Always call onWakeUp when clicking anywhere
        onWakeUp?.();

        // If clicking on the Blobbi itself, just wake up but don't move
        if (blobbiRef.current?.contains(event.target as Node)) {
          return;
        }

        // If attached to bed, don't respond to container clicks (only wake up)
        if (isAttachedToBed) {
          return;
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

        setTargetPosition(newTarget);
        setIsMoving(true);
        onMoveStart?.(newTarget);
      };

      container.addEventListener('click', handleClick);
      container.addEventListener('touchend', handleClick);

      return () => {
        container.removeEventListener('click', handleClick);
        container.removeEventListener('touchend', handleClick);
      };
    }, [containerRef, isVisible, getPercentPosition, onMoveStart, onWakeUp, isAttachedToBed]);

    useImperativeHandle(ref, () => ({
      goTo: (newTarget, immediate = false) => {
        setTargetPosition(newTarget);
        if (immediate) {
          // Immediately snap to position without animation
          setPosition(newTarget);
          setIsMoving(false);
          onMoveComplete?.(newTarget);
        } else {
          setIsMoving(true);
          onMoveStart?.(newTarget);
        }
      },
    }));

    if (!isVisible) return null;

    const shouldFlip = direction.x < 0;
    const dynamicScale = getDynamicScale(position);

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
          className={cn(
            "absolute transition-all duration-200 ease-out",
            "pointer-events-none",
            isMoving && "transition-none",
            className
          )}
          style={{
            left: `${position.x}%`,
            top: `${position.y}%`,
            transform: `translate(-50%, -50%) scale(${dynamicScale}) ${shouldFlip ? 'scaleX(-1)' : ''}`,
            filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))',
            zIndex: getDynamicZIndex(position),
          }}
        >
          <div
            className={cn(
              !isSleeping && "animate-float",
              "transition-transform duration-1000 ease-in-out"
            )}
          >
            <CurrentBlobbiDisplay
              size={size}
              showFallback={true}
              transparent={true}
              isSleeping={isSleeping}
              className={cn(isMoving && "scale-105")}
            />
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
              transform: `translateX(-50%) translateY(-8px) scale(${dynamicScale})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </>
    );
  }
);

MovableBlobbi.displayName = "MovableBlobbi";
