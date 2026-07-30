/**
 * Blobbi Island — context-specific selection among a definition's `image` tags.
 *
 * `@nostr-games/inventory@0.2.0` parses the repeatable kind:31632 `image` tag
 * into an ordered `GameItemImage[]` (URL + optional view marker) and answers ONE
 * question for us: which entry is the primary/default. Everything else — "which
 * picture does a compact inventory row want?", "which picture does a Blobbi seen
 * from behind want?" — is a Blobbi Island product decision, and lives here.
 *
 * This module is PURE: no React, no Nostr, no asset paths, no fetching. It takes
 * already-parsed images and returns plain URLs. That is what lets the accessory
 * adapter stay synchronous and lets `@blobbi/react` stay protocol-agnostic — the
 * renderer receives strings and never learns that a marker existed.
 *
 * TWO DISTINCT CONSUMERS, TWO DISTINCT POLICIES:
 *
 *   compact UI (inventory, shop, cards, lists) → {@link primaryItemImageUrl}
 *   a posed actor (front / back)               → {@link itemImageSourcesForView}
 *
 * The compact policy deliberately returns a SINGLE url: a list row that silently
 * swapped in the side view of a hat because the primary 404'd would misrepresent
 * the item. The posed policy returns an ORDERED, DE-DUPLICATED list, because the
 * renderer paints `sources[0]` and advances through the rest on `<img onError>`;
 * a missing pose asset should degrade to a usable picture rather than a hole.
 *
 * WHY SIDE/DIAGONAL ARE NOT SUBSTITUTED. `side-right`, `side-left`,
 * `diagonal-front-right` and `diagonal-front-left` are different CAMERA ANGLES,
 * not different qualities of the same angle. Dropping a side-view hat onto a
 * front-facing Blobbi is a worse answer than dropping the primary image on it,
 * so they are never chosen *as* a front or back view. They remain reachable
 * through the generic "first valid image" last resort — which exists only so an
 * item that ships nothing but, say, a diagonal view still renders something —
 * and through {@link itemImagesByMarker} for future work.
 */

import {
  getItemImageByMarker,
  getItemImagesByMarker,
  getPrimaryItemImage,
  type GameItemImage,
  type GameItemImageMarkerValue,
  type GameItemImageSource,
} from './package';

/**
 * The actor poses Blobbi Island can currently draw.
 *
 * Deliberately narrower than the spec's six markers: the renderer supports
 * exactly front and back (`CurrentBlobbiDisplay`'s `facing` prop), so this type
 * is the honest set of views an accessory can be *requested* for. Widening it
 * requires new Blobbi artwork, not a new marker.
 */
export type ItemImageView = 'front' | 'back';

/**
 * The subset of an item definition these helpers need.
 *
 * Structural on purpose, so both the package's `GameItemDefinition` and Island's
 * `ResolvedBlobbiItemDefinition` satisfy it, and so a test can pass a literal.
 * `image` is the flattened legacy field kept for compatibility; `images` is the
 * full collection and always wins when present.
 */
export interface ItemImageCandidate {
  readonly images?: readonly GameItemImage[];
  readonly image?: string;
}

/** A URL is usable only if it is a non-empty string once trimmed. */
function isUsableUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * Normalize a candidate to the shape the package helpers accept.
 *
 * Returns `undefined` when there is no image collection to reason about, which
 * is what makes every helper below safely tolerant of a legacy model that only
 * ever had a single flattened `image`.
 */
function imageSourceOf(
  candidate: ItemImageCandidate | null | undefined,
): GameItemImageSource | undefined {
  const images = candidate?.images;
  if (!images || images.length === 0) return undefined;
  return { images };
}

/**
 * The image a compact, non-posed UI should show: inventory grids, shop cards,
 * item detail headers, list rows, HUD chips.
 *
 * Resolution order (the package's rule, then Island's compatibility step):
 *   1. the first unmarked `image` tag — the published primary;
 *   2. the first valid `image` tag, when the item ships only marked views;
 *   3. the flattened legacy `image` field, for models with no collection;
 *   4. `undefined` — the caller renders its existing emoji/placeholder.
 *
 * Steps 1 and 2 are `getPrimaryItemImage` verbatim; Island does not restate
 * them. Step 2 is why "only marked images" is a valid definition rather than an
 * item with no picture.
 */
export function primaryItemImageUrl(
  candidate: ItemImageCandidate | null | undefined,
): string | undefined {
  const source = imageSourceOf(candidate);
  if (source) {
    const primary = getPrimaryItemImage(source);
    if (isUsableUrl(primary)) return primary;
  }
  return isUsableUrl(candidate?.image) ? candidate.image : undefined;
}

/**
 * Every image carrying `marker`, in tag order.
 *
 * Exposed so side/diagonal views stay REACHABLE while no actor pose consumes
 * them (see the module doc). Duplicate markers are preserved, not collapsed —
 * an issuer that published two `front` views published two `front` views.
 */
export function itemImagesByMarker(
  candidate: ItemImageCandidate | null | undefined,
  marker: GameItemImageMarkerValue,
): readonly GameItemImage[] {
  const source = imageSourceOf(candidate);
  if (!source) return [];
  return getItemImagesByMarker(source, marker);
}

/** The first image carrying `marker`, or `undefined`. */
export function itemImageByMarker(
  candidate: ItemImageCandidate | null | undefined,
  marker: GameItemImageMarkerValue,
): GameItemImage | undefined {
  const source = imageSourceOf(candidate);
  if (!source) return undefined;
  return getItemImageByMarker(source, marker);
}

/**
 * Drop unusable URLs and collapse repeats, keeping the FIRST occurrence.
 *
 * Both halves matter to the renderer's `<img onError>` chain: an empty `src` is
 * a request for the current page, and retrying a URL that just failed to load
 * only delays reaching a candidate that might work.
 */
export function dedupeImageSources(
  urls: readonly (string | undefined)[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!isUsableUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * The ordered candidate URLs for drawing an item on a Blobbi in a given pose.
 *
 * FRONT: `front` view → primary → first valid image.
 * BACK:  `back` view → primary → `front` view → first valid image.
 *
 * Back falls through to the front view before the generic last resort because a
 * back-mounted item that published only a front asset is far more likely to be
 * *drawable* from behind than an arbitrary first entry is. Front does not
 * reciprocate: an item that ships a `back` view and no `front` view is telling
 * us its front is the primary.
 *
 * Note the primary step already covers "first valid image" for an all-marked
 * definition (that is `getPrimaryItemImage`'s own fallback); the explicit last
 * resort is kept because it is the documented contract and because it also
 * covers a definition whose primary is unusable.
 *
 * Returns a de-duplicated list, possibly empty. An empty list is not a failure —
 * it means this item contributes nothing, and the caller appends its own
 * fallbacks (see `island-accessory-sources.ts`).
 */
export function itemImageSourcesForView(
  candidate: ItemImageCandidate | null | undefined,
  view: ItemImageView,
): readonly string[] {
  const source = imageSourceOf(candidate);
  const primary = primaryItemImageUrl(candidate);
  if (!source) return dedupeImageSources([primary]);

  const marked = (marker: GameItemImageMarkerValue) =>
    getItemImageByMarker(source, marker)?.url;
  const firstValid = source.images[0]?.url;

  const ordered =
    view === 'back'
      ? [marked('back'), primary, marked('front'), firstValid]
      : [marked('front'), primary, firstValid];

  return dedupeImageSources(ordered);
}
