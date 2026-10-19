/**
 * V3 (procedural) Blobbis in Island: parsed by core, drawn by the kit, and
 * their identity PRESERVED by every kind 31124 Island writes.
 *
 * The contract (blobbi-kit 0.9.0): a V3 Blobbi IS its address. Core derives
 * its seed from (author pubkey, d), Algorithm 1 derives everything it looks
 * like from that seed, and its event states none of it: no seed, colour,
 * trait, algorithm, size or adult form. Island creates V3 Blobbis now, and it
 * receives, draws and republishes them with a tag list it rebuilds itself
 * (`mergePetStateTags`), which is exactly where an older client could write
 * a tag that tried to restate who the Blobbi is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  BLOBBI_V3_ABSENT_TAG_NAMES,
  KIND_BLOBBI_STATE,
  VISUAL_ALGORITHM_TAG,
  VISUAL_GENERATION_TAG,
  buildEggTags,
  canonicalBlobbiV3Seed,
  deriveBlobbiV3Seed,
  getCanonicalBlobbiD,
  updateBlobbiTags,
} from '@blobbi-kit/core';
import { createBlobbiV3Identity, normalizeBlobbiV3Visual, renderBlobbiSvg, type BlobbiVisual } from '@blobbi-kit/renderer';
import { mergePetStateTags, parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';
import { petStateToLegacyBlobbi, type Blobbi } from '@/hooks/useBlobbis';
import { v3VisualFromEvent } from '@/lib/blobbi-v3-visual';
import { resolveBodyFacing } from '@/lib/blobbi-facing';
import { planCareEffect } from '@/inventory/care-effect';
import { BLOBBI_VISUAL_GENERATION_STORAGE_KEY } from '@/lib/blobbi-visual-dev';
import { DEV_V3_IDENTITY, devV3Visual } from '@/lib/dev-v3-fixture';

const PUBKEY = 'c'.repeat(64);
const PET_ID = '0123456789';
const D = getCanonicalBlobbiD(PUBKEY, PET_ID);
const CREATED_AT = 1_700_000_000;
/** The Blobbi's seed: its address, hashed by the kit. No tag states it. */
const SEED = deriveBlobbiV3Seed(PUBKEY, D);
/** Who it is: Algorithm 1's identity for its address. */
const OWN = createBlobbiV3Identity(SEED);
const V3 = { seed: SEED, algorithm: 1 };

/** Every intrinsic tag a replacement event might try to state, each with a value this Blobbi does not have. */
const FORGERIES: string[][] = [
  ['seed', 'f'.repeat(64)],
  [VISUAL_ALGORITHM_TAG, '2'],
  ['base_color', '#000000'],
  ['secondary_color', '#ffffff'],
  ['eye_color', '#ff0000'],
  ['accent_color', '#00ff00'],
  ['antenna', OWN.traits.antenna === 'double' ? 'none' : 'double'],
  ['horns', OWN.traits.horns === 'side' ? 'none' : 'side'],
  ['ears', OWN.traits.ears === 'pointed' ? 'none' : 'pointed'],
  ['tail', OWN.traits.tail === 'leaf' ? 'none' : 'leaf'],
  ['pattern', OWN.traits.pattern === 'striped' ? 'solid' : 'striped'],
  ['special_mark', OWN.traits.specialMark === 'moon' ? 'none' : 'moon'],
  ['belly', String(!OWN.traits.belly)],
  ['freckles', String(!OWN.traits.freckles)],
  ['size', 'large'],
  ['adult_type', 'bloomi'],
];

const tagValue = (tags: readonly (readonly string[])[], name: string) => tags.find((t) => t[0] === name)?.[1];
const eventWith = (tags: string[][], at = CREATED_AT, pubkey = PUBKEY): NostrEvent => ({ id: 'e'.repeat(64), pubkey, created_at: at, kind: KIND_BLOBBI_STATE, tags, content: '', sig: 'f'.repeat(128) });
/** What a relay and a reload do to an event: nothing survives but its JSON. */
const reload = (event: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(event));

/**
 * The V3 adult as ANOTHER client would have published it: born by the kit's
 * creation pipeline, grown to an adult through the kit's own republish, plus
 * the Island extension tags a lived-in Blobbi has.
 */
