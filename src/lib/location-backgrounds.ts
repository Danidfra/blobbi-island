import { LocationId } from '@/lib/location-types';

export const LOCATION_BACKGROUNDS: Record<LocationId, string> = {
  'town': 'town-open.png',
  'home': 'home-open.png',
  'beach': 'beach-open.png',
  'mine': 'mine-open.png',
  'nostr-station': 'nostr-station-open.png',
  'plaza': 'plaza-open.png',
  'plaza-inside': 'plaza-inside.png',
  'arcade': 'arcade-open.png',
  'arcade-1': 'arcade-1.png',
  'arcade-minus1': 'arcade-minus1.png',
  'stage': 'stage-open.png',
  'shop': 'shop-open.png',
  'back-yard': 'back-yard-open.png',
  'cave-open': 'cave-open.png',
};

export function getBackgroundForLocation(location: LocationId): string {
  return LOCATION_BACKGROUNDS[location] || 'town-open.png';
}
