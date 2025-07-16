import React, { useRef } from 'react';
import { PlaceBackground } from './PlaceBackground';
import { MapButton } from './MapButton';
import { MovableBlobbi } from './MovableBlobbi';
import { LocationIndicator } from './LocationIndicator';
import { CurrentBlobbiDisplay } from './CurrentBlobbiDisplay';
import { useLocation } from '@/hooks/useLocation';
import { locationBoundaries } from '@/lib/location-boundaries';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import type { Blobbi } from '@/hooks/useBlobbis';

interface PlayingViewProps {
  selectedBlobbi: Blobbi | null;
  onSwitchBlobbi: () => void;
}

export function PlayingView({ selectedBlobbi, onSwitchBlobbi }: PlayingViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { currentLocation } = useLocation();

  const background = getBackgroundForLocation(currentLocation);
  const boundary = locationBoundaries[background] || {
    shape: 'rectangle',
    x: [0, 100],
    y: [60, 100],
  };

  return (
    <PlaceBackground ref={containerRef}>
      {/* Movable Blobbi Character */}
      <MovableBlobbi
        containerRef={containerRef}
        boundary={boundary}
        isVisible={!!selectedBlobbi}
      />

      {/* Map Button - Top Right */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
        <MapButton />
      </div>

      {/* Current Location Indicator - Top Center */}
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 sm:top-4 z-20">
        <LocationIndicator />
      </div>

      {/* Current Blobbi Info - Top Left */}
      <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20">
        <div className="bg-white/90 backdrop-blur-sm border border-border rounded-lg p-2 sm:p-3 shadow-lg">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <CurrentBlobbiDisplay
              size="sm"
              className="border-2 border-primary/30"
              showFallback={true}
              interactive={true}
              onClick={onSwitchBlobbi}
            />
            <div className="text-left">
              <p className="text-xs sm:text-sm font-medium text-foreground">
                {selectedBlobbi?.name || selectedBlobbi?.id}
              </p>
              <button
                onClick={onSwitchBlobbi}
                className="text-xs text-primary hover:underline"
              >
                Switch Blobbi
              </button>
            </div>
          </div>
        </div>
      </div>
    </PlaceBackground>
  );
}