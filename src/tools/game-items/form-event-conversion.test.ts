/**
 * Form ⇄ event conversion, verified against the REAL
 * `@nostr-games/inventory@0.2.0` — no mock of the builder or the parser exists
 * anywhere in this suite, because a mocked builder would only prove that our
 * assumptions agree with themselves.
 *
 * The load-bearing assertions here are the preservation ones: an event that
 * goes into the form and comes back out must not have lost a tag, an image
 * order, an unknown marker, or a content key. Those are the properties that
 * make it safe to edit somebody's published item with a build that predates
 * whatever they published it with.
 */

import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  KIND_GAME_ITEM_DEFINITION,
  parseGameItemDefinition,
} from '@/inventory/package';

import {
  MANAGED_TAG_NAMES,
  asNewItem,
  buildContentString,
  contentStringToFormState,
  eventToForm,
  formAddress,
  formImageCandidate,
  formToBuildInput,
  formToUnsignedEvent,
  imageRowsToPackageImages,
  isManagedTag,
  partitionTags,
} from './form-event-conversion';
import {
  PRIMARY_MARKER,
  blankItemForm,
  blankVisual,
  nextRowId,
  type ItemFormState,
} from './item-form-model';

const PUBKEY = 'a'.repeat(64);

function imageRow(url: string, marker = PRIMARY_MARKER) {
  return { id: nextRowId('image'), url, marker };
}

function signedEvent(tags: string[][], content = ''): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags,
    content,
    sig: 'f'.repeat(128),
  };
}

/** A form with every managed field populated. */
function completeForm(): ItemFormState {
  return {
    ...blankItemForm(),
    d: 'blobbi:accessory:party-hat',
    name: 'Party Hat',
    type: 'cosmetic',
    category: 'headwear',
    symbol: '🎩',
    rarity: 'rare',
    maxStack: '1',
    version: '2',
    alt: 'Game item: Party Hat',
    images: [
      imageRow('https://cdn.example/hat.png'),
      imageRow('https://cdn.example/hat-front.png', 'front'),
      imageRow('https://cdn.example/hat-back.png', 'back'),
    ],
    contexts: ['game:blobbi', 'cross-game'],
    topics: ['equipable', 'headwear'],
    model3d: 'https://cdn.example/hat.glb',
    audio: 'https://cdn.example/pop.mp3',
    basedOn: [
      { id: nextRowId('based-on'), address: `31632:${'b'.repeat(64)}:blobbi:accessory:hat`, relay: 'wss://relay.example' },
    ],
    content: {
      mode: 'structured',
      description: 'A jaunty paper hat.',
      effects: [
        { id: nextRowId('effect'), context: 'game:blobbi', key: 'happiness', value: '5', valueType: 'number' },
      ],
      metadata: [
        { id: nextRowId('metadata'), key: 'stackable', value: 'false', valueType: 'boolean' },
      ],
      visual: { ...blankVisual(), slot: 'headwear', forms: ['baby', 'adult'] },
      raw: '',
      extra: {},
      rawOnly: false,
    },
    extraTags: [],
    loaded: null,
  };
}

describe('managed tag classification', () => {
  it('treats every builder-managed tag name as managed', () => {
    for (const name of MANAGED_TAG_NAMES) {
      expect(isManagedTag([name, 'value'])).toBe(true);
    }
  });

  it('treats an `a` tag as managed only when it carries the based_on marker', () => {
    expect(isManagedTag(['a', '31632:x:y', '', 'based_on'])).toBe(true);
    expect(isManagedTag(['a', '31632:x:y'])).toBe(false);
    expect(isManagedTag(['a', '30023:x:y', '', 'something-else'])).toBe(false);
  });

  it('partitions unknown tags into the preserved bucket', () => {
    const { managed, unmanaged } = partitionTags([
      ['d', 'x'],
      ['durability', '40'],
      ['client', 'blobbi'],
      ['image', 'https://x/y.png', 'front'],
    ]);
    expect(managed).toEqual([['d', 'x'], ['image', 'https://x/y.png', 'front']]);
    expect(unmanaged).toEqual([['durability', '40'], ['client', 'blobbi']]);
  });
});

