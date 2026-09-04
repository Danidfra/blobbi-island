/**
 * The one-line "what is this for" a Care Store card shows under an item's name.
 *
 * Its own module so the shop component exports nothing but a component (React
 * Fast Refresh), and so the derivation can be tested without rendering a modal.
 */

import type { ItemEffects } from '@/inventory/catalog-fallback';

/** The stat words the store shows, in a fixed reading order. */
const EFFECT_LABELS: Record<keyof ItemEffects, string> = {
  hygiene: 'Hygiene',
  health: 'Health',
  happiness: 'Happiness',
  energy: 'Energy',
  hunger: 'Hunger',
};

const EFFECT_ORDER: (keyof ItemEffects)[] = [
  'hygiene',
  'health',
  'happiness',
  'energy',
  'hunger',
];

/**
 * The one-line "what is this for" under an item's name.
 *
 * Derived from the definition's own `effects` when it carries no `description`,
 * which is the case for all ten published care definitions today. Writing
 * blurbs here instead would be inventing product copy for protocol data the
 * issuer owns; a stat summary is the same fact the item will actually apply.
 */
export function careItemPurpose(
  description: string | null | undefined,
  effects: ItemEffects,
): string {
  if (description) return description;
  const parts = EFFECT_ORDER.flatMap((key) => {
    const value = effects[key];
    if (typeof value !== 'number' || value === 0) return [];
    return [`${EFFECT_LABELS[key]} ${value > 0 ? '+' : ''}${value}`];
  });
  return parts.length > 0 ? parts.join(' · ') : 'A Care Store item.';
}
