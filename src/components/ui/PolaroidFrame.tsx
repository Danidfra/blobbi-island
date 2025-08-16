import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PolaroidFrameProps {
  width?: number | string;
  aspectRatio?: number;
  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  radius?: number;
  className?: string;
  children: ReactNode;
  caption?: ReactNode;
}

export function PolaroidFrame({
  width = 500,
  aspectRatio = 3 / 4,
  margins = { top: 5, right: 4, bottom: 18, left: 4 },
  radius = 12,
  className,
  children,
  caption,
}: PolaroidFrameProps) {
  // Calculate inner photo area dimensions based on margins
  const _innerWidth = 100 - margins.left - margins.right;
  const _innerHeight = 100 - margins.top - margins.bottom;

  return (
    <div
      className={cn(
        // Frame styling
        'bg-white dark:bg-zinc-900',
        'border border-zinc-200 dark:border-zinc-700',
        'rounded-2xl shadow-md',
        'relative',
        className
      )}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        // Calculate aspect ratio based on inner photo area + margins
        aspectRatio: `1 / (${1 / aspectRatio} * (100 - margins.top - margins.bottom) / 100 + (margins.top + margins.bottom) / 100)`,
      }}
    >
      {/* Inner photo area */}
      <div
        className={cn(
          'absolute overflow-hidden',
          'bg-black/5 dark:bg-white/5',
          'rounded-xl'
        )}
        style={{
          top: `${margins.top}%`,
          left: `${margins.left}%`,
          right: `${margins.right}%`,
          bottom: `${margins.bottom}%`,
          borderRadius: `${radius * 0.8}px`, // Slightly smaller radius for inner area
        }}
      >
        {children}
      </div>

      {/* Optional caption area below photo */}
      {caption && (
        <div
          className="absolute text-center text-sm text-zinc-600 dark:text-zinc-400 px-4"
          style={{
            bottom: '8%',
            left: `${margins.left}%`,
            right: `${margins.right}%`,
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}