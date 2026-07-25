import { ASSET_DIRS } from '@/lib/asset-paths';

/**
 * Selectable Blobbi portrait backdrops, keyed by the background id stored on the pet.
 * Keys are data identifiers and must match the asset filenames.
 */
export const BLOBBI_BACKGROUNDS: Record<string, string> = {
  'blobbi-bg-default': `${ASSET_DIRS.blobbiBackgrounds}/blobbi-bg-default.png`,
};

export function getBlobbiBackground(key: string): string {
  return BLOBBI_BACKGROUNDS[key] || '';
}
