/**
 * Authoring a VISUAL-EFFECT item definition in the Item Studio.
 *
 * The bug this file pins down: the structured editor modelled `visual` as a
 * wearable and nothing else, so an effect item published a `visual` containing
 * only `forms`: the effect's `kind`, `effect` and `effectSlot` were typed
 * nowhere and therefore never reached the wire. These tests assert the three
 * properties that fix requires and one that it must not break:
 *
 *   1. effect fields survive structured editing;
 *   2. `visual.slot` is not asked for on an effect item;
 *   3. structured ⇄ JSON round-trips without losing an effect field;
 *   4. wearables with `visual.slot` behave exactly as before.
 *
 * Everything here is the real conversion and validation code; no mocks. The
 * package builder decides tag order and required fields, as it does in
 * production.
 */

import { describe, it, expect } from 'vitest';

import {
  BLOBBI_EFFECT_VISUAL_KIND,
  EFFECT_CATEGORY,
  EFFECT_SLOT_SUGGESTIONS,
  type ItemFormState,
  blankItemForm,
  blankVisual,
  contentPatchForCategory,
  isEffectItemForm,
  isEffectVisual,
} from './item-form-model';
// A TEST may import the renderer freely; the domain layer under test may not
// (`boundaries.test.ts`). That asymmetry is what lets the four slot names be
// written out in `item-form-model.ts` without risking drift; see below.
import { EFFECT_SLOT_ORDER } from '@blobbi/react';
import {
  EFFECT_ID_SUGGESTIONS,
  slotForEffectId,
} from '@/components/tools/game-items/effect-vocabulary';
import {
  buildContentString,
  contentStringToFormState,
  eventToForm,
  formToUnsignedEvent,
  toPreviewEvent,
} from './form-event-conversion';
import { validateItemForm } from './validation';
import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';

const PUBKEY = 'a'.repeat(64);

const GOLDEN_DESCRIPTION =
  'A cheerful constellation of golden stars that twinkles and drifts around your Blobbi wherever it goes.';

/** The Golden Sparkles item exactly as the phase's catalogue specifies it. */
function goldenSparklesForm(overrides: Partial<ItemFormState> = {}): ItemFormState {
  const base = blankItemForm();
  return {
    ...base,
    d: 'blobbi:effect:golden-sparkles',
    name: 'Golden Sparkles',
    type: 'cosmetic',
    category: EFFECT_CATEGORY,
    symbol: '✨',
    rarity: 'rare',
    maxStack: '1',
    version: '1',
    alt: 'Game item definition: Golden Sparkles',
    images: [
      { id: 'image-fx', url: 'https://fixtures.invalid/golden-sparkles.webp', marker: '' },
    ],
    contexts: ['game:blobbi', 'game:blobbi-island'],
    topics: [
      'equipable',
      'wearable',
      'visual-effect',
      'sparkles',
      'golden',
      'particles',
      'arcade-prize',
    ],
    content: {
      ...base.content,
      description: GOLDEN_DESCRIPTION,
      visual: {
        ...blankVisual(),
        kind: BLOBBI_EFFECT_VISUAL_KIND,
        effect: 'golden-sparkles',
        effectSlot: 'ambient-particles',
        forms: ['baby', 'adult'],
      },
    },
    ...overrides,
  };
}

/** A plain wearable, for the "unchanged" half of the contract. */
function partyHatForm(overrides: Partial<ItemFormState> = {}): ItemFormState {
  const base = blankItemForm();
  return {
    ...base,
    d: 'blobbi:accessory:party-hat',
    name: 'Party Hat',
    type: 'cosmetic',
    category: 'headwear',
    images: [{ id: 'image-hat', url: 'https://fixtures.invalid/hat.png', marker: '' }],
    content: {
      ...base.content,
      description: 'A jaunty paper hat.',
      visual: { ...blankVisual(), slot: 'headwear', forms: ['baby', 'adult'] },
    },
    ...overrides,
  };
}

const contentOf = (form: ItemFormState) => {
  const built = buildContentString(form.content);
  if (!built.ok) throw new Error(built.error);
  return built.value;
};

const parsedContentOf = (form: ItemFormState) =>
  JSON.parse(contentOf(form)) as Record<string, unknown>;

// ── 1. Effect fields survive structured editing ────────────────────────────

