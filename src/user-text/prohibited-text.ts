/**
 * A small, deliberate classifier for obviously prohibited user-authored text.
 *
 * ## What this is, and emphatically is not
 *
 * It is **defence in depth**, invoked by individual safety surfaces that
 * deliberately choose to. It is not a moderation engine, not a censor, and not
 * applied automatically to every string in the app.
 *
 * A denylist cannot be the security boundary, and this one is not:
 *
 * ```
 *   Family free-text chat        no free text at all        (Communication V2)
 *   Family own Blobbi names      approved vocabulary only   (curated-names.ts)
 *   Family stranger names        deterministic alias        (display-names.ts)
 * ```
 *
 * Each of those is *structural*; it works on text nobody has seen before, in
 * any language, spelled any way. This file catches the small, obvious subset
 * those structures do not cover, and its value is precisely that it is not load
 * bearing. `docs/safe-user-authored-names.md` §7 states the limits plainly.
 *
 * ## Matching, and why it is boundary-aware
 *
 * The naive version is `value.includes('ass')`, which blocks *class*, *grass*,
 * *pass* and *assassin*. Every term is instead compiled to a pattern that
 * requires a LETTER boundary on each side, so a prohibited word must stand on
 * its own rather than merely appear inside something innocent.
 *
 * Digits are deliberately NOT boundaries: `fuck123` is the same word with a
 * number stuck on, and treating it as different would be free evasion.
 *
 * ## Evasion handled, and evasion not handled
 *
 * The normalizer folds the cheap tricks, case, accents, full-width characters,
 * digit-for-letter substitution: and each term's pattern tolerates arbitrary
 * separators BETWEEN its letters (`f.u.c.k`, `f u c k`, `f-u-c-k`). Separators
 * are restricted to non-alphanumerics, so an intervening real word breaks the
 * match rather than being skipped over.
 *
 * It does not handle new spellings, other languages, coded language, homographs,
 * context, or innocent words used cruelly. Nothing of this shape does.
 */

/**
 * Longest input examined.
 *
 * Beyond this the value is truncated rather than rejected: this is a classifier,
 * not a validator, and a caller asking "is there something prohibited here?"
 * should not get an exception for a long string. Every real caller enforces its
 * own length limit anyway.
 */
const MAX_EXAMINED_LENGTH = 512;

/**
 * Digit and symbol substitutions folded before matching.
 *
 * Only the unambiguous ones. `1` → `i` rather than `l`, because `l` produces
 * more false positives than it prevents, and the terms below do not need it.
 */
const LEET_FOLD: ReadonlyMap<string, string> = new Map([
  ['4', 'a'],
  ['@', 'a'],
  ['3', 'e'],
  ['1', 'i'],
  ['!', 'i'],
  ['0', 'o'],
  ['5', 's'],
  ['$', 's'],
  ['7', 't'],
]);

/**
 * Fold a value into a form terms are matched against.
 *
 * NFKD first so combining marks separate from their base letters and can be
 * dropped (`ｆｕ́ｃｋ` and `fuck` become the same string); the compatibility half
 * of NFKD is also what turns full-width Latin into ASCII.
 *
 * ## Why substitution folding is optional
 *
 * Folding `1`→`i` and `3`→`e` catches `sh1t`, and it also DESTROYS the digit
 * boundary that catches `fuck123`: with the fold applied that becomes
 * `fucki2e`, where `fuck` is followed by a letter and no longer stands alone.
 * The two goals are genuinely in tension, so {@link classifyUserAuthoredText}
 * checks both forms rather than picking one and losing the other. Checking twice
 * can only add matches, never false positives.
 *
 * Never throws: a malformed surrogate or an exotic script must not take out the
 * caller, which may be rendering a remote player's name.
 */
export function normalizeForMatching(value: string, foldSubstitutions = true): string {
  if (typeof value !== 'string' || value === '') return '';
  const bounded = value.slice(0, MAX_EXAMINED_LENGTH);

  let folded: string;
  try {
    folded = bounded.normalize('NFKD');
  } catch {
    folded = bounded;
  }

  let out = '';
  for (const char of folded.toLowerCase()) {
    // Combining marks: dropped, so an accented evasion collapses onto the base.
    if (/\p{M}/u.test(char)) continue;
    // Control characters would otherwise sit between letters and read as
    // separators that a human never sees.
    if (/\p{C}/u.test(char)) continue;
    out += (foldSubstitutions ? LEET_FOLD.get(char) : undefined) ?? char;
  }
  return out;
}

