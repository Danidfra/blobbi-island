/**
 * IMPORTING a pasted kind:31632 event into the Item Studio.
 *
 * The importer deliberately owns no parsing of its own — it validates the
 * envelope and hands the result to `eventToForm`, the same function "Load
 * published" uses. So these tests are mostly about the two things that ARE new:
 * what a pasted blob may look like, and what happens to provenance a paste
 * carries. The field-by-field population they assert is the load path's, and it
 * is asserted here anyway because "the import filled the form in" is the
 * promise an author actually cares about.
 *
 * Nothing here mocks anything: the package parser, the conversion layer and the
 * validation layer all run for real.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContentString,
  contentStringToFormState,
  formToUnsignedEvent,
  importEventJson,
  toPreviewEvent,
} from './form-event-conversion';
import { PRIMARY_MARKER, blankVisual } from './item-form-model';
import { validateItemForm } from './validation';
import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

const ISSUER = '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9';
const IMAGE_URL =
  'https://blossom.primal.net/04dab303524a5b80b4b67a934c3a37fa179b0da7716998c26d5c605e5706eda3.png';

const GOLDEN_DESCRIPTION =
  'A cheerful constellation of golden stars that twinkles and drifts around your Blobbi wherever it goes.';

/** The exact paste from the request, including its formatted `content`. */
const GOLDEN_SPARKLES_JSON = JSON.stringify({
  id: '',
  pubkey: ISSUER,
  created_at: 1785533159,
  kind: 31632,
  tags: [
    ['d', 'blobbi:effect:golden-sparkles'],
    ['name', 'Golden Sparkles'],
    ['type', 'cosmetic'],
    ['category', 'effect'],
    ['image', IMAGE_URL],
    ['symbol', '✨'],
    ['rarity', 'rare'],
    ['max_stack', '1'],
    ['version', '1'],
    ['context', 'game:blobbi'],
    ['context', 'game:blobbi-island'],
    ['t', 'equipable'],
    ['t', 'wearable'],
    ['t', 'visual-effect'],
    ['t', 'sparkles'],
    ['t', 'golden'],
    ['t', 'particles'],
    ['t', 'arcade-prize'],
    ['alt', 'Game item definition: Golden Sparkles'],
  ],
  content:
    '{\n  "description": "' +
    GOLDEN_DESCRIPTION +
    '",\n  "visual": {\n    "kind": "blobbi-effect",\n    "effect": "golden-sparkles",\n    "effectSlot": "ambient-particles",\n    "forms": ["baby", "adult"]\n  }\n}',
  sig: '',
});

/** Build a paste from parts, so each test states only what it is about. */
function paste(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', 'blobbi:accessory:party-hat'],
      ['name', 'Party Hat'],
      ['type', 'cosmetic'],
    ],
    content: '',
    ...overrides,
  });
}

