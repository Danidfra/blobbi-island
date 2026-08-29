/**
 * The Mine policy — parity with the pre-extraction behaviour, then the
 * guardrails layered on top.
 *
 * The first block is the important one: it pins the numbers that used to live
 * inside `MiningGame.tsx` against a REFERENCE implementation of the original
 * cascading thresholds, reproduced verbatim below. Extraction is only safe if
 * it changed nothing, and "nothing" has to be checkable rather than asserted.
 */

import { describe, it, expect } from 'vitest';

import { officialItemByD } from '@/protocol/event-registry';
import { COIN_PRICES } from '@/inventory/shop-catalog';

import {
  MINE_COIN_PER_ENERGY,
  MINE_DAILY_COIN_CAP,
  MINE_ENERGY_PER_DIG,
  MINE_EXPECTED_COINS_PER_DIG,
  MINE_GEM_TABLE,
  MINE_MIN_ENERGY,
  capMineReward,
  expectedCoinsForEnergy,
  mineGem,
  mineRewardBudget,
  mineRewardWindowKey,
  mineRewardWindowResetAt,
  mineRunReward,
  rewardedDigsForEnergy,
  rollMineGem,
  type MineGemKind,
} from './policy';

/**
 * The ORIGINAL drop logic, copied from the pre-policy component. Kept here
 * only so the extraction can be proven equivalent rather than trusted.
 */
function originalRoll(random: number): MineGemKind {
  if (random < 0.05) return 'gem-3';
  if (random < 0.15) return 'gem-2';
  if (random < 0.3) return 'gem-1';
  return 'stone';
}

/** The original inline value table. */
const ORIGINAL_VALUES: Record<MineGemKind, number> = {
  stone: 1,
  'gem-1': 10,
  'gem-2': 25,
  'gem-3': 50,
};

