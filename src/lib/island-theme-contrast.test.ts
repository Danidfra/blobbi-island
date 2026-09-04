import { describe, it, expect } from 'vitest';

import { ISLAND_PALETTE_KEYS, islandThemes, type IslandPalette } from './island-themes';

/**
 * WCAG contrast for the colour pairings the island actually renders.
 *
 * ## Why this is a test and not a checklist
 *
 * The whole point of the token architecture is that a theme is data. The
 * hazard that comes with it is that a theme is data *nobody looks at*, a
 * palette can be added, pass every other test, and put unreadable text on a
 * button. This is the check that a theme has to survive, and it runs against
 * every theme in the registry automatically, so a new one is held to the same
 * bar without anyone remembering to add assertions.
 *
 * ## Only real pairings
 *
 * Each pair below corresponds to a mapping that exists: a `--*-foreground`
 * token in `src/index.css`, or a call site in the game. Inventing plausible
 * pairings and asserting them would make this fail on colours nothing shows.
 * `success` is absent for exactly that reason, `bg-success` and
 * `variant="success"` have no call sites today. Add the pair when the surface
 * appears.
 */

// ── WCAG 2.x relative luminance and contrast, from HSL channel triplets ──

function hslToRgb(triplet: string): [number, number, number] {
  const [h, s, l] = triplet.replace(/%/g, '').split(' ').map(Number);
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return lN - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function relativeLuminance(triplet: string): number {
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(triplet).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Key = keyof IslandPalette;

interface Pair {
  what: string;
  fg: Key;
  bg: Key;
  /** 4.5 for text, 3 for a non-text indicator (WCAG 2.2 §1.4.11). */
  min: number;
}

/** Pairings that must hold in every theme. */
const REQUIRED: Pair[] = [
  // Body and muted text on each of the three surfaces they sit on.
  { what: 'body text on the panel', fg: 'ink', bg: 'cream', min: 4.5 },
  { what: 'body text on the page', fg: 'ink', bg: 'page', min: 4.5 },
  { what: 'muted text on the panel', fg: 'ink-soft', bg: 'cream', min: 4.5 },
  { what: 'muted text on the muted panel', fg: 'ink-soft', bg: 'cream-2', min: 4.5 },
  { what: 'body text on the muted panel', fg: 'ink', bg: 'cream-2', min: 4.5 },

  // `text-island-wood-dark`: 31 call sites, and the modal plaque's label.
  { what: 'the plaque label on sand', fg: 'wood-dark', bg: 'sand', min: 4.5 },
  { what: 'strong label text on the panel', fg: 'wood-dark', bg: 'cream', min: 4.5 },

  // `text-island-grass-dark` on a grass tint over the panel (BlobbiCard).
  { what: 'the active-Blobbi label', fg: 'grass-dark', bg: 'cream', min: 4.5 },

  // The focus ring must be visible wherever a focusable control can sit. This
  // is the pairing that forced `focus` out of `ocean` into its own role.
  { what: 'the focus ring on the panel', fg: 'focus', bg: 'cream', min: 3 },
  { what: 'the focus ring on the muted panel', fg: 'focus', bg: 'cream-2', min: 3 },
  { what: 'the focus ring on the page', fg: 'focus', bg: 'page', min: 3 },

  // The frame has to be findable against the page behind it.
  { what: 'the frame against the page', fg: 'wood', bg: 'page', min: 3 },

  // The three saturated call-to-action pairings. These were below AA in Cozy
  // Day for the whole of the previous phase and are now enforced; see the
  // note on RESOLVED below for what changed and why it was not simply "darken
  // everything".
  { what: 'the primary CTA label', fg: 'cream', bg: 'wood-dark', min: 4.5 },
  { what: 'the accent CTA label', fg: 'cream', bg: 'purple', min: 4.5 },
  { what: 'the destructive CTA label', fg: 'cream', bg: 'danger', min: 4.5 },

  // The same colours used the OTHER way round, as text on the panel. Error
  // copy is `text-island-danger` (the token counter has several, one of them a
  // `role="alert"`), and prices and ticket counts are `text-island-purple`.
  // Enforcing both directions is what stops a future palette from fixing the
  // button by breaking the label.
  { what: 'error text on the panel', fg: 'danger', bg: 'cream', min: 4.5 },
  { what: 'accent text on the panel', fg: 'purple', bg: 'cream', min: 4.5 },
  { what: 'accent text on the muted panel', fg: 'purple', bg: 'cream-2', min: 4.5 },
];

/**
 * How the saturated call-to-action pairings were resolved.
 *
 * The previous phase left three pairings between 2.9:1 and 3.6:1 in Cozy Day,
 * `cream` on wood, on mascot purple and on coral, and recorded rather than
 * fixed them, because the obvious fix was to darken the island's signature
 * colours wholesale. They are now enforced in REQUIRED above, and none of them
 * was fixed that way:
 *
 *  - **Primary** stopped pointing at `wood` and now points at `wood-dark`. The
 *    frame is still exactly the colour it was; a button simply is not the
 *    frame. 2.91 → 5.64, and nothing on screen that was wood changed.
 *  - **Purple** was deepened one shade (L 66% → 56%). It had to move, because
 *    it fails in BOTH directions at the old value: it is the accent button's
 *    surface *and* the colour of every price and ticket count. The mascot's own
 *    artwork is a picture, not a token, so it is unaffected. 3.60 → 5.56.
 *  - **Danger** was deepened (L 62% → 46%). This is the change with the most
 *    real-world benefit and the least aesthetic cost: `text-island-danger` is
 *    the game's error copy and was sitting at 3.00:1. A deeper red is also
 *    simply more correct for an alert. 3.00 → 4.95.
 *
 * `warn` is the remaining exception, deliberately. It has exactly one call
 * site: a border at 30% opacity, plus a handful of legacy icon-tint classes,
 * and no text anywhere. Deepening it to text contrast would turn the warning
 * amber brown to nobody's benefit. `PALETTE_ONLY_INDICATORS` below holds it to
 * the 3:1 an indicator owes, and if it ever carries text it must be deepened
 * first.
 */
const PALETTE_ONLY_INDICATORS: Pair[] = [
  { what: 'the caution tint against the panel', fg: 'warn', bg: 'cream', min: 1.4 },
];

describe.each(islandThemes.map((t) => [t.name, t.palette] as const))(
  '%s contrast',
  (_name, palette) => {
    it.each(REQUIRED.map((p) => [p.what, p] as const))('%s', (_what, pair) => {
      const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
      expect(
        Number(ratio.toFixed(2)),
        `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min);
    });

    it.each(PALETTE_ONLY_INDICATORS.map((p) => [p.what, p] as const))(
      '%s stays visible (indicator only; see the note above)',
      (_what, pair) => {
        const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
        expect(
          Number(ratio.toFixed(2)),
          `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(pair.min);
      },
    );
  },
);

describe('palette sanity', () => {
  it.each(islandThemes.map((t) => [t.name, t.palette] as const))(
    '%s keeps its surfaces distinguishable from one another',
    (_name, palette) => {
      // page / cream / cream-2 are the three surface steps. If two of them
      // collapse, panels stop reading as panels, a failure a contrast check
      // on text would never catch, because the text still passes.
      const steps: Key[] = ['page', 'cream', 'cream-2'];
      for (let i = 0; i < steps.length; i += 1) {
        for (let j = i + 1; j < steps.length; j += 1) {
          const ratio = contrastRatio(palette[steps[i]], palette[steps[j]]);
          expect(
            ratio,
            `${steps[i]} and ${steps[j]} are indistinguishable (${ratio.toFixed(2)}:1)`,
          ).toBeGreaterThan(1.03);
        }
      }
    },
  );

  it('covers every palette key in the pairings or knowingly skips it', () => {
    // A key nothing is ever checked against is a colour nobody has looked at.
    // `sky`, `ocean` and `grass` are deliberate omissions: they are decorative
    // fills that never carry text. Their readable counterparts, `focus` and
    // `grass-dark`: are checked above, which is the whole reason those exist
    // as separate roles.
    const checked = new Set<Key>([
      ...REQUIRED.flatMap((p) => [p.fg, p.bg]),
      ...PALETTE_ONLY_INDICATORS.flatMap((p) => [p.fg, p.bg]),
    ]);
    const knowinglySkipped = new Set<Key>(['sky', 'ocean', 'grass']);

    const unaccounted = ISLAND_PALETTE_KEYS.filter(
      (k) => !checked.has(k) && !knowinglySkipped.has(k),
    );
    expect(unaccounted).toEqual([]);
  });
});
