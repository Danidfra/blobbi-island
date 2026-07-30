/**
 * kind:31632 image views — library integration and Island selection policy.
 *
 * Every case here starts from RAW TAGS and goes through the real
 * `@nostr-games/inventory@0.2.0` parser, so the tests fail if the library's
 * contract moves under us rather than quietly agreeing with a hand-built object
 * that no issuer could actually publish.
 *
 * No relay, no signer, no published event, no inventory ownership — see
 * `item-image-fixtures.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  GAME_ITEM_IMAGE_MARKERS,
  getPrimaryItemImage,
  isGameItemImageMarker,
  parseGameItemDefinitionResult,
  selectPrimaryGameItemImage,
  type GameItemDefinition,
} from './package';
import {
  dedupeImageSources,
  itemImageByMarker,
  itemImagesByMarker,
  itemImageSourcesForView,
  primaryItemImageUrl,
} from './item-image-resolution';
import {
  ALL_ITEM_IMAGE_FIXTURES,
  FIXTURE_BACK_ONLY,
  FIXTURE_DUPLICATE_FRONT,
  FIXTURE_FRONT_ONLY,
  FIXTURE_FULL_TURNAROUND,
  FIXTURE_IMAGE_URLS as U,
  FIXTURE_INVALID_IMAGE_TAGS,
  FIXTURE_MULTIPLE_PRIMARIES,
  FIXTURE_NO_IMAGES,
  FIXTURE_ONLY_MARKED,
  FIXTURE_PRIMARY_FRONT_BACK,
  FIXTURE_PRIMARY_ONLY,
  FIXTURE_UNKNOWN_MARKER,
} from './item-image-fixtures';
import type { NostrEvent } from '@nostrify/nostrify';

/** Parse a fixture, asserting it survived — none of them are invalid items. */
function parse(event: NostrEvent): GameItemDefinition {
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) throw new Error(`fixture rejected: ${result.error}`);
  return result.value;
}

function warningsOf(event: NostrEvent): string[] {
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  return result.warnings.map((w) => w.code);
}

describe('external library integration (0.2.0)', () => {
  it('exposes the six view markers this spec version defines', () => {
    expect([...GAME_ITEM_IMAGE_MARKERS]).toEqual([
      'front',
      'side-right',
      'side-left',
      'back',
      'diagonal-front-right',
      'diagonal-front-left',
    ]);
  });

  it('narrows known markers and rejects unknown ones without dropping them', () => {
    expect(isGameItemImageMarker('front')).toBe(true);
    expect(isGameItemImageMarker('diagonal-front-left')).toBe(true);
    expect(isGameItemImageMarker('top-down')).toBe(false);

    // Not a known marker, yet still present in the parsed collection.
    const def = parse(FIXTURE_UNKNOWN_MARKER);
    expect(def.images).toEqual([
      { url: U.primary },
      { url: U.future, marker: 'top-down' },
    ]);
  });

  it('parses every `image` tag into an ordered collection with its marker', () => {
    const def = parse(FIXTURE_FULL_TURNAROUND);
    expect(def.images).toEqual([
      { url: U.primary },
      { url: U.front, marker: 'front' },
      { url: U.back, marker: 'back' },
      { url: U.sideRight, marker: 'side-right' },
      { url: U.sideLeft, marker: 'side-left' },
      { url: U.diagonalFrontRight, marker: 'diagonal-front-right' },
      { url: U.diagonalFrontLeft, marker: 'diagonal-front-left' },
    ]);
  });

  it('agrees with itself: `image` IS the primary selection over `images`', () => {
    for (const fixture of ALL_ITEM_IMAGE_FIXTURES) {
      const def = parse(fixture);
      expect(def.image).toBe(getPrimaryItemImage(def));
      expect(def.image).toBe(selectPrimaryGameItemImage(def.images)?.url);
    }
  });

  it('drops blank/valueless image tags and keeps the item', () => {
    const def = parse(FIXTURE_INVALID_IMAGE_TAGS);
    expect(def.images).toEqual([{ url: U.primary }]);
    expect(warningsOf(FIXTURE_INVALID_IMAGE_TAGS)).toEqual([
      'invalid-image-tag',
      'invalid-image-tag',
      'invalid-image-tag',
    ]);
  });
});

