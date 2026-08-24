/**
 * The two cross-app scenarios, as pure resolution.
 *
 * ```
 *   Ditto select  →  Island startup  →  same theme
 *   Island select →  Ditto's resolver →  same theme
 * ```
 *
 * `resolveRemoteSelection` is the Island half and is exported for exactly this;
 * `dittoWouldRender` below is the Ditto half, transcribed from
 * `resolveTheme` + `useApplyBackground` + `NostrSync` in the Ditto source. Both
 * are pure, so these are the fast tests that pin the behaviour the manual
 * cross-app checklist verifies with real relays.
 *
 * Every one of these fails against the pre-fix implementation: it required a
 * remote event to NAME a theme it could resolve, and Ditto names nothing in the
 * common case.
 */

import { describe, it, expect } from 'vitest';

import { resolveRemoteSelection } from '@/components/IslandThemeSync';
import { DITTO_ACTIVE_THEME_ID, resolveIslandTheme } from '@/lib/island-themes';
import { themeConfigFromIslandTheme } from '@/lib/island-theme-adapter';
import { hexToHslTriplet, type ThemeConfig } from '@/lib/nostr-theme';
import {
  mergeDittoThemeSettings,
  parseDittoThemeSettings,
  themeConfigFromDittoSettings,
} from '@/lib/ditto-settings';

const AUTHOR = 'a'.repeat(64);

const HARBOUR: ThemeConfig = {
  title: 'Harbour Dusk',
  colors: {
    background: hexToHslTriplet('#141a24'),
    text: hexToHslTriplet('#f2f5fa'),
    primary: hexToHslTriplet('#5b8cff'),
  },
  font: { family: 'Playfair Display', url: 'https://fonts.example/pf.woff2' },
  background: { url: 'https://media.example/w.jpg', mode: 'cover' },
};

/**
 * What Ditto would render for a given settings blob.
 *
 * From `resolveTheme` in ditto `src/themes.ts`: the mode is `light`, `dark`,
 * `system` or `custom`, and ONLY `custom` renders `customTheme`. This is the
 * rule that made an Island-published 16767 invisible.
 */
function dittoWouldRender(blobJson: string): ThemeConfig | 'builtin' | null {
  const settings = parseDittoThemeSettings(blobJson);
  if (!settings) return null;
  if (settings.theme !== 'custom') return 'builtin';
  return settings.customTheme ?? null;
}

// ─── Ditto → Island ──────────────────────────────────────────────────────────

describe('Ditto select → Island startup', () => {
  it('adopts a theme Ditto selected from a community definition', () => {
    // Ditto's `applyCustomTheme` writes the settings blob AND (2s later) a
    // kind:16767 carrying an `a` reference to the definition.
    const remote = resolveRemoteSelection({
      settingsConfig: HARBOUR,
      activeConfig: HARBOUR,
      activeSourceAddress: `36767:${AUTHOR}:harbour-dusk`,
      activeIslandThemeId: null,
    })!;

    // A NAMED theme is adopted by name, so the island follows the author's
    // later edits to it rather than freezing today's colours.
    expect(remote.id).toBe(`nostr:36767:${AUTHOR}:harbour-dusk`);
  });

  it('adopts a SELF-CONTAINED theme — the case Ditto produces most often', () => {
    /*
      This is the Ditto → Island bug, in one assertion.

      Selecting a preset, or nudging a colour, produces a 16767 with three `c`
      tags, an `alt`, maybe a `title` — and NO `a` tag, because there is no
      definition behind it. The previous resolver required a name and returned
      early. There is nothing wrong with the event; it is complete.
    */
    const remote = resolveRemoteSelection({
      settingsConfig: HARBOUR,
      activeConfig: HARBOUR,
      activeSourceAddress: null,
      activeIslandThemeId: null,
    })!;

    expect(remote.id).toBe(DITTO_ACTIVE_THEME_ID);
    expect(remote.theme.name).toBe('Harbour Dusk');
    // And it arrives complete: font and wallpaper included, not colours only.
    expect(remote.theme.config).toEqual(HARBOUR);
  });

  it('prefers the encrypted settings over the public event', () => {
    // 30078 is what Ditto RENDERS. If the two disagree — a 16767 that has not
    // caught up, or one the user published from another client — the settings
    // blob wins, because that is the one Ditto is looking at.
    const newer: ThemeConfig = { ...HARBOUR, title: 'Newer' };
    const remote = resolveRemoteSelection({
      settingsConfig: newer,
      activeConfig: HARBOUR,
      activeSourceAddress: null,
      activeIslandThemeId: null,
    })!;
    expect(remote.theme.config?.title).toBe('Newer');
  });

  it('falls back to the public event when the settings cannot be read', () => {
    // A signer with no NIP-44, or a relay carrying only public events. The
    // 16767 is then the best information available, and it is still correct.
    const remote = resolveRemoteSelection({
      settingsConfig: null,
      activeConfig: HARBOUR,
      activeSourceAddress: null,
      activeIslandThemeId: null,
    })!;
    expect(remote.id).toBe(DITTO_ACTIVE_THEME_ID);
    expect(remote.theme.config).toEqual(HARBOUR);
  });

  it('adopts nothing when the account has no theme at all', () => {
    expect(
      resolveRemoteSelection({
        settingsConfig: null,
        activeConfig: null,
        activeSourceAddress: null,
        activeIslandThemeId: null,
      }),
    ).toBeNull();
  });

  it('ignores a stale customTheme left under a built-in mode', () => {
    // Ditto keeps `customTheme` around when the user switches back to `dark`,
    // so it can be restored. It is NOT what they are looking at, and adopting
    // it would show the island a theme Ditto is not rendering.
    const blob = JSON.stringify({ theme: 'dark', customTheme: HARBOUR });
    expect(themeConfigFromDittoSettings(parseDittoThemeSettings(blob))).toBeNull();
    expect(dittoWouldRender(blob)).toBe('builtin');
  });
});

