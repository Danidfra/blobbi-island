import { LocationId } from '@/lib/location-types';

export const LOCATION_BACKGROUNDS: Record<LocationId, string> = {
  'town': 'town-open.png',
  'home': 'home-inside.png',
  'beach': 'beach-open.png',
  'mine': 'mine-open.png',
  'nostr-station': 'nostr-station-open.png',
  'plaza': 'plaza-open.png',
  'plaza-inside': 'plaza-inside.png',
  'arcade': 'arcade-inside.png',
  'arcade-1': 'arcade-1.png',
  'arcade-minus1': 'arcade-minus1.png',
  'stage': 'stage-inside.png',
  'shop': 'shopping-mall-inside.png',
  'back-yard': 'back-yard-open.png',
  'cave-open': 'cave-inside.png',
};

export function getBackgroundForLocation(location: LocationId): string {
  return LOCATION_BACKGROUNDS[location] || 'town-open.png';
}
