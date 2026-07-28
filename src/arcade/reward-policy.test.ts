/**
 * Reward-policy tests.
 *
 * The point of these is not to bless a particular ticket number — the numbers
 * are explicitly tunable product decisions. It is to prove the SHARED layer
 * cannot be bypassed: caps hold, the participation floor exists, the daily limit
 * bites, an invalid result pays nothing, and every registered policy stays
 * inside the agreed output band whatever its own score scale looks like.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_REWARD_TUNING,
  DANCE_REWARD_POLICY,
  EMPTY_REWARD_CONTEXT,
  arcadeRewardPolicies,
  calculateTicketAward,
  getProductionRewardPolicy,
  getRewardPolicy,
  type ArcadeRewardPolicy,
} from './reward-policy';
import type { ArcadeGameResult } from './types';

function result(overrides: Partial<ArcadeGameResult> = {}): ArcadeGameResult {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    difficulty: 'normal',
    cleared: true,
    score: 1000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_090_000,
    stats: { accuracy: 100 },
    ...overrides,
  };
}

/** A fixed-output policy, so shared-layer behaviour is tested in isolation. */
const fixed = (
  base: number,
  max: number = ARCADE_REWARD_TUNING.hardCapPerRun,
): ArcadeRewardPolicy => ({
  gameId: 'blobbi-dance',
  status: 'draft',
  base: () => base,
  maxTicketsPerRun: max,
});

