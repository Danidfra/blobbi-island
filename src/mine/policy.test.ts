/**
 * The Mine policy — parity with the pre-extraction behaviour, and the economic
 * claim the model rests on.
 *
 * The first block is the important one: it pins the numbers that used to live
 * inside `MiningGame.tsx` against a REFERENCE implementation of the original
 * cascading thresholds, reproduced verbatim below. Extraction is only safe if
 * it changed nothing, and "nothing" has to be checkable rather than asserted.
 *
 * The last two blocks stand in for the daily cap the Mine no longer has: with
 * energy as the only boundary, "no refill pays for itself" is what keeps the
 * Mine from being a faucet, so it is a test rather than a comment.
 */

import { describe, it, expect } from 'vitest';

import { officialItemByD } from '@/protocol/event-registry';
import { COIN_PRICES } from '@/inventory/shop-catalog';

import * as policy from './policy';
import {
  MINE_COIN_PER_ENERGY,
  MINE_ENERGY_PER_DIG,
  MINE_EXPECTED_COINS_PER_DIG,
  MINE_GEM_TABLE,
  MINE_MIN_ENERGY,
  expectedCoinsForEnergy,
  mineGem,
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

/**
 * The arbitrage check.
 *
 * If any purchasable item returned more Coins of mining than it cost, the Mine
 * would be an unbounded faucet — buy, mine, buy more, repeat — and energy
 * would stop being a boundary at all. This asserts the loop is closed at
 * CURRENT production prices and effects, and it fails if a future price cut or
 * effect buff opens it. That failure is the signal to re-audit the Mine, which
 * is why no speculative cap is encoded instead.
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

/**
 * The Mine is bounded by energy, and by nothing else.
 *
 * Asserted structurally rather than as prose: if a cap, cooldown or quota is
 * reintroduced as a policy constant, this fails and forces the decision to be
 * made deliberately.
 */
describe('no daily cap, cooldown or quota exists', () => {
  it('the policy exports nothing that limits earnings by time or count', () => {
    const exported = Object.keys(policy);
    const limiters = exported.filter((name) =>
      /CAP|COOLDOWN|QUOTA|DAILY|WINDOW|BUDGET|LIMIT/i.test(name),
    );
    expect(limiters).toEqual([]);
  });

  it('exports only the gem table, the energy rules and their derivations', () => {
    expect(new Set(Object.keys(policy))).toEqual(
      new Set([
        'MINE_GEM_TABLE',
        'mineGem',
        'MINE_ENERGY_PER_DIG',
        'MINE_MIN_ENERGY',
        'rollMineGem',
        'mineRunReward',
        'MINE_EXPECTED_COINS_PER_DIG',
        'MINE_COIN_PER_ENERGY',
        'rewardedDigsForEnergy',
        'expectedCoinsForEnergy',
      ]),
    );
  });

  it('a run of any size is worth exactly its gems', () => {
    // Nothing clamps this: 20 top gems is 1000 Coins, and that is the answer.
    const jackpot: MineGemKind[] = Array(20).fill('gem-3');
    expect(mineRunReward(jackpot)).toBe(1_000);
  });
});
