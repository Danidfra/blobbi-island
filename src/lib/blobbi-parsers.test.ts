/**
 * Island's kind 31124 read side is an ADAPTER over @blobbi-kit/core's canonical
 * modern parser (0.5.2). These tests pin the contract Island relies on:
 *
 * - every current Island-produced event (egg, hatched baby, adult) is modern;
 * - the modern contract is core's: `b` is required, `client` is irrelevant;
 * - historical events are identified and excluded, never migrated;
 * - `visual_generation` reaches `PetState` with the canonical semantics;
 * - the adapter maps protocol fields from the companion and Island extension
 *   tags from the event, and a republish preserves what it does not manage.
 *
 * The kind 11125 profile validator keeps Island's own (looser) ecosystem gate:
 * it is a different protocol and is not delegated.
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  validatePetStateEvent,
  validateOwnerProfileEvent,
  parsePetState,
  companionToPetState,
  mergePetStateTags,
} from './blobbi-parsers';
import { KIND_BLOBBI_STATE, KIND_BLOBBONAUT_PROFILE } from './blobbi-kinds';
import { generateEggPreview, previewToBabyTags } from './blobbi-egg-preview';
import {
  BLOBBI_ECOSYSTEM_NAMESPACE,
  classifyBlobbiEvent,
  deriveBlobbiSeedV1,
  deriveSeedIdentity,
  getCanonicalBlobbiD,
  parseModernBlobbiEvent,
} from '@blobbi-kit/core/blobbi';

const FOREIGN_ECOSYSTEM = 'pets:ecosystem:v1';
const PUBKEY = 'feb88e80a63d1111222233334444555566667777888899990000aaaabbbbcccc';
const PET_ID = '3196847fb5';
const CREATED_AT = 1_757_000_000;
const D = getCanonicalBlobbiD(PUBKEY, PET_ID);
const SEED = deriveBlobbiSeedV1(PUBKEY, D, CREATED_AT);
const TRAITS = deriveSeedIdentity(SEED);

function asEvent(kind: number, tags: string[][], content = ''): NostrEvent {
  return {
    id: 'x'.repeat(64),
    pubkey: PUBKEY,
    created_at: CREATED_AT,
    kind,
    tags,
    content,
    sig: 's'.repeat(128),
  };
}

/** Replace one tag's value, or drop the tag when `value` is undefined. */
function withTag(tags: string[][], name: string, value: string | undefined): string[][] {
  const rest = tags.filter(([n]) => n !== name);
  return value === undefined ? rest : [...rest, [name, value]];
}

/**
 * A current Blobbi Island egg, exactly as the create flow publishes it: the
 * canonical d and seed, ecosystem marker, activity state and incubating
 * progression, streak bookkeeping, the five stats, both timestamps, the
 * seed-mirrored trait tags, Island's branding and `published_at`.
 */
function islandEggTags(): string[][] {
  const now = String(CREATED_AT);
  return [
    ['d', D],
    ['b', BLOBBI_ECOSYSTEM_NAMESPACE],
    ['name', 'Brook'],
    ['stage', 'egg'],
    ['state', 'active'],
    ['progression_state', 'incubating'],
    ['seed', SEED],
    ['generation', '1'],
    ['breeding_ready', 'false'],
    ['experience', '0'],
    ['care_streak', '1'],
    ['care_streak_last_at', now],
    ['care_streak_last_day', '2025-09-04'],
    ['hunger', '80'],
    ['happiness', '90'],
    ['health', '100'],
    ['hygiene', '70'],
    ['energy', '60'],
    ['last_interaction', now],
    ['last_decay_at', now],
    ['progression_started_at', now],
    ['base_color', TRAITS.baseColor],
    ['secondary_color', TRAITS.secondaryColor],
    ['eye_color', TRAITS.eyeColor],
    ['pattern', TRAITS.pattern],
    ['special_mark', TRAITS.specialMark],
    ['size', TRAITS.size],
    ['client', 'blobbi'],
    ['published_at', now],
  ];
}

const PROFILE_BASE_TAGS: string[][] = [
  ['d', 'blobbonaut-abc'],
  ['name', 'Alice'],
];

