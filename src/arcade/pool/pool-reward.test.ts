/**
 * Pool reward-policy tests.
 *
 * Written the way the dance and hockey policies' tests are: every bonus, the
 * cap, and every route to zero. The totals are PINNED on purpose, an economy
 * change must arrive as a deliberate edit here, not as a side effect.
 */
import { describe, it, expect } from 'vitest';

import {
  POOL_REWARD_POLICY,
  POOL_REWARD_TUNING,
  poolBaseTickets,
} from './pool-reward';
import { POOL_STAT_KEYS } from './pool-result';
import { calculateArcadeReward, calculateTicketAward } from '../reward-policy';
import type { ArcadeDifficulty, ArcadeGameResult } from '../types';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

function result(overrides: {
  won?: boolean;
  difficulty?: ArcadeDifficulty;
  completed?: boolean;
  legalEight?: boolean;
  scratches?: number;
  fouls?: number;
  earlyEightLoss?: boolean;
  extra?: Partial<ArcadeGameResult>;
} = {}): ArcadeGameResult {
  const {
    won = true,
    difficulty = 'normal',
    completed = true,
    legalEight = won,
    scratches = 0,
    fouls = 0,
    earlyEightLoss = false,
    extra = {},
  } = overrides;
  return {
    runId: 'run-1',
    gameId: 'blobbi-pool',
    machineId: 'arcade-pool-table',
    difficulty,
    cleared: won,
    score: won ? 7 : 3,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_240_000,
    stats: {
      [POOL_STAT_KEYS.won]: won ? 1 : 0,
      [POOL_STAT_KEYS.completedNaturally]: completed ? 1 : 0,
      [POOL_STAT_KEYS.durationMs]: 240_000,
      [POOL_STAT_KEYS.playerBalls]: won ? 7 : 3,
      [POOL_STAT_KEYS.opponentBalls]: won ? 4 : 7,
      [POOL_STAT_KEYS.playerShots]: 18,
      [POOL_STAT_KEYS.playerSuccessfulShots]: 9,
      [POOL_STAT_KEYS.playerScratches]: scratches,
      [POOL_STAT_KEYS.playerFouls]: fouls,
      [POOL_STAT_KEYS.longestPlayerRun]: 3,
      [POOL_STAT_KEYS.earlyEightLoss]: earlyEightLoss ? 1 : 0,
      [POOL_STAT_KEYS.legalEightFinish]: legalEight && won ? 1 : 0,
    },
    ...extra,
  };
}

const tickets = (overrides: Parameters<typeof result>[0] = {}) =>
  calculateArcadeReward({
    policy: POOL_REWARD_POLICY,
    result: result(overrides),
    itemAddress: TICKET_ADDRESS,
  });

describe('the policy is live and self-describing', () => {
  it('is active, flat, and versioned', () => {
    expect(POOL_REWARD_POLICY.status).toBe('active');
    expect(POOL_REWARD_POLICY.shape).toBe('flat');
    expect(POOL_REWARD_POLICY.policyId).toBe('blobbi-pool-tickets');
    expect(POOL_REWARD_POLICY.version).toBe(1);
    expect(POOL_REWARD_POLICY.gameId).toBe('blobbi-pool');
  });

  it('carries the CANONICAL Arcade Ticket address into the calculation', () => {
    expect(tickets().itemAddress).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket',
    );
  });

  it('never pays more than its own ceiling', () => {
    expect(POOL_REWARD_POLICY.maxTicketsPerRun).toBe(POOL_REWARD_TUNING.maxPerRun);
    expect(POOL_REWARD_TUNING.maxPerRun).toBe(8);
  });
});

