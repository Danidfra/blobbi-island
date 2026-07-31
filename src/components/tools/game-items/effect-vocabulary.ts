/**
 * The effect ids the Item Studio offers, read from the renderer.
 *
 * WHY THIS LIVES IN THE COMPONENT LAYER. `src/tools/game-items/` is the
 * studio's pure domain layer: form model, event conversion, validation. It must
 * not import `@blobbi/react`, because that would put React — and 230 kB of
 * artwork — in the middle of event building, a boundary
 * `src/tools/game-items/boundaries.test.ts` enforces. Suggestions and
 * autofill are UI, so they belong here, where the renderer is already a
 * dependency.
 *
 * What the domain layer keeps is the part it can decide alone: the four effect
 * SLOT names, which are item-format vocabulary rather than renderer internals
 * (`EFFECT_SLOT_SUGGESTIONS`, with a drift test against this package).
 *
 * Nothing here gates a publication. An effect id this client does not implement
 * is valid to publish — another client may draw it — so the studio offers what
 * it knows, reports what it does not, and never refuses.
 */

import {
  BLOBBI_VISUAL_EFFECT_IDS,
  EFFECT_SLOTS,
  isBlobbiVisualEffectId,
} from '@blobbi/react';

/** Effect ids `@blobbi/react` currently implements. Suggestions, not a gate. */
export const EFFECT_ID_SUGGESTIONS: readonly string[] = [
  ...BLOBBI_VISUAL_EFFECT_IDS,
];

/**
 * The slot an implemented effect occupies, or `''` for an id this client does
 * not implement.
 *
 * Used to fill `effectSlot` in when the author picks a known effect. An unknown
 * id is answered with `''` rather than a guess: inventing a slot for an effect
 * nobody implements would publish a claim this repository cannot honour.
 */
export function slotForEffectId(effectId: string): string {
  const id = effectId.trim();
  return isBlobbiVisualEffectId(id) ? EFFECT_SLOTS[id] : '';
}

/** Does this client implement the named effect? */
export function isImplementedEffectId(effectId: string): boolean {
  return isBlobbiVisualEffectId(effectId.trim());
}

// --- Previewing an effect this client does not implement --------------------

/**
 * A STAND-IN for an effect id this client cannot draw.
 *
 * An author may legitimately publish an effect a newer client knows and this
 * one does not — the studio never refuses that. But answering "what does it
 * look like?" with an empty box is the worst of both worlds: it looks like a
 * broken item rather than an unimplemented one.
 *
 * So an unknown id borrows a real effect from its DECLARED SLOT and is labelled
 * as an approximation. That is honest about the two things the author can
 * actually act on — where the effect will sit, and that this client will draw
 * nothing for it — without inventing a second rendering engine to be wrong in
 * a new way. It is `effectSlot` that decides, which is exactly what the slot is
 * for.
 */
/**
 * A `Map`, not an object literal. `effectSlot` comes off a relay, and
 * `'__proto__' in {…}` is `true` for every plain object — an object-literal
 * lookup would answer `effectSlot: "__proto__"` with `Object.prototype` and
 * hand a non-string "effect id" to the renderer. A `Map` has no inherited keys,
 * so the hazard does not exist rather than being guarded against.
 */
export const SLOT_PLACEHOLDER_EFFECTS: ReadonlyMap<string, string> = new Map([
  // Motes in the air around the character.
  ['ambient-particles', 'golden-sparkles'],
  // Atmosphere pooling at the feet.
  ['ground-local', 'mystic-fog'],
  // Something happening ON the silhouette.
  ['body-overlay', 'pixel-glitch'],
  // A luminous field behind the whole body.
  ['aura', 'celestial-aura'],
]);

/** Is this one of the four slots a stand-in can be chosen for? */
export function isPlaceholderSlot(slot: string): boolean {
  return SLOT_PLACEHOLDER_EFFECTS.has(slot.trim());
}

/**
 * The slot used when a definition declares an effect this client cannot draw
 * and names no slot either. Ambient particles read as "an effect is here"
 * without implying a halo or a fog bank the item may not have.
 */
export const DEFAULT_PLACEHOLDER_SLOT = 'ambient-particles';

export interface EffectPreviewResolution {
  /** The effect id to actually render, or `null` to render nothing. */
  renderId: string | null;
  /** Is `renderId` the effect the item names, or a stand-in for its slot? */
  kind: 'implemented' | 'placeholder' | 'none';
  /** The slot the preview is standing in for, when it is a placeholder. */
  placeholderSlot: string | null;
}

/**
 * Decide what the preview should draw for a declared effect.
 *
 * The ONE resolver every preview surface uses, so a draft, an import, a loaded
 * event and live form state cannot disagree — they are all just two strings by
 * the time they reach here.
 *
 * `effect` is the canonical source. `effectSlot` is consulted only to choose a
 * stand-in, never to identify the effect itself.
 */
export function resolveEffectPreview(
  effect: string,
  effectSlot: string,
): EffectPreviewResolution {
  const id = effect.trim();
  if (isBlobbiVisualEffectId(id)) {
    return { renderId: id, kind: 'implemented', placeholderSlot: null };
  }

  const declaredSlot = effectSlot.trim();
  // An effect named by NEITHER an id nor a slot is not yet an effect: the
  // author has opened the editor and typed nothing. Drawing a stand-in for that
  // would be inventing an item.
  if (id === '' && declaredSlot === '') {
    return { renderId: null, kind: 'none', placeholderSlot: null };
  }

  const slot = isPlaceholderSlot(declaredSlot)
    ? declaredSlot
    : DEFAULT_PLACEHOLDER_SLOT;
  return {
    // Non-null: `slot` is either a key the map has or the default, which is.
    renderId: SLOT_PLACEHOLDER_EFFECTS.get(slot)!,
    kind: 'placeholder',
    placeholderSlot: slot,
  };
}