// ─── Current Island events are modern ────────────────────────────────────────

describe('current Island-produced events pass the canonical modern contract', () => {
  it('a current egg is modern, valid and parsed with every protocol field', () => {
    const event = asEvent(KIND_BLOBBI_STATE, islandEggTags());
    expect(classifyBlobbiEvent(event)).toBe('modern');
    expect(validatePetStateEvent(event)).toBe(true);
    const pet = parsePetState(event)!;
    expect(pet.id).toBe(D);
    expect(pet.name).toBe('Brook');
    expect(pet.stage).toBe('egg');
    expect(pet.generation).toBe(1);
    expect(pet.breedingReady).toBe(false);
    expect([pet.hunger, pet.happiness, pet.health, pet.hygiene, pet.energy]).toEqual([80, 90, 100, 70, 60]);
    expect(pet.experience).toBe(0);
    expect(pet.careStreak).toBe(1);
    expect(pet.lastInteraction).toEqual(new Date(CREATED_AT * 1000));
    expect(pet.baseColor).toBe(TRAITS.baseColor);
    expect(pet.pattern).toBe(TRAITS.pattern);
    expect(pet.size).toBe(TRAITS.size);
    expect(pet.visualGeneration).toBe('v1');
    expect(pet.client).toBe('blobbi');
    expect(pet.rawTags).toBe(event.tags);
  });

  it('the hatched baby the first-egg ceremony publishes is modern', () => {
    const preview = generateEggPreview(PUBKEY, 'Egg');
    const event = asEvent(KIND_BLOBBI_STATE, previewToBabyTags({ ...preview, name: 'Puck' }));
    expect(classifyBlobbiEvent(event)).toBe('modern');
    expect(validatePetStateEvent(event)).toBe(true);
    const pet = parsePetState(event)!;
    expect(pet.stage).toBe('baby');
    expect(pet.name).toBe('Puck');
    expect(pet.id).toBe(preview.d);
    expect(pet.isSleeping).toBe(false);
  });

  it('a current adult (adult_type, V2 artwork, social open) is modern', () => {
    let tags = withTag(islandEggTags(), 'stage', 'adult');
    tags = withTag(tags, 'progression_state', 'none');
    tags = [...tags, ['adult_type', 'catti'], ['visual_generation', 'v2'], ['social', 'open']];
    const event = asEvent(KIND_BLOBBI_STATE, tags);
    expect(classifyBlobbiEvent(event)).toBe('modern');
    const pet = parsePetState(event)!;
    expect(pet.stage).toBe('adult');
    expect(pet.adultType).toBe('catti');
    expect(pet.visualGeneration).toBe('v2');
  });

  it('client branding never causes rejection (Island brands every event)', () => {
    for (const branding of [['client', 'blobbi'], ['t', 'blobbi'], ['client', 'Ditto', '31990:a:b', 'wss://r']]) {
      const event = asEvent(KIND_BLOBBI_STATE, [...withTag(islandEggTags(), 'client', undefined), branding]);
      expect(validatePetStateEvent(event)).toBe(true);
      expect(parsePetState(event)).not.toBeNull();
    }
  });
});

// ─── The modern contract is core's ───────────────────────────────────────────

