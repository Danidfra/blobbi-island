/**
 * The Ditto theme protocol, both directions.
 *
 * The fixtures below are Ditto's own event shapes, transcribed from
 * `src/lib/themeEvent.ts` in the Ditto client — the `c` tag encoding, the role
 * markers, the tag order `buildThemeDefinitionTags` produces, the legacy
 * JSON-in-content format and the `a`-tag reference on an active theme. If Island
 * drifts from any of them, one of these fails and the interop claim is false.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  ACTIVE_THEME_KIND,
  ISLAND_THEME_TAG,
  THEME_DEFINITION_KIND,
  addressFromNostrThemeId,
  buildActiveThemeTags,
  buildThemeDefinitionTags,
  contrastRatio,
  hexToHslTriplet,
  hslTripletToHex,
  isValidHexColor,
  nostrThemeId,
  parseActiveTheme,
  parseHslTriplet,
  parseThemeDefinition,
  resolveThemeDefinitions,
  sanitizeThemeText,
  titleToSlug,
  type CoreThemeColors,
} from './nostr-theme';

const AUTHOR = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

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

/** A theme event exactly as Ditto publishes one. */
function dittoTheme(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return event({
    kind: THEME_DEFINITION_KIND,
    tags: [
      ['d', 'harbour-dusk'],
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ['title', 'Harbour Dusk'],
      ['alt', 'Custom theme: Harbour Dusk'],
      ['t', 'theme'],
      ['description', 'Cold water at the end of the day.'],
    ],
    ...overrides,
  });
}

describe('reading a Ditto theme', () => {
  it('parses the kinds Ditto uses', () => {
    expect(THEME_DEFINITION_KIND).toBe(36767);
    expect(ACTIVE_THEME_KIND).toBe(16767);
  });

  it('parses a real Ditto kind:36767 event', () => {
    const parsed = parseThemeDefinition(dittoTheme());
    expect(parsed).not.toBeNull();
    expect(parsed!.identifier).toBe('harbour-dusk');
    expect(parsed!.title).toBe('Harbour Dusk');
    expect(parsed!.description).toBe('Cold water at the end of the day.');
    // Hex on the wire, HSL channels in memory.
    expect(hslTripletToHex(parsed!.colors.background)).toBe('#141a24');
    expect(hslTripletToHex(parsed!.colors.text)).toBe('#f2f5fa');
    expect(hslTripletToHex(parsed!.colors.primary)).toBe('#5b8cff');
  });

  it('uses the ADDRESS as identity, never the event id', () => {
    const parsed = parseThemeDefinition(dittoTheme())!;
    expect(parsed.address).toBe(`36767:${AUTHOR}:harbour-dusk`);
    // kind:36767 is addressable: the author republishes on every edit, so an
    // id-keyed identity would break the moment they changed a colour.
    expect(nostrThemeId(parsed.address)).toBe(`nostr:36767:${AUTHOR}:harbour-dusk`);
    expect(addressFromNostrThemeId(nostrThemeId(parsed.address))).toBe(parsed.address);
  });

  it('reads Ditto\'s legacy JSON-in-content format', () => {
    // Themes published before the `c`-tag encoding are on relays right now.
    // Dropping them would make discovery look empty.
    const legacy = event({
      kind: THEME_DEFINITION_KIND,
      tags: [['d', 'old'], ['title', 'Old One']],
      content: JSON.stringify({ background: '228 20% 10%', text: '210 40% 98%', primary: '258 70% 60%' }),
    });
    expect(parseThemeDefinition(legacy)?.colors.primary).toBe('258 70% 60%');

    // The original nineteen-token blob called it `foreground`.
    const ancient = event({
      kind: THEME_DEFINITION_KIND,
      tags: [['d', 'ancient'], ['title', 'Ancient']],
      content: JSON.stringify({ background: '0 0% 100%', foreground: '0 0% 4%', primary: '210 40% 50%', card: 'x' }),
    });
    expect(parseThemeDefinition(ancient)?.colors.text).toBe('0 0% 4%');
  });

  it('rejects events that are not usable themes', () => {
    const cases: Record<string, NostrEvent> = {
      'wrong kind': dittoTheme({ kind: 1 }),
      'no d tag': event({ kind: THEME_DEFINITION_KIND, tags: [['title', 'x'], ['c', '#000', 'background']] }),
      'no title': event({
        kind: THEME_DEFINITION_KIND,
        tags: [['d', 'x'], ['c', '#000', 'background'], ['c', '#fff', 'text'], ['c', '#f00', 'primary']],
      }),
      'missing a colour role': event({
        kind: THEME_DEFINITION_KIND,
        tags: [['d', 'x'], ['title', 'X'], ['c', '#000', 'background'], ['c', '#fff', 'text']],
      }),
      'malformed content JSON': event({
        kind: THEME_DEFINITION_KIND,
        tags: [['d', 'x'], ['title', 'X']],
        content: '{not json',
      }),
    };
    for (const [why, e] of Object.entries(cases)) {
      expect(parseThemeDefinition(e), why).toBeNull();
    }
  });
});