describe('effect visual fields are preserved in structured editing', () => {
  it('serializes kind, effect, effectSlot and forms', () => {
    expect(parsedContentOf(goldenSparklesForm())).toEqual({
      description: GOLDEN_DESCRIPTION,
      visual: {
        kind: 'blobbi-effect',
        effect: 'golden-sparkles',
        effectSlot: 'ambient-particles',
        forms: ['baby', 'adult'],
      },
    });
  });

  it('produces exactly the documented content string, key order included', () => {
    // Byte-for-byte, because this is the string that goes on a relay and the
    // one the phase document publishes as the expected output.
    expect(contentOf(goldenSparklesForm())).toBe(
      `{"description":${JSON.stringify(GOLDEN_DESCRIPTION)},` +
        '"visual":{"kind":"blobbi-effect","effect":"golden-sparkles",' +
        '"effectSlot":"ambient-particles","forms":["baby","adult"]}}',
    );
  });

  it('emits no visual.slot and no metadata the author did not set', () => {
    const content = parsedContentOf(goldenSparklesForm());
    const visual = content.visual as Record<string, unknown>;
    expect(visual).not.toHaveProperty('slot');
    // The reported failure produced `metadata: { itemId, stackable }` nobody
    // asked for. Nothing may be injected: an empty metadata list emits no key.
    expect(content).not.toHaveProperty('metadata');
    expect(content).not.toHaveProperty('effects');
  });

  it('builds the whole event, with identity in tags and the effect in content', () => {
    const built = formToUnsignedEvent(goldenSparklesForm());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const tag = (name: string) =>
      built.value.tags.filter((t) => t[0] === name).map((t) => t[1]);

    expect(built.value.kind).toBe(KIND_GAME_ITEM_DEFINITION);
    expect(tag('d')).toEqual(['blobbi:effect:golden-sparkles']);
    expect(tag('name')).toEqual(['Golden Sparkles']);
    expect(tag('type')).toEqual(['cosmetic']);
    expect(tag('category')).toEqual(['effect']);
    expect(tag('symbol')).toEqual(['✨']);
    expect(tag('rarity')).toEqual(['rare']);
    expect(tag('max_stack')).toEqual(['1']);
    expect(tag('version')).toEqual(['1']);
    expect(tag('image')).toEqual(['https://fixtures.invalid/golden-sparkles.webp']);
    expect(tag('context')).toEqual(['game:blobbi', 'game:blobbi-island']);
    expect(tag('t')).toEqual([
      'equipable',
      'wearable',
      'visual-effect',
      'sparkles',
      'golden',
      'particles',
      'arcade-prize',
    ]);
    expect(tag('alt')).toEqual(['Game item definition: Golden Sparkles']);

    // The effect configuration lives in content and NOWHERE in the tags: a tag
    // is indexable metadata, and the effect shape is not a query key.
    const tagText = JSON.stringify(built.value.tags);
    expect(tagText).not.toContain('blobbi-effect');
    expect(tagText).not.toContain('ambient-particles');
    expect(JSON.parse(built.value.content).visual.effect).toBe('golden-sparkles');
  });

  it('omits an effect field the author left blank rather than emitting an empty one', () => {
    const form = goldenSparklesForm();
    form.content.visual = { ...form.content.visual, effectSlot: '  ' };
    const visual = parsedContentOf(form).visual as Record<string, unknown>;
    expect(visual).not.toHaveProperty('effectSlot');
    expect(visual.effect).toBe('golden-sparkles');
  });

  it('recognizes an effect item from either its visual or its category', () => {
    expect(isEffectItemForm(goldenSparklesForm())).toBe(true);
    // Category alone, before the author has touched the visual.
    expect(isEffectItemForm({ ...blankItemForm(), category: 'effect' })).toBe(true);
    expect(isEffectItemForm({ ...blankItemForm(), category: 'Effect' })).toBe(true);
    expect(isEffectItemForm(partyHatForm())).toBe(false);
    expect(isEffectVisual(partyHatForm().content.visual)).toBe(false);
  });
});

