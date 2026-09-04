/**
 * Beach Treasure Hunt, reward CALCULATION, as pure math.
 *
 * Deterministic from `(finalized result, policy)` and nothing else: no
 * randomness after the field was generated, no multipliers, no jackpot, no
 * hidden odds. Missed digs earn nothing; litter still contributes positively
 * (the cleanup framing); valuables contribute more because their unit values
 * (2–6) exceed litter's (1). The output is integers throughout, bounded by
 * an explicit per-round maximum; never silently clamped elsewhere.
 *
 * This module knows nothing about persistence, ledgers, wallets or the
 * daily window: authorization lives in `provisional-authorization.ts`, and
 * the split is deliberate so a future issuer-grant flow can replace
 * authorization without touching the formula (or anything upstream of it).
 */

import type { TreasureHuntResult } from '@/beach/treasure-hunt';
import type { BeachRewardPolicy } from './policy';

/** Why a finished round earns no reward. */
export type RewardIneligibilityReason
  = /** Closed/abandoned rather than legitimately finished. */
  | 'not-finished'
  /** Fewer accepted digs than the minimum participation rule. */
  | 'not-enough-digs'
  /** Ended before the minimum active time (and not by finding everything). */
  | 'too-short';

export type RewardEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: RewardIneligibilityReason };

/**
 * The minimum-participation rule (documented in the audit + intro copy):
 * ≥ `minDigs` accepted digs AND ≥ `minActiveSeconds` of hunt time, except a
 * round that legitimately found EVERY target, which qualifies at any speed.
 * `ended-by-player` (an explicit early end) is accepted only past the same
 * threshold; an abandoned round never reaches this function because the
 * modal discards it without a finalized result.
 */
export function rewardEligibility(
  result: TreasureHuntResult,
  policy: BeachRewardPolicy,
): RewardEligibility {
  if (result.endReason === 'all-targets-found') return { eligible: true };
  const digs = result.successfulDigs + result.missedDigs;
  if (digs < policy.minDigs) return { eligible: false, reason: 'not-enough-digs' };
  if (result.durationSeconds < policy.minActiveSeconds) {
    return { eligible: false, reason: 'too-short' };
  }
  return { eligible: true };
}

export interface TreasureHuntCoinReward {
  readonly baseCoins: number;
  readonly cleanupCoins: number;
  readonly treasureCoins: number;
  /** Sum of the above, capped at `policy.maxCoinsPerRound`. Integer, ≥ base. */
  readonly totalCoins: number;
  /** True when the cap trimmed the sum (surfaced honestly, never hidden). */
  readonly capped: boolean;
}

/**
 * The deterministic payout for an ELIGIBLE finalized result. Returns `null`
 * for an ineligible one, callers must check {@link rewardEligibility} when
 * they need the reason.
 */
export function calculateTreasureHuntReward(
  result: TreasureHuntResult,
  policy: BeachRewardPolicy,
): TreasureHuntCoinReward | null {
  if (!rewardEligibility(result, policy).eligible) return null;

  const baseCoins = policy.baseCoins;
  const cleanupCoins = result.rawCleanupValue * policy.cleanupCoinsPerUnit;
  const treasureCoins = result.rawTreasureValue * policy.treasureCoinsPerUnit;
  const sum = baseCoins + cleanupCoins + treasureCoins;
  const totalCoins = Math.min(sum, policy.maxCoinsPerRound);

  return {
    baseCoins,
    cleanupCoins,
    treasureCoins,
    totalCoins,
    capped: sum > policy.maxCoinsPerRound,
  };
}
