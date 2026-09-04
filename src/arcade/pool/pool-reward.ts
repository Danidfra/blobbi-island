/**
 * Pool: the production ticket policy.
 *
 * The third `active` policy in the arcade, written against the fields
 * `pool-result.ts` was built to expose: the win, the difficulty, how the 8-ball
 * went down, and how cleanly the frame was played. Like the other two it is a
 * client-trusted Arcade V1 number, the client computes it and the client
 * writes it, which a modified client can abuse. That is accepted for now; see
 * `docs/arcade-reward-publication-boundary.md` §1.
 *
 * ## The numbers
 *
 * ```
 *   participation (a frame that finished)                     2
 *   victory                                                  +3
 *   Normal rival (only on a victory)                         +1
 *   legal 8-ball finish (you potted it properly)             +1
 *   clean frame (no scratches, no fouls; on a victory)       +1
 *   ──────────────────────────────────────────────────────
 *   maximum                                                   8
 *   completed loss (incl. an early 8-ball)                    2   (shared floor)
 *   aborted / abandoned frame                                 0   (no result exists)
 * ```
 *
 * Worked examples:
 *
 * | frame | tickets |
 * | --- | --- |
 * | clean legal-8 win, Normal | 2 + 3 + 1 + 1 + 1 = **8** |
 * | legal-8 win with a scratch, Normal | 2 + 3 + 1 + 1 = **7** |
 * | win because the rival potted the 8 early, Normal, clean | 2 + 3 + 1 + 1 = **7** |
 * | clean legal-8 win, Easy | 2 + 3 + 1 + 1 = **7** |
 * | any completed loss, outdrawn, or your own early 8 | **2** (participation floor) |
 * | left mid-frame | **0** (an aborted run has no result) |
 *
 * ## Fouls reduce bonuses; they never go negative
 *
 * A scratch or foul costs the clean-frame bonus and nothing more. There is no
 * per-foul deduction: the shared layer already guarantees a non-negative
 * integer, and a policy that could push a win below the participation floor
 * would punish beginners for finishing, which is the opposite of what the floor
 * is for. The early 8-ball loss is likewise not punished below the floor, the
 * frame completed, and losing it is already the outcome.
 *
 * ## What is deliberately NOT an input
 *
 * Balls pocketed, shots taken, duration, and the longest run. Every one of them
 * grows with time at the table, and paying for any of them makes the dominant
 * strategy a long frame of harmless safety shots rather than potting the 8. The
 * win, how it was won, and how cleanly are the only levers.
 *
 * ## Why it is `flat`
 *
 * The same reason the dance and hockey policies are: no first-clear ledger, no
 * personal-best store, no per-day counter exists to substantiate the shared
 * `scaled` bonuses, and the game has exactly two difficulties, so the Normal
 * bonus lives in `base` where it says precisely what it pays. The shared
 * participation floor and caps still apply.
 *
 * ## What this module does NOT do
 *
 * Write anything. Read a clock. Know an item address. Know what a relay is. It
 * converts a validated result into a number, and the number means nothing until
 * something outside `src/arcade/` chooses to grant it.
 */

import type { ArcadeGameResult } from '../types';
import type { ArcadeRewardPolicy, TicketAwardLine } from '../reward-policy';
import { BLOBBI_POOL_GAME_ID } from '../catalogue';
import { POOL_STAT_KEYS } from './pool-result';

export { BLOBBI_POOL_GAME_ID };

/** Every constant the policy pays from, in one frozen object. */
export const POOL_REWARD_TUNING = {
  /** Paid for any frame that reached its natural end. */
  participation: 2,
  /** Paid on top of participation for winning the frame. */
  victory: 3,
  /** Paid on a victory over the Normal rival. Easy pays no difficulty bonus. */
  normalDifficulty: 1,
  /** Paid for winning by potting the 8-ball properly, not by the rival's mistake. */
  legalEightFinish: 1,
  /** Paid for a winning frame with no scratches and no fouls. */
  cleanFrame: 1,
  /** Hard ceiling for one frame. Equals every line above added up. */
  maxPerRun: 8,
} as const;

/**
 * Tickets for a WON frame, before the shared floor and caps.
 *
 * Only called for `cleared` results, the shared layer pays every completed
 * loss the participation floor without consulting the game. Missing stats
 * degrade to "bonus not earned" rather than refusing: the validated result that
 * reached the reducer always carries them, and a hand-built one without them
 * simply earns the smaller number.
 */
export function poolBaseTickets(result: ArcadeGameResult): number {
  const scratches = result.stats[POOL_STAT_KEYS.playerScratches];
  const fouls = result.stats[POOL_STAT_KEYS.playerFouls];
  const clean = scratches === 0 && fouls === 0;
  return (
    POOL_REWARD_TUNING.participation +
    POOL_REWARD_TUNING.victory +
    (result.difficulty === 'normal' ? POOL_REWARD_TUNING.normalDifficulty : 0) +
    (result.stats[POOL_STAT_KEYS.legalEightFinish] === 1
      ? POOL_REWARD_TUNING.legalEightFinish
      : 0) +
    (clean ? POOL_REWARD_TUNING.cleanFrame : 0)
  );
}

/**
 * The base, decomposed into the lines the results screen shows.
 *
 * Must add up to exactly what {@link poolBaseTickets} returns, the shared
 * layer checks that and falls back to a single `Clear` line if it ever drifts,
 * so this function can only ever explain the number, never change it.
 */
export function poolBaseBreakdown(result: ArcadeGameResult): readonly TicketAwardLine[] {
  const scratches = result.stats[POOL_STAT_KEYS.playerScratches];
  const fouls = result.stats[POOL_STAT_KEYS.playerFouls];

  const lines: TicketAwardLine[] = [
    { label: 'Completed frame', tickets: POOL_REWARD_TUNING.participation },
    { label: 'Victory', tickets: POOL_REWARD_TUNING.victory },
  ];
  if (result.difficulty === 'normal') {
    lines.push({ label: 'Normal rival', tickets: POOL_REWARD_TUNING.normalDifficulty });
  }
  if (result.stats[POOL_STAT_KEYS.legalEightFinish] === 1) {
    lines.push({ label: 'Legal 8-ball finish', tickets: POOL_REWARD_TUNING.legalEightFinish });
  }
  if (scratches === 0 && fouls === 0) {
    lines.push({
      label: 'Clean frame',
      tickets: POOL_REWARD_TUNING.cleanFrame,
      detail: 'no fouls or scratches',
    });
  }
  return lines;
}

/**
 * The game's own eligibility rule: a frame that did not reach its natural end
 * earns nothing. In practice an abandoned frame never produces a result at all
 * (the lifecycle reducer refuses one outside `playing`), so this is defence in
 * depth against a result built by hand or restored from storage.
 */
function poolIneligible(result: ArcadeGameResult): string | null {
  if (result.stats[POOL_STAT_KEYS.completedNaturally] !== 1) {
    return 'the frame did not reach its natural end';
  }
  return null;
}

/**
 * The live policy.
 *
 * `version` is bumped whenever any number above changes, so a claim recorded
 * against version 1 can always be explained by the constants that were in force.
 */
export const POOL_REWARD_POLICY: ArcadeRewardPolicy = {
  gameId: BLOBBI_POOL_GAME_ID,
  policyId: 'blobbi-pool-tickets',
  version: 1,
  status: 'active',
  shape: 'flat',
  base: poolBaseTickets,
  baseBreakdown: poolBaseBreakdown,
  maxTicketsPerRun: POOL_REWARD_TUNING.maxPerRun,
  ineligible: poolIneligible,
};