describe('choosing the effect category seeds the effect shape', () => {
  it('fills in visual.kind so the structured editor stops emitting a bare forms list', () => {
    const patched = contentPatchForCategory(blankItemForm().content, EFFECT_CATEGORY);
    expect(patched?.visual.kind).toBe(BLOBBI_EFFECT_VISUAL_KIND);
    expect(patched?.visual.slot).toBe('');
  });

  it('seeds only an unclaimed visual; it never rewrites typed content', () => {
    const hat = partyHatForm().content;
    expect(contentPatchForCategory(hat, EFFECT_CATEGORY)).toBeNull();

    const alreadyEffect = goldenSparklesForm().content;
    expect(contentPatchForCategory(alreadyEffect, EFFECT_CATEGORY)).toBeNull();
  });

  it('does nothing for any other category, or in JSON mode', () => {
    const blank = blankItemForm().content;
    expect(contentPatchForCategory(blank, 'headwear')).toBeNull();
    expect(contentPatchForCategory(blank, '')).toBeNull();
    expect(contentPatchForCategory({ ...blank, mode: 'json' }, EFFECT_CATEGORY)).toBeNull();
    expect(contentPatchForCategory({ ...blank, rawOnly: true }, EFFECT_CATEGORY)).toBeNull();
  });
});

describe('the effect vocabulary agrees with the renderer', () => {
  it('offers exactly the four effect slots', () => {
    expect([...EFFECT_SLOT_SUGGESTIONS].sort()).toEqual([
      'ambient-particles',
      'aura',
      'body-overlay',
      'ground-local',
    ]);
  });

  it('has not drifted from the slots the renderer actually implements', () => {
    // The domain layer writes these four names out rather than importing them,
    // to keep React out of event building. This is the guard that makes that
    // safe: add or remove an effect slot in `@blobbi/react` and this fails.
    expect([...EFFECT_SLOT_SUGGESTIONS].sort()).toEqual([...EFFECT_SLOT_ORDER].sort());
  });

  it('offers the twelve implemented effect ids', () => {
    expect(EFFECT_ID_SUGGESTIONS).toContain('golden-sparkles');
    expect(EFFECT_ID_SUGGESTIONS).toHaveLength(12);
  });

  it('answers the slot of a known effect, and refuses to guess for an unknown one', () => {
    expect(slotForEffectId('golden-sparkles')).toBe('ambient-particles');
    expect(slotForEffectId('celestial-aura')).toBe('aura');
    expect(slotForEffectId('mystic-fog')).toBe('ground-local');
    expect(slotForEffectId('pixel-glitch')).toBe('body-overlay');
    expect(slotForEffectId('not-an-effect')).toBe('');
    expect(slotForEffectId('')).toBe('');
  });
});

// ── 2. visual.slot is not required for category "effect" ───────────────────

describe('visual.slot is not required for an effect item', () => {
  const validate = (form: ItemFormState) => {
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    return validateItemForm({
      form,
      previewEvent: toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      buildError: null,
      probes: new Map(),
    });
  };

  const codes = (form: ItemFormState) => validate(form).authoring.map((i) => i.code);

  it('does not suggest a wearable slot on an effect item', () => {
    expect(codes(goldenSparklesForm())).not.toContain('cosmetic-no-slot');
  });

  it('does not suggest one from the category alone, before the visual is filled in', () => {
    const form = goldenSparklesForm();
    form.content.visual = blankVisual();
    expect(codes(form)).not.toContain('cosmetic-no-slot');
  });

  it('still suggests one for a cosmetic that is NOT an effect', () => {
    const form = partyHatForm();
    form.content.visual = { ...blankVisual(), forms: ['baby'] };
    expect(codes(form)).toContain('cosmetic-no-slot');
  });

  it('publishes without any blocking issue', () => {
    const result = validate(goldenSparklesForm());
    expect(result.blocking).toEqual([]);
    expect(result.isPublishable).toBe(true);
  });

  it('a fully specified effect item raises no effect-specific advice at all', () => {
    expect(codes(goldenSparklesForm()).filter((c) => c.startsWith('effect-'))).toEqual([]);
  });
});