describe('parity with the pre-extraction Mine', () => {
  it('every gem keeps its value', () => {
    for (const kind of Object.keys(ORIGINAL_VALUES) as MineGemKind[]) {
      expect(mineGem(kind).value).toBe(ORIGINAL_VALUES[kind]);
    }
  });

  it('the drop table reproduces the original thresholds exactly', () => {
    // Sweep the whole unit interval finely, plus every boundary and the value
    // immediately below it — a shifted threshold shows up as an inequality
    // flip precisely there.
    const probes = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) probes.add(i / 10_000);
    for (const edge of [0, 0.05, 0.15, 0.3, 0.999999]) {
      probes.add(edge);
      probes.add(Math.max(0, edge - Number.EPSILON));
    }
    for (const roll of probes) {
      expect(rollMineGem(roll), `roll ${roll}`).toBe(originalRoll(roll));
    }
  });

  it('the weights are the original probabilities and sum to one', () => {
    const byKind = Object.fromEntries(MINE_GEM_TABLE.map((g) => [g.kind, g.weight]));
    expect(byKind['gem-3']).toBeCloseTo(0.05, 10);
    expect(byKind['gem-2']).toBeCloseTo(0.1, 10);
    expect(byKind['gem-1']).toBeCloseTo(0.15, 10);
    expect(byKind.stone).toBeCloseTo(0.7, 10);
    const total = MINE_GEM_TABLE.reduce((sum, g) => sum + g.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('a dig costs 10 energy and the run ends at 20', () => {
    expect(MINE_ENERGY_PER_DIG).toBe(10);
    expect(MINE_MIN_ENERGY).toBe(20);
  });

  it('expected value per rewarded dig is 7.2 Coins', () => {
    expect(MINE_EXPECTED_COINS_PER_DIG).toBeCloseTo(7.2, 10);
    expect(MINE_COIN_PER_ENERGY).toBeCloseTo(0.72, 10);
  });

  it('a full 100-energy run is 7 rewarded digs, ~50 Coins expected', () => {
    // 100→90→80→70→60→50→40→30 pay; the dig that lands on 20 ends the run and
    // pays nothing. That last unrewarded dig is the original stop condition.
    expect(rewardedDigsForEnergy(100)).toBe(7);
    expect(expectedCoinsForEnergy(100)).toBeCloseTo(50.4, 10);
  });

  it('counts rewarded digs correctly at and below the floor', () => {
    expect(rewardedDigsForEnergy(20)).toBe(0);
    expect(rewardedDigsForEnergy(21)).toBe(0); // 21→11 ends it, unrewarded
    expect(rewardedDigsForEnergy(31)).toBe(1);
    expect(rewardedDigsForEnergy(0)).toBe(0);
    expect(rewardedDigsForEnergy(-5)).toBe(0);
  });
});

describe('a deterministic set of finds pays a deterministic reward', () => {
  it('sums the gem table, nothing else', () => {
    expect(mineRunReward(['gem-3', 'gem-1', 'stone', 'stone'])).toBe(50 + 10 + 1 + 1);
    expect(mineRunReward([])).toBe(0);
    expect(mineRunReward(['gem-2', 'gem-2'])).toBe(50);
  });

  it('refuses an unknown gem rather than silently paying zero', () => {
    expect(() => mineRunReward(['diamond' as MineGemKind])).toThrow(/Unknown mine gem/);
  });
});

describe('the daily ceiling', () => {
  it('is 200 — about four full-energy runs, and never clips a normal one', () => {
    expect(MINE_DAILY_COIN_CAP).toBe(200);
    // One full run is far below the cap, so ordinary play never meets it.
    expect(expectedCoinsForEnergy(100)).toBeLessThan(MINE_DAILY_COIN_CAP / 3);
    // Even a maximally lucky full run stays under it.
    const luckiestRun = rewardedDigsForEnergy(100) * mineGem('gem-3').value;
    expect(luckiestRun).toBeGreaterThan(MINE_DAILY_COIN_CAP);
    // ...though that requires seven 5% rolls in a row, so the *expected*
    // number of runs before the cap binds is four, not one.
    expect(MINE_DAILY_COIN_CAP / expectedCoinsForEnergy(100)).toBeGreaterThan(3.9);
  });

  it('trims a payout to what is left, and says that it did', () => {
    expect(capMineReward(50, 200)).toEqual({ coinReward: 50, capped: false });
    expect(capMineReward(50, 30)).toEqual({ coinReward: 30, capped: true });
    expect(capMineReward(50, 0)).toEqual({ coinReward: 0, capped: true });
    expect(capMineReward(0, 0)).toEqual({ coinReward: 0, capped: false });
  });

  it('never produces a negative or fractional reward', () => {
    expect(capMineReward(-10, 100)).toEqual({ coinReward: 0, capped: false });
    expect(capMineReward(12.9, 100).coinReward).toBe(12);
    expect(capMineReward(100, -5)).toEqual({ coinReward: 0, capped: true });
  });

  it('reports the budget from an awarded total', () => {
    const budget = mineRewardBudget(60, Date.UTC(2026, 7, 28, 12));
    expect(budget).toMatchObject({ cap: 200, awarded: 60, remaining: 140 });
    expect(mineRewardBudget(500, 0).remaining).toBe(0);
  });
});

describe('the daily window is UTC', () => {
  it('keys by UTC calendar day, not local time', () => {
    // 23:30 UTC and 00:30 UTC the next day are different windows even though
    // they are minutes apart.
    expect(mineRewardWindowKey(Date.UTC(2026, 7, 28, 23, 30))).toBe('2026-08-28');
    expect(mineRewardWindowKey(Date.UTC(2026, 7, 29, 0, 30))).toBe('2026-08-29');
  });

  it('resets at the next UTC midnight', () => {
    const noon = Date.UTC(2026, 7, 28, 12);
    expect(mineRewardWindowResetAt(noon)).toBe(Date.UTC(2026, 7, 29));
    // The instant of reset already belongs to the new window.
    expect(mineRewardWindowKey(mineRewardWindowResetAt(noon))).toBe('2026-08-29');
  });
});

/**
 * The arbitrage check.
 *
 * If any purchasable item returned more Coins of mining than it cost, the Mine
 * would be an infinite faucet regardless of any daily cap — buy, mine, repeat.
 * This asserts the loop is closed at CURRENT production prices and effects,
 * and it fails if a future price cut or effect buff opens it.
 */
describe('no energy refill pays for itself', () => {
  const refills = COIN_PRICES.map((entry) => {
    const item = officialItemByD(entry.d);
    return {
      d: entry.d,
      coins: entry.coins,
      energy: item?.effects.energy ?? 0,
    };
  }).filter((entry) => entry.energy > 0);

  it('finds the energy-restoring items to check', () => {
    expect(refills.length).toBeGreaterThan(0);
    // The Energy Drink is the best rate on offer and the one to watch.
    expect(refills.some((r) => r.d === 'blobbi:energy:drink')).toBe(true);
  });

  it.each(
    COIN_PRICES.map((entry) => ({
      d: entry.d,
      coins: entry.coins,
      energy: officialItemByD(entry.d)?.effects.energy ?? 0,
    })).filter((entry) => entry.energy > 0),
  )('$d returns less than it costs', ({ coins, energy }) => {
    // The generous ceiling: assume every restored point becomes a rewarded
    // dig at full expected value, ignoring the unusable tail below the floor.
    const bestCaseReturn = energy * MINE_COIN_PER_ENERGY;
    expect(bestCaseReturn).toBeLessThan(coins);
  });

  it('states the margin explicitly, so a future price change trips this test', () => {
    // Break-even needs more energy per Coin than any item gives.
    const breakEvenEnergyPerCoin = 1 / MINE_COIN_PER_ENERGY;
    expect(breakEvenEnergyPerCoin).toBeCloseTo(1.3888, 3);
    const best = Math.max(...refills.map((r) => r.energy / r.coins));
    // The Energy Drink: 35 energy for 30 Coins ≈ 1.167 energy/Coin.
    expect(best).toBeCloseTo(35 / 30, 5);
    expect(best).toBeLessThan(breakEvenEnergyPerCoin);
  });

  it('and the realistic return is worse still, because of the energy floor', () => {
    // Buying a drink at the floor (20) gives 55 energy → only 3 rewarded digs,
    // not the 3.5 the raw ratio suggests.
    const afterDrink = MINE_MIN_ENERGY + 35;
    expect(rewardedDigsForEnergy(afterDrink)).toBe(3);
    expect(expectedCoinsForEnergy(afterDrink)).toBeCloseTo(21.6, 10);
    expect(expectedCoinsForEnergy(afterDrink)).toBeLessThan(30);
  });
});