describe('validatePetStateEvent is the canonical modern contract', () => {
  it('requires the ecosystem marker: a missing b is not a Blobbi state event', () => {
    // The previous Island gate accepted a missing `b` for historical events.
    // Legacy is out of scope: the contract is core's, and every current
    // producer (Island included) writes `b` on every event.
    const event = asEvent(KIND_BLOBBI_STATE, withTag(islandEggTags(), 'b', undefined));
    expect(validatePetStateEvent(event)).toBe(false);
    expect(parsePetState(event)).toBeNull();
  });

  it('accepts the canonical b and rejects a foreign one', () => {
    expect(validatePetStateEvent(asEvent(KIND_BLOBBI_STATE, islandEggTags()))).toBe(true);
    const foreign = asEvent(KIND_BLOBBI_STATE, withTag(islandEggTags(), 'b', FOREIGN_ECOSYSTEM));
    expect(validatePetStateEvent(foreign)).toBe(false);
    expect(parsePetState(foreign)).toBeNull();
  });

  it('rejects the wrong kind and malformed modern events', () => {
    expect(validatePetStateEvent(asEvent(KIND_BLOBBONAUT_PROFILE, islandEggTags()))).toBe(false);
    for (const [name, value] of [['d', undefined], ['stage', 'elder'], ['state', 'dancing'], ['last_interaction', undefined]] as const) {
      const event = asEvent(KIND_BLOBBI_STATE, withTag(islandEggTags(), name, value));
      expect(validatePetStateEvent(event), `${name}=${value}`).toBe(false);
    }
  });

  it('stats are optional in the contract and take Island defaults when absent', () => {
    // No current producer omits them; the contract does not require them.
    const event = asEvent(KIND_BLOBBI_STATE, withTag(withTag(islandEggTags(), 'hunger', undefined), 'generation', undefined));
    const pet = parsePetState(event)!;
    expect(pet.hunger).toBe(50);
    expect(pet.generation).toBe(1);
  });

  it('agrees with core on every event: valid <=> parseModernBlobbiEvent parses', () => {
    const cases = [
      islandEggTags(),
      withTag(islandEggTags(), 'b', undefined),
      withTag(islandEggTags(), 'seed', undefined),
      [...islandEggTags(), ['incubation_time', '3600']],
    ];
    for (const tags of cases) {
      const event = asEvent(KIND_BLOBBI_STATE, tags);
      expect(validatePetStateEvent(event)).toBe(parseModernBlobbiEvent(event) !== undefined);
      expect(parsePetState(event) !== null).toBe(validatePetStateEvent(event));
    }
  });
});

// ─── Legacy: identified and excluded ─────────────────────────────────────────

describe('historical events are excluded, never migrated', () => {
  it.each([
    'incubation_time', 'incubation_progress', 'egg_temperature', 'egg_status',
    'shell_integrity', 'fees', 'start_incubation', 'interact_6_progress',
  ])('a canonical-looking event carrying %s is dropped', (marker) => {
    const event = asEvent(KIND_BLOBBI_STATE, [...islandEggTags(), [marker, '1']]);
    expect(classifyBlobbiEvent(event)).toBe('legacy');
    expect(validatePetStateEvent(event)).toBe(false);
    expect(parsePetState(event)).toBeNull();
  });

  it('progression stored in state (the pre-2026-04 schema) is dropped, not reinterpreted', () => {
    const tags = withTag(withTag(islandEggTags(), 'state', 'incubating'), 'progression_state', undefined);
    expect(parsePetState(asEvent(KIND_BLOBBI_STATE, tags))).toBeNull();
  });

  it('a non-canonical d, a missing or short seed, or a missing name is dropped', () => {
    for (const tags of [
      withTag(islandEggTags(), 'd', 'blobbi-puck'),
      withTag(islandEggTags(), 'seed', undefined),
      withTag(islandEggTags(), 'seed', 'b'.repeat(63)),
      withTag(islandEggTags(), 'name', undefined),
    ]) {
      expect(classifyBlobbiEvent(asEvent(KIND_BLOBBI_STATE, tags))).toBe('legacy');
      expect(parsePetState(asEvent(KIND_BLOBBI_STATE, tags))).toBeNull();
    }
  });

  it('a PetState no longer models historical egg fields, so a writer can never author them', () => {
    const pet = parsePetState(asEvent(KIND_BLOBBI_STATE, islandEggTags()))!;
    expect('incubationTime' in pet).toBe(false);
    expect('eggTemperature' in pet).toBe(false);
    expect('fees' in pet).toBe(false);
    const names = new Set(mergePetStateTags(pet).map(([n]) => n));
    for (const legacy of ['incubation_time', 'incubation_progress', 'egg_temperature', 'egg_status', 'shell_integrity', 'fees']) {
      expect(names.has(legacy), legacy).toBe(false);
    }
  });
});

// ─── visual_generation ───────────────────────────────────────────────────────