describe('writing a theme Ditto can read', () => {
  const colors: CoreThemeColors = {
    background: hexToHslTriplet('#141a24'),
    text: hexToHslTriplet('#f2f5fa'),
    primary: hexToHslTriplet('#5b8cff'),
  };

  it('emits Ditto\'s tags, in Ditto\'s order and encoding', () => {
    const tags = buildThemeDefinitionTags({
      identifier: 'harbour-dusk',
      title: 'Harbour Dusk',
      colors,
      description: 'Cold water at the end of the day.',
    });

    // buildThemeDefinitionTags in Ditto: d, colours (background/text/primary),
    // fonts, background media, title, alt, t, then description. Island has no
    // fonts and no background media, so this is the same list minus those.
    expect(tags).toEqual([
      ['d', 'harbour-dusk'],
      ['c', '#141a24', 'background'],
      ['c', '#f2f5fa', 'text'],
      ['c', '#5b8cff', 'primary'],
      ['title', 'Harbour Dusk'],
      ['alt', 'Custom theme: Harbour Dusk'],
      ['t', 'theme'],
      ['description', 'Cold water at the end of the day.'],
    ]);
  });

  it('round-trips through its own parser without drift', () => {
    const tags = buildThemeDefinitionTags({ identifier: 'x', title: 'X', colors });
    const parsed = parseThemeDefinition(event({ kind: THEME_DEFINITION_KIND, tags }))!;
    expect(parsed.colors).toEqual(colors);
  });

  it('slugs a title the way Ditto does — so editing REPLACES', () => {
    expect(titleToSlug('Harbour Dusk')).toBe('harbour-dusk');
    expect(titleToSlug('  Sun   & Sand!! ')).toBe('sun-sand');
    expect(titleToSlug('!!!')).toBe('');
    // Same title, same `d`, same address: the second publish replaces the first
    // rather than creating a duplicate theme.
    expect(titleToSlug('Harbour Dusk')).toBe(titleToSlug('harbour dusk'));
  });
});

