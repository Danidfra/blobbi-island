/**
 * Air Hockey → the shared arcade result contract.
 *
 * Two shapes, and the split is the point.
 *
 *  - {@link AirHockeyMatchResult} is the game's OWN summary: an outcome, two
 *    scores, a margin, a duration, a difficulty. It reads the way a person would
 *    describe the match, and it is the thing a future reward policy would be
 *    written against.
 *  - {@link ArcadeGameResult} is the arcade's contract: an id, an integer score,
 *    two timestamps and an open map of NUMBERS. It is what the lifecycle reducer
 *    validates and what a persisted claim must still parse after a refresh.
 *
 * `buildAirHockeyResult` is the one translation between them, so the stat KEYS
 * exist in exactly one place and cannot be misspelled into existence somewhere
 * else. That is the same rule `dance-result.ts` follows, for the same reason.
 *
 * ## Rewards are still not computed here
 *
 * `HOCKEY_REWARD_POLICY` (in `hockey-reward.ts`) is now active and reads the
 * `stats` keys below — exactly the join point this file promised. The division
 * of labour is unchanged: this module SUMMARISES a match; the policy prices it;
 * and nothing in this module publishes, persists or awards anything.
 */

import type { ArcadeGameResult } from '../types';
import type { HockeyDifficulty } from './ai';
import type { HockeyMatchState, HockeyMatchStats } from './match';

/** Win or loss. Air Hockey cannot draw — a match ends when someone reaches the target. */
export type AirHockeyOutcome = 'win' | 'loss';

/**
 * The match, described in its own words.
 *
 * Local by design: nothing here reaches Nostr, inventory or storage. It is
 * rendered by the results panel and it is the shape a reward policy would read.
 */
export interface AirHockeyMatchResult {
  readonly outcome: AirHockeyOutcome;
  readonly playerScore: number;
  readonly opponentScore: number;
  /** Player minus opponent. Negative on a loss, and allowed to be. */
  readonly scoreDifference: number;
  readonly targetGoals: number;
  readonly durationMs: number;
  readonly difficulty: HockeyDifficulty;
  /**
   * True when the match ended because someone reached the target, rather than
   * because the player left. A run that ends any other way never produces a
   * result at all — the lifecycle reducer refuses one outside `playing` — so
   * this is `true` for every result that exists today. It is recorded anyway,
   * because a future "best of" or timed mode would make it vary and a reward
   * policy must be able to ask.
   */
  readonly completedNaturally: boolean;
  readonly stats: HockeyMatchStats;
}

/** Every stat key Air Hockey reports. A future reward policy reads from here. */
export const HOCKEY_STAT_KEYS = {
  playerGoals: 'playerGoals',
  opponentGoals: 'opponentGoals',
  goalDifference: 'goalDifference',
  targetGoals: 'targetGoals',
  durationMs: 'durationMs',
  won: 'won',
  completedNaturally: 'completedNaturally',
  playerHits: 'playerHits',
  opponentHits: 'opponentHits',
  wallBounces: 'wallBounces',
  topPuckSpeed: 'topPuckSpeed',
} as const;

/**
 * Summarise a finished match.
 *
 * Deterministic given its input: no clock, no randomness, no I/O. Accepts a
 * match in ANY phase so the caller does not have to guard, but only an `over`
 * match can be `completedNaturally` — a summary of an unfinished match is a
 * loss-shaped record of what was on the board, and it is never handed to the
 * lifecycle.
 */
export function summariseHockeyMatch(state: HockeyMatchState): AirHockeyMatchResult {
  const outcome: AirHockeyOutcome =
    state.playerScore > state.opponentScore ? 'win' : 'loss';
  return {
    outcome,
    playerScore: state.playerScore,
    opponentScore: state.opponentScore,
    scoreDifference: state.playerScore - state.opponentScore,
    targetGoals: state.targetGoals,
    durationMs: Math.max(0, Math.round(state.elapsedMs)),
    difficulty: state.difficulty,
    completedNaturally: state.phase === 'over',
    stats: state.stats,
  };
}

export interface BuildAirHockeyResultInput {
  readonly runId: string;
  readonly machineId: string;
  readonly gameId: string;
  readonly match: AirHockeyMatchResult;
  /** Epoch ms when the countdown ended and play began. */
  readonly startedAt: number;
  /** Epoch ms when the match ended. */
  readonly endedAt: number;
}

