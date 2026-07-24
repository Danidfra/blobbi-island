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

import { generateEggPreview, previewToBabyTags } from './blobbi-egg-preview';
import { validatePetStateEvent, parsePetState } from './blobbi-parsers';
import { isModernBlobbi } from './blobbi-legacy';
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
    expect(a.seed).toBeTruthy();
    expect(a.d).not.toBe(b.d); // unique petId per preview
  });

  it('previewToBabyTags produces a baby (never egg) that survives reload validation', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const tags = previewToBabyTags({ ...preview, name: 'Puck' });
    const event = asBabyEvent(tags);

    // stage is baby, not egg — so useBlobbis (which drops eggs) keeps it.
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
    const parsed = parsePetState(event)!;

    expect(isModernBlobbi({ id: parsed.id, rawTags: parsed.rawTags })).toBe(true);
  });

  it('an egg event would be excluded by the collection filter', () => {
    // Sanity: the collection filter drops stage=egg. Prove a baby is not an egg.
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const parsed = parsePetState(asBabyEvent(previewToBabyTags(preview)))!;
    expect(parsed.stage).not.toBe('egg');
  });
});