describe('form → event', () => {
  it('rejects a blank form with the package builder’s own reason', () => {
    const result = formToUnsignedEvent(blankItemForm());
    expect(result.ok).toBe(false);
  });

  it('builds a complete definition and omits blank optional fields', () => {
    const result = formToUnsignedEvent(completeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tagNames = result.value.tags.map(([name]) => name);
    expect(tagNames).toContain('d');
    expect(tagNames).toContain('name');
    expect(tagNames).toContain('type');
    expect(tagNames).toContain('max_stack');
    expect(result.value.tags.find(([n]) => n === 'max_stack')?.[1]).toBe('1');
  });

  it('omits optional tags the user left empty', () => {
    const form = { ...blankItemForm(), d: 'x:y:z', name: 'X', type: 'misc' };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.tags.map(([name]) => name);
    expect(names).not.toContain('alt');
    expect(names).not.toContain('category');
    expect(names).not.toContain('rarity');
    expect(names).not.toContain('max_stack');
  });

  it('serializes the primary image as an UNMARKED tag', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [imageRow('https://cdn.example/a.png')],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imageTags = result.value.tags.filter(([name]) => name === 'image');
    expect(imageTags).toEqual([['image', 'https://cdn.example/a.png']]);
  });

  it('never emits the literal marker "primary"', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [
        imageRow('https://cdn.example/a.png'),
        imageRow('https://cdn.example/b.png', 'front'),
        imageRow('https://cdn.example/c.png', 'back'),
      ],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const tag of result.value.tags) {
      expect(tag[2]).not.toBe('primary');
    }
  });

  it('supports the primary plus every marker the spec defines', () => {
    const markers = [
      'front',
      'side-right',
      'side-left',
      'back',
      'diagonal-front-right',
      'diagonal-front-left',
    ];
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [
        imageRow('https://cdn.example/primary.png'),
        ...markers.map((marker) => imageRow(`https://cdn.example/${marker}.png`, marker)),
      ],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imageTags = result.value.tags.filter(([name]) => name === 'image');
    expect(imageTags).toHaveLength(7);
    expect(imageTags[0]).toEqual(['image', 'https://cdn.example/primary.png']);
  });

  it('publishes an item that ships only marked views', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [
        imageRow('https://cdn.example/front.png', 'front'),
        imageRow('https://cdn.example/back.png', 'back'),
      ],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
  });

  it('rejects two DIFFERENT unmarked images as an ambiguous primary', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [imageRow('https://cdn.example/a.png'), imageRow('https://cdn.example/b.png')],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(false);
  });

  it('accepts the SAME unmarked image listed twice, publishing it once', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [imageRow('https://cdn.example/a.png'), imageRow('https://cdn.example/a.png')],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags.filter(([name]) => name === 'image')).toHaveLength(1);
  });

  it('drops image rows with a blank URL', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [imageRow(''), imageRow('https://cdn.example/a.png')],
    };
    expect(imageRowsToPackageImages(form.images)).toEqual([
      { url: 'https://cdn.example/a.png' },
    ]);
  });

  it('preserves image ORDER through the builder', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      images: [
        imageRow('https://cdn.example/primary.png'),
        imageRow('https://cdn.example/back.png', 'back'),
        imageRow('https://cdn.example/front.png', 'front'),
      ],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const markers = result.value.tags
      .filter(([name]) => name === 'image')
      .map((tag) => tag[2] ?? '');
    expect(markers).toEqual(['', 'back', 'front']);
  });

  it('appends preserved unknown tags after the managed ones', () => {
    const form = {
      ...blankItemForm(),
      d: 'x:y:z',
      name: 'X',
      type: 'misc',
      extraTags: [['durability', '40'], ['client', 'blobbi']],
    };
    const result = formToUnsignedEvent(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags).toContainEqual(['durability', '40']);
    expect(result.value.tags).toContainEqual(['client', 'blobbi']);
  });

  it('emits based_on references as `a` tags with the fixed marker', () => {
    const result = formToUnsignedEvent(completeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const aTag = result.value.tags.find(([name]) => name === 'a');
    expect(aTag?.[3]).toBe('based_on');
  });

  it('emits repeated context and topic tags', () => {
    const result = formToUnsignedEvent(completeForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags.filter(([n]) => n === 'context')).toHaveLength(2);
    expect(result.value.tags.filter(([n]) => n === 't')).toHaveLength(2);
  });

  it('builds the full address from the signer pubkey', () => {
    expect(formAddress(completeForm(), PUBKEY)).toBe(
      `31632:${PUBKEY}:blobbi:accessory:party-hat`,
    );
    expect(formAddress(blankItemForm(), PUBKEY)).toBeNull();
  });
});

