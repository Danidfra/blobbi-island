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
  'arcade-1': { x: 50, y: 75 },
  'arcade-minus1': { x: 50, y: 75 },
  'stage': { x: 50, y: 75 },
  'shop': { x: 50, y: 75 },
  'back-yard': { x: 50, y: 75 },
  'cave-open': { x: 50, y: 75 },
};

export function getBlobbiInitialPosition(location: LocationId): InitialPosition {
  return LOCATION_INITIAL_POSITIONS[location] || { x: 50, y: 75 };
}
