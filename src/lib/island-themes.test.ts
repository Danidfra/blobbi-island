import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_ISLAND_THEME_ID,
  ISLAND_PALETTE_KEYS,
  applyIslandTheme,
  islandThemeDeclarations,
  islandThemes,
  isKnownIslandThemeId,
  resolveIslandTheme,
} from './island-themes';

/**
 * The registry's own invariants, plus the two duplications the architecture
 * deliberately accepts:
 *
 *   1. the default palette is also written literally into `:root` in
 *      src/index.css, so the island renders correctly with no JavaScript;
 *   2. every palette is also written into public/island-theme.js, so the
 *      correct theme is applied before first paint.
 *
 * Both are asserted here rather than defended by a build step, because the
 * failure they prevent (a theme added in one place and not the others) is
 * silent and cosmetic, exactly the kind that ships.
 */

const ROOT = resolve(__dirname, '../..');

describe('island theme registry', () => {
  it('every theme defines every palette key', () => {
    for (const theme of islandThemes) {
      for (const key of ISLAND_PALETTE_KEYS) {
        expect(theme.palette[key], `${theme.id} is missing "${key}"`).toBeTruthy();
      }
      // No stray keys either, an extra one is a colour nothing reads.
      expect(Object.keys(theme.palette).sort()).toEqual([...ISLAND_PALETTE_KEYS].sort());
    }
  });

  it('every palette value is bare HSL channels, never a colour', () => {
    // The Tailwind palette is declared as `hsl(var(--island-x) / <alpha-value>)`,
    // so a hex or an `hsl(...)` here would break every class that uses the token,
    // including, silently, every opacity modifier.
    for (const theme of islandThemes) {
      for (const key of ISLAND_PALETTE_KEYS) {
        expect(theme.palette[key], `${theme.id}.${key}`).toMatch(
          /^\d{1,3} \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/,
        );
      }
    }
  });

  it('theme ids are unique and the default exists', () => {
    const ids = islandThemes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_ISLAND_THEME_ID);
  });

  it('every theme carries picker metadata', () => {
    for (const theme of islandThemes) {
      expect(theme.name.length, theme.id).toBeGreaterThan(0);
      expect(theme.description.length, theme.id).toBeGreaterThan(0);
      expect(theme.emoji.length, theme.id).toBeGreaterThan(0);
    }
  });

  it('ships more than one theme, so the architecture is actually exercised', () => {
    expect(islandThemes.length).toBeGreaterThan(1);
  });
});

describe('resolveIslandTheme', () => {
  it('resolves a known id', () => {
    expect(resolveIslandTheme('lantern-night').id).toBe('lantern-night');
  });

  it('falls back to the default for an unknown id', () => {
    expect(resolveIslandTheme('a-theme-that-was-removed').id).toBe(DEFAULT_ISLAND_THEME_ID);
  });

  it('falls back to the default for the legacy light/dark/system values', () => {
    // These were the previous meaning of AppConfig.theme. They are not
    // migrated: they resolve through the same unknown-id path.
    for (const legacy of ['light', 'dark', 'system']) {
      expect(resolveIslandTheme(legacy).id).toBe(DEFAULT_ISLAND_THEME_ID);
    }
  });

  it('falls back to the default for undefined', () => {
    expect(resolveIslandTheme(undefined).id).toBe(DEFAULT_ISLAND_THEME_ID);
  });

  it('never returns undefined', () => {
    expect(resolveIslandTheme('')).toBeDefined();
  });
});

describe('isKnownIslandThemeId', () => {
  it('distinguishes real ids from stale ones', () => {
    expect(isKnownIslandThemeId(DEFAULT_ISLAND_THEME_ID)).toBe(true);
    expect(isKnownIslandThemeId('light')).toBe(false);
    expect(isKnownIslandThemeId(undefined)).toBe(false);
  });
});

describe('applyIslandTheme', () => {
  it('writes every palette key as a custom property plus the id attribute', () => {
    const el = document.createElement('div');
    const theme = resolveIslandTheme('lantern-night');

    applyIslandTheme(theme, el);

    expect(el.getAttribute('data-island-theme')).toBe('lantern-night');
    for (const key of ISLAND_PALETTE_KEYS) {
      expect(el.style.getPropertyValue(`--island-${key}`)).toBe(theme.palette[key]);
    }
  });

  it('fully replaces the previous theme, leaving nothing behind', () => {
    const el = document.createElement('div');

    applyIslandTheme(resolveIslandTheme('lantern-night'), el);
    applyIslandTheme(resolveIslandTheme('cozy-day'), el);

    const cozy = resolveIslandTheme('cozy-day');
    expect(el.getAttribute('data-island-theme')).toBe('cozy-day');
    for (const key of ISLAND_PALETTE_KEYS) {
      expect(el.style.getPropertyValue(`--island-${key}`)).toBe(cozy.palette[key]);
    }
  });

  it('declarations cover exactly the palette', () => {
    const decls = islandThemeDeclarations(resolveIslandTheme('cozy-day'));
    expect(decls).toHaveLength(ISLAND_PALETTE_KEYS.length);
    expect(decls.every(([prop]) => prop.startsWith('--island-'))).toBe(true);
  });
});

describe('the stylesheet default matches the default theme', () => {
  it(':root in src/index.css declares the default palette value for value', () => {
    const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');
    const theme = resolveIslandTheme(DEFAULT_ISLAND_THEME_ID);

    for (const key of ISLAND_PALETTE_KEYS) {
      // Anchored to the start of a line so the prose in the file header
      // (which cites `--island-wood: 27 40% 54%` as the worked example)
      // cannot be mistaken for the declaration.
      const match = css.match(new RegExp(`^\\s*--island-${key}:\\s*([^;]+);`, 'm'));
      expect(match, `src/index.css does not declare --island-${key}`).toBeTruthy();
      expect(match![1].trim(), `--island-${key} in src/index.css`).toBe(theme.palette[key]);
    }
  });
});

describe('the pre-paint boot script matches the registry', () => {
  const boot = readFileSync(resolve(ROOT, 'public/island-theme.js'), 'utf8');

  it('declares the same default id', () => {
    expect(boot).toMatch(new RegExp(`DEFAULT_ID\\s*=\\s*'${DEFAULT_ISLAND_THEME_ID}'`));
  });

  it.each(islandThemes.map((t) => [t.id, t] as const))(
    'carries %s with an identical palette',
    (id, theme) => {
      // Parse the theme's object literal out of the script rather than
      // eval-ing it, so this stays a pure text comparison of two sources.
      const block = boot.match(new RegExp(`'${id}':\\s*\\{([^}]*)\\}`));
      expect(block, `public/island-theme.js is missing the "${id}" palette`).toBeTruthy();

      for (const key of ISLAND_PALETTE_KEYS) {
        const entry = block![1].match(new RegExp(`'?${key}'?:\\s*'([^']+)'`));
        expect(entry, `"${id}" is missing "${key}" in public/island-theme.js`).toBeTruthy();
        expect(entry![1], `${id}.${key} in public/island-theme.js`).toBe(theme.palette[key]);
      }
    },
  );

  it('carries no theme the registry does not have', () => {
    const ids = [...boot.matchAll(/^\s{4}'([a-z0-9-]+)':\s*\{$/gm)].map((m) => m[1]);
    expect(ids.sort()).toEqual(islandThemes.map((t) => t.id).sort());
  });
});
