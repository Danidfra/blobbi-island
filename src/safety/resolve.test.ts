/**
 * Resolution, and the guarantee that production is Standard.
 *
 * The second half is the one that makes this phase safe to merge: if
 * `ACTIVE_EXPERIENCE_PROFILE` is anything but `'standard'`, or if it can be
 * influenced by storage, an environment variable or a URL, then adding the
 * policy foundation could change what a shipped player sees. These tests are
 * how that stays false.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPERIENCE_PROFILES, isExperienceProfile } from './experience-profile';
import { FAMILY_POLICY, STANDARD_POLICY } from './policies';
import { ACTIVE_EXPERIENCE_PROFILE, resolveSafetyPolicy } from './resolve';

describe('resolveSafetyPolicy', () => {
  it('maps each profile to its policy', () => {
    expect(resolveSafetyPolicy('standard')).toBe(STANDARD_POLICY);
    expect(resolveSafetyPolicy('family')).toBe(FAMILY_POLICY);
  });

  it('returns the shared singleton, not a copy', () => {
    // Identity matters: a copy would be a second object a consumer could hold
    // while the "real" policy changed, and it would defeat the frozen guarantee.
    expect(resolveSafetyPolicy('family')).toBe(resolveSafetyPolicy('family'));
  });

  it.each([
    ['an unknown string', 'kids'],
    ['a near-miss of a real profile', 'Family'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['an object shaped like a policy', { profile: 'family' }],
  ])('throws rather than guessing for %s', (_label, value) => {
    // The failure mode being prevented: an unreadable profile quietly resolving
    // to the permissive policy, or to a half-restricted merge of the two.
    expect(() => resolveSafetyPolicy(value as never)).toThrow(/Unknown ExperienceProfile/);
  });

  it('never produces a mix of two policies', () => {
    for (const profile of EXPERIENCE_PROFILES) {
      const policy = resolveSafetyPolicy(profile);
      const expected = profile === 'standard' ? STANDARD_POLICY : FAMILY_POLICY;
      expect(policy).toEqual(expected);
    }
  });
});

describe('isExperienceProfile', () => {
  it('accepts exactly the known profiles', () => {
    for (const profile of EXPERIENCE_PROFILES) expect(isExperienceProfile(profile)).toBe(true);
  });

  it.each([['kids'], ['Family'], ['STANDARD'], [''], [null], [undefined], [0], [{}], [['family']]])(
    'rejects %s',
    (value) => {
      expect(isExperienceProfile(value)).toBe(false);
    },
  );
});

describe('this build runs Standard, deterministically', () => {
  it('has Standard as the active profile', () => {
    expect(ACTIVE_EXPERIENCE_PROFILE).toBe('standard');
    expect(resolveSafetyPolicy(ACTIVE_EXPERIENCE_PROFILE)).toBe(STANDARD_POLICY);
  });

  it('derives the active profile from nothing a player or an operator can reach', () => {
    // A literal, and provably so: no env, no storage, no URL, no build flag.
    const source = readFileSync(join(process.cwd(), 'src/safety/resolve.ts'), 'utf8');
    for (const forbidden of [
      'import.meta.env',
      'process.env',
      'localStorage',
      'sessionStorage',
      'location.search',
      'URLSearchParams',
      'VITE_',
    ]) {
      expect(
        source.includes(forbidden),
        `the active profile must not be derived from ${forbidden}`,
      ).toBe(false);
    }
  });
});
