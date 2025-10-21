/**
 * Simple Blobbi Display for rendering other players
 * Uses basic visual properties without full Blobbi data
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { BlobbiVisual } from '@/lib/multiplayer';

interface SimpleBlobbiDisplayProps {
  visual?: BlobbiVisual;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  isMoving?: boolean;
}

const sizeClasses = {
  sm: 'h-8 w-8 md:h-10 md:w-10',
  md: 'h-12 w-12 md:h-16 md:w-16',
  lg: 'h-16 w-16 md:h-20 md:w-20',
  xl: 'h-24 w-24 md:h-32 md:w-32',
};

export function SimpleBlobbiDisplay({
  visual,
  size = 'lg',
  className,
  isMoving = false,
}: SimpleBlobbiDisplayProps) {
  // Fallback when no visual data is available
  if (!visual) {
    return (
      <div
        className={cn(
          'rounded-full bg-gradient-to-br from-blue-400 to-purple-500',
          'border-2 border-white shadow-lg',
          'animate-float',
          sizeClasses[size],
          className
        )}
      >
        <div className="w-full h-full rounded-full bg-gradient-to-br from-white/20 to-transparent" />
      </div>
    );
  }

  // Get colors with fallbacks
  const baseColor = visual.baseColor || '#4F46E5';
  const secondaryColor = visual.secondaryColor || '#7C3AED';
  const eyeColor = visual.eyeColor || '#1F2937';

  return (
    <div
      className={cn(
        'relative rounded-full border-2 border-white shadow-lg',
        'transition-transform duration-200',
        !isMoving && 'animate-float',
        isMoving && 'scale-105',
        sizeClasses[size],
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${baseColor} 0%, ${secondaryColor} 100%)`,
      }}
    >
      {/* Base body */}
      <div 
        className="w-full h-full rounded-full"
        style={{
          background: `linear-gradient(135deg, ${baseColor} 0%, ${secondaryColor} 100%)`,
        }}
      />
      
      {/* Highlight */}
      <div className="absolute top-1 left-1 w-1/3 h-1/3 rounded-full bg-white/30" />
      
      {/* Eyes */}
      <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 flex space-x-1">
        <div 
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: eyeColor }}
        />
        <div 
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: eyeColor }}
        />
      </div>
      
      {/* Special markings */}
      {visual.specialMark && (
        <div className="absolute bottom-1/4 left-1/2 transform -translate-x-1/2">
          <div className="w-2 h-1 bg-white/60 rounded-full" />
        </div>
      )}
      
      {/* Movement indicator */}
      {isMoving && (
        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
          <div className="w-3 h-0.5 bg-white/80 rounded-full animate-pulse" />
        </div>
      )}
    </div>
  );
}