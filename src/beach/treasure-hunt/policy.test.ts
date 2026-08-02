/**
 * Policy validation — the configuration gate.
 *
 * The policy is the single home of every balance number, so a bad policy must
 * be refused loudly at the door rather than clamped into something the author
 * never wrote. These tests pin both the default policy's validity and the
 * refusal of each malformed variant.
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TREASURE_HUNT_POLICY,
  validateTreasureHuntPolicy,
  validCompositions,
  type TreasureHuntPolicy,
} from './policy';

function withOverrides(overrides: Partial<TreasureHuntPolicy>): TreasureHuntPolicy {
  return { ...DEFAULT_TREASURE_HUNT_POLICY, ...overrides };
}

describe('DEFAULT_TREASURE_HUNT_POLICY', () => {
  it('is valid', () => {
    expect(() => validateTreasureHuntPolicy(DEFAULT_TREASURE_HUNT_POLICY)).not.toThrow();
  });

  it('carries the provisional V1 values in one place', () => {
    expect(DEFAULT_TREASURE_HUNT_POLICY.roundDurationSeconds).toBe(120);
    expect(DEFAULT_TREASURE_HUNT_POLICY.targetCount).toBe(9);
    expect(DEFAULT_TREASURE_HUNT_POLICY.shovelUses).toBe(5);
  });

  it('admits exactly the three compositions that sum to nine targets', () => {
    expect(validCompositions(DEFAULT_TREASURE_HUNT_POLICY)).toEqual([
      { litter: 4, valuable: 4, special: 1 },
      { litter: 5, valuable: 3, special: 1 },
      { litter: 5, valuable: 4, special: 0 },
    ]);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_TREASURE_HUNT_POLICY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TREASURE_HUNT_POLICY.categories.litter)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TREASURE_HUNT_POLICY.categories.litter.kinds)).toBe(true);
  });

  it('gives the special candidate no unit value', () => {
    for (const kindSpec of DEFAULT_TREASURE_HUNT_POLICY.categories.special.kinds) {
      expect(kindSpec.rawValue).toBe(0);
    }
  });
});

describe('validateTreasureHuntPolicy', () => {
  it('rejects a non-integer target count', () => {
    expect(() => validateTreasureHuntPolicy(withOverrides({ targetCount: 8.5 }))).toThrow(
      /targetCount/
    );
  });

  it('rejects zero shovel uses', () => {
    expect(() => validateTreasureHuntPolicy(withOverrides({ shovelUses: 0 }))).toThrow(
      /shovelUses/
    );
  });

  it('rejects a non-finite round duration', () => {
    expect(() =>
      validateTreasureHuntPolicy(withOverrides({ roundDurationSeconds: Number.NaN }))
    ).toThrow(/roundDurationSeconds/);
  });

  it('rejects negative edge padding', () => {
    expect(() => validateTreasureHuntPolicy(withOverrides({ edgePadding: -0.01 }))).toThrow(
      /edgePadding/
    );
  });

  it('rejects edge padding that leaves no placeable area', () => {
    expect(() => validateTreasureHuntPolicy(withOverrides({ edgePadding: 0.5 }))).toThrow(
      /placeable/
    );
  });

  it('rejects an initial coil position outside the field', () => {
    expect(() =>
      validateTreasureHuntPolicy(withOverrides({ initialCoilPosition: { x: 1.5, y: 0.5 } }))
    ).toThrow(/initialCoilPosition/);
  });

  it('rejects a non-finite initial coil position', () => {
    expect(() =>
      validateTreasureHuntPolicy(
        withOverrides({ initialCoilPosition: { x: Number.NaN, y: 0.5 } })
      )
    ).toThrow(/initialCoilPosition/);
  });

  it('rejects a saturation distance at or beyond a detection radius', () => {
    expect(() =>
      validateTreasureHuntPolicy(withOverrides({ signalSaturationDistance: 0.16 }))
    ).toThrow(/signalSaturationDistance/);
  });

  it('rejects a signal weight outside (0, 1]', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      litter: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.litter, signalWeight: 1.2 },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(
      /signalWeight/
    );
    const zeroed = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      litter: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.litter, signalWeight: 0 },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories: zeroed }))).toThrow(
      /signalWeight/
    );
  });

  it('rejects an empty kind list', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      valuable: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.valuable, kinds: [] },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(/kinds/);
  });

  it('rejects a kind identifier duplicated across categories', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      valuable: {
        ...DEFAULT_TREASURE_HUNT_POLICY.categories.valuable,
        kinds: [{ kind: 'bottle-cap', rawValue: 2 }],
      },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(
      /duplicated/
    );
  });

  it('rejects a negative kind value', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      valuable: {
        ...DEFAULT_TREASURE_HUNT_POLICY.categories.valuable,
        kinds: [{ kind: 'cursed-doubloon', rawValue: -1 }],
      },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(
      /rawValue/
    );
  });

  it('rejects maxCount below minCount', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      litter: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.litter, minCount: 5, maxCount: 4 },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(
      /maxCount/
    );
  });

  it('rejects a composition that cannot sum to the target count', () => {
    const categories = {
      ...DEFAULT_TREASURE_HUNT_POLICY.categories,
      litter: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.litter, minCount: 1, maxCount: 1 },
      valuable: {
        ...DEFAULT_TREASURE_HUNT_POLICY.categories.valuable,
        minCount: 1,
        maxCount: 1,
      },
      special: { ...DEFAULT_TREASURE_HUNT_POLICY.categories.special, minCount: 0, maxCount: 1 },
    };
    expect(() => validateTreasureHuntPolicy(withOverrides({ categories }))).toThrow(
      /composition/
    );
  });
});