describe('content serialization', () => {
  it('serializes an empty structured form to an empty string, not "{}"', () => {
    const result = buildContentString(blankItemForm().content);
    expect(result).toEqual({ ok: true, value: '' });
  });

  it('groups effects by context', () => {
    const result = buildContentString(completeForm().content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value)).toMatchObject({
      description: 'A jaunty paper hat.',
      effects: { 'game:blobbi': { happiness: 5 } },
      metadata: { stackable: false },
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    });
  });

  it('reports a non-numeric value in a number-typed effect', () => {
    const form = completeForm();
    form.content.effects[0].value = 'lots';
    const result = buildContentString(form.content);
    expect(result.ok).toBe(false);
  });

  it('reports invalid JSON in raw mode', () => {
    const result = buildContentString({
      ...blankItemForm().content,
      mode: 'json',
      raw: '{ nope',
    });
    expect(result.ok).toBe(false);
  });

  it('returns raw JSON byte for byte rather than reformatting it', () => {
    const raw = '{"a":   1}';
    const result = buildContentString({
      ...blankItemForm().content,
      mode: 'json',
      raw,
    });
    expect(result).toEqual({ ok: true, value: raw });
  });

  it('refuses to switch non-object JSON into structured mode', () => {
    expect(contentStringToFormState('"just a string"').ok).toBe(false);
    expect(contentStringToFormState('[1,2,3]').ok).toBe(false);
    expect(contentStringToFormState('{"a":1}').ok).toBe(true);
  });
});

describe('event → form', () => {
  it('populates every supported field', () => {
    const built = formToUnsignedEvent(completeForm());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const loaded = eventToForm(signedEvent(built.value.tags, built.value.content));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.form.d).toBe('blobbi:accessory:party-hat');
    expect(loaded.form.name).toBe('Party Hat');
    expect(loaded.form.type).toBe('cosmetic');
    expect(loaded.form.category).toBe('headwear');
    expect(loaded.form.rarity).toBe('rare');
    expect(loaded.form.maxStack).toBe('1');
    expect(loaded.form.symbol).toBe('🎩');
    expect(loaded.form.contexts).toEqual(['game:blobbi', 'cross-game']);
    expect(loaded.form.topics).toEqual(['equipable', 'headwear']);
    expect(loaded.form.basedOn[0].relay).toBe('wss://relay.example');
    expect(loaded.form.content.description).toBe('A jaunty paper hat.');
    expect(loaded.form.loaded?.eventId).toBe('e'.repeat(64));
  });

  it('records provenance including relays and latest-known state', () => {
    const built = formToUnsignedEvent(completeForm());
    if (!built.ok) throw new Error('build failed');
    const loaded = eventToForm(signedEvent(built.value.tags, built.value.content), {
      relays: ['wss://a', 'wss://b'],
      isLatestKnown: false,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.form.loaded?.relays).toEqual(['wss://a', 'wss://b']);
    expect(loaded.form.loaded?.isLatestKnown).toBe(false);
  });

  it('rejects an event the package rejects', () => {
    const loaded = eventToForm(signedEvent([['d', 'x']]));
    expect(loaded.ok).toBe(false);
  });
});

