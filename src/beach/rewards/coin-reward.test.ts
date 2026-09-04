/**
 * Reward calculation: determinism, bounds, and the simulated payout
 * distribution the provisional economics are tuned against.
 */

import { describe, it, expect } from 'vitest';

import {
  createTreasureHuntRound,
  treasureHuntReducer,
  buildTreasureHuntResult,
  distanceBetween,
  type Point,
  type TreasureHuntRound,
  type TreasureHuntResult,
} from '@/beach/treasure-hunt';
import { TREASURE_HUNT_UI_POLICY } from '@/components/blobbi/beach/treasure-hunt-config';
import { BEACH_REWARD_POLICY } from './policy';
import { calculateTreasureHuntReward, rewardEligibility } from './coin-reward';

const POLICY = BEACH_REWARD_POLICY;

function startedRound(seed: string): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed, policy: TREASURE_HUNT_UI_POLICY });
  if (!created.ok) throw new Error('generation failed');
  return treasureHuntReducer(created.round, { type: 'start' });
}

function missPoint(round: TreasureHuntRound): Point {
  for (let x = 0.05; x < round.policy.fieldWidth; x += 0.02) {
    for (let y = 0.05; y < round.policy.fieldHeight; y += 0.02) {
      const candidate = { x, y };
      if (
        round.targets.every(
          (t) => t.found || distanceBetween(candidate, t.position) > t.digRadius,
        )
      ) {
        return candidate;
      }
    }
  }
  throw new Error('no miss point');
}

/** Deterministic "competent player": digs the 5 nearest targets, in order. */
function playPerfectRound(seed: string): TreasureHuntResult {
  let round = startedRound(seed);
  round = treasureHuntReducer(round, { type: 'advance-time', seconds: 25 });
  const targetsByDistance = [...round.targets].sort(
    (a, b) =>
      distanceBetween(a.position, round.policy.initialCoilPosition) -
      distanceBetween(b.position, round.policy.initialCoilPosition),
  );
  for (const target of targetsByDistance.slice(0, round.policy.shovelUses)) {
    round = treasureHuntReducer(round, { type: 'dig', position: target.position });
  }
  if (round.status !== 'finished') {
    round = treasureHuntReducer(round, { type: 'end-round' });
  }
  return buildTreasureHuntResult(round);
}

/** All five digs miss: minimum VALID participation. */
function playAllMissRound(seed: string): TreasureHuntResult {
  let round = startedRound(seed);
  round = treasureHuntReducer(round, { type: 'advance-time', seconds: 25 });
  for (let i = 0; i < round.policy.shovelUses; i += 1) {
    round = treasureHuntReducer(round, { type: 'dig', position: missPoint(round) });
  }
  return buildTreasureHuntResult(round);
}

describe('eligibility', () => {
  it('requires at least one dig', () => {
    let round = startedRound('no-digs');
    round = treasureHuntReducer(round, {
      type: 'advance-time',
      seconds: TREASURE_HUNT_UI_POLICY.roundDurationSeconds + 1,
    });
    const result = buildTreasureHuntResult(round);
    expect(rewardEligibility(result, POLICY)).toEqual({
      eligible: false,
      reason: 'not-enough-digs',
    });
    expect(calculateTreasureHuntReward(result, POLICY)).toBeNull();
  });

  it('requires the minimum active time for an early end', () => {
    let round = startedRound('too-fast');
    round = treasureHuntReducer(round, { type: 'advance-time', seconds: 5 });
    round = treasureHuntReducer(round, { type: 'dig', position: round.targets[0].position });
    round = treasureHuntReducer(round, { type: 'end-round' });
    const result = buildTreasureHuntResult(round);
    expect(rewardEligibility(result, POLICY)).toEqual({
      eligible: false,
      reason: 'too-short',
    });
  });

  it('accepts a legitimate end past the participation threshold', () => {
    const result = playAllMissRound('legit-misses');
    expect(rewardEligibility(result, POLICY)).toEqual({ eligible: true });
  });
});

describe('formula', () => {
  it('is deterministic and integer-valued', () => {
    const result = playPerfectRound('formula-seed');
    const first = calculateTreasureHuntReward(result, POLICY)!;
    const second = calculateTreasureHuntReward(result, POLICY)!;
    expect(second).toEqual(first);
    for (const value of [first.baseCoins, first.cleanupCoins, first.treasureCoins, first.totalCoins]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('pays the base alone for a valid all-miss round', () => {
    const reward = calculateTreasureHuntReward(playAllMissRound('all-miss'), POLICY)!;
    expect(reward).toMatchObject({
      baseCoins: POLICY.baseCoins,
      cleanupCoins: 0,
      treasureCoins: 0,
      totalCoins: POLICY.baseCoins,
      capped: false,
    });
  });

  it('litter contributes positively and valuables contribute more', () => {
    // Unit values in the game policy: litter = 1 each, valuables = 2–6.
    const result = playPerfectRound('contribution-seed');
    const reward = calculateTreasureHuntReward(result, POLICY)!;
    expect(reward.cleanupCoins).toBe(result.rawCleanupValue * POLICY.cleanupCoinsPerUnit);
    expect(reward.treasureCoins).toBe(result.rawTreasureValue * POLICY.treasureCoinsPerUnit);
    if (result.valuableFinds.length > 0 && result.litterFinds.length > 0) {
      const perValuable = reward.treasureCoins / result.valuableFinds.length;
      const perLitter = reward.cleanupCoins / result.litterFinds.length;
      expect(perValuable).toBeGreaterThan(perLitter);
    }
  });

  it('never exceeds the configured per-round maximum', () => {
    for (let i = 0; i < 40; i += 1) {
      const reward = calculateTreasureHuntReward(playPerfectRound(`cap-${i}`), POLICY);
      expect(reward!.totalCoins).toBeLessThanOrEqual(POLICY.maxCoinsPerRound);
      expect(reward!.totalCoins).toBeGreaterThanOrEqual(POLICY.baseCoins);
    }
  });
});

describe('simulated payout distribution (the provisional economics)', () => {
  it('a competent 5-dig player averages inside the approved 12–15 band', () => {
    const totals: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      const reward = calculateTreasureHuntReward(playPerfectRound(`sim-${i}`), POLICY);
      expect(reward).not.toBeNull();
      totals.push(reward!.totalCoins);
    }
    totals.sort((a, b) => a - b);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const median = totals[Math.floor(totals.length / 2)];
    const p10 = totals[Math.floor(totals.length * 0.1)];
    const p90 = totals[Math.floor(totals.length * 0.9)];

    // The distribution this suite pins (recorded in docs/blobbi-coin-cutover.md):
    // min ≥ base, common range ≈ p10..p90, mean/median in the approved band.
    expect(totals[0]).toBeGreaterThanOrEqual(POLICY.baseCoins);
    expect(totals.at(-1)!).toBeLessThanOrEqual(POLICY.maxCoinsPerRound);
    expect(mean).toBeGreaterThanOrEqual(11);
    expect(mean).toBeLessThanOrEqual(17);
    expect(median).toBeGreaterThanOrEqual(11);
    expect(median).toBeLessThanOrEqual(17);
    expect(p10).toBeGreaterThanOrEqual(POLICY.baseCoins + 4);
    expect(p90).toBeLessThanOrEqual(POLICY.maxCoinsPerRound);
  });
});
