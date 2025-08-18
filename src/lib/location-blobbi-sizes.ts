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
  'back-yard': 'xl',
  'cave-open': 'xl',
};

export function getBlobbiSizeForLocation(location: LocationId): BlobbiSize {
  return LOCATION_BLOBBI_SIZES[location] || 'lg';
}
