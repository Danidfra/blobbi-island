/**
 * Dance reward-policy tests.
 *
 * This is the first policy in the arcade that can actually pay, so the tests are
 * written the way an economy's tests should be: every tier, both edges of every
 * threshold, the cap, and — most importantly — every route to ZERO.
 */
import { describe, it, expect } from 'vitest';

import {
  DANCE_REWARD_POLICY,
  DANCE_REWARD_TUNING,
  accuracyTierTickets,
  danceBaseTickets,
} from './dance-reward';
import { DANCE_STAT_KEYS } from './dance-result';
import { calculateArcadeReward, calculateTicketAward } from '../reward-policy';
import type { ArcadeGameResult } from '../types';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

function result(overrides: {
  accuracy?: number;
  fullCombo?: boolean;
  completed?: boolean;
  extra?: Partial<ArcadeGameResult>;
} = {}): ArcadeGameResult {
  const {
    accuracy = 90,
    fullCombo = false,
    completed = true,
    extra = {},
  } = overrides;
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    difficulty: 'normal',
    cleared: completed && accuracy >= 60,
    score: 100_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_068_000,
    stats: {
      [DANCE_STAT_KEYS.accuracy]: accuracy,
      [DANCE_STAT_KEYS.fullCombo]: fullCombo ? 1 : 0,
      [DANCE_STAT_KEYS.completedNaturally]: completed ? 1 : 0,
      [DANCE_STAT_KEYS.maxCombo]: 100,
    },
    ...extra,
  };
}

const tickets = (overrides: Parameters<typeof result>[0] = {}) =>
  calculateArcadeReward({
    policy: DANCE_REWARD_POLICY,
    result: result(overrides),
    itemAddress: TICKET_ADDRESS,
  });

describe('the policy is live and self-describing', () => {
  it('is active, flat, and versioned', () => {
    expect(DANCE_REWARD_POLICY.status).toBe('active');
    expect(DANCE_REWARD_POLICY.shape).toBe('flat');
    expect(DANCE_REWARD_POLICY.policyId).toBe('blobbi-dance-tickets');
    expect(DANCE_REWARD_POLICY.version).toBe(1);
    expect(DANCE_REWARD_POLICY.gameId).toBe('blobbi-dance');
  });

  it('carries the CANONICAL Arcade Ticket address into the calculation', () => {
    expect(tickets().itemAddress).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket',
    );
  });

  it('reports the policy id and version on every calculation', () => {
    expect(tickets()).toMatchObject({
      policyId: 'blobbi-dance-tickets',
      policyVersion: 1,
      gameId: 'blobbi-dance',
      runId: 'run-1',
    });
  });

  it('never pays more than its own ceiling', () => {
    expect(DANCE_REWARD_POLICY.maxTicketsPerRun).toBe(DANCE_REWARD_TUNING.maxPerRun);
    expect(DANCE_REWARD_TUNING.maxPerRun).toBe(8);
  });

  it('is emphatically not one ticket per point', () => {
    // A perfect run scores six figures. If the reward tracked the score, this
    // would be six figures too.
    expect(tickets({ accuracy: 100, fullCombo: true }).quantity).toBeLessThanOrEqual(8);
  });
});

describe('accuracy tiers — one tier, never cumulative', () => {
  it.each([
    [100, 4],
    [95, 4],
    [94.9, 3],
    [88, 3],
    [87.9, 2],
    [75, 2],
    [74.9, 1],
    [60, 1],
    [59.9, 0],
    [0, 0],
  ])('%s%% accuracy earns %s tier tickets', (accuracy, expected) => {
    expect(accuracyTierTickets(accuracy)).toBe(expected);
  });

  it('adds the tiers to participation rather than stacking them on each other', () => {
    // 95% would be 1+2+3+4 = 10 if the tiers were cumulative; it is 4.
    expect(danceBaseTickets(result({ accuracy: 95 }))).toBe(
      DANCE_REWARD_TUNING.participation + 4,
    );
  });
});

