/**
 * The catalog itself.
 *
 * The first block is the one that earns its keep: a malformed entry is
 * indistinguishable from an absent one at runtime — it simply never matches —
 * so a typo in a video id would silently mean "this film is not approved" with
 * no error anywhere. Checking the shipped list structurally turns that into a
 * failing test instead of a mystery.
 */
import { describe, expect, it } from 'vitest';

import {
  APPROVED_THEATER_MEDIA,
  approvedMediaFor,
  approvedMediaShelf,
  isApprovedMedia,
  isWellFormedApprovedMedia,
  type ApprovedMedia,
} from './catalog';

const ENTRY: ApprovedMedia = {
  id: 'blobbi:film:test-one',
  provider: 'youtube',
  providerMediaId: 'dQw4w9WgXcQ',
  title: 'A Gentle Test Film',
};

const CATALOG: readonly ApprovedMedia[] = Object.freeze([ENTRY]);

describe('the shipped catalog', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(APPROVED_THEATER_MEDIA)).toBe(true);
  });

  it('is well-formed, entry by entry', () => {
    // Passes vacuously while the list is empty, and starts doing real work the
    // moment an entry is added — which is exactly when a typo would matter.
    for (const entry of APPROVED_THEATER_MEDIA) {
      expect(isWellFormedApprovedMedia(entry), `${entry.id} is malformed`).toBe(true);
    }
  });

  it('has no duplicate catalog ids', () => {
    const ids = APPROVED_THEATER_MEDIA.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate media identities', () => {
    // Two entries for the same video would make the title non-deterministic.
    const keys = APPROVED_THEATER_MEDIA.map((e) => `${e.provider}:${e.providerMediaId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ships empty, deliberately', () => {
    // Not an oversight and not a placeholder to be quietly filled: choosing
    // videos that are appropriate for children needs someone to watch them and
    // sign off. If this ever fails, the change should have come with that
    // sign-off — see the module note.
    expect(APPROVED_THEATER_MEDIA).toHaveLength(0);
  });
});

describe('well-formedness', () => {
  it('accepts a complete entry', () => {
    expect(isWellFormedApprovedMedia(ENTRY)).toBe(true);
  });

  it.each([
    ['an empty catalog id', { ...ENTRY, id: '' }],
    ['a wrong provider', { ...ENTRY, provider: 'vimeo' as ApprovedMedia['provider'] }],
    ['a short media id', { ...ENTRY, providerMediaId: 'abc' }],
    ['a long media id', { ...ENTRY, providerMediaId: 'a'.repeat(12) }],
    ['a media id with a slash', { ...ENTRY, providerMediaId: 'abc/defghij' }],
    ['a blank title', { ...ENTRY, title: '   ' }],
  ])('rejects %s', (_label, entry) => {
    expect(isWellFormedApprovedMedia(entry as ApprovedMedia)).toBe(false);
  });
});

describe('lookup', () => {
  it('finds an approved entry by canonical identity', () => {
    expect(approvedMediaFor('youtube', 'dQw4w9WgXcQ', CATALOG)).toEqual(ENTRY);
    expect(isApprovedMedia('youtube', 'dQw4w9WgXcQ', CATALOG)).toBe(true);
  });

  it('does not find an unapproved id', () => {
    expect(approvedMediaFor('youtube', 'Nk9pQ2rT7wY', CATALOG)).toBeNull();
  });

  it('does not match across providers', () => {
    expect(approvedMediaFor('vimeo', 'dQw4w9WgXcQ', CATALOG)).toBeNull();
  });

  it('is case-sensitive, because YouTube ids are', () => {
    expect(approvedMediaFor('youtube', 'dqw4w9wgxcq', CATALOG)).toBeNull();
  });

  it('refuses empty inputs', () => {
    expect(approvedMediaFor('', 'dQw4w9WgXcQ', CATALOG)).toBeNull();
    expect(approvedMediaFor('youtube', '', CATALOG)).toBeNull();
  });

  it('ignores a malformed entry rather than matching it', () => {
    // A conflicting pair resolves deterministically: the malformed one is not a
    // candidate at all, so there is nothing to arbitrate.
    const poisoned = [{ ...ENTRY, title: '' }, ENTRY] as readonly ApprovedMedia[];
    expect(approvedMediaFor('youtube', 'dQw4w9WgXcQ', poisoned)).toEqual(ENTRY);
  });

  it('resolves duplicates to the first well-formed entry, deterministically', () => {
    const twice = [ENTRY, { ...ENTRY, id: 'other', title: 'Second' }] as readonly ApprovedMedia[];
    expect(approvedMediaFor('youtube', 'dQw4w9WgXcQ', twice)).toEqual(ENTRY);
  });
});

describe('the shelf', () => {
  it('offers well-formed entries only', () => {
    const mixed = [ENTRY, { ...ENTRY, id: 'bad', providerMediaId: 'nope' }] as readonly ApprovedMedia[];
    expect(approvedMediaShelf(mixed)).toEqual([ENTRY]);
  });

  it('is empty for an empty catalog', () => {
    expect(approvedMediaShelf([])).toEqual([]);
    expect(approvedMediaShelf()).toEqual([]);
  });
});
