import { LocationId } from '@/lib/location-types';

export const LOCATION_BACKGROUNDS: Record<LocationId, string> = {
  'town': 'town-open.png',
  'home': 'home-open.png',
  'beach': 'beach-open.png',
  'mine': 'mine-open.png',
  'nostr-station': 'nostr-station-open.png',
  'plaza': 'plaza-open.png',
  'arcade': 'town-open.png',
  'stage': 'town-open.png',
  'shop': 'town-open.png',
};

export function getBackgroundForLocation(location: LocationId): string {
  return LOCATION_BACKGROUNDS[location] || 'town-open.png';
}
