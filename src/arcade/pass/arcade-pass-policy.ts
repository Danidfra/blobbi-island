/**
 * The economics behind the Arcade Pass price.
 *
 * The terms themselves live in `arcade-pass-terms.ts`; this module is the
 * arithmetic that says whether they hold together, and `arcade-pass-policy.test.ts`
 * re-derives all of it from the LIVE reward policies so a rebalance moves the
 * verdict instead of stranding it in a comment.
 *
 * ## The bound that makes a price possible
 *
 * An earlier Pass waived Token costs for its whole 24 hours without limit, and
 * could not be priced. The reward policy keeps paying a participation floor
 * after a game's daily scaled runs are used up, so Ticket income has no ceiling
 * in TIME; a Pass that waives unlimited plays has no ceiling in VALUE either.
 * The floor below which a Pass funded its own replacement worked out at roughly
 * a day of grinding, above the permanent headline prize, so there was no
 * number left to choose.
 *
 * Bounding the plays collapses both ceilings to one finite number:
 *
 * ```
 *   most a Pass can ever return  =  ARCADE_PASS_FREE_PLAYS × maxTicketsPerRun
 *                                =  15 × 8
 *                                =  120 Tickets
 * ```
 *
 * `maxTicketsPerRun` is 8 for all three games, the same cap whatever the
 * difficulty, and already inclusive of every first-clear, first-play and
 * personal-best bonus, because the cap is applied last. So 120 is not a
 * pessimistic guess: it is the arithmetic maximum, and it is reachable by a
 * skilled player who chooses to spend every free play on a full-value run.
 *
 * ## The two bounds the price sits between
 *
 * | bound | value | why |
 * | --- | --- | --- |
 * | floor | {@link maxTicketsFromPassAllowance} = 120 | at or below this the Pass buys its own replacement, and the Coin → Token sink dies |
 * | ceiling | the permanent headline prize = 2500 | a consumable that expires in a day cannot cost more than a cosmetic you keep |
 *
 * 180 sits between them with real margin on both sides: a perfect player
 * recovers at most two thirds of the price, and the Pass is still the cheapest
 * thing on the counter, which is right for the only item there that expires.
 *
 * ## What is deliberately NOT claimed
 *
 * That the Pass can never be earned back. It can, partly, and that is the
 * point of a reward. The invariant is narrower and checkable: **one Pass
 * cannot pay for the next one on its own**. Closing the remaining gap takes
 * Token-charged play, so every Pass cycle still pulls Coins through the sink.
 */

import { ARCADE_REWARD_TUNING, arcadeRewardPolicies } from '@/arcade/reward-policy';
import { ARCADE_TOKEN_COIN_PRICE } from '@/arcade/tokens/token-store';
import { ARCADE_GAME_TOKEN_COSTS } from '@/arcade/tokens/game-entry-policy';
import {
  ARCADE_PASS_DURATION_MS,
  ARCADE_PASS_FREE_PLAYS,
  ARCADE_PASS_TICKET_PRICE,
} from './arcade-pass-terms';

/** Pass length in hours. For copy and for reasoning about the numbers below. */
export const ARCADE_PASS_DURATION_HOURS = ARCADE_PASS_DURATION_MS / (60 * 60 * 1000);

/**
 * The highest per-run reward any game can pay.
 *
 * Read from the live policies rather than written down, and asserted equal
 * across them: an economy where one game paid more per run would need this
 * whole analysis redone against that game.
 */
export function maxTicketsPerRun(
  policies: readonly { maxTicketsPerRun: number }[] = arcadeRewardPolicies,
  hardCap: number = ARCADE_REWARD_TUNING.hardCapPerRun,
): number {
  const caps = policies.map((p) => Math.min(p.maxTicketsPerRun, hardCap));
  return caps.length > 0 ? Math.max(...caps) : 0;
}

/**
 * The most Tickets one Pass's free plays can produce.
 *
 * THE bound the price is set against. Every free play is assumed to be a
 * perfect full-value run, which is the best a player can do by choice.
 */
export function maxTicketsFromPassAllowance(
  freePlays: number = ARCADE_PASS_FREE_PLAYS,
  perRun: number = maxTicketsPerRun(),
): number {
  return Math.max(0, freePlays) * perRun;
}

/**
 * A realistic haul from the allowance, for describing the offer honestly.
 *
 * Uses the participation floor as the low end and the per-run cap as the high
 * end. Not used by the invariant, the invariant uses the maximum, because a
 * bound that only holds for average players is not a bound.
 */
