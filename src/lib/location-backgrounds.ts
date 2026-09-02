import { LocationId } from '@/lib/location-types';

export const LOCATION_BACKGROUNDS: Record<LocationId, string> = {
  'town': 'town-open.webp',
  'home': 'home-inside.png',
  'beach': 'beach-open.webp',
  'mine': 'mine-open.webp',
  'nostr-station': 'nostr-station-open.webp',
  'nostr-station-inside': 'nostr-station-inside.png',
  'plaza': 'plaza-open.webp',
  'plaza-inside': 'plaza-inside.png',
  'arcade': 'arcade-inside.png',
  'arcade-1': 'arcade-1.png',
  'arcade-minus1': 'arcade-minus1.png',
  'stage': 'stage-inside.png',
  'shop': 'shopping-mall-inside.png',
  'back-yard': 'back-yard-open.webp',
  'cave-open': 'cave-inside.png',
  'clothing-store-inside': 'clothing-store.webp',
  'badges-store-inside': 'badges-store-inside.webp',
  'care-store-inside': 'care-store-inside.webp',
};

export function getBackgroundForLocation(location: LocationId): string {
  return LOCATION_BACKGROUNDS[location] || 'town-open.webp';
}
