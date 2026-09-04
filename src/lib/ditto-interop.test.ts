/**
 * Cross-app theme interoperability with Ditto.
 *
 * Every fixture in this file is transcribed from the CURRENT Ditto source at
 * `/Users/filemon/Developer/ditto`: `src/lib/themeEvent.ts`,
 * `src/hooks/useEncryptedSettings.ts`, `src/components/NostrSync.tsx`,
 * `src/hooks/useTheme.ts` and `src/hooks/usePublishTheme.ts`. Nothing here is
 * invented; where a shape looks odd it is because Ditto's is.
 *
 * These tests exist because the previous phase shipped a protocol that PARSED
 * correctly and still did not interoperate. Parsing was never the problem.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  ACTIVE_THEME_KIND,
  THEME_DEFINITION_KIND,
  buildActiveThemeTags,
  buildThemeDefinitionTags,
  hexToHslTriplet,
  parseActiveTheme,
  parseThemeDefinition,
  type ThemeConfig,
} from './nostr-theme';
import {
  DITTO_SETTINGS_D,
  NIP78_KIND,
  parseDittoThemeSettings,
  mergeDittoThemeSettings,
  themeConfigFromDittoSettings,
} from './ditto-settings';

const AUTHOR = 'a'.repeat(64);

function event(partial: Partial<NostrEvent> & Pick<NostrEvent, 'kind' | 'tags'>): NostrEvent {
  return {
    id: partial.id ?? '0'.repeat(64),
    pubkey: partial.pubkey ?? AUTHOR,
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    sig: partial.sig ?? '',
    ...partial,
  } as NostrEvent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ditto's own builders, reproduced verbatim so the parity tests compare Island
// against Ditto rather than against Island's idea of Ditto.
//
// Source: ditto `src/lib/themeEvent.ts`: `buildColorTags`, `buildFontTags`,
// `buildBackgroundTag`, `buildThemeDefinitionTags`, `buildActiveThemeTags`.
// ─────────────────────────────────────────────────────────────────────────────

function dittoHslToHex(hsl: string): string {
  const [h, s, l] = hsl.replace(/%/g, '').split(/\s+/).map(Number);
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((lN - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function dittoColorTags(colors: { background: string; text: string; primary: string }) {
  return (['background', 'text', 'primary'] as const).map((role) => [
    'c',
    dittoHslToHex(colors[role]),
    role,
  ]);
}

function dittoFontTags(
  font: { family: string; url?: string } | undefined,
  titleFont: { family: string; url?: string } | undefined,
) {
  const tags: string[][] = [];
  if (font?.family) tags.push(['f', font.family, font.url ?? '', 'body']);
  if (titleFont?.family) tags.push(['f', titleFont.family, titleFont.url ?? '', 'title']);
  return tags;
}

function dittoBackgroundTag(bg: ThemeConfig['background']) {
  if (!bg?.url) return [];
  const entries = ['bg', `url ${bg.url}`];
  if (bg.mode) entries.push(`mode ${bg.mode}`);
  if (bg.mimeType) entries.push(`m ${bg.mimeType}`);
  if (bg.dimensions) entries.push(`dim ${bg.dimensions}`);
  if (bg.blurhash) entries.push(`blurhash ${bg.blurhash}`);
  return [entries];
}

/** Ditto `buildThemeDefinitionTags(identifier, title, themeConfig, description)`. */
function dittoBuildDefinitionTags(
  identifier: string,
  title: string,
  config: ThemeConfig,
  description?: string,
): string[][] {
  const tags: string[][] = [
    ['d', identifier],
    ...dittoColorTags(config.colors),
    ...dittoFontTags(config.font, config.titleFont),
    ...dittoBackgroundTag(config.background),
    ['title', title],
    ['alt', `Custom theme: ${title}`],
    ['t', 'theme'],
  ];
  if (description) tags.push(['description', description]);
  return tags;
}

/** Ditto `buildActiveThemeTags(themeConfig, sourceAuthor, sourceIdentifier, description)`. */
function dittoBuildActiveTags(
  config: ThemeConfig,
  sourceAuthor?: string,
  sourceIdentifier?: string,
  description?: string,
): string[][] {
  const tags: string[][] = [
    ...dittoColorTags(config.colors),
    ...dittoFontTags(config.font, config.titleFont),
    ...dittoBackgroundTag(config.background),
    ['alt', 'Active profile theme'],
  ];
  if (config.title) tags.push(['title', config.title]);
  if (description) tags.push(['description', description]);
  if (sourceAuthor && sourceIdentifier) {
    tags.push(['a', `${THEME_DEFINITION_KIND}:${sourceAuthor}:${sourceIdentifier}`]);
  }
  return tags;
}

