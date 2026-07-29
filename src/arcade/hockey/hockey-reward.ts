/**
 * Air Hockey — the production ticket policy.
 *
 * The second `active` policy in the arcade, written against the fields
 * `hockey-result.ts` was built to expose: the win, the difficulty, the margin,
 * and whether the match actually finished. Like the dance policy it is a
 * client-trusted Arcade V1 number — the client computes it and the client writes
 * it, which a modified client can abuse. That is accepted for now; see
 * `docs/arcade-reward-publication-boundary.md` §1.
 *
 * ## The numbers
 *
 * ```
 *   participation (a match that finished)                     2
 *   victory                                                  +3
 *   Normal opponent (only on a victory)                      +1
 *   margin   win by ≥ 7 (shutout) +2   win by ≥ 3 +1          (ONE tier)
 *   ──────────────────────────────────────────────────────
 *   maximum                                                   8
 *   completed loss                                            2   (shared floor)
 *   aborted / abandoned match                                 0   (no result exists)
 * ```
 *
 * Worked examples:
 *
 * | match | tickets |
 * | --- | --- |
 * | 7–0 win, Normal | 2 + 3 + 1 + 2 = **8** |
 * | 7–3 win, Normal | 2 + 3 + 1 + 1 = **7** |
 * | 7–5 win, Normal | 2 + 3 + 1 = **6** |
 * | 7–5 win, Easy | 2 + 3 = **5** |
 * | 5–7 loss, any | **2** (participation floor; the match did not clear) |
 * | left mid-match | **0** (an aborted run has no result) |
 *
 * ## Why the margin is a tier, not a rate
 *
 * Paying per goal of margin would make grinding shutouts against the Easy rival
 * the dominant strategy. Two tiers keep a 7–0 clearly better than a 7–5 without
 * making it worth several other games' matches — the whole run is still capped
 * at the same 8 the dance policy tops out at.
 *
 * ## Why match duration is not an input
 *
 * The result records `durationMs`, and the policy deliberately ignores it. A
 * duration bonus in either direction is an incentive to either stall the puck or
 * throw goals to end faster; neither is playing air hockey.
 *
 * ## Why it is `flat`
 *
 * The same reason the dance policy is: the app ships no first-clear ledger, no
 * personal-best store and no per-day rewarded-run counter, so a `scaled` policy
 * would advertise bonuses that can never fire. The Normal-opponent bonus lives
 * in `base` instead of the shared difficulty multiplier for the same honesty —
 * this game has exactly two difficulties, and `+1` on a win says precisely what
 * it pays. The shared participation floor and caps still apply.
 *
 * ## What this module does NOT do
 *
 * Write anything. Read a clock. Know an item address. Know what a relay is. It
 * converts a validated result into a number, and the number means nothing until
 * something outside `src/arcade/` chooses to grant it.
 */

import type { ArcadeGameResult } from '../types';
import type { ArcadeRewardPolicy, TicketAwardLine } from '../reward-policy';
import { BLOBBI_AIR_HOCKEY_GAME_ID } from '../catalogue';
import { HOCKEY_STAT_KEYS } from './hockey-result';

export { BLOBBI_AIR_HOCKEY_GAME_ID };

/**
 * Every constant the policy pays from, in one frozen object.
 *
 * Margin tiers are listed high-to-low and evaluated in that order: the first
 * threshold a win meets is the only one it is paid for.
 */
export const HOCKEY_REWARD_TUNING = {
  /** Paid for any match that reached its natural end. */
  participation: 2,
  /** Paid on top of participation for beating the rival. */
  victory: 3,
  /** Paid on a victory over the Normal opponent. Easy pays no difficulty bonus. */
  normalDifficulty: 1,
  /** One tier only. Highest matching goal margin wins. */
  marginTiers: [
    { minMargin: 7, tickets: 2 },
    { minMargin: 3, tickets: 1 },
  ],
  /** Hard ceiling for one match. Equals participation + victory + normal + best margin. */
  maxPerRun: 8,
} as const;

/** The margin tier a winning result earns, in tickets. `0` below the lowest. */
export function marginTierTickets(margin: number): number {
  if (!Number.isFinite(margin)) return 0;
  return HOCKEY_REWARD_TUNING.marginTiers.find((t) => margin >= t.minMargin)?.tickets ?? 0;
}

/**
 * Tickets for a WON match, before the shared floor and caps.
 *
 * Only called for `cleared` results — the shared layer pays every completed
 * loss the participation floor without consulting the game. Missing stats
 * degrade to zero bonus rather than refusing: the validated result that reached
 * the reducer always carries them, and a hand-built one without them simply
 * earns no margin tier.
 */
export function hockeyBaseTickets(result: ArcadeGameResult): number {
  const margin = result.stats[HOCKEY_STAT_KEYS.goalDifference];
  return (
    HOCKEY_REWARD_TUNING.participation +
    HOCKEY_REWARD_TUNING.victory +
    (result.difficulty === 'normal' ? HOCKEY_REWARD_TUNING.normalDifficulty : 0) +
    marginTierTickets(typeof margin === 'number' ? margin : 0)
  );
}

/**
 * The base, decomposed into the lines the results screen shows.
 *
 * Must add up to exactly what {@link hockeyBaseTickets} returns — the shared
 * layer checks that and falls back to a single `Clear` line if it ever drifts,
 * so this function can only ever explain the number, never change it.
 */
export function hockeyBaseBreakdown(result: ArcadeGameResult): readonly TicketAwardLine[] {
  const rawMargin = result.stats[HOCKEY_STAT_KEYS.goalDifference];
  const margin = typeof rawMargin === 'number' ? rawMargin : 0;
  const marginTickets = marginTierTickets(margin);

  const lines: TicketAwardLine[] = [
    { label: 'Completed match', tickets: HOCKEY_REWARD_TUNING.participation },
    { label: 'Victory', tickets: HOCKEY_REWARD_TUNING.victory },
  ];
  if (result.difficulty === 'normal') {
    lines.push({ label: 'Normal opponent', tickets: HOCKEY_REWARD_TUNING.normalDifficulty });
  }
  if (marginTickets > 0) {
    lines.push({
      label: margin >= 7 ? 'Shutout' : 'Winning margin',
      tickets: marginTickets,
      detail: `won by ${margin}`,
    });
  }
  return lines;
}

/**
 * The game's own eligibility rule: a match that did not reach its natural end
 * earns nothing. In practice an abandoned match never produces a result at all
 * (the lifecycle reducer refuses one outside `playing`), so this is defence in
 * depth against a result built by hand or restored from storage.
 */
function hockeyIneligible(result: ArcadeGameResult): string | null {
  if (result.stats[HOCKEY_STAT_KEYS.completedNaturally] !== 1) {
    return 'the match did not reach its natural end';
  }
  return null;
}

/**
 * The live policy.
 *
 * `version` is bumped whenever any number above changes, so a claim recorded
 * against version 1 can always be explained by the constants that were in force.
 */
export const HOCKEY_REWARD_POLICY: ArcadeRewardPolicy = {
  gameId: BLOBBI_AIR_HOCKEY_GAME_ID,
  policyId: 'blobbi-air-hockey-tickets',
  version: 1,
  status: 'active',
  shape: 'flat',
  base: hockeyBaseTickets,
  baseBreakdown: hockeyBaseBreakdown,
  maxTicketsPerRun: HOCKEY_REWARD_TUNING.maxPerRun,
  ineligible: hockeyIneligible,
};
