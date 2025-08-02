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
  'plaza': { x: 50, y: 75 },
  'arcade': { x: 50, y: 75 },
  'arcade-1': { x: 50, y: 63 },
  'arcade-minus1': { x: 50, y: 55 },
  'stage': { x: 50, y: 75 },
  'shop': { x: 50, y: 75 },
  'shop-open': { x: 50, y: 75 },
  'back-yard': { x: 50, y: 75 },
  'cave-open': { x: 50, y: 75 },
};

export function getBlobbiInitialPosition(location: LocationId): InitialPosition {
  const defaultPosition = LOCATION_INITIAL_POSITIONS[location] || { x: 50, y: 75 };

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

  return defaultPosition;
}
