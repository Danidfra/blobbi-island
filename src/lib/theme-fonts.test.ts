/**
 * The curated font registry, and the CSS cascade contract it feeds.
 *
 * The registry is a transcription of Ditto's `bundledFonts`, so the tests that
 * matter are the ones that catch it drifting: URLs that no longer match the
 * fontsource pattern, families Ditto curates that Island has not copied, and
 * the variable/static flag that decides whether a face gets a weight range.
 *
 * The cascade tests read the real `src/index.css` rather than a browser,
 * because jsdom does not resolve `var()` and asserting on a fake would prove
 * nothing. What they pin is the CONTRACT: one declaration site, one variable,
 * and no component quietly re-declaring a family below it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CURATED_FONTS,
  findCuratedFont,
  isVariableFontFamily,
  resolveThemeFontUrl,
} from './theme-fonts';
import { FONT_BODY_VAR, FONT_DISPLAY_VAR } from './island-theme-media';

const ROOT = resolve(__dirname, '../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('the curated registry', () => {
  it('covers the families Ditto bundles', () => {
    // Spot-check across the categories rather than restating the table: a
    // missing family costs a theme its font only when that theme omits a URL,
    // so the failure is soft — but it is exactly the failure this phase fixed.
    for (const family of [
      'Inter',
      'Playfair Display',
      'Comfortaa',
      'Press Start 2P',
      'Pacifico',
      'JetBrains Mono',
      'Comic Neue',
    ]) {
      expect(findCuratedFont(family), family).toBeDefined();
    }
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(25);
  });

  it('matches fontsource URLs on every entry', () => {
    for (const font of CURATED_FONTS) {
      expect(font.url, font.family).toMatch(
        /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/[a-z0-9-]+(:vf)?@latest\/latin-(wght-normal|400-normal)\.woff2$/,
      );
      // A variable font is published as `:vf` + `latin-wght-normal`; a static
      // one as `latin-400-normal`. The flag decides whether the `@font-face`
      // claims a weight range, so a mismatch is a rendering bug.
      expect(font.url.includes(':vf'), `${font.family} variable flag`).toBe(font.variable);
      expect(font.url.includes('wght-normal'), `${font.family} file`).toBe(font.variable);
    }
  });

  it('has no duplicate families', () => {
    const families = CURATED_FONTS.map((f) => f.family.toLowerCase());
    expect(new Set(families).size).toBe(families.length);
  });

  it('looks a family up case-insensitively, as Ditto does', () => {
    expect(findCuratedFont('playfair display')?.family).toBe('Playfair Display');
    expect(findCuratedFont('  INTER  ')?.family).toBe('Inter');
    expect(findCuratedFont('Not A Font')).toBeUndefined();
    expect(findCuratedFont(undefined)).toBeUndefined();
  });

  it('prefers an explicit URL and falls back to the registry', () => {
    expect(resolveThemeFontUrl('Inter', 'https://mine.example/i.woff2')).toBe(
      'https://mine.example/i.woff2',
    );
    expect(resolveThemeFontUrl('Inter')).toContain('jsdelivr');
    // An uncurated family with no URL has nowhere to fetch from, and that is a
    // legitimate answer — not every font is one of Ditto's.
    expect(resolveThemeFontUrl('Georgia')).toBeUndefined();
  });

  it('reports variability only for families it knows', () => {
    expect(isVariableFontFamily('Inter')).toBe(true);
    expect(isVariableFontFamily('Pacifico')).toBe(false);
    expect(isVariableFontFamily('Georgia')).toBe(false);
  });
});

describe('the CSS cascade contract', () => {
  it('declares the body family exactly once, on html', () => {
    // The whole themeability of the app rests on this. A second
    // `font-family` on a shared element would pin every surface below it, and
    // that is invisible until somebody selects a theme with a font.
    const declarations = [...css.matchAll(/^\s*font-family:\s*([^;]+);/gm)].map((m) =>
      m[1].trim(),
    );
    expect(declarations).toEqual([`var(${FONT_BODY_VAR})`, `var(${FONT_DISPLAY_VAR})`]);
  });

  it('defaults both variables to the island\'s own type', () => {
    expect(css).toMatch(new RegExp(`${FONT_BODY_VAR}:\\s*Comfortaa, system-ui, sans-serif`));
    // The display font falls back to the BODY font, not to Comfortaa, so a
    // theme with only a body font still reads as one typeface.
    expect(css).toMatch(new RegExp(`${FONT_DISPLAY_VAR}:\\s*var\\(${FONT_BODY_VAR}\\)`));
  });

  it('applies the body family to html, so everything inherits it', () => {
    expect(css).toMatch(new RegExp(`html\\s*\\{\\s*font-family:\\s*var\\(${FONT_BODY_VAR}\\)`));
  });

  it('gates the display font behind one opt-in class', () => {
    expect(css).toMatch(
      new RegExp(`\\.island-display\\s*\\{\\s*font-family:\\s*var\\(${FONT_DISPLAY_VAR}\\)`),
    );
  });
});

/** Every `.ts`/`.tsx` under `src`, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no component overrides the inherited family', () => {
  it('has no stray font-family in production components', () => {
    /*
      The regression this guards.

      A theme font reaches the app through ONE inherited variable. Any component
      that sets `font-family` itself — a hardcoded `Comfortaa`, a Tailwind
      `font-sans` utility, an inline style — becomes a hole the theme cannot
      reach, and nothing about the app looks wrong until a themed player opens
      it. The exceptions below are deliberate and named.
    */
    const allowed = new Set([
      // The font machinery itself, and the scoped previews it powers.
      'src/lib/island-theme-media.ts',
      'src/components/shell/ThemePicker.tsx',
      'src/components/shell/ThemeCreateDialog.tsx',
      // DELIBERATE special-purpose typography: the Nostr Hub's title is a
      // glowing monospace terminal treatment, the same category as an arcade
      // cabinet's display. A theme's body font there would defeat the effect,
      // which is art direction rather than an oversight. See docs/themes.md.
      'src/components/NostrHubModal.tsx',
    ]);

    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const rel = file.slice(ROOT.length + 1);
      if (allowed.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      if (/fontFamily\s*:/.test(source) || /font-family\s*:/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses font-family utilities only where a fixed face is the point', () => {
    // `font-mono` on hex addresses, event ids and filenames is deliberate: a
    // proportional face makes those genuinely harder to read, and no theme
    // should change them. `font-bold`/`font-semibold`/`font-medium` are WEIGHT,
    // not family, and are none of this test's business.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bfont-(sans|serif|\[[^\]]+\])/g)) {
        offenders.push(`${file.slice(ROOT.length + 1)}: ${match[0]}`);
      }
    }
    // One known call site: the raw-event inspector deliberately drops out of
    // `font-mono` for a label inside an otherwise monospaced block.
    expect(offenders).toEqual([
      'src/components/tools/game-items/RawEventInspector.tsx: font-sans',
    ]);
  });
});
