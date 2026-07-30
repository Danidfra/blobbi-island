/**
 * ISLAND ASSET ADAPTER for accessory images.
 *
 * This is the ONE module in the accessory rendering path that knows Blobbi
 * Island's public asset layout (`/assets/characters/blobbi/accessories/...`)
 * and its remote URL convention. Everything downstream — `accessory-normalize`,
 * `BlobbiRendererView`, `AccessoryLayerView` — consumes an already-resolved
 * list of candidate URLs and never builds a path itself.
 *
 * Why it is its own file, and why it stayed in Island when the renderer moved
 * to `@blobbi/react`: the package must not require a consumer to mirror this
 * repository's `public/` tree. `@blobbi/react` ships a neutral default
 * (`DEFAULT_ACCESSORY_SOURCES` — "use the URL you were given"); Island passes
 * the resolver below instead, and nothing else in the pipeline changes.
 *
 * Deliberately synchronous and side-effect free: resolution is pure string
 * building, so it stays testable outside a browser and outside React.
 */
import type { AccessorySourceResolver } from '@blobbi/react';
import { accessoryImagePath } from '@/lib/asset-paths';
import { generateAccessoryUrl } from './accessory-utils';

export type { AccessorySourceRequest, AccessorySourceResolver } from '@blobbi/react';

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