describe('the active theme (kind:16767)', () => {
  const colors: CoreThemeColors = {
    background: hexToHslTriplet('#fff8ec'),
    text: hexToHslTriplet('#3a2a1a'),
    primary: hexToHslTriplet('#6b4fd6'),
  };

  it('is a separate concept from a theme definition', () => {
    // The distinction the protocol draws and this module must not blur:
    // "a theme exists" vs "this user is using it".
    const definition = dittoTheme();
    expect(parseActiveTheme(definition)).toBeNull();
    expect(parseThemeDefinition(event({ kind: ACTIVE_THEME_KIND, tags: definition.tags }))).toBeNull();
  });

  it('carries the colours, the source address, and Island\'s own id', () => {
    const tags = buildActiveThemeTags({
      colors,
      title: 'Harbour Dusk',
      sourceAddress: `36767:${OTHER}:harbour-dusk`,
      islandThemeId: `nostr:36767:${OTHER}:harbour-dusk`,
    });
    const parsed = parseActiveTheme(event({ kind: ACTIVE_THEME_KIND, tags }))!;

    expect(parsed.colors).toEqual(colors);
    expect(parsed.sourceAddress).toBe(`36767:${OTHER}:harbour-dusk`);
    expect(parsed.islandThemeId).toBe(`nostr:36767:${OTHER}:harbour-dusk`);
    expect(parsed.title).toBe('Harbour Dusk');
  });

  it('stays a valid Ditto event when it names a BUILT-IN Island theme', () => {
    // A built-in has no address, and its sixteen authored colours do not fit in
    // three — so Island adds one extra tag Ditto ignores. Everything Ditto
    // reads must still be there and still be correct.
    const tags = buildActiveThemeTags({ colors, title: 'Cozy Day', islandThemeId: 'cozy-day' });

    const roles = tags.filter(([n]) => n === 'c').map((t) => t[2]);
    expect(roles).toEqual(['background', 'text', 'primary']);
    expect(tags).toContainEqual(['alt', 'Active profile theme']);
    expect(tags).toContainEqual([ISLAND_THEME_TAG, 'cozy-day']);
    // No `a` tag: there is no definition to point at.
    expect(tags.some(([n]) => n === 'a')).toBe(false);

    const parsed = parseActiveTheme(event({ kind: ACTIVE_THEME_KIND, tags }))!;
    expect(parsed.islandThemeId).toBe('cozy-day');
    expect(parsed.sourceAddress).toBeNull();
  });

  it('treats a cleared active theme as no selection', () => {
    // Ditto clears by publishing kind:16767 with empty tags.
    expect(parseActiveTheme(event({ kind: ACTIVE_THEME_KIND, tags: [] }))).toBeNull();
  });
});

describe('discovery resolution', () => {
  const base = (d: string, created_at: number, id: string, pubkey = AUTHOR) =>
    event({
      id,
      pubkey,
      created_at,
      kind: THEME_DEFINITION_KIND,
      tags: [
        ['d', d],
        ['c', '#000000', 'background'],
        ['c', '#ffffff', 'text'],
        ['c', '#ff0000', 'primary'],
        ['title', d],
      ],
    });

  it('keeps the newest event per address', () => {
    const resolved = resolveThemeDefinitions([
      base('one', 100, 'a'.repeat(64)),
      base('one', 300, 'c'.repeat(64)),
      base('one', 200, 'b'.repeat(64)),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].createdAt).toBe(300);
  });

  it('does not merge two authors\' themes with the same slug', () => {
    // The address includes the pubkey, so `harbour-dusk` from two people is two
    // themes — not one that keeps overwriting the other.
    const resolved = resolveThemeDefinitions([
      base('dusk', 100, 'a'.repeat(64), AUTHOR),
      base('dusk', 100, 'b'.repeat(64), OTHER),
    ]);
    expect(resolved).toHaveLength(2);
  });

  it('breaks a created_at tie deterministically', () => {
    // Two clients resolving the same set must pick the same theme, or a shared
    // theme shows different colours to different people.
    const events = [base('one', 100, 'f'.repeat(64)), base('one', 100, '1'.repeat(64))];
    expect(resolveThemeDefinitions(events)[0].eventId).toBe('1'.repeat(64));
    expect(resolveThemeDefinitions([...events].reverse())[0].eventId).toBe('1'.repeat(64));
  });

  it('drops malformed events without emptying the list', () => {
    const broken = event({
      id: '9'.repeat(64),
      kind: THEME_DEFINITION_KIND,
      tags: [['d', 'broken'], ['title', 'Broken'], ['c', 'rgb(1,2,3)', 'background']],
    });
    const resolved = resolveThemeDefinitions([broken, base('fine', 100, 'a'.repeat(64))]);
    expect(resolved.map((t) => t.identifier)).toEqual(['fine']);
  });

  it('answers an empty set with an empty list', () => {
    expect(resolveThemeDefinitions([])).toEqual([]);
  });
});

