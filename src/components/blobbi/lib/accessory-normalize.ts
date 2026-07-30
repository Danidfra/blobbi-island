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
 * refw/refh: every writer in this repository pins them to 100
 * (`AccessoryEditPanel`, `AccessoryInventoryUI`, `DebugAccessoriesModal`), and
 * `blobbi-types.ts` documents the tag with `"refw","100","refh","100"` — i.e.
 * they name the 0-100 reference space the percentages are already expressed
 * in. They are therefore parsed and round-tripped for compatibility but apply
 * NO runtime conversion (see docs/blobbi-renderer-contract.md §refw/refh).
 */

import type { AccessorySlot, EquipmentConfig } from './accessory-types';
import { REAR_VIEW_HIDDEN_SLOTS } from './accessory-types';
import { generateAccessoryUrl } from './accessory-utils';

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
  imageUrl: string;
}

function slotRank(slot: AccessorySlot): number {
  return ACCESSORY_SLOT_RANK[slot] ?? UNKNOWN_SLOT_RANK;
}

/**
 * Normalize equipped accessories into deterministic render order.
 *
 * Ordering NEVER depends on input (relay tag) order: placements sort by
 * (layerRank, code), so the same equipment set always paints identically.
 * Rear view drops the face-only slots ({@link REAR_VIEW_HIDDEN_SLOTS}),
 * exactly as before.
 */
export function normalizeAccessoryPlacements(
  equipment: readonly EquipmentConfig[] | undefined,
  options: { facing?: 'front' | 'back' } = {},
): NormalizedAccessoryPlacement[] {
  const facing = options.facing ?? 'front';

  return (equipment ?? [])
    .filter((item) => facing !== 'back' || !REAR_VIEW_HIDDEN_SLOTS.has(item.slot))
    .map((item): NormalizedAccessoryPlacement => {
      const rank = slotRank(item.slot);
      return {
        id: item.code,
        code: item.code,
        slot: item.slot,
        layer: rank < 0 ? 'behind' : 'front',
        layerRank: rank,
        xPercent: item.x,
        yPercent: item.y,
        scale: item.scale,
        rotationDeg: item.rot,
        flipX: item.flipX,
        imageUrl: item.url || generateAccessoryUrl(item.code) || '',
      };
    })
    .sort((a, b) => a.layerRank - b.layerRank || a.code.localeCompare(b.code));
}