const unwrap = (raw: string) => {
  const result = importEventJson(raw);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

// ── 1. An unsigned draft ────────────────────────────────────────────────────

describe('importing an unsigned kind:31632 draft', () => {
  it('populates every managed field from the tags', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);

    expect(form.d).toBe('blobbi:effect:golden-sparkles');
    expect(form.name).toBe('Golden Sparkles');
    expect(form.type).toBe('cosmetic');
    expect(form.category).toBe('effect');
    expect(form.symbol).toBe('✨');
    expect(form.rarity).toBe('rare');
    expect(form.maxStack).toBe('1');
    expect(form.version).toBe('1');
    expect(form.alt).toBe('Game item definition: Golden Sparkles');
    expect(form.contexts).toEqual(['game:blobbi', 'game:blobbi-island']);
    expect(form.topics).toEqual([
      'equipable',
      'wearable',
      'visual-effect',
      'sparkles',
      'golden',
      'particles',
      'arcade-prize',
    ]);
  });

  it('takes the unmarked image tag as the primary image row', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);
    expect(form.images).toHaveLength(1);
    expect(form.images[0].url).toBe(IMAGE_URL);
    expect(form.images[0].marker).toBe(PRIMARY_MARKER);
  });

  it('parses the content into the structured editor', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);
    expect(form.content.mode).toBe('structured');
    expect(form.content.rawOnly).toBe(false);
    expect(form.content.description).toBe(GOLDEN_DESCRIPTION);
  });

  it('needs no id or sig — an unsigned draft is the point', () => {
    const bare = importEventJson(
      JSON.stringify({
        kind: KIND_GAME_ITEM_DEFINITION,
        tags: [
          ['d', 'blobbi:accessory:party-hat'],
          ['name', 'Party Hat'],
          ['type', 'cosmetic'],
        ],
        content: '',
      }),
    );
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.value.form.d).toBe('blobbi:accessory:party-hat');
    // No id, pubkey, created_at or sig at all → nothing to report.
    expect(bare.value.provenance).toBeNull();
  });

  it('reports the pasted identity as provenance without attaching it', () => {
    const { form, provenance } = unwrap(GOLDEN_SPARKLES_JSON);
    // The paste names an author and a timestamp…
    expect(provenance).toEqual({
      id: '',
      pubkey: ISSUER,
      createdAt: 1785533159,
      sig: '',
      isSigned: false,
    });
    // …but the editor is holding a NEW local draft, so `d` is not locked and
    // publishing goes out under the current signer at the current signer's
    // address rather than claiming to replace somebody else's event.
    expect(form.loaded).toBeNull();
  });
});

// ── 2. A signed, published-looking event ───────────────────────────────────

describe('importing a signed kind:31632 event', () => {
  const signed = paste({
    id: 'e'.repeat(64),
    pubkey: ISSUER,
    created_at: 1_700_000_000,
    sig: 'f'.repeat(128),
    tags: [
      ['d', 'blobbi:cosmetic:block-builder-cap'],
      ['name', 'Block Builder Cap'],
      ['type', 'cosmetic'],
      ['category', 'headwear'],
      ['image', 'https://fixtures.invalid/cap.webp'],
    ],
    content: JSON.stringify({
      description: 'A builder cap.',
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    }),
  });

  it('imports it exactly like an unsigned one', () => {
    const { form } = unwrap(signed);
    expect(form.d).toBe('blobbi:cosmetic:block-builder-cap');
    expect(form.name).toBe('Block Builder Cap');
    expect(form.content.visual.slot).toBe('headwear');
  });

  it('records that it was signed, and still imports as a fresh draft', () => {
    const { form, provenance } = unwrap(signed);
    expect(provenance?.isSigned).toBe(true);
    expect(provenance?.id).toBe('e'.repeat(64));
    expect(form.loaded).toBeNull();
  });

  it('rebuilds to the same event the paste described', () => {
    const { form } = unwrap(signed);
    const rebuilt = formToUnsignedEvent(form);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const original = JSON.parse(signed) as { tags: string[][] };
    expect(rebuilt.value.tags).toEqual(original.tags);
    expect(JSON.parse(rebuilt.value.content)).toEqual({
      description: 'A builder cap.',
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    });
  });
});

// ── 3 & 4. Both visual shapes ──────────────────────────────────────────────

describe('importing content in either visual shape', () => {
  it('keeps kind, effect and effectSlot for a visual effect', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);
    expect(form.content.visual).toEqual({
      slot: '',
      kind: 'blobbi-effect',
      effect: 'golden-sparkles',
      effectSlot: 'ambient-particles',
      forms: ['baby', 'adult'],
      extra: {},
    });
  });

  it('keeps slot and forms for a wearable, exactly as before', () => {
    const { form } = unwrap(
      paste({
        content: JSON.stringify({
          description: 'A jaunty paper hat.',
          visual: { slot: 'headwear', forms: ['baby', 'adult'] },
        }),
      }),
    );
    expect(form.content.visual).toEqual({
      ...blankVisual(),
      slot: 'headwear',
      forms: ['baby', 'adult'],
    });
    expect(form.content.description).toBe('A jaunty paper hat.');
  });

  it('keeps effects and metadata objects too', () => {
    const { form } = unwrap(
      paste({
        content: JSON.stringify({
          effects: { 'game:blobbi': { hunger: 5 } },
          metadata: { stackable: false, itemId: 'apple' },
        }),
      }),
    );
    expect(form.content.effects).toHaveLength(1);
    expect(form.content.effects[0]).toMatchObject({
      context: 'game:blobbi',
      key: 'hunger',
      value: '5',
      valueType: 'number',
    });
    expect(form.content.metadata.map((row) => row.key).sort()).toEqual([
      'itemId',
      'stackable',
    ]);
  });
});

