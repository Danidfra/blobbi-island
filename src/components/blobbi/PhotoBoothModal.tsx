import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MovableBlobbi, MovableBlobbiRef } from './MovableBlobbi';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBlobbiInitialPosition } from '@/lib/location-initial-position';
import { IconX } from '@tabler/icons-react';
import type { Blobbi } from '@/hooks/useBlobbis';

interface PhotoBoothModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBlobbi: Blobbi | null;
}

export function PhotoBoothModal({ isOpen, onClose, selectedBlobbi }: PhotoBoothModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalBlobbiRef = useRef<MovableBlobbiRef>(null);

  // Use centralized boundary system
  const backgroundFile = 'photo-booth-inside.png';
  const boundary = locationBoundaries[backgroundFile] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };
  const blobbiInitialPosition = getBlobbiInitialPosition(backgroundFile);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget && isOpen) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2"
      )}
      onClick={handleBackdropClick}
      style={{
        // Ensure this is positioned relative to the game container
        position: 'absolute',
      }}
    >
      {/* Photo Booth Container - Exact dimensions matching the image */}
      <div
        className="relative bg-transparent"
        style={{
          width: '470px',
          height: '705px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className={cn(
            "absolute top-2 right-2 z-50",
            "bg-white/80 hover:bg-white/90 backdrop-blur-sm rounded-full",
            "h-8 w-8 shadow-lg hover:shadow-xl",
            "transition-all duration-200 ease-out",
            "hover:scale-105 active:scale-95",
            "text-foreground hover:text-red-500",
            "flex items-center justify-center"
          )}
          title="Close Photo Booth"
          aria-label="Close Photo Booth"
        >
          <IconX className="w-3 h-3" />
        </button>

        {/* Photo Booth Background - Exact size */}
        <div ref={containerRef} className="relative w-full h-full">
          <img
            src="/assets/places/photo-booth-inside.png"
            alt="Photo Booth Interior"
            className="w-full h-full object-contain drop-shadow-2xl"
            style={{
              width: '470px',
              height: '705px',
            }}
          />

          {/* Movable Blobbi inside booth - increased size */}
          {selectedBlobbi && (
            <MovableBlobbi
              ref={internalBlobbiRef}
              containerRef={containerRef}
              boundary={boundary}
              isVisible={!!selectedBlobbi}
              initialPosition={blobbiInitialPosition}
              backgroundFile={backgroundFile}
              size="xl" // Increased size for modal
              scaleByYPosition={true}
            />
          )}

          {/* Optional: Visual indicator of walkable area (for debugging) */}
          {process.env.NODE_ENV === 'development' && boundary.shape === 'rectangle' && (
            <div
              className="absolute border-2 border-yellow-400 border-dashed opacity-50 pointer-events-none"
              style={{
                left: `${boundary.x[0]}%`,
                right: `${100 - boundary.x[1]}%`,
                top: `${boundary.y[0]}%`,
                bottom: `${100 - boundary.y[1]}%`,
              }}
            >
              <div className="absolute -top-6 left-0 text-yellow-400 text-xs">
                Walkable Area
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-white/95 backdrop-blur-sm border border-border rounded-full px-4 py-2 shadow-xl">
            <p className="text-xs text-muted-foreground text-center font-medium">
              📸 Click inside booth to move Blobbi • Press Esc or click outside to close
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}