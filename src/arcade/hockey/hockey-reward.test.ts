/**
 * Air Hockey reward-policy tests.
 *
 * Written the way the dance policy's tests are: every bonus, both edges of the
 * margin tiers, the cap, and every route to zero. The totals are PINNED on
 * purpose: an economy change must arrive as a deliberate edit here, not as a
 * side effect.
 */
import { describe, it, expect } from 'vitest';

import {
  HOCKEY_REWARD_POLICY,
  HOCKEY_REWARD_TUNING,
  hockeyBaseTickets,
  marginTierTickets,
} from './hockey-reward';
import { HOCKEY_STAT_KEYS } from './hockey-result';
import { calculateArcadeReward, calculateTicketAward } from '../reward-policy';
import type { ArcadeDifficulty, ArcadeGameResult } from '../types';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

function result(overrides: {
  playerScore?: number;
  opponentScore?: number;
  difficulty?: ArcadeDifficulty;
  completed?: boolean;
  extra?: Partial<ArcadeGameResult>;
} = {}): ArcadeGameResult {
  const {
    playerScore = 7,
    opponentScore = 4,
    difficulty = 'normal',
    completed = true,
    extra = {},
  } = overrides;
  return {
    runId: 'run-1',
    gameId: 'blobbi-air-hockey',
    machineId: 'arcade-air-hockey',
    difficulty,
    cleared: playerScore > opponentScore,
    score: playerScore,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_150_000,
    stats: {
      [HOCKEY_STAT_KEYS.playerGoals]: playerScore,
      [HOCKEY_STAT_KEYS.opponentGoals]: opponentScore,
      [HOCKEY_STAT_KEYS.goalDifference]: playerScore - opponentScore,
      [HOCKEY_STAT_KEYS.targetGoals]: 7,
      [HOCKEY_STAT_KEYS.won]: playerScore > opponentScore ? 1 : 0,
      [HOCKEY_STAT_KEYS.completedNaturally]: completed ? 1 : 0,
      [HOCKEY_STAT_KEYS.durationMs]: 150_000,
    },
    ...extra,
  };
}

const tickets = (overrides: Parameters<typeof result>[0] = {}) =>
  calculateArcadeReward({
    policy: HOCKEY_REWARD_POLICY,
    result: result(overrides),
    itemAddress: TICKET_ADDRESS,
  });

describe('the policy is live and self-describing', () => {
  it('is active, flat, and versioned', () => {
    expect(HOCKEY_REWARD_POLICY.status).toBe('active');
    expect(HOCKEY_REWARD_POLICY.shape).toBe('flat');
    expect(HOCKEY_REWARD_POLICY.policyId).toBe('blobbi-air-hockey-tickets');
    expect(HOCKEY_REWARD_POLICY.version).toBe(1);
    expect(HOCKEY_REWARD_POLICY.gameId).toBe('blobbi-air-hockey');
  });

  it('carries the CANONICAL Arcade Ticket address into the calculation', () => {
    expect(tickets().itemAddress).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket',
    );
  });

  it('never pays more than its own ceiling', () => {
    expect(HOCKEY_REWARD_POLICY.maxTicketsPerRun).toBe(HOCKEY_REWARD_TUNING.maxPerRun);
    expect(HOCKEY_REWARD_TUNING.maxPerRun).toBe(8);
  });
});

describe('margin tiers: one tier, never cumulative', () => {
  it.each([
    [7, 2],
    [6, 1],
    [3, 1],
    [2, 0],
    [1, 0],
    [0, 0],
    [-3, 0],
  ])('a margin of %s earns %s tier tickets', (margin, expected) => {
    expect(marginTierTickets(margin)).toBe(expected);
  });
});

