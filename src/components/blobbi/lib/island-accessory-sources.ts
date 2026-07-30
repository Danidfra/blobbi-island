/**
 * ISLAND ASSET ADAPTER for accessory images.
 *
 * This is the ONE module in the accessory rendering path that knows Blobbi
 * Island's public asset layout (`/assets/characters/blobbi/accessories/...`)
 * and its remote URL convention. Everything downstream — `accessory-normalize`,
 * `BlobbiRendererView`, `AccessoryLayerView` — consumes an already-resolved
 * list of candidate URLs and never builds a path itself.
 *
 * Why it is its own file: a future `@blobbi/react` package must not require a
 * consumer to mirror this repository's `public/` tree. Extraction replaces this
 * default with the consumer's own {@link AccessorySourceResolver} (or with
 * "just use the stored `url`"); nothing else in the pipeline moves.
 *
 * Deliberately synchronous and side-effect free: resolution is pure string
 * building, so it stays testable outside a browser and outside React.
 */
import { accessoryImagePath } from '@/lib/asset-paths';
import { generateAccessoryUrl } from './accessory-utils';
import type { AccessorySlot } from './accessory-types';

/** Everything a resolver may use to locate an accessory's artwork. */
export interface AccessorySourceRequest {
  /** Accessory code as published in the equip tag (e.g. `headwear-8`). */
  code: string;
  slot: AccessorySlot;
  /** The URL stored on the equip tag, if any. */
  url?: string;
}

/**
 * Maps an accessory to an ordered list of candidate image URLs: the first is
 * painted, each later entry is tried in order if the previous one fails to
 * load. An empty list renders no image.
 */
export type AccessorySourceResolver = (
  request: AccessorySourceRequest,
) => readonly string[];

/**
 * Blobbi Island's resolver, and the historical fallback chain exactly:
 * stored/derived URL → local `.webp` → local `.png` → nothing.
 */
export const islandAccessorySources: AccessorySourceResolver = ({ code, slot, url }) => {
  const primary = url || generateAccessoryUrl(code) || '';
  const candidates = [
    primary,
    accessoryImagePath(slot, code, 'webp'),
    accessoryImagePath(slot, code, 'png'),
  ];
  // Non-empty and de-duplicated: retrying a URL that just failed is pointless,
  // and an empty `src` is a request for the current page.
  return Array.from(new Set(candidates.filter((candidate) => candidate.length > 0)));
};