describe('untrusted input', () => {
  it('accepts only hex colours', () => {
    for (const good of ['#fff', '#FFFFFF', '#0a1b2c']) expect(isValidHexColor(good)).toBe(true);
    for (const bad of [
      'red',
      'rgb(0,0,0)',
      '#12345',
      '#1234567',
      'var(--x)',
      'url(javascript:alert(1))',
      '#fff;} body{display:none',
      'expression(alert(1))',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isValidHexColor(bad), String(bad)).toBe(false);
    }
  });

  it('lets nothing but arithmetic reach a custom property', () => {
    // The rule: a colour is validated as hex, then PARSED INTO NUMBERS and
    // re-emitted from those numbers. Even a value that passed validation cannot
    // smuggle a payload through, because the string is never reused.
    const injected = event({
      kind: THEME_DEFINITION_KIND,
      tags: [
        ['d', 'evil'],
        ['title', 'Evil'],
        ['c', '#000000;} :root{--island-ink:red', 'background'],
        ['c', '#ffffff', 'text'],
        ['c', '#ff0000', 'primary'],
      ],
    });
    expect(parseThemeDefinition(injected)).toBeNull();

    // And a legitimate colour comes out as three plain numbers.
    const parsed = parseThemeDefinition(dittoTheme())!;
    for (const channel of Object.values(parsed.colors)) {
      expect(channel).toMatch(/^-?[\d.]+ -?[\d.]+% -?[\d.]+%$/);
      expect(parseHslTriplet(channel)).not.toBeNull();
    }
  });

  it('refuses an HSL triplet that is not three numbers', () => {
    for (const bad of [
      'red',
      '10 20%',
      '10 20% 30% 40%',
      'calc(1px) 20% 30%',
      '10 200% 30%',
      '10 20% -5%',
      'NaN 20% 30%',
      null,
    ]) {
      expect(parseHslTriplet(bad), String(bad)).toBeNull();
    }
  });

  it('caps and cleans free text', () => {
    expect(sanitizeThemeText('x'.repeat(500), 64)).toHaveLength(64);
    expect(sanitizeThemeText('  spaced   out \n\n words ', 64)).toBe('spaced out words');
    expect(sanitizeThemeText('a\u0000b\u001bc\u009fd', 64)).toBe('a b c d');
    expect(sanitizeThemeText(undefined, 64)).toBe('');
    expect(sanitizeThemeText({ toString: () => 'nope' }, 64)).toBe('');
  });

  it('caps a hostile title at parse time, not only at render time', () => {
    const parsed = parseThemeDefinition(
      dittoTheme({
        tags: [
          ['d', 'long'],
          ['c', '#000000', 'background'],
          ['c', '#ffffff', 'text'],
          ['c', '#ff0000', 'primary'],
          ['title', 'T'.repeat(5000)],
          ['description', 'D'.repeat(5000)],
        ],
      }),
    )!;
    expect(parsed.title.length).toBeLessThanOrEqual(64);
    expect(parsed.description.length).toBeLessThanOrEqual(200);
  });

  it('rejects a malformed stored theme id', () => {
    for (const bad of [
      undefined,
      null,
      '',
      'cozy-day',
      'nostr:',
      'nostr:36767',
      `nostr:36767:${AUTHOR}`,
      'nostr:1:' + AUTHOR + ':x',
      'nostr:36767:not-a-pubkey:x',
      `nostr:36767:${AUTHOR.toUpperCase()}:x`,
    ]) {
      expect(addressFromNostrThemeId(bad), String(bad)).toBeNull();
    }
    expect(addressFromNostrThemeId(`nostr:36767:${AUTHOR}:a:b`)).toBe(`36767:${AUTHOR}:a:b`);
  });
});

describe('colour maths', () => {
  it('survives a hex → hsl → hex round trip', () => {
    for (const hex of ['#000000', '#ffffff', '#fff8ec', '#3a2a1a', '#6b4fd6', '#55bfea']) {
      expect(hslTripletToHex(hexToHslTriplet(hex))).toBe(hex);
    }
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 1);
    expect(contrastRatio('0 0% 50%', '0 0% 50%')).toBeCloseTo(1, 5);
  });
});
