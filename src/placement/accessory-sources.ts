/**
 * Blobbi Island: artwork resolution for kind:31634 placements.
 *
 * The renderer's asset contract is a resolver that turns
 * `{ code, slot, url }` into an ordered list of candidate URLs. On the
 * placement path the `code` is the ITEM ADDRESS (`31632:<issuer>:<d>`), so this
 * resolver is a definition lookup and nothing else.
 *
 * WHAT CHANGED FROM THE LEGACY RESOLVER. The legacy chain
 * (`island-accessory-sources.ts`) ended in a filename convention: an accessory
 * with no published definition still drew, because its code doubled as a path
 * into `public/assets/.../accessories/`. There is deliberately no such fallback
 * here. An item identified by address either has a published definition that
 * says what it looks like, or Island does not draw it, inventing a path from
 * an address would resurrect exactly the guess-the-filename identity system
 * this migration removes.
 *
 * Synchronous and side-effect free, like the resolver it replaces: the
 * definitions are closed over at construction time, so a render never triggers
 * a fetch to decide what to paint.
 */

import type { AccessorySourceResolver } from '@blobbi/react';
import {
  dedupeImageSources,
  itemImageSourcesForView,
  type ItemImageView,
} from '@/inventory/item-image-resolution';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

export type { AccessorySourceRequest, AccessorySourceResolver } from '@blobbi/react';

export interface PlacementAccessorySourceOptions {
  /**
   * `31632:<issuer>:<d>` → the resolved official definition.
   *
   * Comes from `useItemCatalog`, which is the module that enforces issuer
   * trust. An address absent from this map resolves to no artwork.
   */
  definitionsByAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /**
   * Which way the Blobbi is turned. Only `front` and `back` exist, because only
   * front and back Blobbi artwork exists, a side-view hat over a front-facing
   * body looks worse than the primary image does.
   */
  facing?: ItemImageView;
}

/**
 * Build the placement artwork resolver.
 *
 * Candidate order, highest first, the same rules
 * `itemImageSourcesForView` already applies for the legacy path, so a cosmetic
 * looks identical whichever path drew it:
 *
 *   1. the requested pose's `image` view (`front` / `back` marker);
 *   2. the definition's primary (unmarked) image;
 *   3. when resolving `back`, the `front` view;
 *   4. the definition's first valid image.
 *
 * The result is de-duplicated and never contains an empty string: an empty
 * `src` is a request for the current page, and retrying a URL that just failed
 * only delays reaching one that works.
 */
export function createPlacementAccessorySourceResolver(
  options: PlacementAccessorySourceOptions,
): AccessorySourceResolver {
  const { definitionsByAddress, facing = 'front' } = options;

  return ({ code }) => {
    const definition = definitionsByAddress.get(code);
    if (!definition) return [];
    return dedupeImageSources(itemImageSourcesForView(definition, facing));
  };
}
