/**
 * Movable Blobbi Component
 *
 * Displays the user's customized Blobbi character with smooth movement capabilities.
 * The Blobbi can move to clicked/tapped positions with fluid animations and is
 * restricted to the lower half of the scene to avoid floating into unrealistic areas.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { Position } from '@/lib/types';
import { Boundary, constrainPosition } from '@/lib/boundaries';

interface MovementDirection {
  x: number;
  y: number;
}

interface MovableBlobbiProps {
  /** Container element to listen for clicks and calculate boundaries */
  containerRef: React.RefObject<HTMLElement>;
  /** Whether the Blobbi should be visible and interactive */
  isVisible?: boolean;
  /** Initial position as percentage of container (0-100) */
  initialPosition?: Position;
  /** Movement speed in pixels per second */
  movementSpeed?: number;
  /** The walkable area for the Blobbi */
  boundary?: Boundary;
  /** Size of the Blobbi character */
  size?: "sm" | "md" | "lg" | "xl";
  /** Additional CSS classes */
  className?: string;
  /** Show movement trail effect */
  showTrail?: boolean;
  /** Callback when movement starts */
  onMoveStart?: (destination: Position) => void;
  /** Callback when movement completes */
  onMoveComplete?: (position: Position) => void;
}

export function MovableBlobbi({
  containerRef,
  isVisible = true,
  initialPosition = { x: 50, y: 75 }, // Start at bottom center
  movementSpeed = 120, // pixels per second
  boundary = { shape: 'rectangle', x: [0, 100], y: [60, 100] }, // Default boundary
  size = "lg",
  className,
  showTrail = false,
  onMoveStart,
  onMoveComplete
}: MovableBlobbiProps) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const [targetPosition, setTargetPosition] = useState<Position>(initialPosition);
  const [isMoving, setIsMoving] = useState(false);
  const [direction, setDirection] = useState<MovementDirection>({ x: 0, y: 0 });
  const [trail, setTrail] = useState<Position[]>([]);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>();
  const blobbiRef = useRef<HTMLDivElement>(null);

  // Convert percentage position to pixel position
  const getPixelPosition = useCallback((percentPos: Position): Position => {
    if (!containerRef.current) return { x: 0, y: 0 };

    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (percentPos.x / 100) * rect.width,
      y: (percentPos.y / 100) * rect.height
    };
  }, [containerRef]);

  // Convert pixel position to percentage position
  const getPercentPosition = useCallback((pixelPos: Position): Position => {
    if (!containerRef.current) return { x: 50, y: 75 };

    const rect = containerRef.current.getBoundingClientRect();
    const percentPos = {
      x: (pixelPos.x / rect.width) * 100,
      y: (pixelPos.y / rect.height) * 100
    };

    return constrainPosition(percentPos, boundary);
  }, [containerRef, boundary]);

  // Calculate distance between two positions
  const getDistance = (pos1: Position, pos2: Position): number => {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Smooth movement animation
  const animateMovement = useCallback((timestamp: number) => {
    if (!lastTimeRef.current) {
      lastTimeRef.current = timestamp;
    }

    const deltaTime = (timestamp - lastTimeRef.current) / 1000; // Convert to seconds
    lastTimeRef.current = timestamp;

    setPosition(currentPos => {
      const currentPixelPos = getPixelPosition(currentPos);
      const targetPixelPos = getPixelPosition(targetPosition);

      const distance = getDistance(currentPixelPos, targetPixelPos);

      // If we're close enough, snap to target and stop moving
      if (distance < 2) {
        setIsMoving(false);
        onMoveComplete?.(targetPosition);
        return targetPosition;
      }

      // Calculate movement direction
      const dx = targetPixelPos.x - currentPixelPos.x;
      const dy = targetPixelPos.y - currentPixelPos.y;
      const moveDistance = movementSpeed * deltaTime;

      // Normalize direction and apply movement
      const directionLength = Math.sqrt(dx * dx + dy * dy);
      const normalizedDx = dx / directionLength;
      const normalizedDy = dy / directionLength;

      // Update direction for visual effects (like facing direction)
      setDirection({ x: normalizedDx, y: normalizedDy });

      const newPixelPos = {
        x: currentPixelPos.x + normalizedDx * moveDistance,
        y: currentPixelPos.y + normalizedDy * moveDistance
      };

      const newPercentPos = getPercentPosition(newPixelPos);

      // Update trail if enabled
      if (showTrail) {
        setTrail(prevTrail => {
          const newTrail = [currentPos, ...prevTrail.slice(0, 4)]; // Keep last 5 positions
          return newTrail;
        });
      }

      return newPercentPos;
    });

    if (isMoving) {
      animationRef.current = requestAnimationFrame(animateMovement);
    }
  }, [targetPosition, movementSpeed, getPixelPosition, getPercentPosition, isMoving, onMoveComplete, showTrail]);

  // Start movement animation
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

  // Handle click/tap events on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isVisible) return;

    const handleClick = (event: MouseEvent | TouchEvent) => {
      // Prevent if clicking on the Blobbi itself
      if (blobbiRef.current?.contains(event.target as Node)) {
        return;
      }

      const rect = container.getBoundingClientRect();
      let clientX: number, clientY: number;

      if (event instanceof MouseEvent) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else {
        // Touch event
        const touch = event.touches[0] || event.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      }

      // Calculate click position relative to container
      const clickX = clientX - rect.left;
      const clickY = clientY - rect.top;

      // Convert to percentage and restrict to lower half
      const newTarget = getPercentPosition({ x: clickX, y: clickY });

      setTargetPosition(newTarget);
      setIsMoving(true);
      onMoveStart?.(newTarget);
    };

    // Add both mouse and touch event listeners
    container.addEventListener('click', handleClick);
    container.addEventListener('touchend', handleClick);

    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('touchend', handleClick);
    };
  }, [containerRef, isVisible, getPercentPosition, onMoveStart]);

  // Don't render if not visible
  if (!isVisible) return null;

  // Calculate facing direction for visual effects
  const shouldFlip = direction.x < 0; // Flip horizontally when moving left

  return (
    <>
      {/* Movement Trail */}
      {showTrail && trail.map((trailPos, index) => (
        <div
          key={index}
          className="absolute z-10 pointer-events-none"
          style={{
            left: `${trailPos.x}%`,
            top: `${trailPos.y}%`,
            transform: 'translate(-50%, -50%)',
            opacity: Math.max(0, 1 - (index + 1) * 0.2), // Fade out trail
            transition: 'opacity 0.3s ease-out',
          }}
        >
          <div
            className="rounded-full bg-primary/20"
            style={{
              width: size === "xl" ? "16px" : size === "lg" ? "12px" : size === "md" ? "8px" : "6px",
              height: size === "xl" ? "16px" : size === "lg" ? "12px" : size === "md" ? "8px" : "6px",
            }}
          />
        </div>
      ))}

      {/* Main Blobbi Character */}
      <div
        ref={blobbiRef}
        className={cn(
          "absolute z-20 transition-all duration-200 ease-out",
          "pointer-events-none", // Allow clicks to pass through to container
          isMoving && "transition-none", // Disable CSS transitions during animation
          className
        )}
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          transform: `translate(-50%, -50%) ${shouldFlip ? 'scaleX(-1)' : ''}`,
          filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))', // Soft shadow for hovering effect
        }}
      >
      {/* Floating animation effect */}
      <div
        className={cn(
          "animate-float", // Custom floating animation
          "transition-transform duration-1000 ease-in-out"
        )}
      >
        <CurrentBlobbiDisplay
          size={size}
          showFallback={true}
          transparent={true}
          className={cn(
            // Add subtle scale animation when moving
            isMoving && "scale-105"
          )}
        />
      </div>

        {/* Subtle ground shadow */}
        <div
          className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-2"
          style={{
            width: size === "xl" ? "32px" : size === "lg" ? "24px" : size === "md" ? "16px" : "12px",
            height: "6px",
            background: "radial-gradient(ellipse, rgba(0, 0, 0, 0.2) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />
      </div>
    </>
  );
}