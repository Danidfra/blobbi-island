/**
 * Cross-game economy checks for Arcade V1.
 *
 * The three dedicated games pay from three separate policies, and nothing else
 * ties their numbers together — so this file does. It pins the documented
 * balance table and asserts the two properties the economy is tuned around:
 *
 *  1. **Equal ceilings.** No game's best run pays more than another's. The
 *     per-run maximum is 8 everywhere, well inside the shared hard cap of 25.
 *  2. **No dominant farm.** Tickets-per-minute for a TYPICAL result (using the
 *     catalogue's own duration estimates) must not differ by more than 2.5×
 *     between any two games. Not parity — pool takes longer and pays a little
 *     less per minute, dance is shorter and pays a little more — but no game
 *     may be "several times" the others.
 *
 * ## The balance table (Arcade V1, policies v1)
 *
 * | scenario | Dance (~68 s) | Air Hockey (~3 min) | Pool (~4 min) |
 * | --- | --- | --- | --- |
 * | weak completion / loss | 2 | 2 | 2 |
 * | average clear / Normal win | 4 (80%) | 6 (7–5) | 7 (legal 8, one foul) |
 * | strong Normal win | 6 (96%) | 7 (7–3) | 7 (clean, rival's early 8) |
 * | best realistic run | 8 (96% + full combo) | 8 (7–0 shutout) | 8 (clean legal 8) |
 *
 * These are PRODUCT numbers. Changing a policy is allowed — arriving here with
 * a failing pin and editing it deliberately is the intended workflow.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_REWARD_TUNING,
  arcadeRewardPolicies,
  calculateArcadeReward,
  getProductionRewardPolicy,
} from './reward-policy';
import { getCatalogueEntry } from './catalogue';
import type { ArcadeGameResult } from './types';
import { DANCE_STAT_KEYS } from './dance/dance-result';
import { HOCKEY_STAT_KEYS } from './hockey/hockey-result';
import { POOL_STAT_KEYS } from './pool/pool-result';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

function base(gameId: string, cleared: boolean): Omit<ArcadeGameResult, 'stats'> {
  return {
    runId: 'economy-run',
    gameId,
    machineId: 'economy-machine',
    difficulty: 'normal',
    cleared,
    score: 100,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_100_000,
  };
}

const dance = (accuracy: number, fullCombo: boolean): ArcadeGameResult => ({
  ...base('blobbi-dance', accuracy >= 60),
  stats: {
    [DANCE_STAT_KEYS.accuracy]: accuracy,
    [DANCE_STAT_KEYS.fullCombo]: fullCombo ? 1 : 0,
    [DANCE_STAT_KEYS.completedNaturally]: 1,
  },
});

const hockey = (playerGoals: number, opponentGoals: number): ArcadeGameResult => ({
  ...base('blobbi-air-hockey', playerGoals > opponentGoals),
  stats: {
    [HOCKEY_STAT_KEYS.playerGoals]: playerGoals,
    [HOCKEY_STAT_KEYS.opponentGoals]: opponentGoals,
    [HOCKEY_STAT_KEYS.goalDifference]: playerGoals - opponentGoals,
    [HOCKEY_STAT_KEYS.completedNaturally]: 1,
  },
});

const pool = (opts: {
  won: boolean;
  legalEight?: boolean;
  scratches?: number;
  fouls?: number;
}): ArcadeGameResult => ({
  ...base('blobbi-pool', opts.won),
  stats: {
    [POOL_STAT_KEYS.won]: opts.won ? 1 : 0,
    [POOL_STAT_KEYS.completedNaturally]: 1,
    [POOL_STAT_KEYS.legalEightFinish]: opts.legalEight ? 1 : 0,
    [POOL_STAT_KEYS.playerScratches]: opts.scratches ?? 0,
    [POOL_STAT_KEYS.playerFouls]: opts.fouls ?? 0,
  },
});

function pay(result: ArcadeGameResult): number {
  const policy = getProductionRewardPolicy(result.gameId);
  expect(policy, result.gameId).toBeDefined();
  return calculateArcadeReward({
    policy: policy!,
    result,
    itemAddress: TICKET_ADDRESS,
  }).quantity;
}

describe('the documented balance table holds', () => {
  it('pays every completed weak run the same floor: 2', () => {
    expect(pay(dance(40, false))).toBe(2);
    expect(pay(hockey(3, 7))).toBe(2);
    expect(pay(pool({ won: false }))).toBe(2);
  });

  it('pays the pinned average-result column', () => {
    expect(pay(dance(80, false))).toBe(4);
    expect(pay(hockey(7, 5))).toBe(6);
    expect(pay(pool({ won: true, legalEight: true, fouls: 1 }))).toBe(7);
  });

  it('pays the pinned strong-result column', () => {
    expect(pay(dance(96, false))).toBe(6);
    expect(pay(hockey(7, 3))).toBe(7);
    expect(pay(pool({ won: true, legalEight: false }))).toBe(7);
  });

  it('pays every best realistic run the same ceiling: 8', () => {
    expect(pay(dance(96, true))).toBe(8);
    expect(pay(hockey(7, 0))).toBe(8);
    expect(pay(pool({ won: true, legalEight: true }))).toBe(8);
  });
});

describe('economy invariants across all registered policies', () => {
  it('gives all three dedicated games an ACTIVE policy', () => {
    for (const gameId of ['blobbi-dance', 'blobbi-air-hockey', 'blobbi-pool']) {
      expect(getProductionRewardPolicy(gameId), gameId).toBeDefined();
    }
  });

  it('keeps every per-run ceiling equal, and far under the shared hard cap', () => {
    const caps = arcadeRewardPolicies
      .filter((p) => p.status === 'active')
      .map((p) => p.maxTicketsPerRun);
    expect(new Set(caps).size).toBe(1);
    const cap = caps[0]!;
    expect(cap).toBe(8);
    expect(cap).toBeLessThan(ARCADE_REWARD_TUNING.hardCapPerRun);
  });

  it('lets no game pay 2.5× more per minute than another for a typical result', () => {
    const typical: { gameId: string; tickets: number }[] = [
      { gameId: 'blobbi-dance', tickets: pay(dance(80, false)) },
      { gameId: 'blobbi-air-hockey', tickets: pay(hockey(7, 5)) },
      { gameId: 'blobbi-pool', tickets: pay(pool({ won: true, legalEight: true, fouls: 1 })) },
    ];
    const rates = typical.map(({ gameId, tickets }) => {
      const durationMs = getCatalogueEntry(gameId)?.estimatedDurationMs;
      expect(durationMs, gameId).toBeGreaterThan(0);
      return tickets / (durationMs! / 60_000);
    });
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThanOrEqual(2.5);
  });
});
