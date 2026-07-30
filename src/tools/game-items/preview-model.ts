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

import type { AccessorySlot } from '@blobbi/react';

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
