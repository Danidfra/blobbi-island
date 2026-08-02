/**
 * Generator — seed determinism and layout validity.
 *
 * The promises under test: same seed + same policy is the identical field;
 * every generated layout honors bounds, padding, separation, the initial-coil
 * exclusion and the category composition; and a policy the seed cannot
 * satisfy fails loudly with a typed result instead of quietly shrinking the
 * round.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_TREASURE_HUNT_POLICY, type TreasureHuntPolicy } from './policy';
import { generateTreasureTargets, validateTargetLayout } from './generator';
import { treasureSeedFrom } from './random';
import { distanceBetween } from './geometry';
import type { TreasureTarget } from './types';

const POLICY = DEFAULT_TREASURE_HUNT_POLICY;

function generateOrFail(seedText: string, policy: TreasureHuntPolicy = POLICY) {
  const result = generateTreasureTargets(treasureSeedFrom(seedText), policy);
  if (!result.ok) throw new Error(`generation unexpectedly failed for seed "${seedText}"`);
  return result.targets;
}

const MANY_SEEDS = Array.from({ length: 30 }, (_, i) => `audit-seed-${i}`);

describe('seed determinism', () => {
  it('produces the identical field from the same seed and policy', () => {
    for (const seed of MANY_SEEDS.slice(0, 10)) {
      const first = generateOrFail(seed);
      const second = generateOrFail(seed);
      expect(second).toEqual(first);
    }
  });

  it('produces deterministic ids, categories and positions independently', () => {
    const first = generateOrFail('stability');
    const second = generateOrFail('stability');
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    expect(second.map((t) => t.category)).toEqual(first.map((t) => t.category));
    expect(second.map((t) => t.kind)).toEqual(first.map((t) => t.kind));
    expect(second.map((t) => t.position)).toEqual(first.map((t) => t.position));
  });

  it('normally differs between different seeds', () => {
    const a = generateOrFail('seed-a');
    const b = generateOrFail('seed-b');
    expect(a.map((t) => t.position)).not.toEqual(b.map((t) => t.position));
  });

  it('never touches Math.random', () => {
    // Determinism across repeated runs (above) is the behavioral proof; this
    // pins it directly: a poisoned Math.random must not change the field.
    const before = generateOrFail('no-global-rng');
    const original = Math.random;
    Math.random = () => {
      throw new Error('the pure model must not call Math.random');
    };
    try {
      expect(generateOrFail('no-global-rng')).toEqual(before);
    } finally {
      Math.random = original;
    }
  });
});

describe('layout validity', () => {
  it('produces a fully valid layout for many seeds', () => {
    for (const seed of MANY_SEEDS) {
      const targets = generateOrFail(seed);
      expect(validateTargetLayout(targets, POLICY)).toEqual([]);
    }
  });

  it('places exactly the policy target count, ids unique and sequential', () => {
    const targets = generateOrFail('count-check');
    expect(targets).toHaveLength(POLICY.targetCount);
    expect(targets.map((t) => t.id)).toEqual(
      Array.from({ length: POLICY.targetCount }, (_, i) => `target-${i + 1}`)
    );
  });

  it('respects edge padding and field bounds directly', () => {
    for (const seed of MANY_SEEDS.slice(0, 10)) {
      for (const target of generateOrFail(seed)) {
        expect(target.position.x).toBeGreaterThanOrEqual(POLICY.edgePadding);
        expect(target.position.x).toBeLessThanOrEqual(POLICY.fieldWidth - POLICY.edgePadding);
        expect(target.position.y).toBeGreaterThanOrEqual(POLICY.edgePadding);
        expect(target.position.y).toBeLessThanOrEqual(POLICY.fieldHeight - POLICY.edgePadding);
      }
    }
  });

  it('respects the minimum separation directly', () => {
    for (const seed of MANY_SEEDS.slice(0, 10)) {
      const targets = generateOrFail(seed);
      for (let i = 0; i < targets.length; i += 1) {
        for (let j = i + 1; j < targets.length; j += 1) {
          expect(
            distanceBetween(targets[i].position, targets[j].position)
          ).toBeGreaterThanOrEqual(POLICY.minTargetSeparation);
        }
      }
    }
  });

  it('keeps every target out of the initial coil exclusion zone', () => {
    for (const seed of MANY_SEEDS) {
      for (const target of generateOrFail(seed)) {
        expect(
          distanceBetween(target.position, POLICY.initialCoilPosition)
        ).toBeGreaterThanOrEqual(POLICY.initialCoilExclusionRadius);
      }
    }
  });

  it('keeps category counts inside the policy bounds and buries everything', () => {
    for (const seed of MANY_SEEDS.slice(0, 10)) {
      const targets = generateOrFail(seed);
      const count = (category: TreasureTarget['category']) =>
        targets.filter((t) => t.category === category).length;
      expect(count('litter')).toBeGreaterThanOrEqual(POLICY.categories.litter.minCount);
      expect(count('litter')).toBeLessThanOrEqual(POLICY.categories.litter.maxCount);
      expect(count('valuable')).toBeGreaterThanOrEqual(POLICY.categories.valuable.minCount);
      expect(count('valuable')).toBeLessThanOrEqual(POLICY.categories.valuable.maxCount);
      expect(count('special')).toBeGreaterThanOrEqual(POLICY.categories.special.minCount);
      expect(count('special')).toBeLessThanOrEqual(POLICY.categories.special.maxCount);
      expect(targets.every((t) => t.found === false)).toBe(true);
    }
  });

  it('draws kinds and values from the target category policy', () => {
    for (const target of generateOrFail('kinds-check')) {
      const categoryPolicy = POLICY.categories[target.category];
      const spec = categoryPolicy.kinds.find((k) => k.kind === target.kind);
      expect(spec).toBeDefined();
      expect(target.rawValue).toBe(spec?.rawValue);
      expect(target.detectionRadius).toBe(categoryPolicy.detectionRadius);
      expect(target.digRadius).toBe(categoryPolicy.digRadius);
      expect(target.signalWeight).toBe(categoryPolicy.signalWeight);
    }
  });
});

describe('generation failure', () => {
  it('fails with a typed result — not a shrunken round — when placement is impossible', () => {
    // Valid policy, unsatisfiable geometry: nine targets half a field apart.
    const impossible: TreasureHuntPolicy = {
      ...POLICY,
      minTargetSeparation: 0.9,
      maxPlacementAttempts: 40,
    };
    const result = generateTreasureTargets(treasureSeedFrom('impossible'), impossible);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('placement-exhausted');
      expect(result.failure.attempts).toBe(40);
      expect(result.failure.placedCount).toBeLessThan(impossible.targetCount);
    }
  });

  it('throws (rather than returning a failure) for an invalid policy', () => {
    expect(() =>
      generateTreasureTargets(1, { ...POLICY, targetCount: 0 })
    ).toThrow(/targetCount/);
  });
});

describe('validateTargetLayout as an independent auditor', () => {
  it('flags duplicate ids, padding violations and bad composition', () => {
    const base = generateOrFail('auditor');
    const corrupted = [
      { ...base[0], id: base[1].id },
      ...base.slice(1, -1),
      { ...base[base.length - 1], position: { x: 0.001, y: 0.5 } },
    ];
    const violations = validateTargetLayout(corrupted, POLICY);
    expect(violations.some((v) => v.includes('duplicate target id'))).toBe(true);
    expect(violations.some((v) => v.includes('edge padding'))).toBe(true);
  });

  it('flags a wrong target count', () => {
    const targets = generateOrFail('short').slice(0, 5);
    expect(
      validateTargetLayout(targets, POLICY).some((v) => v.includes('target count'))
    ).toBe(true);
  });
});
