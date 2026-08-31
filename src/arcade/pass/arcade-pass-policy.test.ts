/**
 * The Arcade Pass economy, re-derived from live code on every run.
 *
 * The Pass has a price now, which it did not before, and the thing that
 * changed is the bound: a finite free-play allowance turns an unlimited waiver
 * into a number the price can be set above. These tests keep that arithmetic
 * honest — every input comes from the real reward policies, the real token
 * costs and the real prize catalog, so a rebalance that breaks the reasoning
 * fails here rather than shipping.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_PASS_DURATION_MS,
  ARCADE_PASS_FREE_PLAYS,
  ARCADE_PASS_TICKET_PRICE,
} from './arcade-pass-terms';
import {
  ARCADE_PASS_DURATION_HOURS,
  arcadePassAvailability,
  evaluatePassPrice,
  expectedTicketsFromPassAllowance,
  fullValueRunsPerDay,
  maxTicketsFromPassAllowance,
  maxTicketsPerRun,
  maxTokenCostPerPlay,
  passCoinValue,
} from './arcade-pass-policy';
import { ARCADE_REWARD_TUNING, arcadeRewardPolicies } from '@/arcade/reward-policy';
import { ARCADE_TOKEN_COIN_PRICE } from '@/arcade/tokens/token-store';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from '@/arcade/prizes/official-prize-catalog';

const headlinePrize = () =>
  Math.max(...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets));
const cheapestPrize = () =>
  Math.min(...OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.tickets));

describe('the terms are finite and centralized', () => {
  it('grants a finite, positive free-play allowance', () => {
    // The whole reason a price exists. An unbounded allowance is unpriceable.
    expect(Number.isInteger(ARCADE_PASS_FREE_PLAYS)).toBe(true);
    expect(ARCADE_PASS_FREE_PLAYS).toBeGreaterThan(0);
    expect(Number.isFinite(ARCADE_PASS_FREE_PLAYS)).toBe(true);
  });

  it('has a real Ticket price', () => {
    expect(ARCADE_PASS_TICKET_PRICE).not.toBeNull();
    expect(Number.isInteger(ARCADE_PASS_TICKET_PRICE)).toBe(true);
    expect(ARCADE_PASS_TICKET_PRICE).toBeGreaterThan(0);
  });

  it('still lasts 24 hours', () => {
    expect(ARCADE_PASS_DURATION_HOURS).toBe(24);
    expect(ARCADE_PASS_DURATION_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('the bound the price is set against', () => {
  it('caps every game at the same Tickets per run', () => {
    // The analysis assumes one per-run ceiling. If the games ever diverge, the
    // bound has to be recomputed against the most generous one.
    const caps = arcadeRewardPolicies.map((p) =>
      Math.min(p.maxTicketsPerRun, ARCADE_REWARD_TUNING.hardCapPerRun),
    );
    expect(new Set(caps).size).toBe(1);
    expect(maxTicketsPerRun()).toBe(caps[0]);
  });

  it('bounds the whole allowance at plays × per-run cap', () => {
    expect(maxTicketsFromPassAllowance()).toBe(
      ARCADE_PASS_FREE_PLAYS * maxTicketsPerRun(),
    );
  });

  it('brackets a realistic haul between the floor and the cap', () => {
    const { min, max } = expectedTicketsFromPassAllowance();
    expect(min).toBe(ARCADE_PASS_FREE_PLAYS * ARCADE_REWARD_TUNING.participationFloor);
    expect(max).toBe(maxTicketsFromPassAllowance());
    expect(min).toBeLessThan(max);
  });
});

describe('THE invariant: one Pass cannot buy the next one', () => {
  it('prices the Pass above everything its own free plays can return', () => {
    const verdict = evaluatePassPrice();
    expect(verdict.maxTicketsReturned).toBe(maxTicketsFromPassAllowance());
    expect(
      verdict.selfFunding,
      `A Pass at ${ARCADE_PASS_TICKET_PRICE} Tickets returns up to ` +
        `${verdict.maxTicketsReturned} from its own free plays, so it funds its own ` +
        'replacement. Raise the price or lower the allowance.',
    ).toBe(false);
  });

  it('leaves a real shortfall that only Token-charged play can close', () => {
    const { shortfall, recoveryRatio } = evaluatePassPrice();
    expect(shortfall).toBeGreaterThan(0);
    // A perfect player recovers a useful but minority share. Loose bounds: the
    // point is "meaningfully rewarding, nowhere near free", not a magic ratio.
    expect(recoveryRatio).toBeGreaterThan(0.25);
    expect(recoveryRatio).toBeLessThan(0.9);
  });

  it('detects a self-funding price, so the invariant can actually fail', () => {
    // The guard is only worth having if it fires. At the bound exactly, and
    // anywhere below it, the loop closes.
    const bound = maxTicketsFromPassAllowance();
    expect(evaluatePassPrice(bound).selfFunding).toBe(true);
    expect(evaluatePassPrice(bound - 1).selfFunding).toBe(true);
    expect(evaluatePassPrice(bound + 1).selfFunding).toBe(false);
  });

  it('would refuse to offer a Pass whose price stopped clearing the bound', () => {
    const offered = arcadePassAvailability();
    expect(offered.kind).toBe('purchasable');

    const tooCheap = arcadePassAvailability(maxTicketsFromPassAllowance());
    expect(tooCheap.kind).toBe('unpriced');

    const unbounded = arcadePassAvailability(ARCADE_PASS_TICKET_PRICE, 0);
    expect(unbounded.kind).toBe('unpriced');
  });
});

describe('the Pass sits sensibly in the prize ladder', () => {
  it('costs less than the permanent headline prize', () => {
    expect(ARCADE_PASS_TICKET_PRICE).toBeLessThan(headlinePrize());
  });

  it('is the cheapest thing on the counter, being the only one that expires', () => {
    // Deliberate: every other prize is permanent. A consumable priced above a
    // cosmetic you keep forever would be the incoherent shelf.
    expect(ARCADE_PASS_TICKET_PRICE).toBeLessThan(cheapestPrize());
  });
});

describe('the allowance fits inside one day of full-value play', () => {
  it('stays at or under the UTC day’s full-value runs', () => {
    // Past this the offer would depend on how close midnight UTC is, because
    // the extra plays could only earn the participation floor.
    expect(ARCADE_PASS_FREE_PLAYS).toBeLessThanOrEqual(fullValueRunsPerDay());
  });

  it('counts three games’ worth of daily rewarded runs', () => {
    expect(fullValueRunsPerDay()).toBe(
      arcadeRewardPolicies.length * ARCADE_REWARD_TUNING.rewardedRunsPerGamePerDay,
    );
  });
});

describe('what the allowance is worth in Coins', () => {
  it('waives one Token per included play, at the live Token price', () => {
    expect(maxTokenCostPerPlay()).toBe(1);
    expect(passCoinValue()).toBe(
      ARCADE_PASS_FREE_PLAYS * maxTokenCostPerPlay() * ARCADE_TOKEN_COIN_PRICE,
    );
  });

  it('is finite, which the unlimited Pass never was', () => {
    expect(Number.isFinite(passCoinValue())).toBe(true);
    expect(passCoinValue()).toBeGreaterThan(0);
  });
});