const CONFIG: ThemeConfig = {
  title: 'Harbour Dusk',
  colors: {
    background: hexToHslTriplet('#141a24'),
    text: hexToHslTriplet('#f2f5fa'),
    primary: hexToHslTriplet('#5b8cff'),
  },
  font: { family: 'Playfair Display', url: 'https://fonts.example/pf.woff2' },
  titleFont: { family: 'Outfit', url: 'https://fonts.example/outfit.woff2' },
  background: {
    url: 'https://media.example/wallpaper.jpg',
    mode: 'cover',
    mimeType: 'image/jpeg',
    dimensions: '1920x1080',
    blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

describe('kind:36767: definition parity with Ditto', () => {
  it('builds byte-identical tags for the same input', () => {
    expect(
      buildThemeDefinitionTags({
        identifier: 'harbour-dusk',
        title: 'Harbour Dusk',
        config: CONFIG,
        description: 'Cold water at the end of the day.',
      }),
    ).toEqual(
      dittoBuildDefinitionTags(
        'harbour-dusk',
        'Harbour Dusk',
        CONFIG,
        'Cold water at the end of the day.',
      ),
    );
  });

  it('parses a Ditto-built definition with all fields intact', () => {
    const parsed = parseThemeDefinition(
      event({
        kind: THEME_DEFINITION_KIND,
        tags: dittoBuildDefinitionTags('harbour-dusk', 'Harbour Dusk', CONFIG),
      }),
    )!;

    expect(parsed.config.colors).toEqual(CONFIG.colors);
    expect(parsed.config.font).toEqual(CONFIG.font);
    expect(parsed.config.titleFont).toEqual(CONFIG.titleFont);
    expect(parsed.config.background).toEqual(CONFIG.background);
  });

  it('treats a legacy `f` tag with no role as the body font', () => {
    // Ditto's `parseFontTags`: "legacy tags without a role are treated as body".
    const parsed = parseThemeDefinition(
      event({
        kind: THEME_DEFINITION_KIND,
        tags: [
          ['d', 'x'],
          ...dittoColorTags(CONFIG.colors),
          ['f', 'Playfair Display', 'https://fonts.example/pf.woff2'],
          ['title', 'X'],
        ],
      }),
    )!;
    expect(parsed.config.font?.family).toBe('Playfair Display');
    expect(parsed.config.titleFont).toBeUndefined();
  });

  it('drops a background URL that is not https', () => {
    // Ditto's `sanitizeUrl` accepts `https:` only.
    const parsed = parseThemeDefinition(
      event({
        kind: THEME_DEFINITION_KIND,
        tags: [
          ['d', 'x'],
          ...dittoColorTags(CONFIG.colors),
          ['bg', 'url javascript:alert(1)', 'mode cover'],
          ['title', 'X'],
        ],
      }),
    )!;
    expect(parsed.config.background).toBeUndefined();
  });
});

describe('kind:16767: active-theme parity with Ditto', () => {
  it('builds byte-identical tags for a theme with a source definition', () => {
    expect(
      buildActiveThemeTags({
        config: CONFIG,
        sourceAuthor: AUTHOR,
        sourceIdentifier: 'harbour-dusk',
      }),
    ).toEqual(dittoBuildActiveTags(CONFIG, AUTHOR, 'harbour-dusk'));
  });

  it('builds byte-identical tags for a self-contained theme', () => {
    expect(buildActiveThemeTags({ config: CONFIG })).toEqual(dittoBuildActiveTags(CONFIG));
  });

  /**
   * THE Ditto → Island bug.
   *
   * Ditto publishes a SELF-CONTAINED active theme for every selection that did
   * not come from a kind:36767 definition, a built-in preset, an edited
   * palette, a colour tweak. Those events carry no `a` tag, and of course no
   * Island tag. Island's previous resolver required one or the other and
   * therefore ignored the single most common event Ditto produces.
   */
  it('parses a self-contained Ditto active theme with no `a` tag', () => {
    const parsed = parseActiveTheme(
      event({ kind: ACTIVE_THEME_KIND, tags: dittoBuildActiveTags(CONFIG) }),
    )!;

    expect(parsed.sourceAddress).toBeNull();
    expect(parsed.islandThemeId).toBeNull();
    // …and it is still a complete, applicable theme.
    expect(parsed.config.colors).toEqual(CONFIG.colors);
    expect(parsed.config.font).toEqual(CONFIG.font);
    expect(parsed.config.background).toEqual(CONFIG.background);
    expect(parsed.config.title).toBe('Harbour Dusk');
  });

  it('round-trips a Ditto active theme back to Ditto unchanged', () => {
    const parsed = parseActiveTheme(
      event({ kind: ACTIVE_THEME_KIND, tags: dittoBuildActiveTags(CONFIG, AUTHOR, 'harbour-dusk') }),
    )!;
    // Re-publishing what we read must not drop the author's font or wallpaper.
    expect(
      buildActiveThemeTags({
        config: parsed.config,
        sourceAuthor: AUTHOR,
        sourceIdentifier: 'harbour-dusk',
      }),
    ).toEqual(dittoBuildActiveTags(CONFIG, AUTHOR, 'harbour-dusk'));
  });
});

describe('kind:30078: Ditto encrypted settings', () => {
  /**
   * THE Island → Ditto bug.
   *
   * Ditto's app theme is NOT kind:16767. `useActiveProfileTheme` (16767) is
   * consumed only by ProfilePage and FollowPage; it decorates a PROFILE.
   * Ditto's own active theme is `AppConfig.theme` + `AppConfig.customTheme`,
   * synced across devices as NIP-78 kind:30078 under `d = "ditto/metadata"`,
   * NIP-44 encrypted to self.
   *
   * On pageload Ditto does read 16767 (when `autoShareTheme`, default true),
   * but it writes the result to `customTheme` ONLY and explicitly never touches
   * `theme`. So an Island-published 16767 is invisible in Ditto unless that
   * account's mode already happens to be `'custom'`.
   */
  it('addresses the settings event exactly as Ditto does', () => {
    expect(NIP78_KIND).toBe(30078);
    expect(DITTO_SETTINGS_D).toBe('ditto/metadata');
  });

  it('reads a Ditto settings blob', () => {
    const blob = {
      theme: 'custom',
      customTheme: {
        title: 'Harbour Dusk',
        colors: { background: '220 27% 11%', text: '210 40% 98%', primary: '221 100% 68%' },
      },
      autoShareTheme: true,
      lastSync: 1_700_000_000_000,
      feedSettings: { showReplies: false },
    };
    const parsed = parseDittoThemeSettings(JSON.stringify(blob))!;
    expect(parsed.theme).toBe('custom');
    expect(parsed.customTheme?.title).toBe('Harbour Dusk');
    expect(parsed.lastSync).toBe(1_700_000_000_000);
    expect(themeConfigFromDittoSettings(parsed)?.colors.primary).toBe('221 100% 68%');
  });

  it('preserves every unrelated setting when Island writes the theme', () => {
    // Ditto's `EncryptedSettingsSchema` is a `looseObject`, so unknown keys
    // survive ITS round trip. Island's write must be at least as careful:
    // clobbering a user's feed settings to change a colour is not acceptable.
    const existing = {
      theme: 'dark',
      feedSettings: { showReplies: false },
      contentFilters: [{ id: 'x' }],
      notificationsCursor: 42,
      somethingDittoAddedLater: { deeply: ['nested'] },
      lastSync: 1,
    };
    const merged = mergeDittoThemeSettings(existing, {
      theme: 'custom',
      customTheme: CONFIG,
      nowMs: 1_700_000_001_000,
    });

    expect(merged.feedSettings).toEqual({ showReplies: false });
    expect(merged.contentFilters).toEqual([{ id: 'x' }]);
    expect(merged.notificationsCursor).toBe(42);
    expect(merged.somethingDittoAddedLater).toEqual({ deeply: ['nested'] });
    expect(merged.theme).toBe('custom');
    expect(merged.lastSync).toBe(1_700_000_001_000);
    expect((merged.customTheme as ThemeConfig).title).toBe('Harbour Dusk');
  });

  it('refuses to build a write from an unreadable blob', () => {
    // A failed decrypt must not become "the user had no settings": that would
    // publish a blob containing only a theme and erase everything else.
    expect(parseDittoThemeSettings('{not json')).toBeNull();
    expect(parseDittoThemeSettings('')).toBeNull();
    expect(parseDittoThemeSettings('"a string"')).toBeNull();
  });
});
