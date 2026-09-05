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

import { validatePetStateEvent, validateOwnerProfileEvent, parsePetState, mergePetStateTags } from './blobbi-parsers';
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

describe('parsePetState reads visual_generation with the canonical semantics', () => {
  const pet = (extra: string[][]) => parsePetState(asEvent(KIND_BLOBBI_STATE, [...PET_BASE_TAGS, ...extra]))!;

  it('a missing tag is V1 (every pre-existing Blobbi)', () => {
    expect(pet([]).visualGeneration).toBe('v1');
  });

  it('an explicit v1 is V1', () => {
    expect(pet([['visual_generation', 'v1']]).visualGeneration).toBe('v1');
  });

  it('an explicit v2 is V2', () => {
    expect(pet([['visual_generation', 'v2']]).visualGeneration).toBe('v2');
  });

  it('an unknown value is V1, never a crash and never a guess', () => {
    expect(pet([['visual_generation', 'future']]).visualGeneration).toBe('v1');
    expect(pet([['visual_generation', 'V2']]).visualGeneration).toBe('v1');
    expect(pet([['visual_generation', '']]).visualGeneration).toBe('v1');
  });

  it('a republish carries the tag through verbatim: Island never authors or drops it', () => {
    const source = pet([['visual_generation', 'v2']]);
    const tags = mergePetStateTags(source, { hunger: '77' });
    expect(tags.filter(([n]) => n === 'visual_generation')).toEqual([['visual_generation', 'v2']]);
    expect(tags.find(([n]) => n === 'hunger')?.[1]).toBe('77');
    // And a V1 Blobbi (no tag) gains no tag on republish.
    expect(mergePetStateTags(pet([])).some(([n]) => n === 'visual_generation')).toBe(false);
  });
});
