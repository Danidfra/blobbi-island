/**
 * The quick-phrase catalog, trusted, local, and the only source of the words a
 * quick phrase renders as.
 *
 * ## IDs are the protocol; text is presentation
 *
 * `'want-to-play'` travels on the wire. `'Want to play?'` never does. That
 * separation is doing two jobs at once:
 *
 *  - **Safety.** A receiver reconstructs the sentence from this file, so a
 *    hostile client cannot make a Blobbi say anything that is not written here,
 *    however it shapes its payload.
 *  - **Translation.** Swapping `text` for a lookup keyed by locale is a change
 *    to this module alone; no published event becomes wrong, and no receiver
 *    needs to understand a second language to validate one.
 *
 * ## Small on purpose
 *
 * Ten phrases, chosen to cover greeting, coordinating and being nice, because a
 * grid a child has to scroll is a grid a child does not read. Growth should come
 * from watching what players reach for the phrase builder to say.
 */

/** One entry in the catalog. */
export interface QuickPhrase {
  /** Stable, language-independent protocol id. Never change one in place. */
  readonly id: string;
  /** What the local client renders. Presentation only; never sent or trusted. */
  readonly text: string;
  /** Grouping hint for the picker. */
  readonly category: 'greeting' | 'play' | 'coordination' | 'kindness';
}

export const QUICK_PHRASES: readonly QuickPhrase[] = Object.freeze([
  { id: 'hi', text: 'Hi!', category: 'greeting' },
  { id: 'bye', text: 'Bye!', category: 'greeting' },
  { id: 'want-to-play', text: 'Want to play?', category: 'play' },
  { id: 'lets-go', text: "Let's go!", category: 'play' },
  { id: 'good-game', text: 'Good game!', category: 'play' },
  { id: 'follow-me', text: 'Follow me!', category: 'coordination' },
  { id: 'wait-for-me', text: 'Wait for me!', category: 'coordination' },
  { id: 'brb', text: 'Be right back!', category: 'coordination' },
  { id: 'nice-blobbi', text: 'Nice Blobbi!', category: 'kindness' },
  { id: 'thank-you', text: 'Thank you!', category: 'kindness' },
]);

const BY_ID: ReadonlyMap<string, QuickPhrase> = new Map(
  QUICK_PHRASES.map((phrase) => [phrase.id, phrase]),
);

/**
 * The phrase with this id, or `null`.
 *
 * `null` rather than a throw: an unknown id is the normal consequence of
 * receiving an event from a client with a newer catalog, and the receive path
 * must treat that as "nothing to show" rather than as an error.
 */
export function quickPhraseById(id: string): QuickPhrase | null {
  return BY_ID.get(id) ?? null;
}

/** Whether the local catalog knows this id. */
export function isKnownQuickPhrase(id: string): boolean {
  return BY_ID.has(id);
}
