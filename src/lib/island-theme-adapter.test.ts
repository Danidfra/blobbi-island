/**
 * The compatibility layer: three colours in, sixteen out, readable at the end.
 *
 * The contract this file defends is the one that makes external themes usable
 * at all — an adapted palette must clear the SAME WCAG pairings every built-in
 * theme clears (`island-theme-contrast.test.ts`). A theme from a stranger is not
 * held to a lower bar just because nobody on the team authored it.
 */

import { describe, it, expect } from 'vitest';

import {
  contrastFailures,
  contrastReport,
  coreColorsFromPalette,
  paletteFromCoreColors,
} from './island-theme-adapter';
import { contrastRatio, hexToHslTriplet, type CoreThemeColors } from './nostr-theme';
import { ISLAND_PALETTE_KEYS, islandThemes, resolveIslandTheme } from './island-themes';

function core(background: string, text: string, primary: string): CoreThemeColors {
  return {
    background: hexToHslTriplet(background),
    text: hexToHslTriplet(text),
    primary: hexToHslTriplet(primary),
  };
}

/**
 * Themes chosen to be awkward, not pretty.
 *
 * The plausible ones prove the adapter produces a sensible island; the hostile
 * ones prove it produces a LEGIBLE one. A mid-grey theme is the case fixed
 * offsets get wrong: stepping panels the "light" way lands them where no text
 * colour clears 4.5:1.
 */
const CASES: [name: string, colors: CoreThemeColors][] = [
  ['Ditto light default', core('#f4eefb', '#1b1420', '#8b5cf6')],
  ['Ditto dark default', core('#141824', '#f5f8fc', '#7c6cf0')],
  ['pure black', core('#000000', '#010101', '#111111')],
  ['pure white', core('#ffffff', '#fefefe', '#ffffcc')],
  ['mid grey on mid grey', core('#808080', '#7f7f7f', '#808080')],
  ['clashing neon', core('#00ff00', '#ff00ff', '#ffff00')],
  ['low-contrast pastel', core('#ffe4ec', '#ffd0e0', '#ffc0d8')],
  ['saturated red on red', core('#8b0000', '#a00000', '#ff0000')],
  ['island-like', core('#fff8ec', '#3a2a1a', '#6b4fd6')],
];

describe('derivation', () => {
  it.each(CASES)('%s produces a complete palette', (_name, colors) => {
    const palette = paletteFromCoreColors(colors);
    expect(Object.keys(palette).sort()).toEqual([...ISLAND_PALETTE_KEYS].sort());
    for (const key of ISLAND_PALETTE_KEYS) {
      // Bare HSL channels, never a colour: `hsl(var(--island-x) / <alpha>)`
      // breaks on anything else, opacity modifiers included.
      expect(palette[key], `${key}`).toMatch(/^-?[\d.]+ -?[\d.]+% -?[\d.]+%$/);
    }
  });

  it.each(CASES)('%s stays readable', (_name, colors) => {
    const failures = contrastFailures(paletteFromCoreColors(colors));
    expect(
      failures.map((f) => `${f.what} ${f.ratio}:1 < ${f.min}:1`),
      'an adapted theme is held to the same bar as a built-in',
    ).toEqual([]);
  });

  it.each(CASES)('%s keeps its three surfaces apart', (_name, colors) => {
    // If page / cream / cream-2 collapse, panels stop reading as panels — a
    // failure a text-contrast check never catches, because the text still
    // passes. Same invariant the built-in palette sanity check holds.
    const p = paletteFromCoreColors(colors);
    for (const [a, b] of [
      ['page', 'cream'],
      ['page', 'cream-2'],
      ['cream', 'cream-2'],
    ] as const) {
      expect(contrastRatio(p[a], p[b]), `${a} vs ${b}`).toBeGreaterThan(1.03);
    }
  });

  it('is deterministic', () => {
    // The palette is recomputed from the three colours on every resolve rather
    // than stored, so a non-deterministic derivation would mean a theme that
    // looked different after a reload.
    const colors = core('#123456', '#eeeeee', '#ff8800');
    expect(paletteFromCoreColors(colors)).toEqual(paletteFromCoreColors(colors));
  });

  it('keeps the page exactly as the author set it', () => {
    // Everything else may be adjusted for legibility; the background is the one
    // colour the author unambiguously chose to look at.
    const colors = core('#123456', '#eeeeee', '#ff8800');
    expect(paletteFromCoreColors(colors).page).toBe(colors.background);
  });

  it('follows the theme into the dark', () => {
    const light = paletteFromCoreColors(core('#fff8ec', '#3a2a1a', '#6b4fd6'));
    const dark = paletteFromCoreColors(core('#141824', '#f5f8fc', '#7c6cf0'));
    const lightness = (t: string) => Number(t.split(' ')[2].replace('%', ''));

    // A light theme deepens its panels; a dark one lifts them. Both directions
    // are "away from the page", which is what keeps a panel a panel.
    expect(lightness(light.cream)).toBeLessThan(lightness(light.page));
    expect(lightness(dark.cream)).toBeGreaterThan(lightness(dark.page));
    // Scenery is dusked rather than left at midday.
    expect(lightness(dark.sky)).toBeLessThan(lightness(light.sky));
  });

  it('reports every pairing, passing or not', () => {
    const report = contrastReport(paletteFromCoreColors(core('#ffffff', '#000000', '#0000ff')));
    expect(report.length).toBeGreaterThan(0);
    for (const finding of report) {
      expect(finding.ratio).toBeGreaterThan(0);
      expect(finding.passes).toBe(finding.ratio >= finding.min);
    }
  });
});

describe('publishing a built-in theme', () => {
  it.each(islandThemes.map((t) => [t.name, t.id] as const))(
    '%s reduces to three colours Ditto can use',
    (_name, id) => {
      const palette = resolveIslandTheme(id).palette;
      const core3 = coreColorsFromPalette(palette);

      // The three that mean the same thing in both models.
      expect(core3.background).toBe(palette.page);
      expect(core3.text).toBe(palette.ink);
      // `purple`, not `wood-dark`: Ditto derives buttons AND links AND the
      // focus ring from `primary`, and the mascot accent is the colour the
      // island uses for that job. Publishing the frame would make every Ditto
      // button brown.
      expect(core3.primary).toBe(palette.purple);
    },
  );

  it('survives a round trip legibly, even though it is lossy', () => {
    // Sixteen authored colours do not fit in three, so a round trip is NOT
    // expected to reproduce the built-in palette. What it must do is come back
    // as a usable island — which is what a Ditto user applying an Island theme
    // and an Island player re-selecting it both get.
    for (const theme of islandThemes) {
      const roundTripped = paletteFromCoreColors(coreColorsFromPalette(theme.palette));
      expect(contrastFailures(roundTripped), theme.name).toEqual([]);
      expect(roundTripped.page).toBe(theme.palette.page);
      expect(roundTripped).not.toEqual(theme.palette);
    }
  });
});