// ── 5. Images ──────────────────────────────────────────────────────────────

describe('importing image tags', () => {
  const withImages = paste({
    tags: [
      ['d', 'blobbi:accessory:party-hat'],
      ['name', 'Party Hat'],
      ['type', 'cosmetic'],
      ['image', 'https://fixtures.invalid/primary.png'],
      ['image', 'https://fixtures.invalid/front.png', 'front'],
      ['image', 'https://fixtures.invalid/back.png', 'back'],
    ],
  });

  it('imports the unmarked primary and every marked view', () => {
    const { form } = unwrap(withImages);
    expect(form.images.map((row) => [row.url, row.marker])).toEqual([
      ['https://fixtures.invalid/primary.png', PRIMARY_MARKER],
      ['https://fixtures.invalid/front.png', 'front'],
      ['https://fixtures.invalid/back.png', 'back'],
    ]);
  });

  it('gives every row a distinct id, so the Images section can edit them', () => {
    const { form } = unwrap(withImages);
    const ids = form.images.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the primary replaceable — the row is ordinary editable state', () => {
    const { form } = unwrap(withImages);
    const replaced = {
      ...form,
      images: form.images.map((row) =>
        row.marker === PRIMARY_MARKER
          ? { ...row, url: 'https://fixtures.invalid/uploaded.webp' }
          : row,
      ),
    };
    const rebuilt = formToUnsignedEvent(replaced);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(rebuilt.value.tags).toContainEqual([
      'image',
      'https://fixtures.invalid/uploaded.webp',
    ]);
  });

  it('keeps an unknown view marker rather than discarding the row', () => {
    const { form } = unwrap(
      paste({
        tags: [
          ['d', 'blobbi:accessory:party-hat'],
          ['name', 'Party Hat'],
          ['type', 'cosmetic'],
          ['image', 'https://fixtures.invalid/odd.png', 'from-the-future'],
        ],
      }),
    );
    expect(form.images).toHaveLength(1);
    expect(form.images[0].marker).toBe('from-the-future');
  });
});

// ── 6 & 7. Preservation ────────────────────────────────────────────────────

describe('nothing meaningful is dropped', () => {
  it('preserves tags no form field manages', () => {
    const { form } = unwrap(
      paste({
        tags: [
          ['d', 'blobbi:accessory:party-hat'],
          ['name', 'Party Hat'],
          ['type', 'cosmetic'],
          ['durability', '40'],
          ['expires_at', '1900000000'],
        ],
      }),
    );
    expect(form.extraTags).toEqual([
      ['durability', '40'],
      ['expires_at', '1900000000'],
    ]);
  });

  it('re-emits preserved tags on the way back out', () => {
    const { form } = unwrap(
      paste({
        tags: [
          ['d', 'blobbi:accessory:party-hat'],
          ['name', 'Party Hat'],
          ['type', 'cosmetic'],
          ['durability', '40'],
        ],
      }),
    );
    const rebuilt = formToUnsignedEvent(form);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(rebuilt.value.tags).toContainEqual(['durability', '40']);
  });

  it('preserves unmanaged content keys and unmanaged visual keys', () => {
    const { form } = unwrap(
      paste({
        content: JSON.stringify({
          description: 'A hat.',
          lore: { chapter: 3 },
          visual: { slot: 'headwear', intensityHint: 0.6 },
        }),
      }),
    );
    expect(form.content.extra).toEqual({ lore: { chapter: 3 } });
    expect(form.content.visual.extra).toEqual({ intensityHint: 0.6 });

    const rebuilt = formToUnsignedEvent(form);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(JSON.parse(rebuilt.value.content)).toEqual({
      description: 'A hat.',
      visual: { slot: 'headwear', intensityHint: 0.6 },
      lore: { chapter: 3 },
    });
  });

  it('keeps content that is valid JSON but not an object, byte for byte', () => {
    const { form } = unwrap(paste({ content: '"just a string"' }));
    expect(form.content.rawOnly).toBe(true);
    expect(form.content.mode).toBe('json');
    expect(form.content.raw).toBe('"just a string"');
  });
});

