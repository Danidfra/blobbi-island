/**
 * Focused tests for the adoption preview → published baby tag set.
 *
 * These pin the data-level guarantees the first-adoption flow relies on WITHOUT
 * any animation timing:
 *
 *   - `generateEggPreview` derives a canonical `blobbi-<prefix>-<petId>` d and a
 *     seed, and different calls produce different (unique) ids.
 *   - `previewToBabyTags` produces a `stage=baby` (never egg) event that:
 *       * passes `validatePetStateEvent` (so it survives the reload query), and
 *       * passes `isModernBlobbi` (so it is shown in the collection, i.e. the
 *         user does NOT bounce back to the empty nest / reopen the ceremony), and
 *       * carries the SAME d as the preview.
 *   - An existing baby event is treated as a real, modern, non-egg Blobbi (so an
 *     existing-Blobbi user skips first adoption), while an egg is filtered out.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { generateEggPreview, previewToBabyTags, previewVisual } from './blobbi-egg-preview';
import { mergePetStateTags, validatePetStateEvent, parsePetState } from './blobbi-parsers';
import { classifyBlobbiEvent, getTagValue, parseModernBlobbiEvent } from '@blobbi-kit/core/blobbi';
import { BLOBBI_V3_ABSENT_TAG_NAMES, deriveBlobbiV3Seed } from '@blobbi-kit/core/blobbi-v3-identity';
import { getBlobbiVisualIdentity } from '@blobbi-kit/core/blobbi-visual-identity';
import { createBlobbiV3Identity, normalizeBlobbiV3Visual, renderBlobbiSvg } from '@blobbi-kit/renderer';
import { KIND_BLOBBI_STATE } from './blobbi-kinds';

const PUBKEY = 'feb88e80a63d1111222233334444555566667777888899990000aaaabbbbcccc';

function asBabyEvent(tags: string[][]): NostrEvent {
  return {
    id: 'x'.repeat(64),
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: KIND_BLOBBI_STATE,
    tags,
    content: '',
    sig: 's'.repeat(128),
  };
}

describe('adoption preview → baby tags', () => {
  it('generates a canonical, unique d and a seed', () => {
    const a = generateEggPreview(PUBKEY, 'Egg');
    const b = generateEggPreview(PUBKEY, 'Egg');

    expect(a.d).toMatch(/^blobbi-feb88e80a63d-[a-f0-9]{10}$/);
    // The seed is the address, hashed by the kit: no birth time in it, no tag for it.
    expect(a.seed).toBe(deriveBlobbiV3Seed(PUBKEY, a.d));
    expect(a.d).not.toBe(b.d); // unique petId per preview
    expect(a.seed).not.toBe(b.seed);
  });

  it('previewToBabyTags produces a baby (never egg) that survives reload validation', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const tags = previewToBabyTags({ ...preview, name: 'Puck' });
    const event = asBabyEvent(tags);

    // stage is baby, not egg, so useBlobbis (which drops eggs) keeps it.
    expect(tags.find(([n]) => n === 'stage')?.[1]).toBe('baby');

    // Passes the same validator useBlobbis uses on reload.
    expect(validatePetStateEvent(event)).toBe(true);

    const parsed = parsePetState(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.stage).toBe('baby');
    expect(parsed!.id).toBe(preview.d);
  });

  it('published baby is a MODERN blobbi (shown in collection, no empty-nest bounce)', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const event = asBabyEvent(previewToBabyTags({ ...preview, name: 'Puck' }));
    // Modern by core's canonical classification: the same predicate the
    // Island collection now parses with, so it is shown, never dropped.
    expect(classifyBlobbiEvent(event)).toBe('modern');
    expect(parsePetState(event)).not.toBeNull();
  });

  it('an egg event would be excluded by the collection filter', () => {
    // Sanity: the collection filter drops stage=egg. Prove a baby is not an egg.
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const parsed = parsePetState(asBabyEvent(previewToBabyTags(preview)))!;
    expect(parsed.stage).not.toBe('egg');
  });
});

describe('the artwork generation of a new Blobbi', () => {
  it('is born V3, canonically: visual_generation=v3 and nothing a V3 event does not carry', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const tags = previewToBabyTags({ ...preview, name: 'Puck' });
    expect(tags.filter(([n]) => n === 'visual_generation')).toEqual([['visual_generation', 'v3']]);
    for (const name of BLOBBI_V3_ABSENT_TAG_NAMES) expect(getTagValue(tags, name), name).toBeUndefined();
    const event = asBabyEvent(tags);
    expect(classifyBlobbiEvent(event)).toBe('modern');
    const companion = parseModernBlobbiEvent(event)!;
    expect(companion.visualGeneration).toBe('v3');
    expect(companion.v3Identity).toEqual({ seed: preview.seed, algorithm: 1, missing: [] });
    const pet = parsePetState(event)!;
    expect(pet.visualGeneration).toBe('v3');
    expect(pet.v3).toEqual({ seed: preview.seed, algorithm: 1 });
    expect(pet.baseColor).toBeUndefined();
    expect(pet.size).toBeUndefined();
    expect(pet.adultType).toBeUndefined();
    // Island's own stats and lifecycle: a playable baby.
    expect(getTagValue(tags, 'stage')).toBe('baby');
    expect(getTagValue(tags, 'progression_state')).toBe('none');
    for (const stat of ['hunger', 'happiness', 'health', 'hygiene', 'energy']) expect(getTagValue(tags, stat), stat).toBe('100');
  });

  it('the preview IS the published Blobbi: the same seed, the same identity, the same drawing', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const published = parseModernBlobbiEvent(asBabyEvent(previewToBabyTags({ ...preview, name: 'Puck' })))!;
    const visual = getBlobbiVisualIdentity(published);
    expect(visual.v3).toEqual(previewVisual(preview));
    expect(normalizeBlobbiV3Visual(previewVisual(preview))).toEqual(createBlobbiV3Identity(preview.seed));
    expect(preview.colors).toEqual(createBlobbiV3Identity(preview.seed).colors);
    const draw = (v3: typeof visual.v3) => renderBlobbiSvg({ stage: 'baby', visualGeneration: 'v3', v3, instanceId: 'same' }).svg;
    expect(draw(previewVisual(preview))).toBe(draw(visual.v3));
  });

  it('every Island republish of the new baby keeps it canonical: no colour, seed or trait tag is ever written', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const pet = parsePetState(asBabyEvent(previewToBabyTags({ ...preview, name: 'Puck' })))!;
    const tags = mergePetStateTags({ ...pet, hunger: 40 }, { care_streak: '2' });
    expect(getTagValue(tags, 'visual_generation')).toBe('v3');
    expect(getTagValue(tags, 'd')).toBe(preview.d);
    for (const name of BLOBBI_V3_ABSENT_TAG_NAMES) expect(getTagValue(tags, name), name).toBeUndefined();
    expect(parsePetState(asBabyEvent(tags))!.v3).toEqual({ seed: preview.seed, algorithm: 1 });
  });

  it('an existing Blobbi without the tag stays V1: nothing is migrated on read', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    // A V1 baby as an older client published it: the V1 seed and its mirrors.
    const legacy = [...previewToBabyTags({ ...preview, name: 'Puck' }).filter(([n]) => n !== 'visual_generation'), ['seed', 'a'.repeat(64)], ['base_color', '#aabbcc']];
    const parsed = parsePetState(asBabyEvent(legacy))!;
    expect(parsed.visualGeneration).toBe('v1');
    expect(parsed.v3).toBeUndefined();
    expect(parsed.baseColor).toBe('#aabbcc');
    expect(classifyBlobbiEvent(asBabyEvent(legacy))).toBe('modern');
  });
});
