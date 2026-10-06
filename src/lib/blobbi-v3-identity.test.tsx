/**
 * V3 (procedural) Blobbis in Island: parsed by core, drawn by the kit, and
 * their identity PRESERVED by every kind 31124 Island writes.
 *
 * The contract (blobbi-kit, `visual_algorithm = 1`): a V3 Blobbi's explicit
 * identity (four colours, the kind of each trait) is decided once, at
 * creation, and stated on its event; from then on every update preserves
 * what the event states and derives nothing from the seed again. Island
 * creates no V3 Blobbi, but it receives them, draws them and republishes
 * them, and it rebuilds the tag list itself (`mergePetStateTags`), which is
 * exactly where an older client rewrote V3 identity.
 *
 * The Blobbi here is deliberately NOT what its seed would have chosen (dark
 * navy with a yellow pattern, every trait on, a moon on its skin), so that a
 * path that quietly regenerates a field from the seed, or from a default,
 * shows up as a changed tag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  BLOBBI_V3_ABSENT_TAG_NAMES,
  BLOBBI_V3_TAG_NAMES,
  KIND_BLOBBI_STATE,
  VISUAL_ALGORITHM_TAG,
  VISUAL_GENERATION_TAG,
  buildEggTags,
  canonicalBlobbiV3Seed,
  deriveBlobbiSeedV1,
  getCanonicalBlobbiD,
  updateBlobbiTags,
  type BlobbiV3Identity,
} from '@blobbi-kit/core';
import { createBlobbiV3Identity, renderBlobbiSvg, type BlobbiVisual } from '@blobbi-kit/renderer';
import { mergePetStateTags, parsePetState, validatePetStateEvent } from '@/lib/blobbi-parsers';
import { petStateToLegacyBlobbi, type Blobbi } from '@/hooks/useBlobbis';
import { v3VisualFromTags } from '@/lib/blobbi-v3-visual';
import { resolveBodyFacing } from '@/lib/blobbi-facing';
import { planCareEffect } from '@/inventory/care-effect';
import { BLOBBI_VISUAL_GENERATION_STORAGE_KEY } from '@/lib/blobbi-visual-dev';
import { DEV_V3_IDENTITY, devV3Visual } from '@/lib/dev-v3-fixture';

const PUBKEY = 'c'.repeat(64);
const PET_ID = '0123456789';
const D = getCanonicalBlobbiD(PUBKEY, PET_ID);
const CREATED_AT = 1_700_000_000;
const SEED = deriveBlobbiSeedV1(PUBKEY, D, CREATED_AT);

/** Not what the seed would choose: every field differs from creation's answer, or is set where creation left it off. */
const UNUSUAL: BlobbiV3Identity = {
  seed: SEED,
  algorithm: 1,
  colors: { base: '#2b3a67', secondary: '#ffd23f', eye: '#e85d75', accent: '#7ad3f4' },
  traits: { antenna: 'double', horns: 'side', ears: 'pointed', tail: 'leaf', pattern: 'striped', specialMark: 'moon', belly: true, freckles: true },
};
const IDENTITY_TAGS = [VISUAL_GENERATION_TAG, 'seed', ...BLOBBI_V3_TAG_NAMES];
/** The identity tags, by name: Island's rebuild orders tags its own way, and order is not identity. */
const identityTagsOf = (tags: readonly (readonly string[])[]) => tags.filter((t) => IDENTITY_TAGS.includes(t[0])).map((t) => [...t]).sort((a, b) => a[0].localeCompare(b[0]));
const tagValue = (tags: readonly (readonly string[])[], name: string) => tags.find((t) => t[0] === name)?.[1];

const eventWith = (tags: string[][], at = CREATED_AT): NostrEvent => ({ id: 'e'.repeat(64), pubkey: PUBKEY, created_at: at, kind: KIND_BLOBBI_STATE, tags, content: '', sig: 'f'.repeat(128) });
/** What a relay and a reload do to an event: nothing survives but its JSON. */
const reload = (event: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(event));

