import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';

interface FloatingBlobbiProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  onBlobbiClick?: () => void;
}

export function FloatingBlobbi({ className, size = 'lg', onBlobbiClick }: FloatingBlobbiProps) {
  const [position, setPosition] = useState({ x: 50, y: 70 }); // Start at bottom center
  const [isMoving, setIsMoving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const moveTimeoutRef = useRef<NodeJS.Timeout>();

  // Auto-movement behavior
  useEffect(() => {
    const moveRandomly = () => {
      if (isMoving) return;

      // Random chance to move (15% every 4-7 seconds)
      if (Math.random() < 0.15) {
        const newX = Math.random() * 80 + 10; // Keep within 10-90% range
        const newY = Math.random() * 40 + 50; // Keep in bottom half (50-90%)

        setIsMoving(true);
        setPosition({ x: newX, y: newY });

        // Stop moving after animation completes (longer duration for smoother movement)
        moveTimeoutRef.current = setTimeout(() => {
          setIsMoving(false);
        }, 3000);
      }
    };

    const interval = setInterval(moveRandomly, 4000 + Math.random() * 3000); // 4-7 seconds

    return () => {
      clearInterval(interval);
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
      }
    };
  }, [isMoving]);

  // Handle click to move
  const handleContainerClick = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Constrain to reasonable bounds
    const constrainedX = Math.max(5, Math.min(95, x));
    const constrainedY = Math.max(30, Math.min(95, y)); // Keep in lower portion

    setIsMoving(true);
    setPosition({ x: constrainedX, y: constrainedY });

    // Clear any existing timeout
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
    }

    // Stop moving after animation completes (longer duration for smoother movement)
    moveTimeoutRef.current = setTimeout(() => {
      setIsMoving(false);
    }, 3000);
  };

  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-20 h-20'
  };

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 cursor-pointer", className)}
      onClick={handleContainerClick}
    >
      {/* Floating Blobbi */}
      <div
        className={cn(
          "absolute transform -translate-x-1/2 -translate-y-1/2",
          "transition-all",
          "hover:scale-105 active:scale-95",
          "cursor-pointer",
          sizeClasses[size]
        )}
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          transitionDuration: '3000ms',
          transitionTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', // Natural easing
        }}
        onClick={(e) => {
          e.stopPropagation();
          onBlobbiClick?.();
        }}
      >
        <CurrentBlobbiDisplay
          size={size}
          className="transition-transform duration-300"
          showFallback={true}
          interactive={true}
          transparent={true}
        />
      </div>

      {/* Click instruction (appears briefly on hover) */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none">
        <div className="bg-black/80 text-white text-xs px-3 py-1.5 rounded-full whitespace-nowrap">
          Click anywhere to move your Blobbi • Click Blobbi to switch
        </div>
      </div>
    </div>
  );
}