// ── 8 & 9. Rejection ───────────────────────────────────────────────────────

describe('rejecting what cannot be imported', () => {
  const failure = (raw: string) => {
    const result = importEventJson(raw);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.error;
  };

  it('asks for something when given nothing', () => {
    expect(failure('')).toMatch(/paste a kind:31632 event/i);
    expect(failure('   \n ')).toMatch(/paste a kind:31632 event/i);
  });

  it('reports malformed JSON with the parser’s own reason', () => {
    expect(failure('{ "kind": 31632, ')).toMatch(/not valid JSON/i);
    expect(failure('not json at all')).toMatch(/not valid JSON/i);
  });

  it('refuses JSON that is not a single event object', () => {
    expect(failure('[]')).toMatch(/object describing one event/i);
    expect(failure('42')).toMatch(/object describing one event/i);
    expect(failure('null')).toMatch(/object describing one event/i);
    expect(failure('"an event"')).toMatch(/object describing one event/i);
  });

  it('refuses another kind, and names it', () => {
    expect(failure(paste({ kind: 1 }))).toMatch(/kind:1 event/);
    expect(failure(paste({ kind: 31633 }))).toMatch(/kind:31633 event/);
    expect(failure(paste({ kind: '31632' }))).toMatch(/kind:31632 event/);
  });

  it('refuses an event with no kind at all', () => {
    const { kind: _dropped, ...rest } = JSON.parse(paste()) as Record<string, unknown>;
    expect(failure(JSON.stringify(rest))).toMatch(/no "kind"/i);
  });

  it('refuses a missing or malformed tag list rather than importing a blank item', () => {
    expect(failure(paste({ tags: undefined }))).toMatch(/no "tags" array/i);
    expect(failure(paste({ tags: 'd,name' }))).toMatch(/no "tags" array/i);
    // A single bad tag is an error, not a silently dropped field.
    expect(failure(paste({ tags: [['d', 'a:b:c'], 'name'] }))).toMatch(/Tag 1/);
    expect(failure(paste({ tags: [['d', 'a:b:c'], ['max_stack', 1]] }))).toMatch(/Tag 1/);
  });

  it('refuses a content field that is neither a string nor an object', () => {
    expect(failure(paste({ content: 42 }))).toMatch(/must be a JSON string/i);
    expect(failure(paste({ content: true }))).toMatch(/must be a JSON string/i);
  });

  it('surfaces the package’s own rejection for a definition it will not parse', () => {
    // No `d`: the parser refuses, and that message is what the author sees.
    expect(failure(paste({ tags: [['name', 'Nameless']] }))).not.toBe('');
  });

  it('accepts a content object, and says so, rather than rejecting the paste', () => {
    const result = importEventJson(
      paste({ content: { description: 'Pasted as an object.' } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.form.content.description).toBe('Pasted as an object.');
    expect(result.value.warnings.join(' ')).toMatch(/serialized/i);
  });
});

// ── 10. No image ───────────────────────────────────────────────────────────

describe('importing an event with no image', () => {
  it('imports everything else', () => {
    const { form } = unwrap(paste({ content: '' }));
    expect(form.d).toBe('blobbi:accessory:party-hat');
    expect(form.images).toEqual([]);
  });

  it('raises the existing no-image warning, and blocks nothing', () => {
    const { form } = unwrap(paste({ content: '' }));
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    const result = validateItemForm({
      form,
      previewEvent: toPreviewEvent(built.value, ISSUER, 1_700_000_000),
      buildError: null,
      probes: new Map(),
    });
    expect(result.image.map((issue) => issue.code)).toContain('no-images');
    expect(result.blocking).toEqual([]);
    expect(result.isPublishable).toBe(true);
  });
});

// ── 11. Round trip after import ────────────────────────────────────────────

describe('the imported form round-trips through the content editor', () => {
  it('structured → JSON → structured loses nothing for a visual effect', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);

    const json = buildContentString(form.content);
    if (!json.ok) throw new Error(json.error);
    const back = contentStringToFormState(json.value);
    if (!back.ok) throw new Error(back.error);

    expect(back.value.visual).toEqual(form.content.visual);
    expect(back.value.description).toBe(GOLDEN_DESCRIPTION);

    const again = buildContentString({ ...back.value, mode: 'structured' });
    if (!again.ok) throw new Error(again.error);
    expect(again.value).toBe(json.value);
  });

  it('normalizes the pasted content formatting without changing its meaning', () => {
    // The paste was pretty-printed with newlines; what gets published is the
    // compact form the builder emits. Same object, different bytes.
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.content).toBe(
      `{"description":${JSON.stringify(GOLDEN_DESCRIPTION)},` +
        '"visual":{"kind":"blobbi-effect","effect":"golden-sparkles",' +
        '"effectSlot":"ambient-particles","forms":["baby","adult"]}}',
    );
    expect(JSON.parse(built.value.content)).toEqual(
      JSON.parse((JSON.parse(GOLDEN_SPARKLES_JSON) as { content: string }).content),
    );
  });

  it('produces the tags the paste described, in the builder’s canonical order', () => {
    const { form } = unwrap(GOLDEN_SPARKLES_JSON);
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    const original = (JSON.parse(GOLDEN_SPARKLES_JSON) as { tags: string[][] }).tags;
    // Same set, regardless of the order the builder chooses to emit them in.
    expect([...built.value.tags].sort()).toEqual([...original].sort());
  });
});