/**
 * The prohibited vocabulary.
 *
 * **Small, curated, English, and explicitly not exhaustive.** The goal is to
 * establish the mechanism, not to attempt comprehensive coverage, a list that
 * pretended to be complete would invite exactly the misplaced confidence this
 * module's header warns against.
 *
 * Terms were chosen for severity and for low false-positive risk under the
 * boundary rules above. Mild profanity and ambiguous words are deliberately
 * absent: blocking `damn` buys nothing, and blocking `ass` breaks *class*,
 * *grass* and *pass* for people who did nothing wrong.
 *
 * Grouped so a future language can be added as a sibling list rather than by
 * appending to one flat array.
 */
const SEVERE_PROFANITY: readonly string[] = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'wanker',
  'motherfucker',
];

const EXPLICIT_SEXUAL: readonly string[] = [
  'porn',
  'penis',
  'vagina',
  'pussy',
  'cock',
  'boobs',
  'horny',
  'whore',
  'slut',
  'rape',
  'nude',
  'sex',
];

/**
 * Severe slurs.
 *
 * Present because a children's product that filtered profanity and not slurs
 * would have its priorities backwards.
 */
const SLURS: readonly string[] = ['nigger', 'faggot', 'retard', 'tranny'];

/** Every term, in one place, for the matcher and for tests to enumerate. */
export const PROHIBITED_TERMS: readonly string[] = Object.freeze([
  ...SEVERE_PROFANITY,
  ...EXPLICIT_SEXUAL,
  ...SLURS,
]);

/**
 * One pattern per term.
 *
 * `[\W_]*` between letters absorbs separators, dots, spaces, hyphens, asterisks,
 * while excluding letters and digits, so an intervening real word breaks the
 * match instead of being skipped.
 *
 * The boundaries are LETTER-only on purpose (see the header): `class` must not
 * match `ass`, and `fuck123` must still match `fuck`.
 */
const PATTERNS: readonly RegExp[] = Object.freeze(
  PROHIBITED_TERMS.map((term) => {
    const body = term.split('').join('[\\W_]*');
    return new RegExp(`(?<![a-z])${body}(?![a-z])`, 'u');
  }),
);

export type UserTextVerdict = 'clean' | 'prohibited';

export interface UserTextClassification {
  readonly verdict: UserTextVerdict;
  /**
   * The term that matched, or `null`.
   *
   * Exposed for tests and diagnostics. **Not for display**: echoing the matched
   * word back to a player is how a filter becomes a lookup table for what to try
   * next, and in a child-facing product it also prints the slur it just blocked.
   */
  readonly matched: string | null;
}

const CLEAN: UserTextClassification = Object.freeze({ verdict: 'clean', matched: null });

/**
 * Classify a value. Never throws; anything unusable is `clean`.
 *
 * `clean` means "nothing on the list was found", never "this is safe": the
 * difference is the whole reason this is defence in depth.
 */
export function classifyUserAuthoredText(value: unknown): UserTextClassification {
  if (typeof value !== 'string') return CLEAN;

  // Both forms, for the reason in `normalizeForMatching`: the substitution fold
  // is what catches `sh1t`, and NOT folding is what keeps the digit boundary
  // that catches `fuck123`.
  const forms = [normalizeForMatching(value, false), normalizeForMatching(value, true)];

  for (let index = 0; index < PATTERNS.length; index += 1) {
    for (const form of forms) {
      if (form && PATTERNS[index].test(form)) {
        return Object.freeze({ verdict: 'prohibited', matched: PROHIBITED_TERMS[index] });
      }
    }
  }
  return CLEAN;
}

/** Convenience predicate for callers that only need the yes/no. */
export function containsProhibitedText(value: unknown): boolean {
  return classifyUserAuthoredText(value).verdict === 'prohibited';
}
