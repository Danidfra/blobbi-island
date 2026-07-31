/**
 * The tiny bit of translation the Blobbi accessory preview needs, kept pure.
 *
 * `content.visual.slot` is free text on the wire — an issuer may write anything
 * there, including a slot this renderer has never heard of. `@blobbi/react`
 * already has a documented answer for that case (`'unknown'`, which draws in
 * front rather than disappearing), so the mapping here is narrow on purpose: it
 * recognizes the slots the renderer draws and hands everything else to that
 * fallback rather than inventing a third behavior.
 */

import type { AccessorySlot, BlobbiRenderVisual } from '@blobbi/react';

/** The slots `@blobbi/react` knows how to place. */
export const RENDERABLE_ACCESSORY_SLOTS: readonly AccessorySlot[] = [
  'headwear',
  'eyewear',
  'back',
  'neckwear',
  'handheld',
  'face-mark',
  'aura',
  'color-overlay',
];

/**
 * Map a free-text `visual.slot` onto a renderer slot.
 *
 * Anything unrecognized becomes `'unknown'` — the package's documented
 * fallback, which renders the accessory instead of silently dropping it.
 */
export function toAccessorySlot(slot: string): AccessorySlot {
  return (RENDERABLE_ACCESSORY_SLOTS as readonly string[]).includes(slot)
    ? (slot as AccessorySlot)
    : 'unknown';
}

/**
 * The fixture Blobbi every preview tab stands on screen.
 *
 * Deliberately NOT the player's companion — a preview owns nothing and reads
 * nothing. Shared so the accessory tab and the effect tab cannot disagree about
 * what a Blobbi looks like, which would make it impossible to compare an item
 * against one.
 *
 * Lives here rather than beside the components because a component file that
 * also exports a constant loses fast refresh, and because this is plain data:
 * `BlobbiRenderVisual` is a TYPE, so this module's `@blobbi/react` import stays
 * type-only and the tools' domain layer stays free of the renderer.
 */
export const PREVIEW_VISUALS: Record<'baby' | 'adult', BlobbiRenderVisual> = {
  baby: {
    stage: 'baby',
    baseColor: '#8E6BE8',
    secondaryColor: '#B79CF2',
    eyeColor: '#3A2A1A',
    name: 'Preview Blobbi',
  },
  adult: {
    stage: 'adult',
    baseColor: '#F2A65A',
    secondaryColor: '#F7C88B',
    eyeColor: '#3A2A1A',
    name: 'Preview Blobbi',
  },
};
