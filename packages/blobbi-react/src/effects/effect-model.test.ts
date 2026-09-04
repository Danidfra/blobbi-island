/**
 * The EFFECT MODEL: what a caller may say, and what the package does with it.
 *
 * This is the package's outer edge for effects, so it is tested the way an
 * outer edge should be: with the input a well-behaved caller sends, and with
 * the input that arrives when something upstream is wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  BLOBBI_VISUAL_EFFECT_IDS,
  EFFECT_SLOTS,
  EFFECT_SLOT_ORDER,
  DEFAULT_EFFECT_INTENSITY,
  MIN_EFFECT_INTENSITY,
  MAX_EFFECT_INTENSITY,
  isBlobbiVisualEffectId,
  normalizeBlobbiVisualEffects,
  type BlobbiVisualEffect,
  type BlobbiVisualEffectId,
} from './effect-model';

const ids = (result: readonly { id: string }[]) => result.map((e) => e.id);

describe('the effect id set', () => {
  it('is exactly the twelve effects of this phase, with no duplicates', () => {
    expect(BLOBBI_VISUAL_EFFECT_IDS).toEqual([
      'golden-sparkles',
      'bubble-bliss',
      'love-burst',
      'firefly-friends',
      'mystic-fog',
      'frost-breath',
      'pixel-glitch',
      'electric-charge',
      'celestial-aura',
      'solar-radiance',
      'void-whispers',
      'rainbow-dream',
    ]);
    expect(new Set(BLOBBI_VISUAL_EFFECT_IDS).size).toBe(12);
  });

  it('gives every id exactly one slot, and uses all four slots', () => {
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      expect(EFFECT_SLOT_ORDER).toContain(EFFECT_SLOTS[id]);
    }
    expect(new Set(Object.values(EFFECT_SLOTS)).size).toBe(EFFECT_SLOT_ORDER.length);
  });

  it('recognises its own ids and nothing else', () => {
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      expect(isBlobbiVisualEffectId(id)).toBe(true);
    }
    for (const other of [
      'GOLDEN-SPARKLES',
      'golden_sparkles',
      ' golden-sparkles',
      'celestial-aura ',
      'constructor',
      '__proto__',
      'toString',
      '',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(isBlobbiVisualEffectId(other)).toBe(false);
    }
  });
});

describe('normalizeBlobbiVisualEffects: the happy path', () => {
  it('resolves every single effect on its own', () => {
    for (const id of BLOBBI_VISUAL_EFFECT_IDS) {
      const [resolved, ...rest] = normalizeBlobbiVisualEffects([{ id }]);
      expect(rest).toEqual([]);
      expect(resolved).toEqual({
        id,
        slot: EFFECT_SLOTS[id],
        intensity: DEFAULT_EFFECT_INTENSITY,
      });
    }
  });

  it('renders one effect per slot together', () => {
    const result = normalizeBlobbiVisualEffects([
      { id: 'celestial-aura' },
      { id: 'mystic-fog' },
      { id: 'golden-sparkles' },
      { id: 'pixel-glitch' },
    ]);
    expect(result).toHaveLength(4);
    expect(new Set(result.map((e) => e.slot)).size).toBe(4);
  });

  it('is JSON round-trippable in both directions', () => {
    const input: BlobbiVisualEffect[] = [
      { id: 'rainbow-dream', intensity: 0.75 },
      { id: 'bubble-bliss' },
    ];
    const viaJson = JSON.parse(JSON.stringify(input)) as BlobbiVisualEffect[];
    expect(normalizeBlobbiVisualEffects(viaJson)).toEqual(
      normalizeBlobbiVisualEffects(input),
    );

    const result = normalizeBlobbiVisualEffects(input);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('normalizeBlobbiVisualEffects: order and determinism', () => {
  it('returns results in canonical slot order, not input order', () => {
    const forwards = normalizeBlobbiVisualEffects([
      { id: 'pixel-glitch' },
      { id: 'golden-sparkles' },
      { id: 'mystic-fog' },
      { id: 'celestial-aura' },
    ]);
    const backwards = normalizeBlobbiVisualEffects([
      { id: 'celestial-aura' },
      { id: 'mystic-fog' },
      { id: 'golden-sparkles' },
      { id: 'pixel-glitch' },
    ]);
    expect(forwards).toEqual(backwards);
    expect(ids(forwards)).toEqual([
      'celestial-aura',
      'mystic-fog',
      'golden-sparkles',
      'pixel-glitch',
    ]);
    expect(forwards.map((e) => e.slot)).toEqual([...EFFECT_SLOT_ORDER]);
  });

  it('is stable across repeated calls with the same input', () => {
    const input: BlobbiVisualEffect[] = [
      { id: 'void-whispers', intensity: 0.4 },
      { id: 'frost-breath' },
    ];
    const first = normalizeBlobbiVisualEffects(input);
    for (let i = 0; i < 50; i++) {
      expect(normalizeBlobbiVisualEffects(input)).toEqual(first);
    }
  });
});

describe('normalizeBlobbiVisualEffects: duplicates and slot conflicts', () => {
  it('keeps the FIRST occurrence of a duplicated id, with its intensity', () => {
    const result = normalizeBlobbiVisualEffects([
      { id: 'love-burst', intensity: 0.3 },
      { id: 'love-burst', intensity: 1.4 },
      { id: 'love-burst' },
    ]);
    expect(result).toEqual([
      { id: 'love-burst', slot: 'ambient-particles', intensity: 0.3 },
    ]);
  });

  it('gives a contested slot to the first competitor in the supplied order', () => {
    // The rule the caller can predict and control. A priority table the caller
    // cannot see would make "why is my aura not showing" unanswerable.
    expect(
      ids(normalizeBlobbiVisualEffects([{ id: 'solar-radiance' }, { id: 'void-whispers' }])),
    ).toEqual(['solar-radiance']);
    expect(
      ids(normalizeBlobbiVisualEffects([{ id: 'void-whispers' }, { id: 'solar-radiance' }])),
    ).toEqual(['void-whispers']);
  });

  it('never stacks two auras, two overlays, two ambients or two ground effects', () => {
    const everyEffect = BLOBBI_VISUAL_EFFECT_IDS.map((id) => ({ id }));
    const result = normalizeBlobbiVisualEffects(everyEffect);

    expect(result).toHaveLength(4);
    const slots = result.map((e) => e.slot);
    expect(new Set(slots).size).toBe(slots.length);
    // Supplied in catalogue order, so each slot's first member wins.
    expect(ids(result)).toEqual([
      'celestial-aura',
      'mystic-fog',
      'golden-sparkles',
      'pixel-glitch',
    ]);
  });

  it('caps the result at one effect per slot no matter how long the input is', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => ({
      id: BLOBBI_VISUAL_EFFECT_IDS[i % 12],
    }));
    expect(normalizeBlobbiVisualEffects(noisy)).toHaveLength(4);
  });
});

describe('normalizeBlobbiVisualEffects: intensity', () => {
  it('clamps to the documented bounds', () => {
    const cases: Array<[number | undefined, number]> = [
      [1, 1],
      [0, MIN_EFFECT_INTENSITY],
      [0.42, 0.42],
      [-5, MIN_EFFECT_INTENSITY],
      [99, MAX_EFFECT_INTENSITY],
      [MAX_EFFECT_INTENSITY, MAX_EFFECT_INTENSITY],
      [undefined, DEFAULT_EFFECT_INTENSITY],
    ];
    for (const [input, expected] of cases) {
      const [resolved] = normalizeBlobbiVisualEffects([
        { id: 'golden-sparkles', intensity: input },
      ]);
      expect(resolved.intensity, `intensity ${input}`).toBe(expected);
    }
  });

  it('falls back to the default for anything non-finite', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const [resolved] = normalizeBlobbiVisualEffects([
        { id: 'golden-sparkles', intensity: bad },
      ]);
      expect(resolved.intensity).toBe(DEFAULT_EFFECT_INTENSITY);
    }
  });
});

describe('normalizeBlobbiVisualEffects: hostile and malformed input', () => {
  it('returns an empty result for nothing at all', () => {
    expect(normalizeBlobbiVisualEffects(undefined)).toEqual([]);
    expect(normalizeBlobbiVisualEffects(null)).toEqual([]);
    expect(normalizeBlobbiVisualEffects([])).toEqual([]);
  });

  it('ignores unknown ids instead of rendering something arbitrary', () => {
    const result = normalizeBlobbiVisualEffects([
      { id: 'not-an-effect' as BlobbiVisualEffectId },
      { id: 'golden-sparkles' },
      { id: '__proto__' as BlobbiVisualEffectId },
      { id: 'constructor' as BlobbiVisualEffectId },
    ]);
    expect(ids(result)).toEqual(['golden-sparkles']);
  });

  it('survives holes, primitives and shapeless objects', () => {
    const junk = [
      null,
      undefined,
      'golden-sparkles',
      42,
      [],
      {},
      { id: null },
      { id: { toString: () => 'golden-sparkles' } },
      { intensity: 1 },
      { id: 'mystic-fog' },
    ] as unknown as BlobbiVisualEffect[];
    expect(ids(normalizeBlobbiVisualEffects(junk))).toEqual(['mystic-fog']);
  });

  it('does not treat a non-array as an array', () => {
    const notAnArray = { 0: { id: 'golden-sparkles' }, length: 1 } as unknown as
      readonly BlobbiVisualEffect[];
    expect(normalizeBlobbiVisualEffects(notAnArray)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input: BlobbiVisualEffect[] = [
      { id: 'frost-breath', intensity: 9 },
      { id: 'frost-breath' },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeBlobbiVisualEffects(input);
    expect(input).toEqual(snapshot);
  });
});
