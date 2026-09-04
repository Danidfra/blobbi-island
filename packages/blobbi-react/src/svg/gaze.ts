/**
 * Eye-gaze SVG post-processing for Blobbi.
 *
 * Marks the actual pupil + highlight shapes inside the generated SVG so they
 * can be translated independently of the body via CSS variables, producing
 * real eye movement (rather than nudging the whole sprite).
 *
 * Strategy (asset-agnostic, works for baby + every adult form/sleeping variant):
 * - Every Blobbi SVG places its pupils/highlights inside a `<!-- Pupils ... -->`
 *   comment block, terminated by the next comment or the closing `</svg>`.
 * - We add `class="blobbi-pupil"` to each `<circle>`/`<ellipse>` in that block.
 * - We inject a scoped `<style>` that translates `.blobbi-pupil` by
 *   `var(--blobbi-eye-x)` / `var(--blobbi-eye-y)` (set on the wrapper at runtime).
 *
 * This runs once per visual change (when the SVG string is generated), never
 * per animation frame. Runtime gaze only updates the CSS variables.
 */

const PUPIL_CLASS = 'blobbi-pupil';

/** Matches the Pupils comment block up to the next comment or end of string. */
const PUPILS_BLOCK_REGEX = /(<!--\s*Pupils[\s\S]*?)(?=<!--|<\/svg>|$)/i;

/** Adds the pupil marker class to circle/ellipse elements within a block. */
function markShapesInBlock(block: string): string {
  return block.replace(/<(circle|ellipse)\b((?:[^>]*?))(\/?)>/gi, (full, tag: string, attrs: string, selfClose: string) => {
    // Avoid double-marking if already processed.
    if (/\bclass\s*=/.test(attrs)) {
      if (attrs.includes(PUPIL_CLASS)) return full;
      const merged = attrs.replace(/class\s*=\s*(["'])(.*?)\1/i, (_m, q: string, val: string) => `class=${q}${val} ${PUPIL_CLASS}${q}`);
      return `<${tag}${merged}${selfClose}>`;
    }
    return `<${tag} class="${PUPIL_CLASS}"${attrs}${selfClose}>`;
  });
}

/**
 * Tag the pupil/highlight shapes and inject the gaze style into an SVG string.
 *
 * Idempotent: calling it again on an already-processed SVG is a no-op for the
 * style injection and won't double-add the class.
 *
 * @param svgText - The fully customized SVG markup (after loadBlobbiSvg).
 * @param maxPx - Maximum pupil travel in user/px units for the CSS transform.
 * @returns SVG markup with marked pupils and an injected gaze `<style>`.
 */
export function applyGazeMarkup(svgText: string, maxPx: number = 2): string {
  // Already processed: avoid double-injecting the style.
  if (svgText.includes('data-blobbi-gaze-style')) {
    return svgText;
  }

  // 1. Mark the pupil/highlight shapes within the Pupils block.
  let modified = svgText;
  const blockMatch = modified.match(PUPILS_BLOCK_REGEX);
  if (!blockMatch) {
    // No pupil block (e.g. sleeping variants with closed eyes): nothing to move.
    return modified;
  }
  const original = blockMatch[0];
  const marked = markShapesInBlock(original);
  modified = modified.replace(original, marked);

  // 2. Inject a scoped style right after the opening <svg ...> tag.
  // The CSS vars are unitless and multiplied by `px`; they default to 0 so an
  // undefined gaze leaves pupils perfectly static.
  const px = Number.isFinite(maxPx) ? maxPx : 2;
  const style =
    `<style data-blobbi-gaze-style>.${PUPIL_CLASS}{` +
    `transform:translate(calc(var(--blobbi-eye-x,0) * ${px}px),calc(var(--blobbi-eye-y,0) * ${px}px));` +
    `transition:transform 250ms ease-out;}</style>`;

  modified = modified.replace(/(<svg\b[^>]*>)/i, `$1${style}`);

  return modified;
}