describe('worked examples from the documented policy', () => {
  it('a clean legal-8 Normal win pays the maximum: 2 + 3 + 1 + 1 + 1 = 8', () => {
    const award = tickets();
    expect(award.quantity).toBe(8);
    expect(award.eligible).toBe(true);
  });

  it('a legal-8 Normal win with a scratch pays 2 + 3 + 1 + 1 = 7', () => {
    expect(tickets({ scratches: 1 }).quantity).toBe(7);
  });

  it("a clean Normal win off the rival's early 8-ball pays 2 + 3 + 1 + 1 = 7", () => {
    expect(tickets({ legalEight: false }).quantity).toBe(7);
  });

  it('a clean legal-8 Easy win pays 2 + 3 + 1 + 1 = 7; no difficulty bonus on Easy', () => {
    expect(tickets({ difficulty: 'easy' }).quantity).toBe(7);
  });

  it('a scrappy Easy win pays the minimum win: 2 + 3 = 5', () => {
    expect(tickets({ difficulty: 'easy', legalEight: false, scratches: 2, fouls: 1 }).quantity).toBe(
      5,
    );
  });

  it('a completed loss pays the participation floor of 2', () => {
    const award = tickets({ won: false });
    expect(award.quantity).toBe(2);
    expect(award.eligible).toBe(true);
  });

  it('losing on your own early 8-ball still pays the floor; never negative', () => {
    const award = tickets({ won: false, earlyEightLoss: true, scratches: 2, fouls: 3 });
    expect(award.quantity).toBe(2);
  });

  it('ignores frame duration, shots taken, and balls pocketed', () => {
    const grind = tickets({
      extra: {
        endedAt: 1_700_001_800_000,
        stats: {
          ...result().stats,
          [POOL_STAT_KEYS.playerShots]: 90,
          [POOL_STAT_KEYS.longestPlayerRun]: 7,
        },
      },
    });
    expect(grind.quantity).toBe(tickets().quantity);
  });
});

describe('every route to zero', () => {
  it('pays nothing for a frame that did not reach its natural end', () => {
    const award = tickets({ completed: false });
    expect(award.quantity).toBe(0);
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/did not reach its natural end/);
  });

  it('pays nothing for an invalid result, and says which field', () => {
    const award = calculateArcadeReward({
      policy: POOL_REWARD_POLICY,
      result: result({ extra: { score: Number.NaN } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.quantity).toBe(0);
    expect(award.ineligibleReason).toMatch(/score/);
  });

  it("pays nothing for another game's result", () => {
    const award = calculateArcadeReward({
      policy: POOL_REWARD_POLICY,
      result: result({ extra: { gameId: 'blobbi-air-hockey' } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/blobbi-air-hockey/);
  });

  it('pays nothing for a draft copy of the policy', () => {
    const draft = { ...POOL_REWARD_POLICY, status: 'draft' as const };
    const award = calculateArcadeReward({
      policy: draft,
      result: result(),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/no production reward policy/);
  });
});

describe('malformed and hostile inputs', () => {
  it('always pays a non-negative integer', () => {
    for (const overrides of [
      {},
      { won: false },
      { scratches: 9, fouls: 9 },
      { difficulty: 'easy' as const, legalEight: false },
    ]) {
      const award = tickets(overrides);
      expect(Number.isInteger(award.quantity)).toBe(true);
      expect(award.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats missing foul stats as "clean not earned", not as a refusal', () => {
    const bare: ArcadeGameResult = {
      ...result(),
      stats: { [POOL_STAT_KEYS.completedNaturally]: 1 },
    };
    expect(poolBaseTickets(bare)).toBe(
      POOL_REWARD_TUNING.participation +
        POOL_REWARD_TUNING.victory +
        POOL_REWARD_TUNING.normalDifficulty,
    );
  });

  it('caps a tuning mistake at the per-run maximum', () => {
    const generous = { ...POOL_REWARD_POLICY, base: () => 40 };
    const award = calculateTicketAward(generous, result());
    expect(award.total).toBe(POOL_REWARD_TUNING.maxPerRun);
    expect(award.capped).toBe(true);
  });
});

describe('the breakdown a player is shown', () => {
  it('explains the participation floor when the frame was lost', () => {
    expect(tickets({ won: false }).components.map((c) => c.label)).toEqual(['Participation']);
  });

  it('itemises a maximum win, and the lines add up to the total', () => {
    const award = tickets();
    expect(award.components.map((c) => c.label)).toEqual([
      'Completed frame',
      'Victory',
      'Normal rival',
      'Legal 8-ball finish',
      'Clean frame',
    ]);
    expect(award.components.reduce((sum, c) => sum + c.tickets, 0)).toBe(award.quantity);
  });

  it('drops the lines that were not earned', () => {
    const award = tickets({ difficulty: 'easy', legalEight: false, scratches: 1 });
    expect(award.components.map((c) => c.label)).toEqual(['Completed frame', 'Victory']);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same frame, every time', () => {
    expect(tickets({ scratches: 1 })).toEqual(tickets({ scratches: 1 }));
  });
});