/**
 * The V3 adult as ANOTHER client would have published it: born by the kit's
 * creation pipeline with the unusual identity, grown to an adult through the
 * kit's own republish, plus the Island extension tags a lived-in Blobbi has.
 */
function unusualAdult(extra: string[][] = []): NostrEvent {
  const born = buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Umber', { visualGeneration: 'v3', v3: (seed) => ({ ...UNUSUAL, seed }) });
  const grown = updateBlobbiTags(born, { stage: 'adult', progression_state: 'none', generation: '3', hunger: '70', last_interaction: String(CREATED_AT + 100) });
  return eventWith([...grown, ['is_sleeping', 'false'], ['last_meal', String(CREATED_AT)], ['custom_host_tag', 'keep-me'], ...extra], CREATED_AT + 100);
}

const parsed = (event: NostrEvent) => {
  expect(validatePetStateEvent(event)).toBe(true);
  const pet = parsePetState(event);
  if (!pet) throw new Error('must parse');
  return pet;
};

/** Everything that must still be true of an event carrying the unusual Blobbi. */
function expectUnchanged(tags: string[][], label: string) {
  expect(identityTagsOf(tags), label).toEqual(identityTagsOf(unusualAdult().tags));
  for (const name of BLOBBI_V3_ABSENT_TAG_NAMES) expect(tagValue(tags, name), `${label} ${name}`).toBeUndefined();
  // Exactly once each: no duplicate colour or trait tag either.
  for (const name of IDENTITY_TAGS) expect(tags.filter((t) => t[0] === name).length, `${label} ${name}`).toBe(1);
  // The genealogical generation is not the visual one, and is untouched.
  expect(tagValue(tags, 'generation'), label).toBe('3');
  const pet = parsed(eventWith(tags, CREATED_AT + 200));
  expect(pet.visualGeneration, label).toBe('v3');
  expect(pet.v3, label).toEqual({ seed: SEED, algorithm: 1, colors: UNUSUAL.colors, traits: UNUSUAL.traits });
  expect(pet.generation, label).toBe(3);
  expect(pet.size, label).toBeUndefined();
  expect(pet.adultType, label).toBeUndefined();
}

