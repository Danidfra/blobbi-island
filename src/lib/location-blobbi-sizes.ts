import { LocationId } from '@/lib/location-types';

type BlobbiSize = "sm" | "md" | "lg" | "xl";

export const LOCATION_BLOBBI_SIZES: Partial<Record<LocationId, BlobbiSize>> = {
  'home': 'xl',
  'town': 'lg',
  'stage': 'xl',
  'beach': 'lg',
  'mine': 'lg',
  'plaza': 'lg',
  'nostr-station': 'lg',
  'back-yard': 'xl',
};

export function getBlobbiSizeForLocation(location: LocationId): BlobbiSize {
  return LOCATION_BLOBBI_SIZES[location] || 'lg';
}