describe('effect-specific authoring advice', () => {
  const codes = (form: ItemFormState) => {
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    return validateItemForm({
      form,
      previewEvent: toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      buildError: null,
      probes: new Map(),
    }).authoring.map((i) => i.code);
  };

  const withVisual = (visual: Partial<ReturnType<typeof blankVisual>>) => {
    const form = goldenSparklesForm();
    form.content.visual = { ...form.content.visual, ...visual };
    return form;
  };

  it('notes a missing effect id, slot and kind', () => {
    expect(codes(withVisual({ effect: '' }))).toContain('effect-no-id');
    expect(codes(withVisual({ effectSlot: '' }))).toContain('effect-no-slot');
    expect(codes(withVisual({ kind: '' }))).toContain('effect-no-kind');
  });

  it('does not judge whether the effect is one this client can draw', () => {
    // That is a question about the RENDERER, and the domain layer cannot see it
    // without importing React into event building. `BlobbiEffectPreview` reports
    // it instead, which is also where an author looks to see what is drawn.
    const form = withVisual({ effect: 'moon-halo', effectSlot: 'aura' });
    expect(codes(form).filter((c) => c.startsWith('effect-'))).toEqual([]);
    const built = formToUnsignedEvent(form);
    expect(built.ok).toBe(true);
  });

  it('notes a slot that is not one of the four', () => {
    expect(codes(withVisual({ effectSlot: 'behind-the-ears' }))).toContain(
      'effect-unknown-slot',
    );
  });

  it('notes a wearable slot left on an effect item', () => {
    expect(codes(withVisual({ slot: 'headwear' }))).toContain('effect-has-wearable-slot');
  });

  it('reports every one of them as a suggestion, never as a blocker', () => {
    const form = withVisual({
      kind: '',
      effect: 'moon-halo',
      effectSlot: 'nowhere',
      slot: 'headwear',
    });
    const built = formToUnsignedEvent(form);
    if (!built.ok) throw new Error(built.error);
    const result = validateItemForm({
      form,
      previewEvent: toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      buildError: null,
      probes: new Map(),
    });
    expect(result.blocking).toEqual([]);
    expect(result.isPublishable).toBe(true);
    expect(result.authoring.every((i) => i.severity === 'suggestion')).toBe(true);
  });
});

// ── 3. Structured ⇄ JSON round trip ────────────────────────────────────────

describe('structured and JSON modes round-trip without dropping effect fields', () => {
  it('structured → JSON → structured preserves kind, effect and effectSlot', () => {
    const original = goldenSparklesForm().content;

    // Structured → JSON: exactly what the editor's JSON button does.
    const json = buildContentString(original);
    expect(json.ok).toBe(true);
    if (!json.ok) return;

    // JSON → structured: exactly what the Structured button does.
    const back = contentStringToFormState(json.value);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(back.value.visual.kind).toBe('blobbi-effect');
    expect(back.value.visual.effect).toBe('golden-sparkles');
    expect(back.value.visual.effectSlot).toBe('ambient-particles');
    expect(back.value.visual.forms).toEqual(['baby', 'adult']);
    expect(back.value.visual.slot).toBe('');
    expect(back.value.description).toBe(GOLDEN_DESCRIPTION);
    // Nothing was pushed into the unknown-key bucket: these fields are modelled.
    expect(back.value.visual.extra).toEqual({});
    expect(back.value.extra).toEqual({});
  });

  it('re-serializes to byte-identical content after the round trip', () => {
    const original = goldenSparklesForm().content;
    const json = buildContentString(original);
    if (!json.ok) throw new Error(json.error);
    const back = contentStringToFormState(json.value);
    if (!back.ok) throw new Error(back.error);
    const again = buildContentString({ ...back.value, mode: 'structured' });
    if (!again.ok) throw new Error(again.error);
    expect(again.value).toBe(json.value);
  });

  it('hand-written effect JSON loads into the structured fields', () => {
    // The author pasted this into JSON mode and pressed Structured.
    const raw = JSON.stringify({
      description: 'Violet mist.',
      visual: {
        kind: 'blobbi-effect',
        effect: 'mystic-fog',
        effectSlot: 'ground-local',
        forms: ['adult'],
      },
    });
    const parsed = contentStringToFormState(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.visual).toEqual({
      slot: '',
      kind: 'blobbi-effect',
      effect: 'mystic-fog',
      effectSlot: 'ground-local',
      forms: ['adult'],
      extra: {},
    });
  });

  it('survives a full publish → load → republish cycle', () => {
    const built = formToUnsignedEvent(goldenSparklesForm());
    if (!built.ok) throw new Error(built.error);
    const published = {
      ...toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      id: 'e'.repeat(64),
      sig: 'f'.repeat(128),
    };

    const loaded = eventToForm(published);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.form.content.mode).toBe('structured');
    expect(loaded.form.content.visual.kind).toBe('blobbi-effect');
    expect(loaded.form.content.visual.effect).toBe('golden-sparkles');
    expect(loaded.form.content.visual.effectSlot).toBe('ambient-particles');
    expect(loaded.form.category).toBe('effect');

    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(rebuilt.value.content).toBe(built.value.content);
    expect(rebuilt.value.tags).toEqual(built.value.tags);
  });

  it('keeps an unknown visual key, and a managed key holding the wrong type', () => {
    // `effect` as a NUMBER is not something the typed field can hold. Coercing
    // it would rewrite another issuer's definition, so it rides along in
    // `extra` and is republished exactly as published.
    const raw = JSON.stringify({
      visual: {
        kind: 'blobbi-effect',
        effect: 42,
        effectSlot: 'aura',
        intensityHint: 0.6,
      },
    });
    const parsed = contentStringToFormState(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.visual.effect).toBe('');
    expect(parsed.value.visual.extra).toEqual({ effect: 42, intensityHint: 0.6 });

    const rebuilt = buildContentString({ ...parsed.value, mode: 'structured' });
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    const visual = (JSON.parse(rebuilt.value) as Record<string, Record<string, unknown>>)
      .visual;
    expect(visual.effect).toBe(42);
    expect(visual.intensityHint).toBe(0.6);
  });
});

