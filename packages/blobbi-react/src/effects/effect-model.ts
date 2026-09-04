/**
 * The PUBLIC effect contract of `@blobbi/react`.
 *
 * A visual effect is named by an ID and nothing else. The package knows a fixed
 * set of ids and how to draw them; it does not know what an id costs, who owns
 * it, which event described it, or whether the caller was allowed to ask. That
 * split is the whole point; see `docs/blobbi-visual-effects-audit.md` §3.
 *
 * Everything a caller sends is PLAIN JSON: `{ id, intensity? }`. No component,
 * no class name, no CSS, no animation expression, no callback. An id this
 * package does not implement is dropped silently rather than rendered as
 * something arbitrary, because "ignore what you don't understand" is the only
 * safe reading of input that originated outside the application.
 *
 * ## Slots
 *
 * Effects compete for four visual slots. At most one effect occupies each, so a
 * player wearing two auras gets one aura rather than a soup. The winner is the
 * FIRST of its slot in the supplied order, a rule the caller can predict and
 * control, unlike a rarity or priority table the caller cannot see.
 *
 * ## Order
 *
 * The RESULT is always ordered by {@link EFFECT_SLOT_ORDER}, never by input
 * order. Two callers who supply the same effects in different orders produce
 * the same DOM (as long as they do not disagree about which effect wins a
 * slot), which is what makes the markup comparable between renders and between
 * a server and its hydration.
 */

/** Every visual effect this package can draw. */
export const BLOBBI_VISUAL_EFFECT_IDS = [
  'golden-sparkles',
  'bubble-bliss',
  'love-burst',
  'firefly-friends',
  'mystic-fog',
  'frost-breath',
  'pixel-glitch',
  'electric-charge',
  'celestial-aura',
  'solar-radiance',
  'void-whispers',
  'rainbow-dream',
] as const;

export type BlobbiVisualEffectId = (typeof BLOBBI_VISUAL_EFFECT_IDS)[number];

/**
 * The visual slot an effect occupies.
 *
 *  - `aura`: a luminous field around/behind the whole body
 *  - `ambient-particles`: motes drifting in the air around the character
 *  - `body-overlay`: something happening ON the body's silhouette
 *  - `ground-local`: low-lying atmosphere pooling around the feet
 */
export type BlobbiEffectSlot =
  | 'aura'
  | 'ambient-particles'
  | 'body-overlay'
  | 'ground-local';

/**
 * Canonical slot order, the DOM order of the resolved result.
 *
 * Read outward-in: the aura is the widest and most background-ish, ground fog
 * pools beneath, ambient particles fill the air, and the body overlay sits
 * closest to the character. Within a layer this is also the paint order.
 */
export const EFFECT_SLOT_ORDER: readonly BlobbiEffectSlot[] = [
  'aura',
  'ground-local',
  'ambient-particles',
  'body-overlay',
];

/** What a caller sends: plain, serializable, JSON round-trippable. */
export interface BlobbiVisualEffect {
  id: BlobbiVisualEffectId;
  /**
   * Visual strength, 1 = the preset as designed. Clamped to
   * {@link MIN_EFFECT_INTENSITY}..{@link MAX_EFFECT_INTENSITY}; a non-finite
   * value falls back to {@link DEFAULT_EFFECT_INTENSITY}.
   *
   * Intensity scales OPACITY only. It never scales particle count, size or
   * speed: those are what the caps and the timing floors are asserted against,
   * and a number supplied from outside must not be able to move them.
   */
  intensity?: number;
}

/** A resolved effect: id, its slot, and a clamped intensity. */
export interface ResolvedBlobbiVisualEffect {
  id: BlobbiVisualEffectId;
  slot: BlobbiEffectSlot;
  intensity: number;
}

export const DEFAULT_EFFECT_INTENSITY = 1;
export const MIN_EFFECT_INTENSITY = 0;
export const MAX_EFFECT_INTENSITY = 1.5;

/** Which slot each effect competes for. */
export const EFFECT_SLOTS: Record<BlobbiVisualEffectId, BlobbiEffectSlot> = {
  'golden-sparkles': 'ambient-particles',
  'bubble-bliss': 'ambient-particles',
  'love-burst': 'ambient-particles',
  'firefly-friends': 'ambient-particles',
  'mystic-fog': 'ground-local',
  // Frost Breath is GROUND-LOCAL rather than ambient: its crystals settle
  // downward around the feet, and putting it in the ambient slot would make it
  // compete with sparkles/bubbles it composes well with.
  'frost-breath': 'ground-local',
  'pixel-glitch': 'body-overlay',
  'electric-charge': 'body-overlay',
  'celestial-aura': 'aura',
  'solar-radiance': 'aura',
  'void-whispers': 'aura',
  'rainbow-dream': 'aura',
};

const KNOWN_IDS: ReadonlySet<string> = new Set(BLOBBI_VISUAL_EFFECT_IDS);

/** Is this string an effect this package implements? */
export function isBlobbiVisualEffectId(
  value: unknown,
): value is BlobbiVisualEffectId {
  return typeof value === 'string' && KNOWN_IDS.has(value);
}

function clampIntensity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_EFFECT_INTENSITY;
  }
  return Math.max(MIN_EFFECT_INTENSITY, Math.min(MAX_EFFECT_INTENSITY, value));
}

/**
 * Resolve loose effect input into the deterministic list the renderer draws.
 *
 * Pure, total, and safe against anything: a non-array, a hole, a string, an
 * object with no `id`, a duplicate, an unknown id, `NaN` intensity. Nothing
 * throws and nothing unknown renders.
 *
 * The pipeline, in order:
 *
 *  1. **filter**: drop anything that is not a known effect id;
 *  2. **dedupe**: first occurrence of an id wins, later ones are dropped
 *     (so `[a(0.2), a(1)]` renders `a` at 0.2, matching "first wins" below);
 *  3. **slot resolution**: first occupant of a slot wins, later competitors
 *     for the same slot are dropped;
 *  4. **order**: the survivors are sorted into {@link EFFECT_SLOT_ORDER}.
 */
export function normalizeBlobbiVisualEffects(
  effects: readonly BlobbiVisualEffect[] | null | undefined,
): readonly ResolvedBlobbiVisualEffect[] {
  if (!Array.isArray(effects) || effects.length === 0) return EMPTY_EFFECTS;

  const seenIds = new Set<string>();
  const bySlot = new Map<BlobbiEffectSlot, ResolvedBlobbiVisualEffect>();

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    const { id } = effect as BlobbiVisualEffect;
    if (!isBlobbiVisualEffectId(id)) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const slot = EFFECT_SLOTS[id];
    // First occupant of a slot wins: a deterministic rule the caller controls.
    if (bySlot.has(slot)) continue;
    bySlot.set(slot, { id, slot, intensity: clampIntensity(effect.intensity) });
  }

  if (bySlot.size === 0) return EMPTY_EFFECTS;

  const resolved: ResolvedBlobbiVisualEffect[] = [];
  for (const slot of EFFECT_SLOT_ORDER) {
    const effect = bySlot.get(slot);
    if (effect) resolved.push(effect);
  }
  return resolved;
}

/** Shared empty result, so "no effects" allocates nothing on every render. */
const EMPTY_EFFECTS: readonly ResolvedBlobbiVisualEffect[] = Object.freeze([]);
