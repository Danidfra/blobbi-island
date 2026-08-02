/**
 * Beach Treasure Hunt — the ONE home of every reward-policy number.
 *
 * Pure data + pure helpers (no React, no storage, no relay), mirroring the
 * game model's own policy discipline: components read this module and never
 * hardcode a balance value.
 *
 * ## The access model, stated plainly
 *
 * Playing is free: no Coin entry fee, no Blobbi energy, no consumable, and
 * the shack never locks. What is limited is REWARDS — up to
 * {@link BeachRewardPolicy.rewardedHuntsPerWindow} rewarded hunts per daily
 * window; after that every hunt is a fully playable practice hunt.
 *
 * ## The daily window
 *
 * A UTC calendar day (`YYYY-MM-DD` of `Date.now()` in UTC). This is a
 * CLIENT-TRUSTED window: a modified client or a changed system clock can
 * manipulate it, exactly like every other client-side limit in this
 * provisional phase — see `docs/blobbi-coin-cutover.md`. The ledger applies
 * a monotonic-window guard (the effective window never goes backwards past
 * one that already has operations), which blunts the obvious
 * set-the-clock-back farming without pretending to be anti-cheat.
 */

export interface BeachRewardPolicy {
  /** Rewarded hunts per daily window; practice is unlimited afterwards. */
  readonly rewardedHuntsPerWindow: number;
  /** Coins for any VALID completed rewarded hunt (see eligibility). */
  readonly baseCoins: number;
  /** Coins per point of `rawCleanupValue` (litter — cleanup framing). */
  readonly cleanupCoinsPerUnit: number;
  /** Coins per point of `rawTreasureValue` (valuables pay more than litter). */
  readonly treasureCoinsPerUnit: number;
  /** Hard ceiling per round. A bound, not a target. */
  readonly maxCoinsPerRound: number;
  /**
   * Minimum participation for a round to bear a reward (and for an abandoned
   * reservation to be CONSUMED rather than released):
   * at least `minDigs` accepted digs AND at least `minActiveSeconds` of hunt
   * time — unless every target was legitimately found sooner.
   */
  readonly minDigs: number;
  readonly minActiveSeconds: number;
}

export const BEACH_REWARD_POLICY: BeachRewardPolicy = Object.freeze({
  rewardedHuntsPerWindow: 10,
  // Chosen from the approved 3–5 range: with cleanup at 1:1 (litter units are
  // 1 each) and treasure at 1:1 (valuables are worth 2–6 units), a typical
  // 5-dig round lands in the target 12–15 total — see the simulation test.
  baseCoins: 4,
  cleanupCoinsPerUnit: 1,
  treasureCoinsPerUnit: 1,
  maxCoinsPerRound: 25,
  minDigs: 1,
  minActiveSeconds: 20,
});

/** The UTC daily window key for a timestamp: `YYYY-MM-DD`. */
export function beachRewardWindowKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Epoch ms of the next window reset (next UTC midnight). */
export function beachRewardWindowResetAt(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