export function expectedTicketsFromPassAllowance(
  freePlays: number = ARCADE_PASS_FREE_PLAYS,
): { readonly min: number; readonly max: number } {
  return {
    min: Math.max(0, freePlays) * ARCADE_REWARD_TUNING.participationFloor,
    max: maxTicketsFromPassAllowance(freePlays),
  };
}

/**
 * What the allowance is worth in Coins.
 *
 * Every included play is one the player would otherwise have bought a Token
 * for, and every Token is bought with Coins. Finite now, which is the whole
 * difference from the unlimited Pass.
 */
export function passCoinValue(
  freePlays: number = ARCADE_PASS_FREE_PLAYS,
  tokensPerPlay: number = maxTokenCostPerPlay(),
  coinsPerToken: number = ARCADE_TOKEN_COIN_PRICE,
): number {
  return Math.max(0, freePlays) * Math.max(0, tokensPerPlay) * coinsPerToken;
}

/**
 * The dearest game's Token price, read from the live cost table.
 *
 * The most a play can cost, so the most a waived play can be worth. All three
 * games cost 1 today; taking the maximum keeps the Coin value an upper bound
 * if one of them ever costs more.
 */
export function maxTokenCostPerPlay(
  costs: Readonly<Record<string, number>> = ARCADE_GAME_TOKEN_COSTS,
): number {
  const values = Object.values(costs);
  return values.length > 0 ? Math.max(...values) : 0;
}

export interface PassSelfFundingResult {
  /** True when one Pass's own free plays can pay for the next one. */
  readonly selfFunding: boolean;
  /** The most those free plays can return. */
  readonly maxTicketsReturned: number;
  /** Tickets that must still come from Token-charged play. */
  readonly shortfall: number;
  /** Share of the price a perfect player recovers, `0`–`1`. */
  readonly recoveryRatio: number;
}

/**
 * Can a Pass at this price buy its own replacement?
 *
 * The one invariant that matters: if the free plays alone can reach the price,
 * the loop closes and the player never buys another Token.
 */
export function evaluatePassPrice(
  ticketPrice: number = ARCADE_PASS_TICKET_PRICE,
  freePlays: number = ARCADE_PASS_FREE_PLAYS,
): PassSelfFundingResult {
  const maxTicketsReturned = maxTicketsFromPassAllowance(freePlays);
  return {
    selfFunding: maxTicketsReturned >= ticketPrice,
    maxTicketsReturned,
    shortfall: Math.max(0, ticketPrice - maxTicketsReturned),
    recoveryRatio: ticketPrice > 0 ? maxTicketsReturned / ticketPrice : Infinity,
  };
}

/**
 * How many FULL-VALUE runs exist in a UTC day, across all three games.
 *
 * The reason the allowance stops at 15: past this, a play's worth depends on
 * how close the redemption was to midnight UTC, which is not a thing to make a
 * player reason about.
 */
export function fullValueRunsPerDay(
  policies: readonly unknown[] = arcadeRewardPolicies,
  perGamePerDay: number = ARCADE_REWARD_TUNING.rewardedRunsPerGamePerDay,
): number {
  return policies.length * perGamePerDay;
}

/** Whether the Pass can be offered, and why not when it cannot. */
export type ArcadePassAvailability =
  | { readonly kind: 'purchasable'; readonly ticketPrice: number; readonly freePlays: number }
  | { readonly kind: 'unpriced'; readonly reason: string };

export function arcadePassAvailability(
  ticketPrice: number = ARCADE_PASS_TICKET_PRICE,
  freePlays: number = ARCADE_PASS_FREE_PLAYS,
): ArcadePassAvailability {
  if (!Number.isInteger(freePlays) || freePlays <= 0) {
    return {
      kind: 'unpriced',
      reason: 'The Arcade Pass has no finite free-play allowance, so its value cannot be bounded.',
    };
  }
  if (!Number.isInteger(ticketPrice) || ticketPrice <= 0) {
    return { kind: 'unpriced', reason: 'The Arcade Pass has no Ticket price yet.' };
  }
  if (evaluatePassPrice(ticketPrice, freePlays).selfFunding) {
    return {
      kind: 'unpriced',
      reason:
        'The Arcade Pass price is at or below what its own free plays can return, so it would fund its own replacement.',
    };
  }
  return { kind: 'purchasable', ticketPrice, freePlays };
}
