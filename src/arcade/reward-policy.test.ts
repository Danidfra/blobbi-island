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
  HOCKEY_REWARD_POLICY,
  POOL_REWARD_POLICY,
  arcadeRewardPolicies,
  calculateTicketAward,
  getProductionRewardPolicy,
  getRewardPolicy,
  type ArcadeRewardPolicy,
  type TicketAwardLine,
} from './reward-policy';
import { HOCKEY_STAT_KEYS } from './hockey/hockey-result';
import { POOL_STAT_KEYS } from './pool/pool-result';
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
  shape: ArcadeRewardPolicy['shape'] = 'scaled',
): ArcadeRewardPolicy => ({
  gameId: 'blobbi-dance',
  policyId: 'test-policy',
  version: 1,
  status: 'draft',
  shape,
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
      policyId: 'test-policy',
      version: 1,
      status: 'draft',
      shape: 'scaled',
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

  it('keeps every clear inside the band its shape promises', () => {
    const { min, max } = ARCADE_REWARD_TUNING.targetBand;

    for (const policy of arcadeRewardPolicies) {
      // Sweep the stat range a game could plausibly report.
      for (const accuracy of [0, 25, 50, 75, 100]) {
        const award = calculateTicketAward(
          policy,
          result({
            gameId: policy.gameId,
            difficulty: 'normal',
            stats: { accuracy, completedNaturally: 1 },
          }),
        );
        if (policy.shape === 'flat') {
          // A flat policy's ceiling IS its promise. The shared target band is a
          // statement about SCALED policies, whose base is then multiplied and
          // bonused; applying it to a policy that opts out of both would be
          // asserting a property nothing depends on.
          expect(award.total).toBeGreaterThanOrEqual(0);
          expect(award.total).toBeLessThanOrEqual(policy.maxTicketsPerRun);
        } else {
          expect(award.base).toBeGreaterThanOrEqual(min);
          expect(award.base).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('gives every registered policy an id and a version', () => {
    for (const policy of arcadeRewardPolicies) {
      expect(policy.policyId.length).toBeGreaterThan(0);
      expect(Number.isInteger(policy.version) && policy.version > 0).toBe(true);
    }
    // Policy ids must be unique, or a claim cannot say which policy paid it.
    const ids = arcadeRewardPolicies.map((p) => p.policyId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the dance policy as the production policy for its game', () => {
    // Phase 3 promotes exactly one policy. `getProductionRewardPolicy` is what
    // stops any other game from paying out by accident.
    expect(getProductionRewardPolicy('blobbi-dance')).toBe(DANCE_REWARD_POLICY);
    expect(getProductionRewardPolicy('not-a-game')).toBeUndefined();
    for (const policy of arcadeRewardPolicies) {
      if (policy.status !== 'active') {
        expect(getProductionRewardPolicy(policy.gameId)).toBeUndefined();
      }
    }
  });

  it('resolves the dance policy by id, and nothing for an unknown game', () => {
    expect(getRewardPolicy('blobbi-dance')).toBe(DANCE_REWARD_POLICY);
    expect(getRewardPolicy('not-a-game')).toBeUndefined();
  });
});

describe('flat policies', () => {
  const flatResult = () =>
    result({ difficulty: 'hard', stats: { accuracy: 100, completedNaturally: 1 } });

  it('ignores the difficulty multiplier', () => {
    const scaled = calculateTicketAward(fixed(6, 25, 'scaled'), flatResult());
    const flat = calculateTicketAward(fixed(6, 25, 'flat'), flatResult());

    expect(scaled.multiplier).toBe(1.5);
    expect(scaled.total).toBe(9);
    expect(flat.multiplier).toBe(1);
    expect(flat.total).toBe(6);
  });

  it('ignores the history bonuses, even when the context claims them', () => {
    const flat = calculateTicketAward(fixed(6, 25, 'flat'), flatResult(), {
      firstClearEver: true,
      firstPlayToday: true,
      newPersonalBest: true,
      rewardedRunsToday: 0,
    });
    expect(flat.bonuses).toEqual({ firstClear: 0, dailyFirstPlay: 0, personalBest: 0 });
    expect(flat.total).toBe(6);
  });

  it('still obeys the participation floor and the caps', () => {
    expect(calculateTicketAward(fixed(0, 25, 'flat'), flatResult()).total).toBe(
      ARCADE_REWARD_TUNING.participationFloor,
    );
    expect(calculateTicketAward(fixed(40, 8, 'flat'), flatResult()).total).toBe(8);
    expect(calculateTicketAward(fixed(40, 8, 'flat'), flatResult()).capped).toBe(true);
  });
});

describe('baseBreakdown validation — presentation can never misrepresent the reward', () => {
  /** A flat policy paying a fixed base, with a breakdown the test scripts. */
  const withBreakdown = (
    base: number,
    lines: readonly TicketAwardLine[],
  ): ArcadeRewardPolicy => ({
    ...fixed(base, 25, 'flat'),
    baseBreakdown: () => lines,
  });

  const FALLBACK = (base: number) => [{ label: 'Clear', tickets: base }];

  it('uses a valid multi-line breakdown verbatim', () => {
    const lines: TicketAwardLine[] = [
      { label: 'Completed', tickets: 2 },
      { label: 'Victory', tickets: 3 },
      { label: 'Margin', tickets: 1, detail: 'won by 4' },
    ];
    const award = calculateTicketAward(withBreakdown(6, lines), result());
    expect(award.breakdown).toEqual(lines);
    expect(award.total).toBe(6);
  });

  it('falls back to the single Clear line for a negative ticket line', () => {
    const award = calculateTicketAward(
      withBreakdown(6, [
        { label: 'Generous', tickets: 8 },
        { label: 'Deduction', tickets: -2 },
      ]),
      result(),
    );
    expect(award.breakdown).toEqual(FALLBACK(6));
  });

  it('falls back for an empty or whitespace-only label', () => {
    expect(
      calculateTicketAward(withBreakdown(6, [{ label: '', tickets: 6 }]), result()).breakdown,
    ).toEqual(FALLBACK(6));
    expect(
      calculateTicketAward(withBreakdown(6, [{ label: '   ', tickets: 6 }]), result()).breakdown,
    ).toEqual(FALLBACK(6));
  });

  it('falls back for duplicate labels, including whitespace-disguised duplicates', () => {
    expect(
      calculateTicketAward(
        withBreakdown(6, [
          { label: 'Victory', tickets: 3 },
          { label: 'Victory', tickets: 3 },
        ]),
        result(),
      ).breakdown,
    ).toEqual(FALLBACK(6));
    expect(
      calculateTicketAward(
        withBreakdown(6, [
          { label: 'Victory', tickets: 3 },
          { label: ' Victory ', tickets: 3 },
        ]),
        result(),
      ).breakdown,
    ).toEqual(FALLBACK(6));
  });

  it('falls back for a non-integer ticket line', () => {
    const award = calculateTicketAward(
      withBreakdown(6, [
        { label: 'Half', tickets: 3.5 },
        { label: 'Other half', tickets: 2.5 },
      ]),
      result(),
    );
    expect(award.breakdown).toEqual(FALLBACK(6));
  });

  it('falls back when the lines do not sum to the base', () => {
    expect(
      calculateTicketAward(withBreakdown(6, [{ label: 'Modest', tickets: 1 }]), result()).breakdown,
    ).toEqual(FALLBACK(6));
    expect(
      calculateTicketAward(withBreakdown(6, [{ label: 'Inflated', tickets: 100 }]), result())
        .breakdown,
    ).toEqual(FALLBACK(6));
  });

  it('never lets an invalid breakdown change the quantity actually paid', () => {
    const invalid: readonly (readonly TicketAwardLine[])[] = [
      [{ label: 'Inflated', tickets: 100 }],
      [{ label: '', tickets: 6 }],
      [
        { label: 'A', tickets: 8 },
        { label: 'B', tickets: -2 },
      ],
      [
        { label: 'X', tickets: 3 },
        { label: 'X', tickets: 3 },
      ],
      [{ label: 'Half', tickets: 6.5 }],
      [],
    ];
    for (const lines of invalid) {
      const award = calculateTicketAward(withBreakdown(6, lines), result());
      expect(award.total, JSON.stringify(lines)).toBe(6);
      expect(award.base, JSON.stringify(lines)).toBe(6);
    }
    // And a VALID one pays exactly the same number — the lines are words only.
    expect(
      calculateTicketAward(
        withBreakdown(6, [
          { label: 'A', tickets: 2 },
          { label: 'B', tickets: 4 },
        ]),
        result(),
      ).total,
    ).toBe(6);
  });

  it('accepts the shipped Hockey breakdown unchanged', () => {
    const award = calculateTicketAward(HOCKEY_REWARD_POLICY, {
      ...result({ gameId: 'blobbi-air-hockey' }),
      stats: {
        [HOCKEY_STAT_KEYS.goalDifference]: 7,
        [HOCKEY_STAT_KEYS.completedNaturally]: 1,
      },
    });
    expect(award.breakdown.map((l) => l.label)).toEqual([
      'Completed match',
      'Victory',
      'Normal opponent',
      'Shutout',
    ]);
    expect(award.breakdown.reduce((sum, l) => sum + l.tickets, 0)).toBe(award.total);
  });

  it('accepts the shipped Pool breakdown unchanged', () => {
    const award = calculateTicketAward(POOL_REWARD_POLICY, {
      ...result({ gameId: 'blobbi-pool' }),
      stats: {
        [POOL_STAT_KEYS.completedNaturally]: 1,
        [POOL_STAT_KEYS.legalEightFinish]: 1,
        [POOL_STAT_KEYS.playerScratches]: 0,
        [POOL_STAT_KEYS.playerFouls]: 0,
      },
    });
    expect(award.breakdown.map((l) => l.label)).toEqual([
      'Completed frame',
      'Victory',
      'Normal rival',
      'Legal 8-ball finish',
      'Clean frame',
    ]);
    expect(award.breakdown.reduce((sum, l) => sum + l.tickets, 0)).toBe(award.total);
  });
});

describe("a policy's own eligibility rule", () => {
  it('refuses before any arithmetic, and says why', () => {
    const refusing: ArcadeRewardPolicy = {
      ...fixed(8),
      ineligible: () => 'the run did not reach the end of the song',
    };
    const award = calculateTicketAward(refusing, result());
    expect(award.total).toBe(0);
    expect(award.rejected).toMatch(/did not reach the end/);
    expect(award.breakdown).toEqual([]);
  });

  it('is skipped when it returns null', () => {
    const allowing: ArcadeRewardPolicy = { ...fixed(8), ineligible: () => null };
    expect(calculateTicketAward(allowing, result({ difficulty: 'easy' })).total).toBe(8);
  });
});
