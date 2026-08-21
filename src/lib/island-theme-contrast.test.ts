import { describe, it, expect } from 'vitest';

import { ISLAND_PALETTE_KEYS, islandThemes, type IslandPalette } from './island-themes';

/**
 * WCAG contrast for the colour pairings the island actually renders.
 *
 * ## Why this is a test and not a checklist
 *
 * The whole point of the token architecture is that a theme is data. The
 * hazard that comes with it is that a theme is data *nobody looks at* — a
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
 * `success` is absent for exactly that reason — `bg-success` and
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

  // `text-island-wood-dark` — 31 call sites, and the modal plaque's label.
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
];

/**
 * The saturated call-to-action pairings, recorded rather than enforced.
 *
 * `--primary-foreground`, `--accent-foreground` and `--destructive-foreground`
 * are all `cream`, and in Cozy Day they land on wood, mascot purple and coral —
 * mid-tone brand colours. Every one of those pairs is between 2.9:1 and 3.6:1,
 * short of the 4.5:1 that button text needs.
 *
 * They are NOT quietly fixed here, because the only fix is to materially darken
 * the island's signature wood and purple, and that is a change to what the game
 * looks like rather than a bug in this layer. It belongs to whoever owns the
 * art direction. Two honest options, when someone takes it up:
 *
 *   - darken `wood`, `purple` and `danger` until `cream` clears 4.5:1 (roughly
 *     L 38%, a visible change to the frame and the mascot accent); or
 *   - give the palette explicit on-surface foreground roles, so each theme
 *     states its own answer instead of routing through `cream`.
 *
 * Until then this test pins the CURRENT ratios. Any change that makes one of
 * them worse fails, so the situation can only improve, and the numbers stay in
 * front of whoever reads this file.
 */
const RECORDED: Array<Pair & { floor: number }> = [
  { what: 'the primary CTA label', fg: 'cream', bg: 'wood', min: 4.5, floor: 2.9 },
  { what: 'the accent CTA label', fg: 'cream', bg: 'purple', min: 4.5, floor: 3.5 },
  { what: 'the destructive CTA label', fg: 'cream', bg: 'danger', min: 4.5, floor: 3.0 },
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

    it.each(RECORDED.map((p) => [p.what, p] as const))(
      '%s does not get worse (known below AA — see the note above)',
      (_what, pair) => {
        const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
        expect(
          Number(ratio.toFixed(2)),
          `${pair.fg} on ${pair.bg} regressed to ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(pair.floor);
      },
    );
  },
);

describe('palette sanity', () => {
  it.each(islandThemes.map((t) => [t.name, t.palette] as const))(
    '%s keeps its surfaces distinguishable from one another',
    (_name, palette) => {
      // page / cream / cream-2 are the three surface steps. If two of them
      // collapse, panels stop reading as panels — a failure a contrast check
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
    // `sky` and `warn` are deliberate omissions: `sky` is a decorative plate
    // that never carries text, and `warn` is used as an icon tint and a border,
    // never as a text/background pair.
    const checked = new Set<Key>([
      ...REQUIRED.flatMap((p) => [p.fg, p.bg]),
      ...RECORDED.flatMap((p) => [p.fg, p.bg]),
    ]);
    const knowinglySkipped = new Set<Key>(['sky', 'ocean', 'grass', 'warn']);

    const unaccounted = ISLAND_PALETTE_KEYS.filter(
      (k) => !checked.has(k) && !knowinglySkipped.has(k),
    );
    expect(unaccounted).toEqual([]);
  });
});
