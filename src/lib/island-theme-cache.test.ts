/**
 * Boot-time resolution: the cache, the offline resolver, and the pre-paint
 * script that has to agree with both.
 *
 * The behaviour under test is a single promise: **a relay being unreachable
 * never changes what the player sees, and never changes what they chose.**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ISLAND_THEME_CACHE_KEY,
  clearIslandThemeCache,
  parseCachedIslandTheme,
  readIslandThemeCache,
  writeIslandThemeCache,
} from './island-theme-cache';
import { resolveIslandThemeOffline } from '@/hooks/useTheme';
import {
  DEFAULT_ISLAND_THEME_ID,
  ISLAND_PALETTE_KEYS,
  isBuiltinThemeId,
  islandThemeFromNostr,
  resolveIslandTheme,
} from './island-themes';
import { paletteFromCoreColors } from './island-theme-adapter';
import { hexToHslTriplet } from './nostr-theme';

const ROOT = resolve(__dirname, '../..');
const AUTHOR = 'a'.repeat(64);
const ADDRESS = `36767:${AUTHOR}:harbour-dusk`;

const communityTheme = islandThemeFromNostr({
  address: ADDRESS,
  pubkey: AUTHOR,
  title: 'Harbour Dusk',
  description: 'Cold water at the end of the day.',
  palette: paletteFromCoreColors({
    background: hexToHslTriplet('#141a24'),
    text: hexToHslTriplet('#f2f5fa'),
    primary: hexToHslTriplet('#5b8cff'),
  }),
});

describe('theme identity', () => {
  it('cannot collide between the two vocabularies', () => {
    // A built-in id is a bare slug and contains no colon; a Nostr id is the
    // protocol address behind a `nostr:` prefix. One `AppConfig.theme` field
    // holds both, unambiguously.
    expect(isBuiltinThemeId('cozy-day')).toBe(true);
    expect(isBuiltinThemeId('lantern-night')).toBe(true);
    expect(isBuiltinThemeId(communityTheme.id)).toBe(false);
    expect(communityTheme.id).toBe(`nostr:${ADDRESS}`);
  });
});

describe('the palette cache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a community theme', () => {
    writeIslandThemeCache(communityTheme);
    const cached = readIslandThemeCache()!;
    expect(cached.id).toBe(communityTheme.id);
    expect(cached.name).toBe('Harbour Dusk');
    expect(cached.palette).toEqual(communityTheme.palette);
  });

  it('refuses an entry that is not a complete, valid palette', () => {
    const good = { id: 'x', name: 'X', description: '', palette: communityTheme.palette };
    expect(parseCachedIslandTheme(good)).not.toBeNull();

    // This value is written straight into custom properties by a script with no
    // error handling of its own, so every failure mode is rejected here.
    const { ink: _dropped, ...missingKey } = communityTheme.palette;
    for (const bad of [
      null,
      'nope',
      {},
      { id: 'x', palette: {} },
      { id: '', palette: communityTheme.palette },
      { id: 'x', palette: missingKey },
      { id: 'x', palette: { ...communityTheme.palette, ink: 'red' } },
      { id: 'x', palette: { ...communityTheme.palette, ink: 'var(--evil)' } },
      { id: 'x', palette: { ...communityTheme.palette, ink: '10 20%' } },
    ]) {
      expect(parseCachedIslandTheme(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });

  it('survives corrupt storage without throwing', () => {
    localStorage.setItem(ISLAND_THEME_CACHE_KEY, '{not json');
    expect(readIslandThemeCache()).toBeNull();
  });

  it('is cleared when a built-in is chosen', () => {
    writeIslandThemeCache(communityTheme);
    clearIslandThemeCache();
    expect(readIslandThemeCache()).toBeNull();
  });
});

describe('offline resolution', () => {
  beforeEach(() => localStorage.clear());

  it('resolves a built-in from the bundle', () => {
    expect(resolveIslandThemeOffline('lantern-night').palette).toEqual(
      resolveIslandTheme('lantern-night').palette,
    );
  });

  it('renders a selected community theme from cache, with no relay', () => {
    writeIslandThemeCache(communityTheme);
    const resolved = resolveIslandThemeOffline(communityTheme.id);
    expect(resolved.id).toBe(communityTheme.id);
    expect(resolved.palette).toEqual(communityTheme.palette);
    expect(resolved.source).toBe('nostr');
  });

  it('ignores a cache that belongs to a different theme', () => {
    writeIslandThemeCache(communityTheme);
    expect(resolveIslandThemeOffline(`nostr:36767:${AUTHOR}:something-else`).id).toBe(
      DEFAULT_ISLAND_THEME_ID,
    );
  });

  it('falls back to the default for an unknown, uncached id', () => {
    expect(resolveIslandThemeOffline('harvest-moon-2019').id).toBe(DEFAULT_ISLAND_THEME_ID);
    expect(resolveIslandThemeOffline(undefined).id).toBe(DEFAULT_ISLAND_THEME_ID);
  });
});

describe('the pre-paint script agrees with the cache', () => {
  const boot = readFileSync(resolve(ROOT, 'public/island-theme.js'), 'utf8');

  it('reads the same storage key', () => {
    expect(boot).toContain(ISLAND_THEME_CACHE_KEY);
  });

  it('knows every palette key', () => {
    // A key the script does not write is a colour that flashes wrong on every
    // boot for anyone using a community theme.
    const block = boot.match(/PALETTE_KEYS\s*=\s*\[([\s\S]*?)\]/);
    expect(block, 'public/island-theme.js has no PALETTE_KEYS').toBeTruthy();
    const keys = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...ISLAND_PALETTE_KEYS].sort());
  });

  it('validates the cached entry before applying it', () => {
    // Same rule as `parseCachedIslandTheme`: the entry must name the selected
    // theme, and every value must be a plain channel triplet.
    expect(boot).toMatch(/entry\.id !== id/);
    expect(boot).toMatch(/\/\^-\?\[\\d\.\]\+ -\?\[\\d\.\]\+% -\?\[\\d\.\]\+%\$\//);
  });

  it('still falls back to the default when there is no usable cache', () => {
    expect(boot).toMatch(new RegExp(`DEFAULT_ID\\s*=\\s*'${DEFAULT_ISLAND_THEME_ID}'`));
    expect(boot).toMatch(/if \(cached\) \{/);
  });

  it('contains the cache parse in its own try, not the outer one', () => {
    // A corrupt entry must cost a FALLBACK, not the whole palette write. When
    // this parse lived in the outer try, a `{bad` in storage threw past the
    // `setProperty` loop and the boot script applied nothing at all, leaving
    // the loading screen unpainted and `data-island-theme` unset.
    const fn = boot.match(/function cachedPalette\(id\) \{([\s\S]*?)\n {2}\}/);
    expect(fn, 'public/island-theme.js has no cachedPalette').toBeTruthy();
    expect(fn![1]).toMatch(/try \{[\s\S]*JSON\.parse[\s\S]*\} catch/);
  });
});