describe('worked examples from the documented policy', () => {
  it('a 7–0 Normal win pays the maximum: 2 + 3 + 1 + 2 = 8', () => {
    const award = tickets({ playerScore: 7, opponentScore: 0 });
    expect(award.quantity).toBe(8);
    expect(award.eligible).toBe(true);
  });

  it('a 7–3 Normal win pays 2 + 3 + 1 + 1 = 7', () => {
    expect(tickets({ playerScore: 7, opponentScore: 3 }).quantity).toBe(7);
  });

  it('a 7–5 Normal win pays 2 + 3 + 1 = 6', () => {
    expect(tickets({ playerScore: 7, opponentScore: 5 }).quantity).toBe(6);
  });

  it('a 7–5 Easy win pays 2 + 3 = 5; no difficulty bonus on Easy', () => {
    expect(tickets({ playerScore: 7, opponentScore: 5, difficulty: 'easy' }).quantity).toBe(5);
  });

  it('a completed loss pays the participation floor of 2, at any score', () => {
    for (const opponentScore of [7]) {
      for (const playerScore of [0, 3, 6]) {
        const award = tickets({ playerScore, opponentScore });
        expect(award.quantity).toBe(2);
        expect(award.eligible).toBe(true);
      }
    }
  });

  it('ignores match duration entirely', () => {
    const quick = tickets({ extra: { endedAt: 1_700_000_030_000 } });
    const slow = tickets({ extra: { endedAt: 1_700_000_900_000 } });
    expect(quick.quantity).toBe(slow.quantity);
  });
});

describe('every route to zero', () => {
  it('pays nothing for a match that did not reach its natural end', () => {
    const award = tickets({ playerScore: 7, opponentScore: 0, completed: false });
    expect(award.quantity).toBe(0);
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/did not reach its natural end/);
  });

  it('pays nothing for an invalid result, and says which field', () => {
    const award = calculateArcadeReward({
      policy: HOCKEY_REWARD_POLICY,
      result: result({ extra: { score: Number.NaN } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.quantity).toBe(0);
    expect(award.ineligibleReason).toMatch(/score/);
  });

  it("pays nothing for another game's result", () => {
    const award = calculateArcadeReward({
      policy: HOCKEY_REWARD_POLICY,
      result: result({ extra: { gameId: 'blobbi-dance' } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/blobbi-dance/);
  });

  it('pays nothing for a draft copy of the policy', () => {
    const draft = { ...HOCKEY_REWARD_POLICY, status: 'draft' as const };
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
  it('never pays a negative or fractional award', () => {
    for (const [playerScore, opponentScore] of [
      [7, 0],
      [7, 6],
      [0, 7],
      [1, 7],
    ] as const) {
      const award = tickets({ playerScore, opponentScore });
      expect(Number.isInteger(award.quantity)).toBe(true);
      expect(award.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats a missing margin stat as no margin bonus, not as a refusal', () => {
    const bare = result();
    const noMargin: ArcadeGameResult = {
      ...bare,
      stats: {
        [HOCKEY_STAT_KEYS.completedNaturally]: 1,
      },
    };
    expect(hockeyBaseTickets(noMargin)).toBe(
      HOCKEY_REWARD_TUNING.participation +
        HOCKEY_REWARD_TUNING.victory +
        HOCKEY_REWARD_TUNING.normalDifficulty,
    );
  });

  it('caps a tuning mistake at the per-run maximum', () => {
    const generous = { ...HOCKEY_REWARD_POLICY, base: () => 40 };
    const award = calculateTicketAward(generous, result({ playerScore: 7, opponentScore: 0 }));
    expect(award.total).toBe(HOCKEY_REWARD_TUNING.maxPerRun);
    expect(award.capped).toBe(true);
  });
});

describe('the breakdown a player is shown', () => {
  it('explains the participation floor when the match was lost', () => {
    expect(tickets({ playerScore: 3, opponentScore: 7 }).components.map((c) => c.label)).toEqual([
      'Participation',
    ]);
  });

  it('itemises a maximum win, and the lines add up to the total', () => {
    const award = tickets({ playerScore: 7, opponentScore: 0 });
    expect(award.components.map((c) => c.label)).toEqual([
      'Completed match',
      'Victory',
      'Normal opponent',
      'Shutout',
    ]);
    expect(award.components.reduce((sum, c) => sum + c.tickets, 0)).toBe(award.quantity);
  });

  it('drops the lines that were not earned', () => {
    const award = tickets({ playerScore: 7, opponentScore: 5, difficulty: 'easy' });
    expect(award.components.map((c) => c.label)).toEqual(['Completed match', 'Victory']);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same match, every time', () => {
    expect(tickets({ playerScore: 7, opponentScore: 2 })).toEqual(
      tickets({ playerScore: 7, opponentScore: 2 }),
    );
  });
});
