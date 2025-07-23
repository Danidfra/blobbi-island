import React from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';

interface LocationIndicatorProps {
  className?: string;
}

// Map location IDs to display names
const LOCATION_NAMES: Record<LocationId, string> = {
  'town': 'Town Square',
  'home': 'Cozy Home',
  'beach': 'Sunny Beach',
  'mine': 'Crystal Mine',
  'nostr-station': 'Nostr Station',
  'plaza': 'Central Plaza',
  'arcade': 'Game Arcade',
  'stage': 'Performance Stage',
  'shop': 'Village Shop',
  'back-yard': 'Back Yard',
  'cave-open': 'Mining Cave',
};

export function LocationIndicator({ className }: LocationIndicatorProps) {
  const { currentLocation } = useLocation();
  const locationName = LOCATION_NAMES[currentLocation];

  return (
    <div className={cn(
      "bg-white/90 backdrop-blur-sm border border-border rounded-full",
      "px-4 py-2 shadow-lg",
      "transition-all duration-300 ease-out",
      className
    )}>
      <div className="flex items-center space-x-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-sm font-medium text-foreground">
          {locationName}
        </span>
      </div>
    </div>
  );
}