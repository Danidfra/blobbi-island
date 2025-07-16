import React, { useState, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';

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
        ref={ref}
        className={cn(
          "relative w-full h-full",
          // Apply blur when map modal is open
          isMapModalOpen && "blur-sm",
          "transition-all duration-300 ease-in-out",
          className
        )}
      >
        {/* Background Image */}
        <>
          <img
            src={backgroundImage}
            alt={`${currentLocation} background`}
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
              shouldShowImage ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            draggable={false}
          />

          {/* Loading state for background image */}
          {!shouldShowImage && (
            <div className="absolute inset-0 bg-gradient-to-b from-sky-200 to-blue-300 animate-pulse" />
          )}
        </>

        {/* Content */}
        <div className="relative z-10 w-full h-full">
          {children}
        </div>
      </div>
    );
  }
);

PlaceBackground.displayName = 'PlaceBackground';
