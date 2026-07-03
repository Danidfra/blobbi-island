/**
 * Writer-alignment tests: ensure Island's tag builders emit the canonical
 * tags required by @blobbi/core validation, without duplicating or overwriting
 * existing values, and without disturbing equip / inv passthrough.
 *
 * These tests exercise the WRITE path only. The Island parser (parsePetState /
 * parseOwnerProfile) is unchanged and still used for reads. Core validators are
 * used here only as an oracle, not wired into runtime.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { mergePetStateTags, mergeOwnerProfileTags, parsePetState, parseOwnerProfile } from './blobbi-parsers';
import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from './blobbi-kinds';
import {
  BLOBBI_ECOSYSTEM_NAMESPACE,
  isValidBlobbiEvent,
  isValidBlobbonautEvent,
} from '@blobbi/core/blobbi';

// ─── Helpers ────────────────────────────────────────────────────────────────

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

function tagCount(tags: string[][], name: string): number {
  return tags.filter(([n]) => n === name).length;
}

/** Build a minimal-but-complete raw Kind 31124 event and parse it to PetState. */
function makePet(rawTags: string[][], content = 'Puck') {
  const baseTags: string[][] = [
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
  const event: NostrEvent = {
    id: 'x',
    pubkey: 'p'.repeat(64),
    created_at: 1_700_000_000,
    kind: KIND_BLOBBI_STATE,
    tags: [...baseTags, ...rawTags],
    content,
    sig: 's',
  };
  const pet = parsePetState(event);
  if (!pet) throw new Error('fixture failed to parse');
  return pet;
}

/** Build a raw Kind 11125 event and parse it to OwnerProfile. */
function makeProfile(rawTags: string[][], content = '') {
  const baseTags: string[][] = [
    ['d', 'profile'],
    ['name', 'Alice'],
  ];
  const event: NostrEvent = {
    id: 'x',
    pubkey: 'p'.repeat(64),
    created_at: 1_700_000_000,
    kind: KIND_BLOBBONAUT_PROFILE,
    tags: [...baseTags, ...rawTags],
    content,
    sig: 's',
  };
  const profile = parseOwnerProfile(event);
  if (!profile) throw new Error('fixture failed to parse');
  return profile;
}

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

// ─── Kind 31124: mergePetStateTags ────────────────────────────────────────────

describe('mergePetStateTags — canonical alignment', () => {
  it('emits canonical b, state, and last_interaction when the source lacks them', () => {
    const pet = makePet([]); // no b / state / last_interaction in source
    const tags = mergePetStateTags(pet);

    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
    // No isSleeping / no source state -> defaults to 'active'
    expect(tagValue(tags, 'state')).toBe('active');
    expect(tagValue(tags, 'last_interaction')).toBeTruthy();
  });

  it('derives state=sleeping from Island isSleeping when no source state exists', () => {
    const pet = makePet([['is_sleeping', 'true']]);
    const tags = mergePetStateTags(pet);
    expect(tagValue(tags, 'state')).toBe('sleeping');
  });

  it('preserves an existing state tag over the isSleeping derivation', () => {
    // Source says hibernating; isSleeping would otherwise derive 'sleeping'.
    const pet = makePet([
      ['state', 'hibernating'],
      ['is_sleeping', 'true'],
    ]);
    const tags = mergePetStateTags(pet);
    expect(tagValue(tags, 'state')).toBe('hibernating');
    expect(tagCount(tags, 'state')).toBe(1);
  });

  it('does not duplicate or overwrite an existing b tag', () => {
    const pet = makePet([['b', BLOBBI_ECOSYSTEM_NAMESPACE]]);
    const tags = mergePetStateTags(pet);
    expect(tagCount(tags, 'b')).toBe(1);
    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
  });

  it('preserves an existing last_interaction value', () => {
    const pet = makePet([['last_interaction', '1699999999']]);
    const tags = mergePetStateTags(pet);
    expect(tagValue(tags, 'last_interaction')).toBe('1699999999');
    expect(tagCount(tags, 'last_interaction')).toBe(1);
  });

  it('preserves unknown Ditto tags (seed, progression_state, room)', () => {
    const pet = makePet([
      ['seed', 'a'.repeat(64)],
      ['progression_state', 'none'],
    ]);
    const tags = mergePetStateTags(pet);
    expect(tagValue(tags, 'seed')).toBe('a'.repeat(64));
    expect(tagValue(tags, 'progression_state')).toBe('none');
  });

  it('does not standardize or mutate equip (equip is caller-managed, not touched by merge)', () => {
    // equip is intentionally excluded from mergePetStateTags output: callers
    // (feed/play/accessory paths) append equip tags themselves after merging.
    // This test pins that contract so the alignment change never starts
    // rewriting equip. The merge must not emit or mutate any equip tag.
    const equipTag = ['equip', 'hat_01', '10', '20', '1.0'];
    const pet = makePet([equipTag]);
    const tags = mergePetStateTags(pet);
    expect(tagCount(tags, 'equip')).toBe(0);
    // The canonical alignment additions must not have altered the passthrough
    // of other unknown tags either.
    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
  });

  it('resulting event passes @blobbi/core isValidBlobbiEvent', () => {
    const pet = makePet([['seed', 'a'.repeat(64)]]);
    const tags = mergePetStateTags(pet);
    expect(isValidBlobbiEvent(asEvent(KIND_BLOBBI_STATE, tags))).toBe(true);
  });

  it('is idempotent for an already-canonical source event', () => {
    const canonical: string[][] = [
      ['b', BLOBBI_ECOSYSTEM_NAMESPACE],
      ['state', 'active'],
      ['last_interaction', '1699999999'],
    ];
    const pet = makePet(canonical);
    const tags = mergePetStateTags(pet);
    expect(tagCount(tags, 'b')).toBe(1);
    expect(tagCount(tags, 'state')).toBe(1);
    expect(tagCount(tags, 'last_interaction')).toBe(1);
    expect(tagValue(tags, 'state')).toBe('active');
    expect(tagValue(tags, 'last_interaction')).toBe('1699999999');
  });
});

// ─── Kind 11125: mergeOwnerProfileTags ─────────────────────────────────────────

describe('mergeOwnerProfileTags — canonical alignment', () => {
  it('emits canonical b when the source lacks it', () => {
    const profile = makeProfile([]);
    const tags = mergeOwnerProfileTags(profile);
    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
    expect(tagCount(tags, 'b')).toBe(1);
  });

  it('does not duplicate or overwrite an existing b tag', () => {
    const profile = makeProfile([['b', BLOBBI_ECOSYSTEM_NAMESPACE]]);
    const tags = mergeOwnerProfileTags(profile);
    expect(tagCount(tags, 'b')).toBe(1);
    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
  });

  it('does not standardize or mutate inv (inv is caller-managed, not touched by merge)', () => {
    // inv is intentionally excluded from mergeOwnerProfileTags output: the
    // accessory system manages inv via updateInvTags. This test pins that
    // contract so the alignment change never starts rewriting inv.
    const invTag = ['inv', 'hat_01', '3'];
    const profile = makeProfile([invTag]);
    const tags = mergeOwnerProfileTags(profile);
    expect(tagCount(tags, 'inv')).toBe(0);
    expect(tagValue(tags, 'b')).toBe(BLOBBI_ECOSYSTEM_NAMESPACE);
  });

  it('preserves unknown Ditto tags (xp, level, room, blobbi_onboarding_done)', () => {
    const profile = makeProfile([
      ['xp', '120'],
      ['level', '3'],
      ['room', 'bedroom'],
      ['blobbi_onboarding_done', 'true'],
    ]);
    const tags = mergeOwnerProfileTags(profile);
    expect(tagValue(tags, 'xp')).toBe('120');
    expect(tagValue(tags, 'level')).toBe('3');
    expect(tagValue(tags, 'room')).toBe('bedroom');
    expect(tagValue(tags, 'blobbi_onboarding_done')).toBe('true');
  });

  it('resulting event passes @blobbi/core isValidBlobbonautEvent', () => {
    const profile = makeProfile([]);
    const tags = mergeOwnerProfileTags(profile);
    expect(isValidBlobbonautEvent(asEvent(KIND_BLOBBONAUT_PROFILE, tags))).toBe(true);
  });
});