function adult(extra: string[][] = []): NostrEvent {
  const born = buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Umber', { visualGeneration: 'v3' });
  const grown = updateBlobbiTags(born, { stage: 'adult', progression_state: 'none', generation: '3', hunger: '70', last_interaction: String(CREATED_AT + 100) });
  return eventWith([...grown, ['is_sleeping', 'false'], ['last_meal', String(CREATED_AT)], ['custom_host_tag', 'keep-me'], ...extra], CREATED_AT + 100);
}

const parsed = (event: NostrEvent) => {
  expect(validatePetStateEvent(event)).toBe(true);
  const pet = parsePetState(event);
  if (!pet) throw new Error('must parse');
  return pet;
};

/** Everything that must still be true of an event at this address. */
function expectSameBlobbi(tags: string[][], label: string) {
  expect(tagValue(tags, 'd'), label).toBe(D);
  expect(tags.filter((t) => t[0] === VISUAL_GENERATION_TAG), label).toEqual([[VISUAL_GENERATION_TAG, 'v3']]);
  for (const name of BLOBBI_V3_ABSENT_TAG_NAMES) expect(tagValue(tags, name), `${label} ${name}`).toBeUndefined();
  // The genealogical generation is not the visual one, and is untouched.
  expect(tagValue(tags, 'generation'), label).toBe('3');
  const pet = parsed(eventWith(tags, CREATED_AT + 200));
  expect(pet.visualGeneration, label).toBe('v3');
  expect(pet.v3, label).toEqual(V3);
  expect(normalizeBlobbiV3Visual(pet.v3), label).toEqual(OWN);
  expect(pet.generation, label).toBe(3);
  expect(pet.baseColor, label).toBeUndefined();
  expect(pet.size, label).toBeUndefined();
  expect(pet.adultType, label).toBeUndefined();
}

describe('Island parses a canonical V3 identity', () => {
  it('through parsePetState: the address seed under Algorithm 1, and nothing a V3 Blobbi does not have', () => {
    const pet = parsed(adult());
    expect(pet.visualGeneration).toBe('v3');
    expect(pet.v3).toEqual(V3);
    expect(canonicalBlobbiV3Seed(pet.v3?.seed)).toBe(SEED);
    // Island carries no colour for a V3 Blobbi: the renderer resolves them from the seed.
    expect(pet.baseColor).toBeUndefined();
    expect(pet.pattern).toBeUndefined();
    expect(pet.specialMark).toBeUndefined();
    expect(pet.size).toBeUndefined();
    expect(pet.adultType).toBeUndefined();
    // Island extensions still read.
    expect(pet.lastMeal?.getTime()).toBe(CREATED_AT * 1000);
    // And the collection object every surface uses carries it on.
    const blobbi = petStateToLegacyBlobbi(pet);
    expect(blobbi.v3).toEqual(V3);
    expect(blobbi.visualGeneration).toBe('v3');
    expect(blobbi.adultType).toBeUndefined();
    expect(blobbi.size).toBeUndefined();
  });

  it('the same event under another author is another Blobbi; the same address at another time is the same one', () => {
    const other = parsed(eventWith(adult().tags, CREATED_AT + 100, 'd'.repeat(64)));
    expect(other.v3?.seed).toBe(deriveBlobbiV3Seed('d'.repeat(64), D));
    expect(other.v3?.seed).not.toBe(SEED);
    expect(parsed(eventWith(adult().tags, CREATED_AT + 999_999)).v3).toEqual(V3);
  });

  it('a stranger\'s event, read for drawing only: the same identity by core, nothing for V1 or V2, and no tag can change it', () => {
    const event = adult();
    expect(v3VisualFromEvent(event)).toEqual(V3);
    expect(v3VisualFromEvent({ ...event, tags: event.tags.filter((t) => t[0] !== VISUAL_GENERATION_TAG) })).toBeUndefined();
    expect(v3VisualFromEvent({ ...event, tags: event.tags.map((t) => (t[0] === VISUAL_GENERATION_TAG ? [t[0], 'v2'] : t)) })).toBeUndefined();
    expect(v3VisualFromEvent({ ...event, tags: [...event.tags, ...FORGERIES] })).toEqual(V3);
    // Without an author there is no address, so no seed: the renderer draws a stand-in, never a guess.
    expect(v3VisualFromEvent({ tags: event.tags })).toEqual({ algorithm: 1 });
  });
});