describe('parser warnings are non-fatal', () => {
  it('keeps an item that ships only marked views', () => {
    expect(warningsOf(FIXTURE_ONLY_MARKED)).toContain('missing-primary-image');
    expect(parse(FIXTURE_ONLY_MARKED).images).toHaveLength(3);
  });

  it('keeps an item that ships two unmarked images', () => {
    expect(warningsOf(FIXTURE_MULTIPLE_PRIMARIES)).toContain(
      'multiple-primary-images',
    );
    expect(parse(FIXTURE_MULTIPLE_PRIMARIES).images).toHaveLength(3);
  });

  it('warns about nothing for duplicate or unknown markers', () => {
    expect(warningsOf(FIXTURE_DUPLICATE_FRONT)).toEqual([]);
    expect(warningsOf(FIXTURE_UNKNOWN_MARKER)).toEqual([]);
  });

  it('never rejects a fixture, whatever its images look like', () => {
    for (const fixture of ALL_ITEM_IMAGE_FIXTURES) {
      const result = parseGameItemDefinitionResult(fixture, { mode: 'permissive' });
      expect(result.ok, `${fixture.id} must parse`).toBe(true);
    }
  });
});

describe('primary image for compact UI', () => {
  it('prefers the unmarked image over any marked one', () => {
    expect(primaryItemImageUrl(parse(FIXTURE_PRIMARY_FRONT_BACK))).toBe(U.primary);
    expect(primaryItemImageUrl(parse(FIXTURE_FULL_TURNAROUND))).toBe(U.primary);
  });

  it('uses the first valid image when every image is marked', () => {
    // The fixture lists `side-right` FIRST, so this also proves the fallback is
    // positional and does not secretly prefer `front`.
    expect(primaryItemImageUrl(parse(FIXTURE_ONLY_MARKED))).toBe(U.sideRight);
  });

  it('uses the first of several unmarked images', () => {
    expect(primaryItemImageUrl(parse(FIXTURE_MULTIPLE_PRIMARIES))).toBe(U.primary);
  });

  it('handles the single-image case', () => {
    expect(primaryItemImageUrl(parse(FIXTURE_PRIMARY_ONLY))).toBe(U.primary);
  });

  it('returns undefined when there is no usable image', () => {
    expect(primaryItemImageUrl(parse(FIXTURE_NO_IMAGES))).toBeUndefined();
    expect(primaryItemImageUrl(undefined)).toBeUndefined();
    expect(primaryItemImageUrl(null)).toBeUndefined();
    expect(primaryItemImageUrl({})).toBeUndefined();
  });

  it('falls back to a legacy flattened `image` when there is no collection', () => {
    expect(primaryItemImageUrl({ image: U.primary })).toBe(U.primary);
    // A collection always wins over the flattened field.
    expect(
      primaryItemImageUrl({ images: [{ url: U.front, marker: 'front' }], image: U.primary }),
    ).toBe(U.front);
  });

  it('treats a blank url as no image', () => {
    expect(primaryItemImageUrl({ image: '   ' })).toBeUndefined();
  });
});

