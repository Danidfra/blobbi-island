/**
 * Rear-view ("facing away") SVG post-processing for Blobbi.
 *
 * There is no rear artwork: every Blobbi is a single flat drawing whose face is
 * baked into the same shapes as its body, and no `viewBox` transform can turn a
 * flat drawing around. `transform: scaleX(-1)` mirrors, it does not rotate.
 *
 * What DOES exist is a semantic convention every one of the Blobbi SVGs follows:
 * each part of the character is introduced by an HTML comment
 * (`<!-- Eyes (white base) -->`, `<!-- Mouth -->`, ...) and runs until the next
 * comment or `</svg>`. The renderer already treats those comments as an API,
 * `applyGazeMarkup` finds the pupils that way, and the eye-colour customizer
 * scopes its fill replacement to the same block.
 *
 * So a rear view is produced by REMOVING the face blocks and keeping everything
 * else: silhouette, body gradients, secondary colour, ears, tails, limbs, wings,
 * petals, leaves, pots, particles, outlines, `<defs>` and the sleeping "Zzz".
 *
 * Two rules make this safe:
 *
 *  1. **Explicit token list, never a pattern.** A bare `/eyes/i` would also strip
 *     FROGGI's `Big circular pop-out eyes`, which are body bulges that define its
 *     silhouette, and would delete gradient definitions named `Eye gradient`.
 *     Only the exact labels in {@link REAR_VIEW_REMOVED_BLOCKS} are removed.
 *  2. **Structural safety check.** A block is only removed when the markup it
 *     spans is tag-balanced, so removing it can never orphan a `</g>` and
 *     corrupt the rest of the drawing. `rear-view.test.ts` asserts that every
 *     face block in every shipped SVG passes this check, so the guard is a
 *     tripwire for future artwork rather than a silent fallback.
 */

/** Which drawing to produce for a Blobbi: the normal one, or its back. */
export type BlobbiView = 'front' | 'rear';

/**
 * Exact comment labels whose blocks are removed in rear view.
 *
 * Comparison is case-insensitive on the trimmed comment text and must match in
 * full, `Eyes` does not match `Eyes (white base)`; both are listed explicitly.
 * The list covers the mixed English/Portuguese naming used across the art.
 */
export const REAR_VIEW_REMOVED_BLOCKS: readonly string[] = [
  // Eyes: awake
  'Eyes',
  'Eyes (white base)',
  'Eyes (white/base eye shapes)',
  'Eyes (black patches + white base)',
  // Eyes: sleeping variants
  'Sleeping eyes',
  'Sleeping eyes on stem',
  'Twinkling eyes',
  'Large expressive eyes',
  'Olhos dormindo',
  // Pupils
  'Pupils (dark circles + highlights)',
  'Pupils (pupil + highlights)',
  // Mouths
  'Mouth',
  'Peaceful mouth',
  'Boca calma',
  'Boca tranquila',
  // Noses, beaks, whiskers
  'Nose',
  'Enhanced cat nose',
  'Enhanced nostrils',
  'Enhanced beak',
  'Enhanced whiskers',
  // Blush / cheeks
  'Rosy cheeks',
  'Bochechas',
  'Soft blush for cuteness',
];

/**
 * Comment labels that contain a face word but must NEVER be removed.
 *
 * Exported so the test suite can assert they survive, and so the intent is
 * documented next to the removal list rather than in a commit message.
 *
 * - `Big circular pop-out eyes`: FROGGI's eye BULGES. They are part of the
 *   silhouette; a frog seen from behind still has them.
 * - `*gradient` blocks live inside `<defs>` and paint nothing on their own.
 * - `Black ear patches`: PANDI's ears, not its eye patches.
 */
export const REAR_VIEW_KEPT_BLOCKS: readonly string[] = [
  'Big circular pop-out eyes',
  'Eye gradient',
  'Pupil gradient',
  'Mouth gradient',
  'Black ear patches',
];

const REMOVED = new Set(REAR_VIEW_REMOVED_BLOCKS.map((label) => label.toLowerCase()));

/** Matches every HTML comment, capturing its inner text. */
const COMMENT_REGEX = /<!--([\s\S]*?)-->/g;

/**
 * Is this markup fragment safe to delete wholesale?
 *
 * True only when every element opened inside it is also closed inside it, so
 * deleting it leaves the surrounding document structurally identical.
 */
export function isSelfContainedMarkup(fragment: string): boolean {
  const withoutComments = fragment.replace(COMMENT_REGEX, '');
  const tagRegex = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  const stack: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(withoutComments)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }

  return stack.length === 0;
}

/**
 * Locate the comment blocks a rear view must delete.
 *
 * A block starts at its `<!--` and ends where the next comment starts, or at
 * `</svg>`, or at the end of the string, the same convention `gaze.ts` uses.
 *
 * @returns Ranges in source order, each with the label that matched.
 */
export function findRearViewRemovals(
  svgText: string,
): Array<{ label: string; start: number; end: number }> {
  const comments: Array<{ label: string; start: number }> = [];

  COMMENT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMENT_REGEX.exec(svgText)) !== null) {
    comments.push({ label: match[1].trim(), start: match.index });
  }

  const svgClose = svgText.search(/<\/svg>/i);
  const hardEnd = svgClose === -1 ? svgText.length : svgClose;

  return comments
    .map((comment, index) => {
      const nextComment = comments[index + 1]?.start ?? svgText.length;
      // A block never runs past `</svg>`, even if a stray comment follows it.
      const end = Math.min(nextComment, comment.start >= hardEnd ? svgText.length : hardEnd);
      return { label: comment.label, start: comment.start, end };
    })
    .filter((block) => REMOVED.has(block.label.toLowerCase()));
}

/**
 * Produce the rear view of an already-customized Blobbi SVG.
 *
 * Idempotent: running it on rear output finds nothing left to remove.
 * Colours, gradients, ids and every non-face part are untouched, so this can be
 * applied after `customizeAdultSvg` / `customizeBabySvg` without disturbing
 * per-instance id uniquification.
 *
 * @param svgText - Fully customized SVG markup.
 * @returns The same markup with the face blocks removed.
 */
export function applyRearView(svgText: string): string {
  const removals = findRearViewRemovals(svgText);
  if (removals.length === 0) return svgText;

  // Splice from the end so earlier offsets stay valid.
  let result = svgText;
  for (let i = removals.length - 1; i >= 0; i -= 1) {
    const { start, end } = removals[i];
    const fragment = result.slice(start, end);
    // Structural guard (see the module doc): never risk orphaning a closing tag.
    if (!isSelfContainedMarkup(fragment)) continue;
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}