describe('round trip', () => {
  it('preserves unknown tags across load → publish', () => {
    const event = signedEvent([
      ['d', 'blobbi:accessory:hat'],
      ['name', 'Hat'],
      ['type', 'cosmetic'],
      ['durability', '40'],
      ['client', 'some-other-client'],
      ['weird', 'a', 'b', 'c'],
    ]);

    const loaded = eventToForm(event);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.form.extraTags).toEqual([
      ['durability', '40'],
      ['client', 'some-other-client'],
      ['weird', 'a', 'b', 'c'],
    ]);

    const rebuilt = formToUnsignedEvent(loaded.form);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.value.tags).toContainEqual(['durability', '40']);
    expect(rebuilt.value.tags).toContainEqual(['client', 'some-other-client']);
    expect(rebuilt.value.tags).toContainEqual(['weird', 'a', 'b', 'c']);
  });

  it('preserves an unknown image marker verbatim', () => {
    const event = signedEvent([
      ['d', 'blobbi:accessory:hat'],
      ['name', 'Hat'],
      ['type', 'cosmetic'],
      ['image', 'https://cdn.example/p.png'],
      ['image', 'https://cdn.example/top.png', 'top-down'],
    ]);

    const loaded = eventToForm(event);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.form.images.map((row) => row.marker)).toEqual(['', 'top-down']);

    const rebuilt = formToUnsignedEvent(loaded.form);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.value.tags).toContainEqual([
      'image',
      'https://cdn.example/top.png',
      'top-down',
    ]);
  });

  it('preserves marked-view order, and lets the builder hoist the primary', () => {
    // The package builder documents that it "emits one unmarked primary image
    // tag followed by the marked image views". So a definition that published
    // its primary in the middle comes back with the primary first — that is
    // the library normalizing, not the form losing information. What must NOT
    // change is the relative order of the MARKED views, because that is the
    // order clients read them in.
    const event = signedEvent([
      ['d', 'x:y:z'],
      ['name', 'X'],
      ['type', 'misc'],
      ['image', 'https://cdn.example/back.png', 'back'],
      ['image', 'https://cdn.example/p.png'],
      ['image', 'https://cdn.example/front.png', 'front'],
    ]);
    const loaded = eventToForm(event);
    if (!loaded.ok) throw new Error('load failed');

    // The FORM keeps the event's order exactly as published.
    expect(loaded.form.images.map((row) => row.marker)).toEqual(['back', '', 'front']);

    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error('rebuild failed');
    const markers = rebuilt.value.tags
      .filter(([n]) => n === 'image')
      .map((tag) => tag[2] ?? '');
    expect(markers).toEqual(['', 'back', 'front']);
    expect(markers.filter(Boolean)).toEqual(['back', 'front']);
  });

  it('preserves unknown content fields', () => {
    const content = JSON.stringify({
      description: 'x',
      futureField: { nested: true },
      visual: { slot: 'headwear', futureVisual: 42 },
    });
    const event = signedEvent(
      [['d', 'x:y:z'], ['name', 'X'], ['type', 'misc']],
      content,
    );

    const loaded = eventToForm(event);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.form.content.extra).toEqual({ futureField: { nested: true } });
    expect(loaded.form.content.visual.extra).toEqual({ futureVisual: 42 });

    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error('rebuild failed');
    const parsed = JSON.parse(rebuilt.value.content);
    expect(parsed.futureField).toEqual({ nested: true });
    expect(parsed.visual.futureVisual).toBe(42);
  });

  it('keeps the d identity stable through a round trip', () => {
    const built = formToUnsignedEvent(completeForm());
    if (!built.ok) throw new Error('build failed');
    const loaded = eventToForm(signedEvent(built.value.tags, built.value.content));
    if (!loaded.ok) throw new Error('load failed');
    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error('rebuild failed');

    const before = parseGameItemDefinition(signedEvent(built.value.tags, built.value.content));
    const after = parseGameItemDefinition(signedEvent(rebuilt.value.tags, rebuilt.value.content));
    expect(after?.id).toBe(before?.id);
    expect(after?.address).toBe(before?.address);
    expect(after?.images).toEqual(before?.images);
    expect(after?.contexts).toEqual(before?.contexts);
    expect(after?.topics).toEqual(before?.topics);
    expect(after?.basedOn).toEqual(before?.basedOn);
  });

  it('does not duplicate a preserved tag once the form manages it', () => {
    // `alt` is managed, so an event carrying one must produce exactly one on
    // the way back out — never one preserved plus one regenerated.
    const event = signedEvent([
      ['d', 'x:y:z'],
      ['name', 'X'],
      ['type', 'misc'],
      ['alt', 'An X'],
    ]);
    const loaded = eventToForm(event);
    if (!loaded.ok) throw new Error('load failed');
    expect(loaded.form.extraTags).toEqual([]);
    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error('rebuild failed');
    expect(rebuilt.value.tags.filter(([n]) => n === 'alt')).toHaveLength(1);
  });
});

describe('asNewItem', () => {
  it('drops provenance so the next publish is a creation', () => {
    const built = formToUnsignedEvent(completeForm());
    if (!built.ok) throw new Error('build failed');
    const loaded = eventToForm(signedEvent(built.value.tags, built.value.content));
    if (!loaded.ok) throw new Error('load failed');

    const derived = asNewItem(loaded.form);
    expect(derived.loaded).toBeNull();
    expect(derived.d).toBe(loaded.form.d);
  });

  it('adds a based_on reference when deriving from a source address', () => {
    const source = `31632:${'c'.repeat(64)}:blobbi:accessory:original`;
    const derived = asNewItem(blankItemForm(), { derivedFrom: source, d: 'x:y:z' });
    expect(derived.basedOn.map((row) => row.address)).toContain(source);
  });
});

describe('formImageCandidate', () => {
  it('exposes the primary URL and the ordered collection', () => {
    const candidate = formImageCandidate(completeForm());
    expect(candidate.image).toBe('https://cdn.example/hat.png');
    expect(candidate.images.map((image) => image.marker ?? '')).toEqual([
      '',
      'front',
      'back',
    ]);
  });
});

describe('formToBuildInput', () => {
  it('trims values without mutating meaningful whitespace inside them', () => {
    const form = {
      ...blankItemForm(),
      d: '  x:y:z  ',
      name: '  Party  Hat  ',
      type: ' misc ',
    };
    const input = formToBuildInput(form);
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    expect(input.value.id).toBe('x:y:z');
    expect(input.value.name).toBe('Party  Hat');
  });
});