describe('a replacement event cannot restate who a V3 Blobbi is', () => {
  it.each(FORGERIES.map((f) => [f[0], f[1]] as const))('%s = %s on the event changes nothing that is read, and the next Island write drops it', (name, value) => {
    const forged = eventWith([...adult().tags, [name, value]], CREATED_AT + 150);
    const pet = parsed(forged);
    expect(pet.v3).toEqual(V3);
    expect(renderBlobbiSvg({ ...visualOf(pet), instanceId: 'f' }).svg).toBe(renderBlobbiSvg({ ...visualOf(parsed(adult())), instanceId: 'f' }).svg);
    expectSameBlobbi(mergePetStateTags(pet), `forged ${name}`);
    expectSameBlobbi(mergePetStateTags(pet, { [name]: value }), `override ${name}`);
  });

  it('all of them at once, too', () => {
    const pet = parsed(eventWith([...adult().tags, ...FORGERIES], CREATED_AT + 150));
    expect(pet.v3).toEqual(V3);
    expectSameBlobbi(mergePetStateTags({ ...pet, baseColor: '#123456', size: 'large', adultType: 'catti' }, { hunger: '12' }), 'all forged');
  });
});

describe('every Island republish preserves the V3 identity exactly', () => {
  it('the plain republish: Island\'s own tag rebuild changes stats and nothing of who the Blobbi is', () => {
    const pet = parsed(adult());
    expectSameBlobbi(mergePetStateTags(pet), 'rebuild');
    expectSameBlobbi(mergePetStateTags({ ...pet, hunger: 12, happiness: 99, isSleeping: true, lastInteraction: new Date((CREATED_AT + 500) * 1000) }), 'rebuild with changes');
    expectSameBlobbi(mergePetStateTags(pet, { care_streak: '5', care_streak_last_at: String(CREATED_AT + 500), care_streak_last_day: '2023-11-14' }), 'rebuild with overrides');
    // Island's extension tags and the unknown host tag still ride through.
    const tags = mergePetStateTags(pet, { hunger: '12' });
    expect(tagValue(tags, 'custom_host_tag')).toBe('keep-me');
    expect(tagValue(tags, 'hunger')).toBe('12');
    expect(tagValue(tags, 'name')).toBe('Umber');
  });

  it('an item used on it (the care-effect planner, then the same rebuild useUseItem publishes)', () => {
    let event = adult();
    let now = CREATED_AT + 600;
    for (const [action, effects] of [['feed', { hunger: 25, hygiene: -2, energy: 5 }], ['clean', { hygiene: 25 }], ['play', { happiness: 20, energy: -5 }]] as const) {
      const pet = parsed(event);
      const plan = planCareEffect({ pet, action, effects, quantity: 1, now: new Date(now * 1000) });
      const tags = mergePetStateTags(plan.updatedPet, plan.streakOverrides);
      expectSameBlobbi(tags, `item ${action}`);
      event = reload(eventWith(tags, now));
      now += 600;
    }
  });

  it('the pet-state transaction\'s rebuild (an energy settlement) with an op marker', () => {
    const pet = parsed(adult());
    const tags = mergePetStateTags({ ...pet, energy: 3, lastInteraction: new Date((CREATED_AT + 900) * 1000) }, { last_decay_at: String(CREATED_AT + 900) });
    tags.push(['blobbi_op', 'o'.repeat(64)]);
    expectSameBlobbi(tags, 'settlement');
  });

  it('twenty republishes and reloads later it is still the same Blobbi, and the drawing is the same string', () => {
    let event = adult();
    const before = renderBlobbiSvg({ ...visualOf(parsed(event)), instanceId: 'life' }).svg;
    for (let i = 0; i < 20; i++) {
      const pet = parsed(event);
      const tags = mergePetStateTags({ ...pet, hunger: Math.max(0, pet.hunger - 3), isSleeping: i % 2 === 0 }, i % 3 === 0 ? { care_streak: String(i) } : undefined);
      event = reload(eventWith(tags, event.created_at + 60));
    }
    expectSameBlobbi(event.tags, 'after twenty');
    expect(renderBlobbiSvg({ ...visualOf(parsed(event)), instanceId: 'life' }).svg).toBe(before);
  });

  it('a pre-release V3 event that stated its seed, colours and traits: read as its address, and the republish drops what it stated', () => {
    const event = adult([['seed', SEED], ['base_color', '#2b3a67'], ['antenna', 'double'], ['horns', 'side'], [VISUAL_ALGORITHM_TAG, '1'], ['size', 'large'], ['adult_type', 'bloomi'], ['spots', 'true']]);
    const pet = parsed(event);
    expect(pet.v3).toEqual(V3);
    expect(pet.size).toBeUndefined();
    expect(pet.adultType).toBeUndefined();
    const tags = mergePetStateTags(pet);
    expectSameBlobbi(tags, 'pre-release tags dropped');
    // `spots` is no tag of the kit's at all: Island neither authors it nor, as an unknown tag, deletes it. Exactly what the kit's own republish does.
    expect(tagValue(tags, 'spots')).toBe(tagValue(updateBlobbiTags(event.tags, { hunger: '1' }), 'spots'));
  });

  it('a V3 event with no single well-formed address is no modern Blobbi: Island neither collects nor republishes it', () => {
    const tags = adult().tags;
    const broken: [string, string[][]][] = [['two d tags', [...tags, ['d', D]]], ['no d', tags.filter((t) => t[0] !== 'd')]];
    for (const [label, tagsOf] of broken) {
      expect(validatePetStateEvent(eventWith(tagsOf)), label).toBe(false);
      expect(parsePetState(eventWith(tagsOf)), label).toBeNull();
    }
    expect(parsePetState(eventWith(tags, CREATED_AT, 'C'.repeat(64)))).toBeNull();
  });

  it('a V2 Blobbi gains no V3 tag from a republish, and keeps its seed mirrors, adult form and size as before', () => {
    const born = buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Elder', { visualGeneration: 'v2' });
    const grown = updateBlobbiTags(born, { stage: 'adult', progression_state: 'none' });
    const pet = parsed(eventWith(grown));
    expect(pet.visualGeneration).toBe('v2');
    expect(pet.v3).toBeUndefined();
    expect(pet.adultType).toBeDefined();
    expect(pet.size).toBeDefined();
    expect(pet.baseColor).toBe(tagValue(grown, 'base_color'));
    const tags = mergePetStateTags({ ...pet, hunger: 40 });
    expect(tagValue(tags, 'seed')).toBe(tagValue(grown, 'seed'));
    expect(tagValue(tags, 'adult_type')).toBe(pet.adultType);
    expect(tagValue(tags, 'size')).toBe(pet.size);
    expect(tagValue(tags, 'base_color')).toBe(tagValue(grown, 'base_color'));
    expect(tagValue(tags, VISUAL_GENERATION_TAG)).toBe('v2');
    expect(tagValue(tags, VISUAL_ALGORITHM_TAG)).toBeUndefined();
    // A V1 Blobbi (no tag) stays V1 and gets no tag either.
    const v1 = parsed(eventWith(updateBlobbiTags(buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Old', { visualGeneration: 'v1' }), { stage: 'adult', progression_state: 'none' })));
    expect(v1.visualGeneration).toBe('v1');
    expect(tagValue(mergePetStateTags(v1), VISUAL_GENERATION_TAG)).toBeUndefined();
    expect(tagValue(mergePetStateTags(v1), 'seed')).toBe(v1.v3 === undefined ? tagValue(v1.rawTags, 'seed') : undefined);
  });
});

/** The renderer visual the in-world display builds from a collection entry. */
function visualOf(pet: ReturnType<typeof parsePetState> & object): BlobbiVisual {
  const blobbi = petStateToLegacyBlobbi(pet);
  return { stage: blobbi.stage, adultType: blobbi.adultType, visualGeneration: blobbi.visualGeneration, v3: blobbi.v3, baseColor: blobbi.baseColor, secondaryColor: blobbi.secondaryColor, eyeColor: blobbi.eyeColor };
}

// The display wrapper reads the collection and the profile through these hooks;
// the mocks are fed the object derived from the event, so the parser is exercised for real.
let current: Blobbi;
vi.mock('@/hooks/useBlobbis', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useBlobbis')>('@/hooks/useBlobbis');
  return { ...actual, useBlobbis: () => ({ data: [current] }) };
});
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: { currentCompanion: D } }) }));
const { CurrentBlobbiDisplay } = await import('@/components/blobbi/CurrentBlobbiDisplay');

