/**
 * Media admission — the pure decision every theater path consults.
 *
 * The production catalog is empty, so the interesting cases all supply fixtures.
 * That is deliberate: what is being pinned is the RULE, and a rule tested only
 * against the shipped list would stop meaning anything the day the list changes.
 */
import { describe, expect, it } from 'vitest';

import { FAMILY_POLICY, STANDARD_POLICY, type IslandSafetyPolicy } from '@/safety';

import {
  admitTheaterMedia,
  allowsOpenMediaEntry,
  allowsTheaterFullscreen,
  theaterMediaTitle,
} from './admission';
import { APPROVED_THEATER_MEDIA, type ApprovedMedia } from './catalog';

const APPROVED_ID = 'dQw4w9WgXcQ';
const OTHER_ID = 'Nk9pQ2rT7wY';

const CATALOG: readonly ApprovedMedia[] = Object.freeze([
  {
    id: 'blobbi:film:test-one',
    provider: 'youtube',
    providerMediaId: APPROVED_ID,
    title: 'A Gentle Test Film',
  },
]);

const media = (id: string) => ({ provider: 'youtube', id });

const policy = (overrides: Partial<IslandSafetyPolicy>): IslandSafetyPolicy =>
  ({ ...STANDARD_POLICY, ...overrides }) as IslandSafetyPolicy;

describe('open entry', () => {
  it('admits any supported media', () => {
    expect(admitTheaterMedia(STANDARD_POLICY, media(OTHER_ID), CATALOG)).toEqual({
      admitted: true,
      approved: null,
    });
  });

  it('still reports the catalog entry when one exists', () => {
    // So a curated title is used wherever there is one, in every experience.
    const admission = admitTheaterMedia(STANDARD_POLICY, media(APPROVED_ID), CATALOG);
    expect(admission.admitted && admission.approved?.title).toBe('A Gentle Test Film');
  });

  it('is unaffected by an empty catalog', () => {
    // Standard must not depend on the catalog being populated.
    expect(admitTheaterMedia(STANDARD_POLICY, media(OTHER_ID), []).admitted).toBe(true);
    expect(admitTheaterMedia(STANDARD_POLICY, media(OTHER_ID), APPROVED_THEATER_MEDIA).admitted).toBe(
      true,
    );
  });
});

describe('curated entry', () => {
  it('admits approved media', () => {
    expect(admitTheaterMedia(FAMILY_POLICY, media(APPROVED_ID), CATALOG)).toEqual({
      admitted: true,
      approved: CATALOG[0],
    });
  });

  it('refuses media that is not approved', () => {
    expect(admitTheaterMedia(FAMILY_POLICY, media(OTHER_ID), CATALOG)).toEqual({
      admitted: false,
      reason: 'not-approved',
    });
  });

  it('fails closed on an empty catalog rather than open', () => {
    // The failure mode that matters: "nothing is approved" must never be read as
    // "everything is allowed". The shipped catalog is empty today, so this is
    // the live behaviour and not a hypothetical.
    expect(admitTheaterMedia(FAMILY_POLICY, media(APPROVED_ID), []).admitted).toBe(false);
    expect(
      admitTheaterMedia(FAMILY_POLICY, media(APPROVED_ID), APPROVED_THEATER_MEDIA).admitted,
    ).toBe(false);
  });

  it('matches on identity, never on a title', () => {
    // A hostile session carries `{provider, id}` and no words. Even if it
    // carried a title, admission never looks at one.
    const decoy = [{ ...CATALOG[0], providerMediaId: OTHER_ID }] as readonly ApprovedMedia[];
    expect(admitTheaterMedia(FAMILY_POLICY, media(APPROVED_ID), decoy).admitted).toBe(false);
    expect(admitTheaterMedia(FAMILY_POLICY, media(OTHER_ID), decoy).admitted).toBe(true);
  });
});

describe('structural support comes first', () => {
  it.each([
    ['a malformed id', { provider: 'youtube', id: 'too-short' }],
    ['an empty id', { provider: 'youtube', id: '' }],
    ['an id with a slash', { provider: 'youtube', id: 'abc/defghij' }],
    ['a wrong provider', { provider: 'vimeo', id: APPROVED_ID }],
    ['no provider', { provider: '', id: APPROVED_ID }],
  ])('refuses %s in every experience', (_label, ref) => {
    for (const p of [STANDARD_POLICY, FAMILY_POLICY]) {
      expect(admitTheaterMedia(p, ref, CATALOG)).toEqual({
        admitted: false,
        reason: 'unsupported-media',
      });
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s without throwing', (_label, ref) => {
    expect(() => admitTheaterMedia(FAMILY_POLICY, ref, CATALOG)).not.toThrow();
    expect(admitTheaterMedia(FAMILY_POLICY, ref, CATALOG).admitted).toBe(false);
  });

  it('says "unsupported" rather than "not approved" for something that is not media', () => {
    // The reasons are different problems and produce different copy.
    const admission = admitTheaterMedia(FAMILY_POLICY, { provider: 'vimeo', id: 'x' }, CATALOG);
    expect(admission.admitted === false && admission.reason).toBe('unsupported-media');
  });
});

describe('capabilities, never a profile', () => {
  it('follows openMediaEntry wherever it is set', () => {
    const curatedStandard = policy({ openMediaEntry: false });
    expect(admitTheaterMedia(curatedStandard, media(OTHER_ID), CATALOG).admitted).toBe(false);

    const openFamily = { ...FAMILY_POLICY, openMediaEntry: true } as IslandSafetyPolicy;
    expect(admitTheaterMedia(openFamily, media(OTHER_ID), CATALOG).admitted).toBe(true);
  });

  it('ignores the profile name', () => {
    // A policy labelled 'family' whose capability is open behaves as open.
    const mislabelled = policy({ profile: 'family' } as Partial<IslandSafetyPolicy>);
    expect(admitTheaterMedia(mislabelled, media(OTHER_ID), CATALOG).admitted).toBe(true);
  });

  it('exposes the positive reading of the capability', () => {
    expect(allowsOpenMediaEntry(STANDARD_POLICY)).toBe(true);
    expect(allowsOpenMediaEntry(FAMILY_POLICY)).toBe(false);
  });
});

describe('fullscreen', () => {
  it('follows the same capability, derived in one place', () => {
    // No `theaterFullscreen` field was added: it has exactly one call site (the
    // iframe's permissions) and always moves with curation. See the function's
    // own note for when that should become a capability instead.
    expect(allowsTheaterFullscreen(STANDARD_POLICY)).toBe(true);
    expect(allowsTheaterFullscreen(FAMILY_POLICY)).toBe(false);
  });
});

describe('titles', () => {
  it('uses the catalog title for approved media', () => {
    expect(theaterMediaTitle(FAMILY_POLICY, media(APPROVED_ID), CATALOG)).toBe('A Gentle Test Film');
  });

  it('has no title for media the catalog does not know', () => {
    // A curated client has no trustworthy source for a name it did not write.
    expect(theaterMediaTitle(STANDARD_POLICY, media(OTHER_ID), CATALOG)).toBeNull();
  });

  it('has no title for refused media', () => {
    expect(theaterMediaTitle(FAMILY_POLICY, media(OTHER_ID), CATALOG)).toBeNull();
  });
});

describe('decisions are frozen', () => {
  it('cannot be flipped by a caller', () => {
    const refused = admitTheaterMedia(FAMILY_POLICY, media(OTHER_ID), CATALOG);
    expect(Object.isFrozen(refused)).toBe(true);
    expect(() => {
      (refused as { admitted: boolean }).admitted = true;
    }).toThrow();
  });
});