// ─── Island → Ditto ──────────────────────────────────────────────────────────

describe('Island select → Ditto startup', () => {
  it('makes Ditto render an Island BUILT-IN', () => {
    /*
      This is the Island → Ditto bug.

      Publishing only a 16767 leaves Ditto on whatever mode it was already on:
      `NostrSync` imports the palette into `customTheme` and, in its own words,
      does "NOT change the `theme` value". The mode has to be set, and the mode
      lives in the encrypted blob.
    */
    const lantern = resolveIslandTheme('lantern-night');
    const config = themeConfigFromIslandTheme(lantern);

    const before = JSON.stringify({ theme: 'dark', feedSettings: { showReplies: false } });
    expect(dittoWouldRender(before)).toBe('builtin');

    const after = JSON.stringify(
      mergeDittoThemeSettings(parseDittoThemeSettings(before)!.raw, {
        theme: 'custom',
        customTheme: config,
        nowMs: 1_700_000_000_000,
      }),
    );

    const rendered = dittoWouldRender(after);
    expect(rendered).not.toBe('builtin');
    expect((rendered as ThemeConfig).title).toBe('Lantern Night');
    expect((rendered as ThemeConfig).colors).toEqual(config.colors);
    // Ditto renders three colours; the island's other thirteen were never its
    // business, and the ones that travel are the ones that mean the same thing.
    expect((rendered as ThemeConfig).colors.background).toBe(lantern.palette.page);
  });

  it('carries a community theme through Island back to Ditto unchanged', () => {
    // Selecting somebody else's theme in Island must not cost its font or
    // wallpaper on the way to the other app.
    const islandTheme = {
      id: `nostr:36767:${AUTHOR}:harbour-dusk`,
      name: 'Harbour Dusk',
      description: '',
      emoji: '✨',
      palette: resolveIslandTheme('cozy-day').palette,
      source: 'nostr' as const,
      address: `36767:${AUTHOR}:harbour-dusk`,
      config: HARBOUR,
    };

    const config = themeConfigFromIslandTheme(islandTheme);
    expect(config).toEqual(HARBOUR);

    const blob = JSON.stringify(
      mergeDittoThemeSettings({}, { theme: 'custom', customTheme: config, nowMs: 1 }),
    );
    const rendered = dittoWouldRender(blob) as ThemeConfig;
    expect(rendered.font).toEqual(HARBOUR.font);
    expect(rendered.background).toEqual(HARBOUR.background);
  });

  it('never erases the rest of the account settings', () => {
    const before = {
      theme: 'system',
      feedSettings: { showReplies: true },
      contentFilters: [{ id: 'spam' }],
      savedFeeds: [{ id: 'a' }],
      notificationsCursor: 99,
      lastSync: 5,
    };
    const after = mergeDittoThemeSettings(before, {
      theme: 'custom',
      customTheme: HARBOUR,
      nowMs: 6,
    });
    for (const key of ['feedSettings', 'contentFilters', 'savedFeeds', 'notificationsCursor']) {
      expect(after[key]).toEqual(before[key as keyof typeof before]);
    }
  });
});

// ─── Round trip ──────────────────────────────────────────────────────────────

describe('a theme survives a round trip through both apps', () => {
  it('Ditto → Island → Ditto is the identity for the interoperable fields', () => {
    // Ditto writes it…
    const dittoBlob = JSON.stringify(
      mergeDittoThemeSettings({}, { theme: 'custom', customTheme: HARBOUR, nowMs: 1 }),
    );

    // …Island reads it…
    const settings = parseDittoThemeSettings(dittoBlob)!;
    const remote = resolveRemoteSelection({
      settingsConfig: themeConfigFromDittoSettings(settings),
      activeConfig: null,
      activeSourceAddress: null,
      activeIslandThemeId: null,
    })!;

    // …and Island writes it back.
    const republished = themeConfigFromIslandTheme(remote.theme);
    expect(republished).toEqual(HARBOUR);
    expect(dittoWouldRender(
      JSON.stringify(
        mergeDittoThemeSettings({}, { theme: 'custom', customTheme: republished, nowMs: 2 }),
      ),
    )).toEqual(HARBOUR);
  });
});