describe('worked examples from the documented policy', () => {
  it('96% with a full combo pays the maximum: 2 + 4 + 2 = 8', () => {
    const award = tickets({ accuracy: 96, fullCombo: true });
    expect(award.quantity).toBe(8);
    expect(award.eligible).toBe(true);
  });

  it('96% with one miss pays 2 + 4 = 6', () => {
    expect(tickets({ accuracy: 96, fullCombo: false }).quantity).toBe(6);
  });

  it('80% pays 2 + 2 = 4', () => {
    expect(tickets({ accuracy: 80 }).quantity).toBe(4);
  });

  it('61% pays 2 + 1 = 3', () => {
    expect(tickets({ accuracy: 61 }).quantity).toBe(3);
  });

  it('40% pays the participation floor of 2 — the run finished, it just did not clear', () => {
    const award = tickets({ accuracy: 40 });
    expect(award.quantity).toBe(DANCE_REWARD_TUNING.participation);
    expect(award.eligible).toBe(true);
  });

  it('0% still pays 2 for finishing', () => {
    expect(tickets({ accuracy: 0 }).quantity).toBe(2);
  });

  it('never pays below the minimum for a completed valid run', () => {
    for (const accuracy of [0, 12.5, 33, 59.9, 60, 74.9, 88, 95, 100]) {
      const award = tickets({ accuracy });
      expect(award.quantity).toBeGreaterThanOrEqual(DANCE_REWARD_TUNING.participation);
      expect(award.quantity).toBeLessThanOrEqual(DANCE_REWARD_TUNING.maxPerRun);
    }
  });
});

describe('every route to zero', () => {
  it('pays nothing for a run that did not reach the end of the song', () => {
    const award = tickets({ accuracy: 100, fullCombo: true, completed: false });
    expect(award.quantity).toBe(0);
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/did not reach the end/);
  });

  it('pays nothing for an unusable accuracy', () => {
    expect(tickets({ accuracy: 500 }).eligible).toBe(false);
    expect(tickets({ accuracy: 500 }).ineligibleReason).toMatch(/unusable accuracy/);
  });

  it('pays nothing for an invalid result, and says which field', () => {
    const award = calculateArcadeReward({
      policy: DANCE_REWARD_POLICY,
      result: result({ extra: { score: Number.NaN } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.quantity).toBe(0);
    expect(award.ineligibleReason).toMatch(/score/);
  });

  it("pays nothing for another game's result", () => {
    const award = calculateArcadeReward({
      policy: DANCE_REWARD_POLICY,
      result: result({ extra: { gameId: 'blobbi-pool' } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/blobbi-pool/);
  });

  it('pays nothing without an item address to pay into', () => {
    const award = calculateArcadeReward({
      policy: DANCE_REWARD_POLICY,
      result: result(),
      itemAddress: '  ',
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/item address/);
  });

  it('pays nothing for a draft policy, even one that would otherwise qualify', () => {
    const draft = { ...DANCE_REWARD_POLICY, status: 'draft' as const };
    const award = calculateArcadeReward({
      policy: draft,
      result: result(),
      itemAddress: TICKET_ADDRESS,
    });
    expect(award.eligible).toBe(false);
    expect(award.ineligibleReason).toMatch(/no production reward policy/);
  });
});

describe('the breakdown a player is shown', () => {
  it('explains the participation floor when a run did not clear', () => {
    expect(tickets({ accuracy: 40 }).components.map((c) => c.label)).toEqual(['Participation']);
  });

  it('shows a single Clear line for a flat policy — no phantom difficulty bonus', () => {
    const award = tickets({ accuracy: 96, fullCombo: true });
    expect(award.components.map((c) => c.label)).toEqual(['Clear']);
    expect(award.components[0].tickets).toBe(8);
    expect(award.award.bonuses).toEqual({ firstClear: 0, dailyFirstPlay: 0, personalBest: 0 });
    expect(award.award.multiplier).toBe(1);
  });

  it('reports the cap that was in force whether or not it bit', () => {
    expect(tickets({ accuracy: 96, fullCombo: true }).cap).toBe(8);
    expect(tickets({ accuracy: 96, fullCombo: true }).capApplied).toBe(false);
  });

  it('applies the cap if the tuning ever over-pays', () => {
    const generous = { ...DANCE_REWARD_POLICY, base: () => 40 };
    const award = calculateTicketAward(generous, result({ accuracy: 96 }));
    expect(award.total).toBe(DANCE_REWARD_TUNING.maxPerRun);
    expect(award.capped).toBe(true);
  });
});

describe('determinism', () => {
  it('gives the same answer for the same run, every time', () => {
    expect(tickets({ accuracy: 88, fullCombo: true })).toEqual(
      tickets({ accuracy: 88, fullCombo: true }),
    );
  });

  it('reads no clock — a result from 2020 pays the same as one from today', () => {
    const old = calculateArcadeReward({
      policy: DANCE_REWARD_POLICY,
      result: result({ extra: { startedAt: 1_580_000_000_000, endedAt: 1_580_000_068_000 } }),
      itemAddress: TICKET_ADDRESS,
    });
    expect(old.quantity).toBe(tickets().quantity);
  });
});