describe('Island draws a V3 Blobbi through the kit', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.removeItem(BLOBBI_VISUAL_GENERATION_STORAGE_KEY);
  });

  it('the in-world display: the stated identity, generated by the renderer, with its profile and back of its own', () => {
    current = petStateToLegacyBlobbi(parsed(adult()));
    for (const facing of ['front', 'right', 'back'] as const) {
      // A side view comes from movement (the display's pose facing is front or back only), as in the world.
      // One instance id for both drawings: the renderer's idle motion phase is derived from it.
      const { container, unmount } = render(<CurrentBlobbiDisplay idSuffix="v3-probe" size="md" facing={facing === 'back' ? 'back' : 'front'} movementFacing={facing === 'right' ? 'right' : undefined} />);
      const svg = container.querySelector('[data-blobbi-renderer] svg') as SVGSVGElement;
      expect(svg.getAttribute('data-blobbi-generation')).toBe('v3');
      expect(svg.getAttribute('data-blobbi-stage')).toBe('adult');
      expect(svg.getAttribute('data-blobbi-view')).toBe(facing === 'right' ? 'side' : facing);
      const markup = svg.outerHTML;
      if (facing === 'front') {
        // Algorithm 1's own paint for this address, from the seed alone.
        expect(markup).toContain(OWN.colors.base);
        expect(markup).toContain(`data-pattern="${OWN.traits.pattern}"`);
      }
      // The kit's own picture for the same visual: no Island step between the event and the drawing changes it.
      const asDom = (text: string) => { const host = document.createElement('div'); host.innerHTML = text.replace(/<style[\s\S]*?<\/style>/, ''); return host.innerHTML; };
      // An adult at rest breathes where it stands (`blobbi-stage-motion.ts`): the display hands the renderer `idle`.
      const direct = renderBlobbiSvg({ ...visualOf(parsed(adult())), instanceId: 'v3-probe', facing, motion: 'idle' }).svg;
      if (direct.includes('data-blobbi-generation="v3"') && !direct.includes('id="-')) expect(asDom(markup).replace(/id="[^"]*"|url\(#[^)]*\)/g, '')).toBe(asDom(direct).replace(/id="[^"]*"|url\(#[^)]*\)/g, ''));
      unmount();
    }
  });

  it('the seed alone is the individual: { seed, algorithm } draws exactly what the full Algorithm 1 identity draws', () => {
    const fromAddress = renderBlobbiSvg({ stage: 'adult', visualGeneration: 'v3', v3: V3, instanceId: 'x' }).svg;
    const fromIdentity = renderBlobbiSvg({ stage: 'adult', visualGeneration: 'v3', v3: OWN, instanceId: 'x' }).svg;
    expect(fromAddress).toBe(fromIdentity);
  });

  it('the dev fixture is a complete V3 identity the kit accepts as itself', () => {
    expect(canonicalBlobbiV3Seed(DEV_V3_IDENTITY.seed)).toBe(DEV_V3_IDENTITY.seed);
    for (const stage of ['baby', 'adult'] as const) {
      expect(renderBlobbiSvg({ ...devV3Visual(stage), instanceId: 'dev' }).svg).toContain(`data-blobbi-stage="${stage}"`);
    }
  });
});

describe('movement facing', () => {
  it('a V3 body turns with its heading while standing, like V2; V1 keeps its pose; a rear seat wins', () => {
    const v3: BlobbiVisual = { stage: 'adult', visualGeneration: 'v3', v3: V3 };
    for (const movementFacing of ['left', 'right', 'back', 'front'] as const) {
      expect(resolveBodyFacing({ visual: v3, poseFacing: 'front', movementFacing })).toBe(movementFacing);
    }
    expect(resolveBodyFacing({ visual: v3, poseFacing: 'front' })).toBe('front');
    expect(resolveBodyFacing({ visual: v3, poseFacing: 'back', movementFacing: 'left' })).toBe('back');
    expect(resolveBodyFacing({ visual: { ...v3, visualGeneration: 'v1' }, poseFacing: 'front', movementFacing: 'left' })).toBe('front');
  });
});

describe('no Island-local V3 implementation', () => {
  it('nothing in src derives a genome, a morphology, a palette or a random stream, or hands the renderer a seed it made up', () => {
    const SRC = join(__dirname, '..');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full) : [full]; });
    const sources = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    // (`createBlobbiV3Identity` is the renderer's public identity API, not the engine: the adoption preview reads its colours through it.)
    const forbidden = /\b(generateGenome|deriveMorphology|buildBlobbiGeometry|geneRng|createRng|hashSeed|derivePalette|generateColors|cyrb128|sfc32|deriveBlobbiSeedV1\s*\(.*v3)\b/;
    const hits = sources.filter((f) => forbidden.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });
});
