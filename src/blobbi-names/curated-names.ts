/**
 * The approved naming vocabulary, and the grammar that validates it.
 *
 * ## Why a vocabulary rather than a filter
 *
 * "Reject names containing prohibited words" is not a boundary — a modified
 * client sends `meet me outside`, which is clean, and every filter in the world
 * passes it. The only rule that holds against text nobody has written yet is a
 * closed set: a curated name must be two words, both from these lists, in this
 * order. Nothing else is a name.
 *
 * That is what makes {@link validateCuratedBlobbiName} a real writer-side check
 * rather than a UI convenience. The composer is how a player picks; this is what
 * decides whether the result may be published.
 *
 * ## The tone
 *
 * Cosy and small-creature-ish, to sit beside the island's own voice. Sixteen by
 * sixteen is 256 combinations — enough that a name feels chosen rather than
 * assigned, small enough that every word and every pairing has actually been
 * read. `Bouncy Sparkle` is the longest at fourteen characters, comfortably
 * inside the existing thirty-two-character limit.
 *
 * Every pair is checked against the prohibited-text classifier by this module's
 * test, so no combination can produce something unfortunate by accident.
 */

/** First word. Adjectives only — the grammar depends on the position. */
export const CURATED_ADJECTIVES: readonly string[] = Object.freeze([
  'Sunny',
  'Tiny',
  'Brave',
  'Happy',
  'Misty',
  'Cozy',
  'Fluffy',
  'Jolly',
  'Gentle',
  'Bouncy',
  'Sleepy',
  'Speedy',
  'Lucky',
  'Merry',
  'Bubbly',
  'Wobbly',
]);

/** Second word. Small, soft, findable-in-a-garden nouns. */
export const CURATED_NOUNS: readonly string[] = Object.freeze([
  'Puff',
  'Sprout',
  'Star',
  'Pebble',
  'Cloud',
  'Bumble',
  'Berry',
  'Pip',
  'Moss',
  'Nugget',
  'Sparkle',
  'Biscuit',
  'Waffle',
  'Comet',
  'Muffin',
  'Acorn',
]);

/** How many names the vocabulary can express. */
export const CURATED_NAME_COMBINATIONS = CURATED_ADJECTIVES.length * CURATED_NOUNS.length;

const ADJECTIVES = new Set(CURATED_ADJECTIVES);
const NOUNS = new Set(CURATED_NOUNS);

/**
 * Build a name from two approved words.
 *
 * Returns `null` rather than throwing for an unapproved word, because the
 * composer's own state can legitimately be incomplete while a player is still
 * choosing.
 */
export function composeCuratedName(adjective: string, noun: string): string | null {
  if (!ADJECTIVES.has(adjective) || !NOUNS.has(noun)) return null;
  return `${adjective} ${noun}`;
}

export type CuratedNameRejection =
  | 'empty'
  | 'wrong-shape'
  | 'unapproved-adjective'
  | 'unapproved-noun';

export type CuratedNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: CuratedNameRejection };

/**
 * Whether a name structurally belongs to the approved vocabulary.
 *
 * Exactly two words, separated by a single space, both from the lists above, in
 * that order, case-sensitively. Deliberately strict: every relaxation here is a
 * gap a modified client can write through, and there is no legitimate caller
 * that needs one — the composer only ever produces this shape.
 *
 * Note what it does NOT do: consult the prohibited-text classifier. It does not
 * need to. A closed vocabulary that has been read cannot contain a prohibited
 * word, and checking would imply the list might.
 */
export function validateCuratedBlobbiName(value: unknown): CuratedNameResult {
  if (typeof value !== 'string') return { ok: false, reason: 'empty' };

  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  const parts = trimmed.split(' ');
  // Not `split(/\s+/)`: collapsing whitespace would accept "Sunny    Puff" and
  // "Sunny\nPuff" as the same name, and a name with a newline in it is not a
  // name the composer can have produced.
  if (parts.length !== 2) return { ok: false, reason: 'wrong-shape' };

  const [adjective, noun] = parts;
  if (!ADJECTIVES.has(adjective)) return { ok: false, reason: 'unapproved-adjective' };
  if (!NOUNS.has(noun)) return { ok: false, reason: 'unapproved-noun' };

  return { ok: true, name: `${adjective} ${noun}` };
}

/** Whether a name is one the curated vocabulary can express. */
export function isCuratedBlobbiName(value: unknown): boolean {
  return validateCuratedBlobbiName(value).ok;
}
