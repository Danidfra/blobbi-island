/**
 * Blobbi Dance: the production ticket policy.
 *
 * **This is the first `active` reward policy in the arcade.** Phase 2 shipped
 * the machinery with every policy marked `draft` precisely so that no code path
 * could pay out before a real game existed to earn it. One does now, so this one
 * is promoted: deliberately, with its numbers written down, versioned, and
 * bounded.
 *
 * ## The numbers
 *
 * ```
 *   participation (a run that reached the end)      2
 *   accuracy tier   ≥60% +1   ≥75% +2   ≥88% +3   ≥95% +4     (ONE tier, not cumulative)
 *   full combo (every note hit)                    +2
 *   ──────────────────────────────────────────────────────
 *   maximum                                         8
 *   minimum for a naturally completed valid run     2
 *   aborted / interrupted / invalid run             0
 * ```
 *
 * Worked examples:
 *
 * | run | tickets |
 * | --- | --- |
 * | 96%, full combo, finished | 2 + 4 + 2 = **8** |
 * | 96%, one miss, finished | 2 + 4 = **6** |
 * | 80%, finished | 2 + 2 = **4** |
 * | 61%, finished | 2 + 1 = **3** |
 * | 40%, finished | **2** (participation floor; the run did not clear) |
 * | 100%, closed at bar 30 | **0** (no result exists, an aborted run has none) |
 *
 * ## Why it is `flat`
 *
 * The shared layer offers a difficulty multiplier and first-clear / first-play-
 * today / personal-best bonuses. This phase ships no store for any of them: no
 * first-clear ledger, no personal-best record, no per-day rewarded-run counter,
 * and exactly one difficulty. Declaring `shape: 'flat'` says that in data
 * instead of feeding the shared layer a context of permanent `false`s and
 * advertising bonuses that can never fire. The shared caps and the participation
 * floor still apply, a flat policy opts out of bonuses, not out of the ceiling.
 *
 * ## Why not `1 score = 1 ticket`
 *
 * A perfect run scores 110 notes × 1000 plus combo bonus, well over 130,000.
 * Paying anything proportional to that would make one afternoon's play worth
 * more than every coin sink on the island combined, and it would reward grinding
 * an easy chart over playing well. A bounded per-run reward makes the ceiling a
 * product decision rather than an emergent property of a score formula.
 *
 * ## What this module does NOT do
 *
 * Write anything. Read a clock. Know an item address. Know what a relay is. It
 * converts a validated result into a number, and the number means nothing until
 * something outside `src/arcade/` chooses to grant it.
 */

import type { ArcadeGameResult } from '../types';
import type { ArcadeRewardPolicy } from '../reward-policy';
import { BLOBBI_DANCE_GAME_ID } from '../catalogue';
import {
  DANCE_CLEAR_ACCURACY,
  completedNaturally,
  resultAccuracy,
  wasFullCombo,
} from './dance-result';

/**
 * The dance game's stable id.
 *
 * Re-exported, not redeclared. It was written out here AND in the machine
 * registry, each with a comment saying it mirrored the other, two constants
 * that a rename would have silently desynchronised. The catalogue owns game
 * identity now, so it owns the string; this module borrows it.
 */
export { BLOBBI_DANCE_GAME_ID };

/**
 * Every constant the policy pays from, in one frozen object.
 *
 * Tiers are listed high-to-low and evaluated in that order, which is what makes
 * them a single tier rather than a cumulative stack: the first threshold a run
 * meets is the only one it is paid for.
 */
export const DANCE_REWARD_TUNING = {
  /** Paid for any run that reached the end of the song. */
  participation: 2,
  /** One tier only. Highest matching threshold wins. */
  accuracyTiers: [
    { minAccuracy: 95, tickets: 4 },
    { minAccuracy: 88, tickets: 3 },
    { minAccuracy: 75, tickets: 2 },
    { minAccuracy: 60, tickets: 1 },
  ],
  /** Every note in the chart hit, none missed. */
  fullCombo: 2,
  /** Hard ceiling for one run. Equals participation + best tier + full combo. */
  maxPerRun: 8,
} as const;

/** The accuracy tier a run earns, in tickets. `0` below the lowest threshold. */
export function accuracyTierTickets(accuracy: number): number {
  if (!Number.isFinite(accuracy)) return 0;
  return DANCE_REWARD_TUNING.accuracyTiers.find((t) => accuracy >= t.minAccuracy)?.tickets ?? 0;
}

/**
 * Tickets for a cleared run, before the shared floor and caps.
 *
 * Exported for tests and for the DEV harness's tier table; production callers go
 * through `calculateArcadeReward`, which applies the caps and the eligibility
 * rules on top.
 */
export function danceBaseTickets(result: ArcadeGameResult): number {
  const accuracy = resultAccuracy(result);
  if (accuracy === null) {
    // A result whose accuracy stat is missing or out of range still finished a
    // run, so it is paid participation; never zero (which would look like a
    // punishment) and never a tier (which would be unearned).
    return DANCE_REWARD_TUNING.participation;
  }
  return (
    DANCE_REWARD_TUNING.participation +
    accuracyTierTickets(accuracy) +
    (wasFullCombo(result) ? DANCE_REWARD_TUNING.fullCombo : 0)
  );
}

/**
 * The dance game's own eligibility rule.
 *
 * Two refusals the shared layer cannot make for itself:
 *
 *  - a run that did not reach the end of the song. In practice an interrupted
 *    run never produces a result at all (the lifecycle reducer refuses one
 *    outside `playing`, and an abort clears it), so this is defence in depth
 *    against a result built by hand or restored from storage;
 *  - a result whose accuracy stat is outside 0–100, which means the run's own
 *    numbers are wrong and nothing derived from them should be paid.
 */
function danceIneligible(result: ArcadeGameResult): string | null {
  if (!completedNaturally(result)) {
    return 'the run did not reach the end of the song';
  }
  if (resultAccuracy(result) === null) {
    return 'the run reported an unusable accuracy';
  }
  return null;
}

/**
 * The live policy.
 *
 * `version` is bumped whenever any number above changes, so a claim recorded
 * against version 1 can always be explained by the constants that were in force.
 */
export const DANCE_REWARD_POLICY: ArcadeRewardPolicy = {
  gameId: BLOBBI_DANCE_GAME_ID,
  policyId: 'blobbi-dance-tickets',
  version: 1,
  status: 'active',
  shape: 'flat',
  base: danceBaseTickets,
  maxTicketsPerRun: DANCE_REWARD_TUNING.maxPerRun,
  ineligible: danceIneligible,
};

/** Accuracy at or above which a run counts as cleared. Re-exported for the UI. */
export { DANCE_CLEAR_ACCURACY };