describe('shared award layer', () => {
  it('pays the participation floor for a run that did not clear', () => {
    const award = calculateTicketAward(fixed(12), result({ cleared: false }));

    expect(award.total).toBe(ARCADE_REWARD_TUNING.participationFloor);
    expect(award.participationFloorApplied).toBe(true);
    expect(award.bonuses).toEqual({ firstClear: 0, dailyFirstPlay: 0, personalBest: 0 });
    expect(award.breakdown.map((l) => l.label)).toEqual(['Participation']);
  });

  it('lifts a stingy base up to the participation floor on a clear', () => {
    const award = calculateTicketAward(fixed(0), result({ difficulty: 'easy' }));
    expect(award.base).toBe(ARCADE_REWARD_TUNING.participationFloor);
    expect(award.participationFloorApplied).toBe(true);
  });

  it('applies the difficulty multiplier to the base only', () => {
    const easy = calculateTicketAward(fixed(8), result({ difficulty: 'easy' }));
    const hard = calculateTicketAward(fixed(8), result({ difficulty: 'hard' }));

    expect(easy.multiplier).toBe(1);
    expect(easy.total).toBe(8);
    expect(hard.multiplier).toBe(1.5);
    expect(hard.total).toBe(12);
  });

  it('adds each bonus once, and only when the context says so', () => {
    const all = calculateTicketAward(fixed(4), result({ difficulty: 'easy' }), {
      firstClearEver: true,
      firstPlayToday: true,
      newPersonalBest: true,
      rewardedRunsToday: 0,
    });

    expect(all.bonuses).toEqual({ firstClear: 10, dailyFirstPlay: 5, personalBest: 5 });
    expect(all.subtotal).toBe(4 + 10 + 5 + 5);
    expect(all.total).toBe(24);
    expect(all.capped).toBe(false);

    const none = calculateTicketAward(fixed(4), result({ difficulty: 'easy' }));
    expect(none.bonuses).toEqual({ firstClear: 0, dailyFirstPlay: 0, personalBest: 0 });
    expect(none.total).toBe(4);
    // Bonus lines only exist when they were earned.
    expect(none.breakdown.map((l) => l.label)).toEqual(['Clear']);
  });

  it('reports the cap honestly when the bonuses push past it', () => {
    const award = calculateTicketAward(fixed(8), result({ difficulty: 'easy' }), {
      firstClearEver: true,
      firstPlayToday: true,
      newPersonalBest: true,
      rewardedRunsToday: 0,
    });

    expect(award.subtotal).toBe(28);
    expect(award.total).toBe(ARCADE_REWARD_TUNING.hardCapPerRun);
    expect(award.capped).toBe(true);
    expect(award.breakdown.some((l) => l.label === 'Capped')).toBe(true);
  });

  it('never exceeds the hard cap, whatever a policy claims', () => {
    const award = calculateTicketAward(fixed(1000), result({ difficulty: 'hard' }));
    expect(award.total).toBe(ARCADE_REWARD_TUNING.hardCapPerRun);
    expect(award.capped).toBe(true);
  });

  it("honours a policy's own lower cap", () => {
    const award = calculateTicketAward(fixed(20, 6), result({ difficulty: 'easy' }));
    expect(award.total).toBe(6);
    expect(award.capped).toBe(true);
  });

  it('rejects a policy whose cap exceeds the shared hard cap', () => {
    const award = calculateTicketAward(
      fixed(5, ARCADE_REWARD_TUNING.hardCapPerRun + 1),
      result(),
    );
    expect(award.total).toBe(0);
    expect(award.rejected).toMatch(/hard cap/);
  });

  it('drops to participation only once the daily limit is reached', () => {
    const context = {
      ...EMPTY_REWARD_CONTEXT,
      firstClearEver: true,
      rewardedRunsToday: ARCADE_REWARD_TUNING.rewardedRunsPerGamePerDay,
    };
    const award = calculateTicketAward(fixed(12), result(), context);

    expect(award.dailyLimitReached).toBe(true);
    expect(award.total).toBe(ARCADE_REWARD_TUNING.participationFloor);
    expect(award.bonuses.firstClear).toBe(0);
    // The UI must be able to explain it.
    expect(award.breakdown[0].label).toBe('Daily bonus used up');
  });

  it('still rewards the last run before the daily limit', () => {
    const award = calculateTicketAward(fixed(12), result(), {
      ...EMPTY_REWARD_CONTEXT,
      rewardedRunsToday: ARCADE_REWARD_TUNING.rewardedRunsPerGamePerDay - 1,
    });
    expect(award.dailyLimitReached).toBe(false);
    expect(award.total).toBeGreaterThan(ARCADE_REWARD_TUNING.participationFloor);
  });

  it('pays nothing for an invalid result and says why', () => {
    const award = calculateTicketAward(fixed(10), result({ score: Number.NaN }));
    expect(award.total).toBe(0);
    expect(award.rejected).toMatch(/invalid result/);
    expect(award.breakdown).toEqual([]);
  });

  it("pays nothing when the result belongs to a different game", () => {
    const award = calculateTicketAward(fixed(10), result({ gameId: 'other-game' }));
    expect(award.total).toBe(0);
    expect(award.rejected).toMatch(/other-game/);
  });

  it('survives a policy that returns nonsense', () => {
    const broken: ArcadeRewardPolicy = {
      gameId: 'blobbi-dance',
      status: 'draft',
      base: () => Number.NaN,
      maxTicketsPerRun: 25,
    };
    const award = calculateTicketAward(broken, result({ difficulty: 'easy' }));
    expect(award.total).toBe(ARCADE_REWARD_TUNING.participationFloor);
    expect(award.rejected).toBeNull();

    const negative = { ...broken, base: () => -50 };
    expect(calculateTicketAward(negative, result({ difficulty: 'easy' })).total).toBe(
      ARCADE_REWARD_TUNING.participationFloor,
    );
  });

  it('is deterministic and carries the run identity through', () => {
    const a = calculateTicketAward(fixed(9), result());
    const b = calculateTicketAward(fixed(9), result());
    expect(a).toEqual(b);
    expect(a.runId).toBe('run-1');
    expect(a.gameId).toBe('blobbi-dance');
  });

  it('always produces a non-negative integer total', () => {
    for (const base of [0, 1, 3, 7, 15, 40]) {
      for (const difficulty of ['easy', 'normal', 'hard'] as const) {
        const award = calculateTicketAward(fixed(base), result({ difficulty }));
        expect(Number.isInteger(award.total)).toBe(true);
        expect(award.total).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('policy registry', () => {
  it('keeps every registered policy inside the shared hard cap', () => {
    for (const policy of arcadeRewardPolicies) {
      expect(policy.maxTicketsPerRun).toBeLessThanOrEqual(ARCADE_REWARD_TUNING.hardCapPerRun);
    }
  });

  it('keeps a normal-difficulty clear inside the target band, before bonuses', () => {
    const { min, max } = ARCADE_REWARD_TUNING.targetBand;

    for (const policy of arcadeRewardPolicies) {
      // Sweep the stat range a game could plausibly report.
      for (const accuracy of [0, 25, 50, 75, 100]) {
        const award = calculateTicketAward(
          policy,
          result({ gameId: policy.gameId, difficulty: 'normal', stats: { accuracy } }),
        );
        expect(award.base).toBeGreaterThanOrEqual(min);
        expect(award.base).toBeLessThanOrEqual(max);
      }
    }
  });

  it('registers no production-ready policy in this phase', () => {
    // Phase 2 grants nothing. A caller reaching for a live policy must get
    // nothing back rather than accidentally paying out.
    for (const policy of arcadeRewardPolicies) {
      expect(getProductionRewardPolicy(policy.gameId)).toBeUndefined();
    }
    expect(arcadeRewardPolicies.every((p) => p.status === 'draft')).toBe(true);
  });

  it('resolves the dance policy by id, and nothing for an unknown game', () => {
    expect(getRewardPolicy('blobbi-dance')).toBe(DANCE_REWARD_POLICY);
    expect(getRewardPolicy('not-a-game')).toBeUndefined();
  });

  it('gives the dance policy a base that rises with accuracy', () => {
    const at = (accuracy: number) =>
      DANCE_REWARD_POLICY.base(result({ stats: { accuracy } }));
    expect(at(0)).toBeLessThan(at(50));
    expect(at(50)).toBeLessThan(at(100));
    // A missing stat degrades to the bottom of the band, never to zero.
    expect(DANCE_REWARD_POLICY.base(result({ stats: {} }))).toBe(
      ARCADE_REWARD_TUNING.targetBand.min,
    );
  });
});
