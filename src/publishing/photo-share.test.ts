/**
 * The pure half: who may share, and exactly what gets published.
 *
 * The event assertions are here to pin the shape rather than to describe it,
 * this phase changed permission, not social posting, and a test that fails if
 * the tags move is the thing that makes "unchanged" checkable.
 */
import { describe, expect, it } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';

import { buildPhotoShareEvent, permitPhotoShare } from './photo-share';

const IMAGE = 'https://blossom.primal.net/abc123.png';

const policy = (overrides: Partial<IslandSafetyPolicy>): IslandSafetyPolicy =>
  ({ ...STANDARD_POLICY, ...overrides }) as IslandSafetyPolicy;

describe('permission', () => {
  it('allows a share under Standard', () => {
    expect(permitPhotoShare(STANDARD_POLICY)).toEqual({ allowed: true });
  });

  it('refuses under Family', () => {
    expect(permitPhotoShare(FAMILY_POLICY).allowed).toBe(false);
  });

  it('needs both capabilities, because the operation is both', () => {
    // A share is an upload followed by a note. Either one missing means the
    // whole thing cannot complete, and finding that out halfway would leave a
    // permanent public upload behind.
    expect(permitPhotoShare(policy({ mediaUploads: false }))).toEqual({
      allowed: false,
      reason: 'media-uploads-not-permitted',
    });
    expect(permitPhotoShare(policy({ publicNotePublishing: false }))).toEqual({
      allowed: false,
      reason: 'public-notes-not-permitted',
    });
  });

  it('reports the upload refusal first when both are missing', () => {
    // The step that would have happened first, and the irreversible one.
    expect(permitPhotoShare(policy({ mediaUploads: false, publicNotePublishing: false }))).toEqual({
      allowed: false,
      reason: 'media-uploads-not-permitted',
    });
  });

  it('reads capabilities, never the profile name', () => {
    const mislabelled = policy({ profile: 'family' } as Partial<IslandSafetyPolicy>);
    expect(permitPhotoShare(mislabelled).allowed).toBe(true);
  });

  it('returns frozen results, so a caller cannot flip a refusal into consent', () => {
    const refused = permitPhotoShare(FAMILY_POLICY);
    expect(Object.isFrozen(refused)).toBe(true);
    expect(() => {
      (refused as { allowed: boolean }).allowed = true;
    }).toThrow();
  });
});

describe('the published event is unchanged', () => {
  it('is a kind 1 note with the island hashtags', () => {
    const event = buildPhotoShareEvent({ caption: '', imageUrl: IMAGE });
    expect(event.kind).toBe(1);
    expect(event.tags).toContainEqual(['t', 'Blobbi']);
    expect(event.tags).toContainEqual(['t', 'BlobbiIsland']);
  });

  it('carries a NIP-92 imeta tag with a url and NIP-94 fields', () => {
    // NIP-92: each imeta MUST have a `url` and at least one other field, drawn
    // from NIP-94. `m`, `summary` and `alt` are all NIP-94 fields.
    const event = buildPhotoShareEvent({ caption: '', imageUrl: IMAGE });
    const imeta = event.tags.find(([name]) => name === 'imeta');

    expect(imeta?.[1]).toBe(`url ${IMAGE}`);
    expect(imeta?.length).toBeGreaterThan(2);
    expect(imeta).toContain('m image/png');
    expect(imeta?.some((entry) => entry.startsWith('alt '))).toBe(true);
  });

  it('puts the image URL in the content, which is what imeta must match', () => {
    const event = buildPhotoShareEvent({ caption: '', imageUrl: IMAGE });
    expect(event.content).toContain(IMAGE);
  });

  it('includes the caption when there is one', () => {
    const event = buildPhotoShareEvent({ caption: 'my blobbi!', imageUrl: IMAGE });
    expect(event.content).toBe(`my blobbi!\n\n#Blobbi #BlobbiIsland\n\n${IMAGE}`);
  });

  it('omits the caption block when there is not', () => {
    const event = buildPhotoShareEvent({ caption: '   ', imageUrl: IMAGE });
    expect(event.content).toBe(`#Blobbi #BlobbiIsland\n\n${IMAGE}`);
  });

  it('introduces no new kind and no custom tag', () => {
    // This phase is permission, not protocol. Everything here is kind 1
    // (NIP-10), `t` hashtags, and NIP-92 `imeta`.
    const event = buildPhotoShareEvent({ caption: 'x', imageUrl: IMAGE });
    const tagNames = new Set(event.tags.map(([name]) => name));
    expect(event.kind).toBe(1);
    expect([...tagNames].sort()).toEqual(['imeta', 't']);
  });
});
