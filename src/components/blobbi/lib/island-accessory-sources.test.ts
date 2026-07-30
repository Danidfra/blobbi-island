/**
 * The Island accessory asset adapter: published artwork joined to the historical
 * filename convention.
 *
 * Two properties matter most and are asserted hardest:
 *
 *  1. LEGACY ACCESSORIES ARE UNTOUCHED. Every accessory in the game today has no
 *     item definition, so the resolver must return byte-for-byte what it
 *     returned before this phase. A regression here breaks every hat in the
 *     world at once.
 *  2. A DEFINITION OUTRANKS A GUESS. When an issuer has published what an item
 *     looks like, that beats a path derived from the item's code.
 */

import { describe, it, expect } from 'vitest';

import {
  createIslandAccessorySourceResolver,
  islandAccessorySources,
} from './island-accessory-sources';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';
import type { ItemImageCandidate } from '@/inventory/item-image-resolution';
import { accessoryImagePath } from '@/lib/asset-paths';
import { generateAccessoryUrl } from './accessory-utils';

const HAT = { code: 'headwear-8', slot: 'headwear' as const };
const STORED_URL = 'https://stored.invalid/headwear-8.png';

const webp = accessoryImagePath(HAT.slot, HAT.code, 'webp');
const png = accessoryImagePath(HAT.slot, HAT.code, 'png');
const generated = generateAccessoryUrl(HAT.code)!;

function definitions(
  entries: Record<string, ItemImageCandidate>,
): ReadonlyMap<string, ItemImageCandidate> {
  return new Map(Object.entries(entries));
}

describe('legacy accessories keep their exact source chain', () => {
  it('uses the stored URL, then the local webp, then the local png', () => {
    expect(islandAccessorySources({ ...HAT, url: STORED_URL })).toEqual([
      STORED_URL,
      webp,
      png,
    ]);
  });

  it('generates the remote URL only when no URL is stored', () => {
    expect(islandAccessorySources(HAT)).toEqual([generated, webp, png]);
    // With a stored URL the generated one is NOT appended: adding it would
    // introduce a network retry that never used to happen.
    expect(islandAccessorySources({ ...HAT, url: STORED_URL })).not.toContain(generated);
  });

  it('drops the generated URL for a code with an unrecognized prefix', () => {
    const mystery = { code: 'sparkle-1', slot: 'unknown' as const };
    expect(generateAccessoryUrl(mystery.code)).toBeNull();
    expect(islandAccessorySources(mystery)).toEqual([
      accessoryImagePath('unknown', 'sparkle-1', 'webp'),
      accessoryImagePath('unknown', 'sparkle-1', 'png'),
    ]);
  });

  it('behaves identically with an empty definition map and with none at all', () => {
    const empty = createIslandAccessorySourceResolver({ definitionsByCode: new Map() });
    expect(empty({ ...HAT, url: STORED_URL })).toEqual(
      islandAccessorySources({ ...HAT, url: STORED_URL }),
    );
  });

  it('is unaffected by facing when no definition exists', () => {
    const back = createIslandAccessorySourceResolver({ facing: 'back' });
    expect(back({ ...HAT, url: STORED_URL })).toEqual([STORED_URL, webp, png]);
  });

  it('never emits an empty source, and never repeats one', () => {
    // A stored URL that happens to equal the local png must not be tried twice.
    const sources = islandAccessorySources({ ...HAT, url: png });
    expect(sources).toEqual([png, webp]);
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources.every((s) => s.length > 0)).toBe(true);
  });
});

describe('a published definition outranks the legacy chain', () => {
  const withViews = definitions({
    [HAT.code]: {
      images: [
        { url: U.primary },
        { url: U.front, marker: 'front' },
        { url: U.back, marker: 'back' },
      ],
    },
  });

  it('puts the front view first for a front-facing Blobbi', () => {
    const resolve = createIslandAccessorySourceResolver({
      definitionsByCode: withViews,
      facing: 'front',
    });
    expect(resolve({ ...HAT, url: STORED_URL })).toEqual([
      U.front,
      U.primary,
      STORED_URL,
      webp,
      png,
    ]);
  });

  it('puts the back view first for a rear-facing Blobbi', () => {
    const resolve = createIslandAccessorySourceResolver({
      definitionsByCode: withViews,
      facing: 'back',
    });
    expect(resolve({ ...HAT, url: STORED_URL })).toEqual([
      U.back,
      U.primary,
      U.front,
      STORED_URL,
      webp,
      png,
    ]);
  });

  it('defaults to the front view when no facing is given', () => {
    const resolve = createIslandAccessorySourceResolver({ definitionsByCode: withViews });
    expect(resolve(HAT)[0]).toBe(U.front);
  });

  it('keeps the legacy chain intact underneath as a genuine fallback', () => {
    const resolve = createIslandAccessorySourceResolver({ definitionsByCode: withViews });
    expect(resolve({ ...HAT, url: STORED_URL }).slice(-3)).toEqual([
      STORED_URL,
      webp,
      png,
    ]);
  });

  it('leaves accessories WITHOUT a definition on the legacy chain', () => {
    const resolve = createIslandAccessorySourceResolver({ definitionsByCode: withViews });
    const other = { code: 'back-3', slot: 'back' as const };
    expect(resolve(other)).toEqual([
      generateAccessoryUrl('back-3')!,
      accessoryImagePath('back', 'back-3', 'webp'),
      accessoryImagePath('back', 'back-3', 'png'),
    ]);
  });

  it('never offers a side or diagonal view to a front/back actor', () => {
    const turnaround = definitions({
      [HAT.code]: {
        images: [
          { url: U.primary },
          { url: U.front, marker: 'front' },
          { url: U.back, marker: 'back' },
          { url: U.sideRight, marker: 'side-right' },
          { url: U.diagonalFrontLeft, marker: 'diagonal-front-left' },
        ],
      },
    });
    for (const facing of ['front', 'back'] as const) {
      const sources = createIslandAccessorySourceResolver({
        definitionsByCode: turnaround,
        facing,
      })({ ...HAT, url: STORED_URL });
      expect(sources).not.toContain(U.sideRight);
      expect(sources).not.toContain(U.diagonalFrontLeft);
    }
  });

  it('de-duplicates a definition image that equals the stored URL', () => {
    const same = definitions({ [HAT.code]: { images: [{ url: STORED_URL }] } });
    const sources = createIslandAccessorySourceResolver({ definitionsByCode: same })({
      ...HAT,
      url: STORED_URL,
    });
    expect(sources).toEqual([STORED_URL, webp, png]);
  });

  it('falls straight through when the definition has no usable image', () => {
    const blank = definitions({ [HAT.code]: { images: [] } });
    const sources = createIslandAccessorySourceResolver({ definitionsByCode: blank })({
      ...HAT,
      url: STORED_URL,
    });
    expect(sources).toEqual([STORED_URL, webp, png]);
  });
});