// ── 4. Wearables are unchanged ─────────────────────────────────────────────

describe('accessory items with visual.slot still work unchanged', () => {
  it('serializes slot and forms, and no effect keys', () => {
    expect(parsedContentOf(partyHatForm())).toEqual({
      description: 'A jaunty paper hat.',
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    });
  });

  it('round-trips structured → JSON → structured', () => {
    const json = buildContentString(partyHatForm().content);
    if (!json.ok) throw new Error(json.error);
    const back = contentStringToFormState(json.value);
    if (!back.ok) throw new Error(back.error);
    expect(back.value.visual.slot).toBe('headwear');
    expect(back.value.visual.kind).toBe('');
    expect(back.value.visual.effect).toBe('');
    expect(back.value.visual.effectSlot).toBe('');
    expect(back.value.visual.forms).toEqual(['baby', 'adult']);
  });

  it('survives publish → load → republish byte-identically', () => {
    const built = formToUnsignedEvent(partyHatForm());
    if (!built.ok) throw new Error(built.error);
    const published = {
      ...toPreviewEvent(built.value, PUBKEY, 1_700_000_000),
      id: 'e'.repeat(64),
      sig: 'f'.repeat(128),
    };
    const loaded = eventToForm(published);
    if (!loaded.ok) throw new Error(loaded.error);
    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(rebuilt.value.content).toBe(built.value.content);
    expect(rebuilt.value.tags).toEqual(built.value.tags);
  });

  it('is not mistaken for an effect item by any signal', () => {
    expect(isEffectItemForm(partyHatForm())).toBe(false);
    expect(isEffectItemForm(partyHatForm({ category: 'aura' }))).toBe(false);
  });

  it('leaves an existing accessory definition alone when it is loaded and saved', () => {
    // The published Block Builder Cap shape, minus the URLs.
    const event = {
      id: 'e'.repeat(64),
      pubkey: PUBKEY,
      created_at: 1_700_000_000,
      kind: KIND_GAME_ITEM_DEFINITION,
      tags: [
        ['d', 'blobbi:cosmetic:block-builder-cap'],
        ['name', 'Block Builder Cap'],
        ['type', 'cosmetic'],
        ['category', 'headwear'],
        ['image', 'https://fixtures.invalid/cap.webp'],
        ['image', 'https://fixtures.invalid/cap-back.webp', 'back'],
        ['context', 'game:blobbi'],
        ['t', 'equipable'],
      ],
      content: JSON.stringify({
        description: 'A builder cap.',
        visual: { slot: 'headwear', forms: ['baby', 'adult'] },
      }),
      sig: 'f'.repeat(128),
    };

    const loaded = eventToForm(event);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.form.content.visual.slot).toBe('headwear');
    expect(isEffectItemForm(loaded.form)).toBe(false);

    const rebuilt = formToUnsignedEvent(loaded.form);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(JSON.parse(rebuilt.value.content)).toEqual({
      description: 'A builder cap.',
      visual: { slot: 'headwear', forms: ['baby', 'adult'] },
    });
  });
});
