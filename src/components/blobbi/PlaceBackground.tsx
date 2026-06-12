import React, { useState, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { VirtualWorld } from '@/components/shell/VirtualWorld';

interface PlaceBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

export const PlaceBackground = forwardRef<HTMLDivElement, PlaceBackgroundProps>(
  ({ children, className }, ref) => {
    const { currentLocation, isMapModalOpen } = useLocation();
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    const backgroundImageFile = getBackgroundForLocation(currentLocation);
    const backgroundImage = `/assets/places/${backgroundImageFile}`;
    const shouldShowImage = imageLoaded && !imageError;

    return (
      <div
        className={cn(
          "relative w-full h-full",
          // Apply blur when map modal is open
          isMapModalOpen && "blur-sm",
          "transition-all duration-300 ease-in-out",
          className
        )}
      >
        {/*
          Fixed virtual world coordinate space (1046×697), uniformly scaled to
          fit. The background image AND the clickable world surface both live
          inside it so every percent-positioned and px/rem-sized world object
          shares one consistent coordinate system. UI/HUD/dock/chat/modals are
          rendered outside this layer and do not scale as world objects.
        */}
        <VirtualWorld>
          {/* Background Image */}
          <>
            <img
              src={backgroundImage}
              alt={`${currentLocation} background`}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-500 pointer-events-none",
                shouldShowImage ? "opacity-100" : "opacity-0",
                currentLocation === "stage" ? 'bg-black' : '',
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />

            {/* Loading state for background image */}
            {!shouldShowImage && (
              <div className="absolute inset-0 bg-gradient-to-b from-sky-200 to-blue-300 animate-pulse" />
            )}
          </>

          {/* Clickable ground/surface layer (only this recebe data-world-surface) */}
          {/* Content */}
          <div
          ref={ref}
            className="relative z-10 w-full h-full"
            data-world-surface
          >
            {children}
          </div>
        </VirtualWorld>
      </div>
    );
  }
);

PlaceBackground.displayName = 'PlaceBackground';
