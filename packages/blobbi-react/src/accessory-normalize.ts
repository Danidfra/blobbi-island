/**
 * Pure accessory normalization: raw equipped accessory data → render-ready
 * placements in the canonical renderer-box coordinate space.
 *
 * This is the boundary between "how equipment is stored/parsed" and "what the
 * renderer paints". The DOM renderer (`BlobbiRendererView` /
 * `AccessoryLayerView`) consumes ONLY `NormalizedAccessoryPlacement` — it does
 * not know about tags, parsing defaults, refw/refh, or which hook supplied the
 * data.
 *
 * Coordinates: `xPercent`/`yPercent` are percentages (0-100) of the canonical
 * renderer box, measured to the accessory's center — the same box the body SVG
 * fills (see `blobbi-render-size.ts`).
 *
 * Reference dimensions: consumers whose storage format carries a "reference
 * width/height" alongside the coordinates (Blobbi Island's equip tags do) keep
 * that field to themselves. This package defines x/y as percentages of the
 * renderer box and applies NO reference-space conversion, so a placement means
 * the same thing in an editor, in a world and in a static preview.
 */

import type {
  AccessoryPlacementInput,
  AccessorySlot,
  AccessorySourceResolver,
} from './accessory-types';
import { DEFAULT_ACCESSORY_SOURCES, REAR_VIEW_HIDDEN_SLOTS } from './accessory-types';

/** Which side of the body an accessory paints on. */
export type AccessoryLayer = 'behind' | 'front';

/**
 * Deterministic paint order per slot — lower ranks paint first (further back).
 * The body sits at rank 0: negative ranks paint BEHIND the body, positive in
 * front of it.
 *
 * Derived from the real slot semantics (`accessory-types.ts`):
 *  - `aura` is a radial glow around the whole body → furthest back;
 *  - `back` (wings/capes) is explicitly back-mounted → behind the body;
 *  - face layers stack naturally: neckwear under face-mark under eyewear
 *    under headwear; `handheld` is held in front of everything;
 *  - `unknown` is the documented fallback for unrecognized/legacy codes: it
 *    paints in FRONT (above known front slots) so an unknown accessory is
 *    never silently hidden behind the body;
 *  - `color-overlay` is a tint and paints on top of everything.
 */
export const ACCESSORY_SLOT_RANK: Record<AccessorySlot, number> = {
  aura: -20,
  back: -10,
  // body renders at rank 0
  neckwear: 10,
  'face-mark': 20,
  eyewear: 30,
  headwear: 40,
  handheld: 50,
  unknown: 60,
  'color-overlay': 70,
};

/** Fallback rank for a slot value missing from the map (future slot types). */
const UNKNOWN_SLOT_RANK = ACCESSORY_SLOT_RANK.unknown;

/** Render-ready accessory placement in renderer-box coordinates. */
export interface NormalizedAccessoryPlacement {
  /** Stable identity (the accessory code — unique per equipped item). */
  id: string;
  code: string;
  slot: AccessorySlot;
  layer: AccessoryLayer;
  /** Absolute paint rank (see {@link ACCESSORY_SLOT_RANK}); body is 0. */
  layerRank: number;
  /** Center x as a percentage (0-100) of the renderer box. */
  xPercent: number;
  /** Center y as a percentage (0-100) of the renderer box. */
  yPercent: number;
  /** The accessory's own scale, multiplied onto the base ratio. */
  scale: number;
  rotationDeg: number;
  flipX: boolean;
  /** The URL painted first. Equal to `sources[0]` whenever a source exists. */
  imageUrl: string;
  /**
   * Ordered candidate image URLs (see {@link AccessorySourceResolver}): the
   * renderer paints the first and advances on load failure. Pre-resolved here
   * so the DOM renderer never builds an asset path itself.
   */
  sources: readonly string[];
}

function slotRank(slot: AccessorySlot): number {
  return ACCESSORY_SLOT_RANK[slot] ?? UNKNOWN_SLOT_RANK;
}

/**
 * Guards for numbers that reach CSS. Stored equipment is external data (relay
 * tags, and a drag editor that does its own arithmetic), so a missing, NaN or
 * Infinite value must resolve to something renderable rather than emit
 * `left: NaN%` / `scale(Infinity)` — which browsers drop, silently teleporting
 * or erasing an accessory.
 */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Scale additionally rejects zero/negative: both make the accessory invisible. */
function positiveScaleOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface NormalizeAccessoryOptions {
  facing?: 'front' | 'back';
  /**
   * How an accessory maps to image URLs. Defaults to
   * {@link DEFAULT_ACCESSORY_SOURCES} — "use the URL you gave me" — because a
   * package that guessed a directory layout would force every consumer to
   * mirror somebody else's `public/` tree.
   */
  resolveSources?: AccessorySourceResolver;
}

/**
 * Normalize equipped accessories into deterministic render order.
 *
 * Ordering NEVER depends on input (relay tag) order: placements sort by
 * (layerRank, code), so the same equipment set always paints identically.
 * Rear view drops the face-only slots ({@link REAR_VIEW_HIDDEN_SLOTS}),
 * exactly as before.
 *
 * Numeric fields are guaranteed finite on the way out (see {@link finiteOr}),
 * so a placement can never produce broken CSS.
 */
export function normalizeAccessoryPlacements(
  equipment: readonly AccessoryPlacementInput[] | undefined,
  options: NormalizeAccessoryOptions = {},
): NormalizedAccessoryPlacement[] {
  const facing = options.facing ?? 'front';
  const resolveSources = options.resolveSources ?? DEFAULT_ACCESSORY_SOURCES;

  return (equipment ?? [])
    .filter((item) => facing !== 'back' || !REAR_VIEW_HIDDEN_SLOTS.has(item.slot))
    .map((item): NormalizedAccessoryPlacement => {
      const rank = slotRank(item.slot);
      const sources = resolveSources({ code: item.code, slot: item.slot, url: item.url });
      return {
        id: item.code,
        code: item.code,
        slot: item.slot,
        layer: rank < 0 ? 'behind' : 'front',
        layerRank: rank,
        // Centered in the box is the only neutral answer for a broken
        // coordinate: visible, obviously wrong, and never off-screen.
        xPercent: finiteOr(item.x, 50),
        yPercent: finiteOr(item.y, 50),
        scale: positiveScaleOr(item.scale, 1),
        rotationDeg: finiteOr(item.rot, 0),
        flipX: !!item.flipX,
        imageUrl: sources[0] ?? '',
        sources,
      };
    })
    .sort((a, b) => a.layerRank - b.layerRank || a.code.localeCompare(b.code));
}
