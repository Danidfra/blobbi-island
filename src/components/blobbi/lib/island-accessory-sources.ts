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
 * It is now ALSO the join point between published kind:31632 artwork and the
 * historical filename convention. The package's contract is unchanged — a
 * resolver still receives only `{ code, slot, url }` and still returns plain
 * strings — so the definition lookup is CLOSED OVER at construction time rather
 * than passed through the request. That is what keeps item definitions,
 * addresses and view markers on the Island side of the boundary: the renderer
 * receives URLs and cannot tell whether one came from a relay or from
 * `public/`.
 *
 * Deliberately synchronous and side-effect free: resolution is pure string
 * building, so it stays testable outside a browser and outside React, and a
 * render never triggers a fetch to decide what to draw.
 */
import type { AccessorySourceResolver } from '@blobbi/react';
import { accessoryImagePath } from '@/lib/asset-paths';
import {
  dedupeImageSources,
  itemImageSourcesForView,
  type ItemImageCandidate,
  type ItemImageView,
} from '@/inventory/item-image-resolution';
import { generateAccessoryUrl } from './accessory-utils';

export type { AccessorySourceRequest, AccessorySourceResolver } from '@blobbi/react';

export interface IslandAccessorySourceOptions {
  /**
   * Accessory code → the item definition describing it, when one is published.
   *
   * Built by `accessoryDefinitionsByCode` (see
   * `src/inventory/accessory-item-identity.ts`), which is the module that owns
   * issuer trust. An absent or empty map means "no accessory has a definition",
   * which is the situation today and resolves to the legacy chain alone.
   */
  definitionsByCode?: ReadonlyMap<string, ItemImageCandidate>;
  /**
   * Which way the Blobbi wearing these accessories is turned.
   *
   * Only front and back exist, because only front and back Blobbi artwork
   * exists. Side and diagonal `image` markers are parsed and preserved but are
   * never requested here — see `item-image-resolution.ts` for why substituting
   * a different camera angle is worse than falling back to the primary image.
   */
  facing?: ItemImageView;
}

/**
 * Build Blobbi Island's accessory source resolver.
 *
 * FULL PRIORITY ORDER, highest first:
 *
 *   1. the requested pose's `image` view from the item definition
 *      (`front`/`back` marker);
 *   2. the definition's primary image;
 *   3. when resolving `back` and nothing better exists, the definition's
 *      `front` view;
 *   4. the definition's first valid image (covers an item that ships only, say,
 *      a diagonal view);
 *   5. the URL stored on the equip tag, or — only when there is none — the
 *      generated remote URL for the code;
 *   6. the local `.webp` asset;
 *   7. the local `.png` asset.
 *
 * Steps 1-4 are `itemImageSourcesForView`; steps 5-7 are the historical chain,
 * unchanged and in its original order. PUBLISHED ARTWORK OUTRANKS INFERRED
 * PATHS: an issuer that says what a hat looks like is a better authority than a
 * filename guess, and an accessory with no definition (every accessory today)
 * behaves exactly as it did before.
 *
 * Step 5 keeps the legacy `url || generated` pairing rather than listing both.
 * Appending the generated URL after a stored one would add a network retry that
 * never used to happen, which is a behavior change disguised as a fallback.
 *
 * The result is non-empty-only and de-duplicated: an empty `src` is a request
 * for the current page, and re-trying a URL that just failed only delays
 * reaching one that works.
 */
export function createIslandAccessorySourceResolver(
  options: IslandAccessorySourceOptions = {},
): AccessorySourceResolver {
  const { definitionsByCode, facing = 'front' } = options;

  return ({ code, slot, url }) => {
    const definition = definitionsByCode?.get(code);
    const fromDefinition = definition
      ? itemImageSourcesForView(definition, facing)
      : [];

    return dedupeImageSources([
      ...fromDefinition,
      url || generateAccessoryUrl(code) || '',
      accessoryImagePath(slot, code, 'webp'),
      accessoryImagePath(slot, code, 'png'),
    ]);
  };
}

/**
 * The default resolver: front-facing, no item definitions — i.e. the historical
 * chain exactly (stored/derived URL → local `.webp` → local `.png` → nothing).
 *
 * Kept as a named export because plenty of call sites (previews, tests, tools)
 * genuinely have no catalog and no pose to speak of, and should not have to
 * construct one to ask "where does this accessory's picture live?".
 */
export const islandAccessorySources: AccessorySourceResolver =
  createIslandAccessorySourceResolver();