// ── 12. Import publishes nothing ───────────────────────────────────────────

describe('importing is an editor action and nothing more', () => {
  const ROOT = process.cwd();
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  it('reaches no signer, relay or publish path from the importer', () => {
    const source = read('src/tools/game-items/form-event-conversion.ts');
    for (const banned of [
      /signEvent/,
      /publishToRelays/,
      /mutateAsync/,
      /useNostr/,
      /nostr\.event\(/,
    ]) {
      expect(banned.test(source), String(banned)).toBe(false);
    }
  });

  it('reaches no signer, relay or publish path from the dialog', () => {
    const source = read('src/components/tools/game-items/ImportEventDialog.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of [
      /signEvent/,
      /publishToRelays/,
      /mutateAsync/,
      /usePublishItemDefinition/,
      /useCurrentUser/,
    ]) {
      expect(banned.test(source), String(banned)).toBe(false);
    }
  });

  it('is a pure function: importing twice yields the same form', () => {
    const first = unwrap(GOLDEN_SPARKLES_JSON);
    const second = unwrap(GOLDEN_SPARKLES_JSON);
    // Row ids are minted per call and are deliberately unique, so they are the
    // one thing that legitimately differs.
    const withoutIds = (value: typeof first) => ({
      ...value,
      form: {
        ...value.form,
        images: value.form.images.map(({ id: _id, ...rest }) => rest),
      },
    });
    expect(withoutIds(second)).toEqual(withoutIds(first));
  });

  it('does not mutate the string it was given', () => {
    const raw = GOLDEN_SPARKLES_JSON;
    const before = String(raw);
    importEventJson(raw);
    expect(raw).toBe(before);
  });
});