/**
 * Build the one immutable {@link ArcadeGameResult} a finished match produces.
 *
 * `score` is the player's goal count, because that is the only number in this
 * game a player would call a score. The arcade contract requires it to be a
 * non-negative integer, which a goal count always is — the margin, which can be
 * negative, travels in `stats` where negatives are legal.
 *
 * `cleared` is a WIN, not a completion. Air Hockey's own clear condition is
 * beating the opponent; finishing a 0–7 loss is a completed match and an
 * uncleared one, and a future reward policy should be able to tell them apart
 * without reading the two scores back out.
 */
export function buildAirHockeyResult(input: BuildAirHockeyResultInput): ArcadeGameResult {
  const { match } = input;
  return {
    runId: input.runId,
    gameId: input.gameId,
    machineId: input.machineId,
    difficulty: match.difficulty,
    cleared: match.outcome === 'win',
    score: Math.max(0, Math.round(match.playerScore)),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    stats: {
      [HOCKEY_STAT_KEYS.playerGoals]: match.playerScore,
      [HOCKEY_STAT_KEYS.opponentGoals]: match.opponentScore,
      [HOCKEY_STAT_KEYS.goalDifference]: match.scoreDifference,
      [HOCKEY_STAT_KEYS.targetGoals]: match.targetGoals,
      [HOCKEY_STAT_KEYS.durationMs]: match.durationMs,
      [HOCKEY_STAT_KEYS.won]: match.outcome === 'win' ? 1 : 0,
      [HOCKEY_STAT_KEYS.completedNaturally]: match.completedNaturally ? 1 : 0,
      [HOCKEY_STAT_KEYS.playerHits]: match.stats.playerHits,
      [HOCKEY_STAT_KEYS.opponentHits]: match.stats.opponentHits,
      [HOCKEY_STAT_KEYS.wallBounces]: match.stats.wallBounces,
      [HOCKEY_STAT_KEYS.topPuckSpeed]: Math.round(match.stats.topPuckSpeed),
    },
  };
}

/**
 * Read an {@link AirHockeyMatchResult} back out of an {@link ArcadeGameResult}.
 *
 * The exact inverse of {@link buildAirHockeyResult}, and the reason the results
 * panel needs no state of its own: the lifecycle already holds the one immutable
 * result, so the panel derives its display from THAT rather than from a
 * parallel copy the controller would have to keep in step. A round-trip test
 * pins the two together.
 *
 * Missing or malformed stats degrade to zero rather than throwing — a results
 * screen is not the place to discover a schema problem, and the validated
 * result that reached the reducer cannot have any.
 */
export function summaryFromResult(result: ArcadeGameResult): AirHockeyMatchResult {
  const stat = (key: string) => {
    const value = result.stats[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    outcome: stat(HOCKEY_STAT_KEYS.won) === 1 ? 'win' : 'loss',
    playerScore: stat(HOCKEY_STAT_KEYS.playerGoals),
    opponentScore: stat(HOCKEY_STAT_KEYS.opponentGoals),
    scoreDifference: stat(HOCKEY_STAT_KEYS.goalDifference),
    targetGoals: stat(HOCKEY_STAT_KEYS.targetGoals),
    durationMs: stat(HOCKEY_STAT_KEYS.durationMs),
    difficulty: result.difficulty === 'easy' ? 'easy' : 'normal',
    completedNaturally: stat(HOCKEY_STAT_KEYS.completedNaturally) === 1,
    stats: {
      playerHits: stat(HOCKEY_STAT_KEYS.playerHits),
      opponentHits: stat(HOCKEY_STAT_KEYS.opponentHits),
      wallBounces: stat(HOCKEY_STAT_KEYS.wallBounces),
      topPuckSpeed: stat(HOCKEY_STAT_KEYS.topPuckSpeed),
    },
  };
}

/** Did the player win this result? Reads the recorded flag, never re-derives it. */
export function wonAirHockey(result: ArcadeGameResult): boolean {
  return result.stats[HOCKEY_STAT_KEYS.won] === 1;
}

/** "2 min 14 s", for the results panel. */
export function formatMatchDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
