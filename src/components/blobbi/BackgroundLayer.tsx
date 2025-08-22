import React, { useState, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface BackgroundLayerProps {
  src: string;
  alt?: string;
  fit?: 'cover' | 'contain' | 'fill';
  className?: string;
  fallback?: React.ReactNode;
}

export const BackgroundLayer = forwardRef<HTMLDivElement, BackgroundLayerProps>(
  ({ src, alt = '', fit = 'cover', className, fallback }, ref) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const shouldShowImage = imageLoaded && !imageError;

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-full h-full overflow-hidden",
          className
        )}
        aria-hidden="true"
        tabIndex={-1}
      >
        {/* Background Image */}
        <img
          src={src}
          alt={alt}
          className={cn(
            "absolute inset-0 w-full h-full transition-opacity duration-500",
            fit === 'cover' && 'object-cover bg-center',
            fit === 'contain' && 'object-contain bg-center',
            fit === 'fill' && 'object-fill bg-center',
            shouldShowImage ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          decoding="async"
          fetchPriority="low"
        />

        {/* Loading state */}
        {!shouldShowImage && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 animate-pulse" />
        )}

        {/* Fallback state for error */}
        {imageError && fallback && (
          <div className="absolute inset-0">
            {fallback}
          </div>
        )}

        {/* Fallback gradient if no fallback provided */}
        {imageError && !fallback && (
          <div className="absolute inset-0 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900" />
        )}
      </div>
    );
  }
);

BackgroundLayer.displayName = 'BackgroundLayer';