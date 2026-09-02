import { LocationId } from '@/lib/location-types';

type BlobbiSize = "sm" | "md" | "lg" | "xl";

export const LOCATION_BLOBBI_SIZES: Partial<Record<LocationId, BlobbiSize>> = {
  'home': 'xl',
  'town': 'lg',
  'stage': 'xl',
  'arcade': 'xl',
  'arcade-1': 'lg',
  'arcade-minus1': 'lg',
  'beach': 'lg',
  'mine': 'xl',
  'plaza': 'lg',
  'plaza-inside': 'lg',
  'nostr-station': 'lg',
  'nostr-station-inside': 'lg',
  'back-yard': 'xl',
  'cave-open': 'xl',
  'clothing-store-inside': 'xl',
  'badges-store-inside': 'xl',
  'care-store-inside': 'xl',
  'furniture-store-inside': 'xl',
};

export function getBlobbiSizeForLocation(location: LocationId): BlobbiSize {
  return LOCATION_BLOBBI_SIZES[location] || 'lg';
}
