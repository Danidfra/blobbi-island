/**
 * The emote catalog.
 *
 * ## The glyph is not the id
 *
 * `'clap'` is the protocol; `'👏'` is one way to draw it. Sending the glyph
 * would tie the wire format to a Unicode revision, make the payload
 * unvalidatable against a small set (any emoji is a "valid" emoji), and leave no
 * room to replace the emoji with real Blobbi artwork later, which is the
 * likeliest next step. It would also mean a receiver rendering a character an
 * author chose, which is precisely what structured communication exists to
 * avoid.
 *
 * ## Every emote has a label
 *
 * `label` is not decoration. An emote-only control is unusable with a screen
 * reader without it, and a bubble showing a bare glyph is unreadable for the
 * same reason. The label is also what a text-only future surface would show.
 */

/** One entry in the catalog. */
export interface Emote {
  /** Stable, language-independent protocol id. */
  readonly id: string;
  /** Current visual. Replaceable with artwork without touching the protocol. */
  readonly glyph: string;
  /** Accessible name, and the text equivalent of the emote. */
  readonly label: string;
}

export const EMOTES: readonly Emote[] = Object.freeze([
  { id: 'wave', glyph: '👋', label: 'Wave' },
  { id: 'heart', glyph: '❤️', label: 'Heart' },
  { id: 'laugh', glyph: '😂', label: 'Laugh' },
  { id: 'clap', glyph: '👏', label: 'Clap' },
  { id: 'celebrate', glyph: '🎉', label: 'Celebrate' },
  { id: 'thumbs-up', glyph: '👍', label: 'Thumbs up' },
  { id: 'question', glyph: '❓', label: 'Question' },
]);

const BY_ID: ReadonlyMap<string, Emote> = new Map(EMOTES.map((emote) => [emote.id, emote]));

/** The emote with this id, or `null` when the local catalog does not know it. */
export function emoteById(id: string): Emote | null {
  return BY_ID.get(id) ?? null;
}

/** Whether the local catalog knows this id. */
export function isKnownEmote(id: string): boolean {
  return BY_ID.has(id);
}
