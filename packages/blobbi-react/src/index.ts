/**
 * `@blobbi/react` — the portable Blobbi renderer.
 *
 * Everything reachable from this file renders a Blobbi from PLAIN, SERIALIZABLE
 * DATA: no relay, no query client, no router, no current user, no world
 * coordinates, no asset directory. Feed it a visual description and it draws;
 * that is the entire contract.
 *
 * The export list is written out by hand, one symbol at a time. There is no
 * `export *` anywhere in this package on purpose — a wildcard would make every
 * future internal helper public by accident, and `package-api.test.ts` asserts
 * this surface exactly, so growing it is a decision somebody makes rather than
 * something that happens.
 */

// ── The component ──────────────────────────────────────────────────────────
export { BlobbiRendererView, AccessoryLayerView } from './BlobbiRendererView';
export type { BlobbiRendererViewProps } from './BlobbiRendererView';

// ── Visual normalization ───────────────────────────────────────────────────
export {
  normalizeBlobbiRenderModel,
  normalizeInstanceId,
  DEFAULT_STAGE,
  DEFAULT_ADULT_TYPE,
  FALLBACK_INSTANCE_ID,
} from './blobbi-render-model';
export type {
  BlobbiRenderVisual,
  BlobbiRenderModel,
  BlobbiRenderModelInput,
  BlobbiRenderView,
} from './blobbi-render-model';

// ── The canonical box ──────────────────────────────────────────────────────
export {
  BLOBBI_RENDER_SIZE_PX,
  BLOBBI_RENDER_SIZE_CLASSES,
  ACCESSORY_BASE_RATIO,
  ACCESSORY_BASE_PERCENT,
  blobbiRenderSizePx,
  accessoryBasePx,
} from './blobbi-render-size';
export type { BlobbiRenderSize } from './blobbi-render-size';

// ── Accessories ────────────────────────────────────────────────────────────
export {
  normalizeAccessoryPlacements,
  ACCESSORY_SLOT_RANK,
} from './accessory-normalize';
export type {
  NormalizedAccessoryPlacement,
  NormalizeAccessoryOptions,
  AccessoryLayer,
} from './accessory-normalize';
export {
  REAR_VIEW_HIDDEN_SLOTS,
  DEFAULT_ACCESSORY_SOURCES,
} from './accessory-types';
export type {
  AccessorySlot,
  AccessoryPlacementInput,
  AccessorySourceRequest,
  AccessorySourceResolver,
} from './accessory-types';

// ── Rendering without React ────────────────────────────────────────────────
// The same SVG pipeline the component uses, for consumers that want a string:
// server-side thumbnails, canvas compositing, a non-React card.
export { loadBlobbiSvg } from './artwork/load-blobbi-svg';
export type { BlobbiView } from './svg';

// ── SVG post-processing (provisional) ──────────────────────────────────────
// Exported for consumers composing their own pipeline around `loadBlobbiSvg`.
// Provisional: these are string→string transforms over an artwork convention,
// and the convention may change with the artwork.
export { applyGazeMarkup, applyRearView, uniquifySvgIds } from './svg';