describe('parsePetState reads visual_generation with the canonical semantics', () => {
  const pet = (extra: string[][]) => parsePetState(asEvent(KIND_BLOBBI_STATE, [...islandEggTags(), ...extra]))!;

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

// ─── The adapter and the write side ──────────────────────────────────────────

describe('companionToPetState: protocol fields from core, Island extensions from the event', () => {
  it('reads Island extension tags the shared protocol does not model', () => {
    const tags = [
      ...islandEggTags(),
      ['is_sleeping', 'true'], ['is_dirty', 'true'], ['last_meal', '1757000100'],
      ['current_location', 'town'], ['in_party', 'true'], ['visible_to_others', 'false'],
      ['mood', 'happy'], ['manifestation', 'spark'],
    ];
    const pet = companionToPetState(parseModernBlobbiEvent(asEvent(KIND_BLOBBI_STATE, tags))!);
    expect(pet.isSleeping).toBe(true);
    expect(pet.isDirty).toBe(true);
    expect(pet.lastMeal).toEqual(new Date(1_757_000_100 * 1000));
    expect(pet.currentLocation).toBe('town');
    expect(pet.inParty).toBe(true);
    expect(pet.visibleToOthers).toBe(false);
    expect(pet.mood).toBe('happy');
    expect(pet.manifestation).toBe('spark');
  });

  it('reads trait tags verbatim and falls back to the seed-derived identity when a tag is absent', () => {
    const noColour = withTag(withTag(islandEggTags(), 'base_color', undefined), 'size', undefined);
    const pet = parsePetState(asEvent(KIND_BLOBBI_STATE, noColour))!;
    expect(pet.baseColor).toBe(TRAITS.baseColor);
    expect(pet.size).toBe(TRAITS.size);
    expect(pet.secondaryColor).toBe(TRAITS.secondaryColor);
  });

  it('a republish through the adapter preserves unknown tags verbatim and never authors name or seed', () => {
    const tags = [
      ...islandEggTags(),
      ['ditto_xp', '123'], ['equip', 'hat:wizard'], ['client', 'Ditto', '31990:a:b', 'wss://r'],
    ];
    const pet = parsePetState(asEvent(KIND_BLOBBI_STATE, tags))!;
    const out = mergePetStateTags(pet, { hunger: '77' });
    const value = (n: string) => out.find(([name]) => name === n);
    expect(value('ditto_xp')).toEqual(['ditto_xp', '123']);
    expect(value('equip')).toEqual(['equip', 'hat:wizard']);
    expect(out.filter(([n]) => n === 'client')).toEqual([['client', 'blobbi'], ['client', 'Ditto', '31990:a:b', 'wss://r']]);
    expect(value('name')).toEqual(['name', 'Brook']);
    expect(value('seed')).toEqual(['seed', SEED]);
    expect(value('progression_state')).toEqual(['progression_state', 'incubating']);
    expect(value('published_at')).toEqual(['published_at', String(CREATED_AT)]);
    expect(value('hunger')?.[1]).toBe('77');
    expect(value('b')).toEqual(['b', BLOBBI_ECOSYSTEM_NAMESPACE]);
    expect(out.filter(([n]) => n === 'state')).toEqual([['state', 'active']]);
    // The republished event is itself modern.
    expect(classifyBlobbiEvent(asEvent(KIND_BLOBBI_STATE, out))).toBe('modern');
  });
});

// ─── Kind 11125 keeps Island's own gate ──────────────────────────────────────

describe('validateOwnerProfileEvent ecosystem gate (profile protocol, not delegated)', () => {
  it('accepts an event with no b tag', () => {
    expect(validateOwnerProfileEvent(asEvent(KIND_BLOBBONAUT_PROFILE, [...PROFILE_BASE_TAGS]))).toBe(true);
  });

  it('accepts an event with canonical Blobbi b', () => {
    expect(validateOwnerProfileEvent(asEvent(KIND_BLOBBONAUT_PROFILE, [['b', BLOBBI_ECOSYSTEM_NAMESPACE], ...PROFILE_BASE_TAGS]))).toBe(true);
  });

  it('rejects an event with foreign b = pets:ecosystem:v1', () => {
    expect(validateOwnerProfileEvent(asEvent(KIND_BLOBBONAUT_PROFILE, [['b', FOREIGN_ECOSYSTEM], ...PROFILE_BASE_TAGS]))).toBe(false);
  });
});