describe('Island parses a canonical V3 identity', () => {
  it('through parsePetState: the identity as the event states it, nothing a V3 Blobbi does not have', () => {
    const pet = parsed(unusualAdult());
    expect(pet.visualGeneration).toBe('v3');
    expect(pet.v3).toEqual({ seed: SEED, algorithm: 1, colors: UNUSUAL.colors, traits: UNUSUAL.traits });
    expect(canonicalBlobbiV3Seed(pet.v3?.seed)).toBe(SEED);
    // The plain colour fields are the stated ones (explicit identity), not the seed's old mirrors.
    expect(pet.baseColor).toBe('#2b3a67');
    expect(pet.pattern).toBe('striped');
    expect(pet.specialMark).toBe('moon');
    expect(pet.size).toBeUndefined();
    expect(pet.adultType).toBeUndefined();
    // Island extensions still read.
    expect(pet.lastMeal?.getTime()).toBe(CREATED_AT * 1000);
    // And the collection object every surface uses carries it on.
    const blobbi = petStateToLegacyBlobbi(pet);
    expect(blobbi.v3).toEqual(pet.v3);
    expect(blobbi.visualGeneration).toBe('v3');
    expect(blobbi.adultType).toBeUndefined();
    expect(blobbi.size).toBeUndefined();
  });

  it('the explicit identity is NOT what the seed alone would choose, and the seed is what core derives', () => {
    const own = createBlobbiV3Identity(SEED);
    expect(UNUSUAL.colors).not.toEqual(own.colors);
    expect(UNUSUAL.traits).not.toEqual(own.traits);
    expect(SEED).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a stranger\'s event, read for drawing only: the same identity by core, nothing for V1 or V2, a bad colour simply absent', () => {
    const event = unusualAdult();
    expect(v3VisualFromTags(event.tags)).toEqual({ seed: SEED, algorithm: 1, colors: UNUSUAL.colors, traits: UNUSUAL.traits });
    expect(v3VisualFromTags(event.tags.filter((t) => t[0] !== VISUAL_GENERATION_TAG))).toBeUndefined();
    expect(v3VisualFromTags(event.tags.map((t) => (t[0] === VISUAL_GENERATION_TAG ? [t[0], 'v2'] : t)))).toBeUndefined();
    const hostile = v3VisualFromTags(event.tags.map((t) => (t[0] === 'eye_color' ? ['eye_color', 'javascript:alert(1)'] : t[0] === 'horns' ? ['horns', 'antlers'] : t)))!;
    expect(hostile.colors?.eye).toBeUndefined();
    expect(hostile.traits?.horns).toBeUndefined();
    expect(hostile.colors?.base).toBe('#2b3a67');
  });
});

describe('every Island republish preserves the V3 identity exactly', () => {
  it('the plain republish: Island\'s own tag rebuild changes stats and nothing of who the Blobbi is', () => {
    const pet = parsed(unusualAdult());
    expectUnchanged(mergePetStateTags(pet), 'rebuild');
    expectUnchanged(mergePetStateTags({ ...pet, hunger: 12, happiness: 99, isSleeping: true, lastInteraction: new Date((CREATED_AT + 500) * 1000) }), 'rebuild with changes');
    expectUnchanged(mergePetStateTags(pet, { care_streak: '5', care_streak_last_at: String(CREATED_AT + 500), care_streak_last_day: '2023-11-14' }), 'rebuild with overrides');
    // Island's extension tags and the unknown host tag still ride through.
    const tags = mergePetStateTags(pet, { hunger: '12' });
    expect(tagValue(tags, 'custom_host_tag')).toBe('keep-me');
    expect(tagValue(tags, 'hunger')).toBe('12');
    expect(tagValue(tags, 'name')).toBe('Umber');
  });

  it('an item used on it (the care-effect planner, then the same rebuild useUseItem publishes)', () => {
    let event = unusualAdult();
    let now = CREATED_AT + 600;
    for (const [action, effects] of [['feed', { hunger: 25, hygiene: -2, energy: 5 }], ['clean', { hygiene: 25 }], ['play', { happiness: 20, energy: -5 }]] as const) {
      const pet = parsed(event);
      const plan = planCareEffect({ pet, action, effects, quantity: 1, now: new Date(now * 1000) });
      const tags = mergePetStateTags(plan.updatedPet, plan.streakOverrides);
      expectUnchanged(tags, `item ${action}`);
      event = reload(eventWith(tags, now));
      now += 600;
    }
  });

  it('the pet-state transaction\'s rebuild (an energy settlement) with an op marker, and a settlement that touches every stat', () => {
    const pet = parsed(unusualAdult());
    const tags = mergePetStateTags({ ...pet, energy: 3, lastInteraction: new Date((CREATED_AT + 900) * 1000) }, { last_decay_at: String(CREATED_AT + 900) });
    tags.push(['blobbi_op', 'o'.repeat(64)]);
    expectUnchanged(tags, 'settlement');
  });

  it('twenty republishes and reloads later it is still the same Blobbi, and the drawing is the same string', () => {
    let event = unusualAdult();
    const before = renderBlobbiSvg({ ...visualOf(parsed(event)), instanceId: 'life' }).svg;
    for (let i = 0; i < 20; i++) {
      const pet = parsed(event);
      const tags = mergePetStateTags({ ...pet, hunger: Math.max(0, pet.hunger - 3), isSleeping: i % 2 === 0 }, i % 3 === 0 ? { care_streak: String(i) } : undefined);
      event = reload(eventWith(tags, event.created_at + 60));
    }
    expectUnchanged(event.tags, 'after twenty');
    expect(renderBlobbiSvg({ ...visualOf(parsed(event)), instanceId: 'life' }).svg).toBe(before);
  });

  it('an older event that carried size or adult_type: a republish drops them, as the kit\'s does, and authors neither spots nor anything else', () => {
    const event = unusualAdult([['size', 'large'], ['adult_type', 'bloomi'], ['spots', 'true']]);
    const pet = parsed(event);
    expect(pet.size).toBeUndefined();
    expect(pet.adultType).toBeUndefined();
    const tags = mergePetStateTags(pet);
    expectUnchanged(tags, 'legacy tags dropped');
    // `spots` is no tag of the kit's at all: Island neither authors it nor, as an unknown tag, deletes it. Exactly what the kit's own republish does.
    expect(tagValue(tags, 'spots')).toBe(tagValue(updateBlobbiTags(event.tags, { hunger: '1' }), 'spots'));
    expect(tagValue(mergePetStateTags(parsed(unusualAdult())), 'spots')).toBeUndefined();
  });

  it('a seed in upper case is the same Blobbi, read canonically; the tag itself is carried as written', () => {
    const upper = unusualAdult().tags.map((t) => (t[0] === 'seed' ? ['seed', SEED.toUpperCase()] : t));
    const pet = parsed(eventWith(upper));
    expect(pet.v3?.seed).toBe(SEED);
    const tags = mergePetStateTags(pet);
    expect(tagValue(tags, 'seed')).toBe(SEED.toUpperCase());
    expect(renderBlobbiSvg({ ...visualOf(pet), instanceId: 'u' }).svg).toBe(renderBlobbiSvg({ ...visualOf(parsed(unusualAdult())), instanceId: 'u' }).svg);
  });

  it('a value that is not a V3 seed never becomes another individual: the renderer draws the stand-in, not a guess', () => {
    const bad = unusualAdult().tags.map((t) => (t[0] === 'seed' ? ['seed', 'x'.repeat(64)] : t));
    const pet = parsed(eventWith(bad));
    expect(pet.v3?.seed).toBeUndefined();
    const drawn = renderBlobbiSvg({ ...visualOf(pet), instanceId: 'bad' }).svg;
    const real = renderBlobbiSvg({ ...visualOf(parsed(unusualAdult())), instanceId: 'bad' }).svg;
    expect(drawn).not.toBe(real);
    // The same drawing for any such value: nothing was derived from it.
    const other = parsed(eventWith(unusualAdult().tags.map((t) => (t[0] === 'seed' ? ['seed', 'y'.repeat(64)] : t))));
    expect(renderBlobbiSvg({ ...visualOf(other), instanceId: 'bad' }).svg).toBe(drawn);
    // And the republish carries the tag as it is: Island repairs nothing into a seed.
    expect(tagValue(mergePetStateTags(pet), 'seed')).toBe('x'.repeat(64));
  });

  it('a V2 Blobbi gains no V3 tag from a republish, and keeps its seed mirrors, adult form and size as before', () => {
    const born = buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Elder', { visualGeneration: 'v2' });
    const grown = updateBlobbiTags(born, { stage: 'adult', progression_state: 'none' });
    const pet = parsed(eventWith(grown));
    expect(pet.visualGeneration).toBe('v2');
    expect(pet.v3).toBeUndefined();
    expect(pet.adultType).toBeDefined();
    expect(pet.size).toBeDefined();
    const tags = mergePetStateTags({ ...pet, hunger: 40 });
    for (const name of BLOBBI_V3_TAG_NAMES.filter((n) => !['base_color', 'secondary_color', 'eye_color', 'pattern', 'special_mark'].includes(n))) expect(tagValue(tags, name), name).toBeUndefined();
    expect(tagValue(tags, 'adult_type')).toBe(pet.adultType);
    expect(tagValue(tags, 'size')).toBe(pet.size);
    expect(tagValue(tags, 'base_color')).toBe(tagValue(grown, 'base_color'));
    expect(tagValue(tags, VISUAL_GENERATION_TAG)).toBe('v2');
    // A V1 Blobbi (no tag) stays V1 and gets no tag either.
    const v1 = parsed(eventWith(updateBlobbiTags(buildEggTags(PUBKEY, PET_ID, CREATED_AT, 'Old', { visualGeneration: 'v1' }), { stage: 'adult', progression_state: 'none' })));
    expect(v1.visualGeneration).toBe('v1');
    expect(tagValue(mergePetStateTags(v1), VISUAL_GENERATION_TAG)).toBeUndefined();
    expect(tagValue(mergePetStateTags(v1), VISUAL_ALGORITHM_TAG)).toBeUndefined();
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
    current = petStateToLegacyBlobbi(parsed(unusualAdult()));
    for (const facing of ['front', 'right', 'back'] as const) {
      // A side view comes from movement (the display's pose facing is front or back only), as in the world.
      const { container, unmount } = render(<CurrentBlobbiDisplay size="md" facing={facing === 'back' ? 'back' : 'front'} movementFacing={facing === 'right' ? 'right' : undefined} />);
      const svg = container.querySelector('[data-blobbi-renderer] svg') as SVGSVGElement;
      expect(svg.getAttribute('data-blobbi-generation')).toBe('v3');
      expect(svg.getAttribute('data-blobbi-stage')).toBe('adult');
      expect(svg.getAttribute('data-blobbi-view')).toBe(facing === 'right' ? 'side' : facing);
      const markup = svg.outerHTML;
      if (facing === 'front') {
        expect(markup).toContain('#ffd23f');
        expect(markup).toContain('data-pattern="striped"');
        expect(markup).toContain('data-part="antenna"');
        expect(markup).toContain('data-part="horn-body"');
        expect(markup).toContain('data-part="freckle"');
      }
      if (facing === 'back') expect(markup).toContain('data-part="tail');
      // The kit's own picture for the same visual: no Island step between the event and the drawing changes it.
      const asDom = (text: string) => { const host = document.createElement('div'); host.innerHTML = text.replace(/<style[\s\S]*?<\/style>/, ''); return host.innerHTML; };
      const direct = renderBlobbiSvg({ ...visualOf(parsed(unusualAdult())), instanceId: svg.closest('[data-blobbi-renderer]')?.getAttribute('data-blobbi-instance-id') ?? '', facing, motion: 'still' }).svg;
      if (direct.includes('data-blobbi-generation="v3"') && !direct.includes('id="-')) expect(asDom(markup).replace(/id="[^"]*"|url\(#[^)]*\)/g, '')).toBe(asDom(direct).replace(/id="[^"]*"|url\(#[^)]*\)/g, ''));
      unmount();
    }
  });

  it('explicit traits win over the seed: the same seed with its own creation identity is another picture', () => {
    const own = createBlobbiV3Identity(SEED);
    const stated = renderBlobbiSvg({ stage: 'adult', visualGeneration: 'v3', v3: UNUSUAL, instanceId: 'x' }).svg;
    const natural = renderBlobbiSvg({ stage: 'adult', visualGeneration: 'v3', v3: own, instanceId: 'x' }).svg;
    expect(stated).not.toBe(natural);
    expect(stated).toContain('data-mark="moon"');
    // The same body under the stated paint: the seed still decides the micro-geometry.
    const shapes = (svg: string) => svg.replace(/#[0-9a-f]{6}/g, '#');
    expect(shapes(renderBlobbiSvg({ stage: 'adult', visualGeneration: 'v3', v3: { ...own, colors: UNUSUAL.colors }, instanceId: 'x' }).svg)).toBe(shapes(natural));
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
    const v3: BlobbiVisual = { stage: 'adult', visualGeneration: 'v3', v3: UNUSUAL };
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
    const forbidden = /\b(generateGenome|deriveMorphology|buildBlobbiGeometry|geneRng|createRng|hashSeed|derivePalette|generateColors|cyrb128|sfc32|createBlobbiV3Identity)\b/;
    const hits = sources.filter((f) => forbidden.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });
});
