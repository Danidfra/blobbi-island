import { LocationId } from '@/lib/location-types';

export interface InitialPosition {
  x: number;
  y: number;
}

export const LOCATION_INITIAL_POSITIONS: Record<LocationId, InitialPosition> = {
  'town': { x: 50, y: 75 },
  'home': { x: 50, y: 75 },
  'beach': { x: 50, y: 75 },
  'mine': { x: 50, y: 75 },
  'nostr-station': { x: 50, y: 75 },
  'nostr-station-inside': { x: 50, y: 85 },
  'plaza': { x: 50, y: 75 },
  'plaza-inside': { x: 50, y: 43 },
  'arcade': { x: 50, y: 75 },
  'arcade-1': { x: 50, y: 63 },
  'arcade-minus1': { x: 50, y: 55 },
  'stage': { x: 50, y: 75 },
  'shop': { x: 50, y: 90 },
  'back-yard': { x: 50, y: 75 },
  'cave-open': { x: 50, y: 75 },
  'clothing-store-inside': { x: 50, y: 80 },
};

/**
 * Maps a child location to the position near its door on the parent location.
 * Key format: "parentLocation:childLocation" → position near the child's door on the parent map.
 * Used when exiting a room so the blobbi appears near the door they just came out of,
 * instead of the default center position.
 */
const EXIT_POSITIONS: Record<string, InitialPosition> = {
  // Exiting to town from various rooms
  'town:arcade': { x: 32, y: 68 },
  'town:stage': { x: 58, y: 65 },
  'town:shop': { x: 68, y: 68 },

  // Exiting to nostr-station area from nostr-station-inside
  'nostr-station:nostr-station-inside': { x: 80, y: 40 },

  // Exiting to plaza from plaza-inside
  'plaza:plaza-inside': { x: 50, y: 60 },

  // Exiting to shop (mall) from clothing-store-inside
  'shop:clothing-store-inside': { x: 55, y: 40 },

  // Exiting to mine from cave-open
  'mine:cave-open': { x: 50, y: 70 },

  // Exiting to home from back-yard
  'home:back-yard': { x: 78, y: 75 },
};

export function getBlobbiInitialPosition(location: string, previousLocation?: string | null): InitialPosition {
  // If we have a previous location, try to find an exit position near the door
  if (previousLocation) {
    const exitKey = `${location}:${previousLocation}`;
    const exitPosition = EXIT_POSITIONS[exitKey];
    if (exitPosition) {
      return exitPosition;
    }
  }

  const defaultPosition = LOCATION_INITIAL_POSITIONS[location as LocationId] || { x: 50, y: 75 };

  if (location === 'arcade') {
    const hasArcadePass = sessionStorage.getItem('has-arcade-pass') === 'true';
    if (hasArcadePass) {
      // Player has the arcade pass, set initial position near the elevator
      return { x: 50, y: 48 };
    } else {
      // Player does not have the arcade pass, set initial position near the ticket booth
      return { x: 50, y: 75 };
    }
  }

  // Handle modal backgrounds (like photo-booth-inside.png)
  if (location === 'photo-booth-inside.png') {
    // Place Blobbi at bottom-center of the booth walkable area
    return { x: 45, y: 60 };
  }

  return defaultPosition;
}
