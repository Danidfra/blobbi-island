/**
 * Ecosystem-gate validator tests.
 *
 * These exercise the READ-side validators only. The rule is backward-compatible:
 * - missing `b` tag                → accepted (legacy Blobbi events)
 * - `b === BLOBBI_ECOSYSTEM_NAMESPACE` → accepted
 * - `b` present but foreign        → rejected (e.g. `pets:ecosystem:v1`)
 *
 * parsePetState / parseOwnerProfile output shapes are unchanged; only validation
 * gating is affected.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { validatePetStateEvent, validateOwnerProfileEvent } from './blobbi-parsers';
import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from './blobbi-kinds';
import { BLOBBI_ECOSYSTEM_NAMESPACE } from '@blobbi-kit/core/blobbi';

const FOREIGN_ECOSYSTEM = 'pets:ecosystem:v1';

function asEvent(kind: number, tags: string[][], content = ''): NostrEvent {
  return {
    id: 'x',
    pubkey: 'p'.repeat(64),
    created_at: 1_700_000_000,
    kind,
    tags,
    content,
    sig: 's',
  };
}

/** Required non-`b` tags for a valid kind 31124 pet state event. */
const PET_BASE_TAGS: string[][] = [
  ['d', 'blobbi-puck'],
  ['stage', 'baby'],
  ['breeding_ready', 'false'],
  ['generation', '1'],
  ['hunger', '50'],
  ['happiness', '50'],
  ['health', '50'],
  ['hygiene', '50'],
  ['energy', '50'],
  ['experience', '0'],
  ['care_streak', '0'],
];

/** Required non-`b` tags for a valid kind 11125 owner profile event. */
const PROFILE_BASE_TAGS: string[][] = [
  ['d', 'blobbonaut-abc'],
  ['name', 'Alice'],
];

describe('validatePetStateEvent ecosystem gate', () => {
  it('accepts an event with no b tag (legacy backward compatibility)', () => {
    const event = asEvent(KIND_BLOBBI_STATE, [...PET_BASE_TAGS]);
    expect(validatePetStateEvent(event)).toBe(true);
  });

  it('accepts an event with canonical Blobbi b', () => {
    const event = asEvent(KIND_BLOBBI_STATE, [
      ['b', BLOBBI_ECOSYSTEM_NAMESPACE],
      ...PET_BASE_TAGS,
    ]);
    expect(validatePetStateEvent(event)).toBe(true);
  });

  it('rejects an event with foreign b = pets:ecosystem:v1', () => {
    const event = asEvent(KIND_BLOBBI_STATE, [
      ['b', FOREIGN_ECOSYSTEM],
      ...PET_BASE_TAGS,
    ]);
    expect(validatePetStateEvent(event)).toBe(false);
  });
});

describe('validateOwnerProfileEvent ecosystem gate', () => {
  it('accepts an event with no b tag (legacy backward compatibility)', () => {
    const event = asEvent(KIND_BLOBBONAUT_PROFILE, [...PROFILE_BASE_TAGS]);
    expect(validateOwnerProfileEvent(event)).toBe(true);
  });

  it('accepts an event with canonical Blobbi b', () => {
    const event = asEvent(KIND_BLOBBONAUT_PROFILE, [
      ['b', BLOBBI_ECOSYSTEM_NAMESPACE],
      ...PROFILE_BASE_TAGS,
    ]);
    expect(validateOwnerProfileEvent(event)).toBe(true);
  });

  it('rejects an event with foreign b = pets:ecosystem:v1', () => {
    const event = asEvent(KIND_BLOBBONAUT_PROFILE, [
      ['b', FOREIGN_ECOSYSTEM],
      ...PROFILE_BASE_TAGS,
    ]);
    expect(validateOwnerProfileEvent(event)).toBe(false);
  });
});