describe('pose-specific sources', () => {
  it('front prefers the front view, then the primary, then the first valid', () => {
    expect(itemImageSourcesForView(parse(FIXTURE_PRIMARY_FRONT_BACK), 'front')).toEqual([
      U.front,
      U.primary,
    ]);
    // No front view: the primary leads, and is also the first valid entry.
    expect(itemImageSourcesForView(parse(FIXTURE_BACK_ONLY), 'front')).toEqual([U.back]);
    expect(itemImageSourcesForView(parse(FIXTURE_PRIMARY_ONLY), 'front')).toEqual([
      U.primary,
    ]);
  });

  it('back prefers the back view, then the primary, then front, then first valid', () => {
    expect(itemImageSourcesForView(parse(FIXTURE_PRIMARY_FRONT_BACK), 'back')).toEqual([
      U.back,
      U.primary,
      U.front,
    ]);
    // Only a front view exists: back falls through to it rather than to nothing.
    expect(itemImageSourcesForView(parse(FIXTURE_FRONT_ONLY), 'back')).toEqual([U.front]);
  });

  it('never CHOOSES a side or diagonal view for a front or back actor', () => {
    const def = parse(FIXTURE_FULL_TURNAROUND);
    const sideAndDiagonal = [
      U.sideRight,
      U.sideLeft,
      U.diagonalFrontRight,
      U.diagonalFrontLeft,
    ];

    for (const view of ['front', 'back'] as const) {
      const sources = itemImageSourcesForView(def, view);
      for (const url of sideAndDiagonal) {
        expect(sources, `${view} must not use ${url}`).not.toContain(url);
      }
    }
  });

  it('reaches a side view ONLY as the generic last resort', () => {
    // This definition ships nothing but marked views, `side-right` first. The
    // last-resort rule exists precisely so such an item still renders.
    expect(itemImageSourcesForView(parse(FIXTURE_ONLY_MARKED), 'front')).toEqual([
      U.front,
      U.sideRight,
    ]);
    expect(itemImageSourcesForView(parse(FIXTURE_ONLY_MARKED), 'back')).toEqual([
      U.back,
      U.sideRight,
      U.front,
    ]);
  });

  it('takes the FIRST of duplicate markers, deterministically', () => {
    const def = parse(FIXTURE_DUPLICATE_FRONT);
    expect(itemImageSourcesForView(def, 'front')).toEqual([U.front, U.primary]);
    expect(itemImageSourcesForView(def, 'front')).not.toContain(U.frontAlt);
    // Both entries survive in the model even though only one is selected.
    expect(itemImagesByMarker(def, 'front').map((i) => i.url)).toEqual([
      U.front,
      U.frontAlt,
    ]);
  });

  it('de-duplicates identical URLs across the fallback steps', () => {
    // A definition whose primary IS its front view must not offer it twice.
    const def = { images: [{ url: U.front }, { url: U.front, marker: 'front' as const }] };
    expect(itemImageSourcesForView(def, 'front')).toEqual([U.front]);
  });

  it('excludes empty values and returns an empty list for no images', () => {
    expect(itemImageSourcesForView(parse(FIXTURE_NO_IMAGES), 'front')).toEqual([]);
    expect(itemImageSourcesForView(parse(FIXTURE_NO_IMAGES), 'back')).toEqual([]);
    expect(itemImageSourcesForView(undefined, 'front')).toEqual([]);
    expect(itemImageSourcesForView({ image: '' }, 'front')).toEqual([]);
  });
});

describe('side and diagonal views stay reachable for future work', () => {
  it('resolves every marker the spec defines by name', () => {
    const def = parse(FIXTURE_FULL_TURNAROUND);
    const expected: Record<string, string> = {
      front: U.front,
      back: U.back,
      'side-right': U.sideRight,
      'side-left': U.sideLeft,
      'diagonal-front-right': U.diagonalFrontRight,
      'diagonal-front-left': U.diagonalFrontLeft,
    };
    for (const marker of GAME_ITEM_IMAGE_MARKERS) {
      expect(itemImageByMarker(def, marker)?.url).toBe(expected[marker]);
    }
  });

  it('resolves an unknown marker verbatim', () => {
    expect(itemImageByMarker(parse(FIXTURE_UNKNOWN_MARKER), 'top-down')?.url).toBe(
      U.future,
    );
  });

  it('returns nothing for a marker the item does not carry', () => {
    expect(itemImageByMarker(parse(FIXTURE_PRIMARY_ONLY), 'side-left')).toBeUndefined();
    expect(itemImagesByMarker(parse(FIXTURE_PRIMARY_ONLY), 'side-left')).toEqual([]);
  });
});

describe('dedupeImageSources', () => {
  it('keeps first occurrences, drops repeats, blanks and undefined', () => {
    expect(
      dedupeImageSources(['a', undefined, 'b', 'a', '', '   ', 'c', 'b']),
    ).toEqual(['a', 'b', 'c']);
  });
});
