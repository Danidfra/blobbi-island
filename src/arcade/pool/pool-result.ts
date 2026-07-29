/**
 * Pool → the shared arcade result contract.
 *
 * Two shapes, and the split is the point — the same split `hockey-result.ts`
 * makes, for the same reason.
 *
 *  - {@link PoolMatchResult} is the game's OWN summary: an outcome, a group, a
 *    count of balls each way, how the 8-ball went down. It reads the way a
 *    person would describe the frame, and it is the thing a future reward policy
 *    would be written against.
 *  - {@link ArcadeGameResult} is the arcade's contract: an id, an integer score,
 *    two timestamps and an open map of NUMBERS. It is what the lifecycle reducer
 *    validates and what a persisted claim must still parse after a refresh.
 *
 * {@link buildPoolResult} is the one translation between them, so the stat KEYS
 * exist in exactly one place and cannot be misspelled into existence somewhere
 * else.
 *
 * ## Rewards are deliberately not here
 *
 * Pool grants no Arcade Tickets. The catalogue says `grantsTickets: false`,
 * there is no reward policy for `blobbi-pool`, and nothing in this module or its
 * callers publishes, persists or awards anything. This file imports no reward,
 * grant, ticket, inventory, relay or Nostr module, and `boundaries.test.ts`
 * checks that against the real import graph rather than taking this paragraph's
 * word for it.
 *
 * What exists is the JOIN POINT, and it is deliberately richer than Air
 * Hockey's because pool has more to say about *how* a match was won. A policy
 * could reward the win, the margin in balls, a clean 8-ball finish, a run of
 * pots, or a foul-free frame — every one of those is already a number below, and
 * enabling any of them needs a policy registered in `reward-policy.ts` and the
 * two hook calls `DanceMachine` already has. No change to this file, to the
 * simulation, or to the result shape.
 */

import type { ArcadeGameResult } from '../types';
import type { PoolDifficulty } from './ai';
import type { PoolMatchState, PoolMatchStats } from './match';
import { groupNumbers, remainingInGroup, type PoolGroup } from './rules';

/** Win or loss. Pool cannot draw — the 8-ball decides it either way. */
export type PoolOutcome = 'win' | 'loss';

/**
 * The match, described in its own words.
 *
 * Local by design: nothing here reaches Nostr, inventory or storage. It is
 * rendered by the results panel and it is the shape a reward policy would read.
 */
export interface PoolMatchResult {
  readonly outcome: PoolOutcome;
  readonly difficulty: PoolDifficulty;
  readonly durationMs: number;
  /** Which group the player ended up on. `null` if the match ended while open. */
  readonly playerGroup: PoolGroup | null;
  /** How many of the player's own group went down. */
  readonly playerBallsPocketed: number;
  readonly opponentBallsPocketed: number;
  /** How many of the opponent's balls were still on the table at the end. */
  readonly remainingOpponentBalls: number;
  readonly playerShots: number;
  /** Shots on which the player potted one of their own and kept the table. */
  readonly playerSuccessfulShots: number;
  readonly playerScratches: number;
  readonly opponentScratches: number;
  readonly playerFouls: number;
  /** The most consecutive shots the player kept the table for. */
  readonly longestPlayerRun: number;
  /** The player lost by potting the 8-ball before their group was clear. */
  readonly earlyEightLoss: boolean;
  /** The player won by potting the 8-ball properly. */
  readonly legalEightFinish: boolean;
  /**
   * True when the match ended because somebody potted the 8-ball, rather than
   * because the player left. A run that ends any other way never produces a
   * result at all — the lifecycle reducer refuses one outside `playing` — so
   * this is `true` for every result that exists today. It is recorded anyway,
   * because a future timed or best-of mode would make it vary and a reward
   * policy must be able to ask.
   */
  readonly completedNaturally: boolean;
  readonly stats: PoolMatchStats;
}

/** Every stat key Pool reports. A future reward policy reads from here. */
export const POOL_STAT_KEYS = {
  won: 'won',
  completedNaturally: 'completedNaturally',
  durationMs: 'durationMs',
  playerBalls: 'playerBallsPocketed',
  opponentBalls: 'opponentBallsPocketed',
  remainingOpponentBalls: 'remainingOpponentBalls',
  ballDifference: 'ballDifference',
  playerShots: 'playerShots',
  playerSuccessfulShots: 'playerSuccessfulShots',
  playerScratches: 'playerScratches',
  opponentScratches: 'opponentScratches',
  playerFouls: 'playerFouls',
  longestPlayerRun: 'longestPlayerRun',
  earlyEightLoss: 'earlyEightLoss',
  legalEightFinish: 'legalEightFinish',
  /** `0` solids, `1` stripes, `-1` the table never opened. */
  playerGroup: 'playerGroup',
} as const;

const GROUP_CODE: Record<'solids' | 'stripes', number> = { solids: 0, stripes: 1 };

function groupFromCode(code: number): PoolGroup | null {
  if (code === GROUP_CODE.solids) return 'solids';
  if (code === GROUP_CODE.stripes) return 'stripes';
  return null;
}

/**
 * Summarise a finished match.
 *
 * Deterministic given its input: no clock, no randomness, no I/O. Accepts a
 * match in ANY phase so the caller does not have to guard, but only an `over`
 * match can be `completedNaturally` — a summary of an unfinished match is a
 * loss-shaped record of what was on the table, and it is never handed to the
 * lifecycle.
 */
export function summarisePoolMatch(state: PoolMatchState): PoolMatchResult {
  const playerGroup = state.assignment.player;
  const opponentGroup = state.assignment.opponent;

  const playerRemaining =
    playerGroup === null ? groupNumbers('solids').length : remainingInGroup(state.balls, playerGroup).length;
  const opponentRemaining =
    opponentGroup === null
      ? groupNumbers('solids').length
      : remainingInGroup(state.balls, opponentGroup).length;

  const groupSize = groupNumbers('solids').length;

  const outcome: PoolOutcome = state.winner === 'player' ? 'win' : 'loss';

  return {
    outcome,
    difficulty: state.difficulty,
    durationMs: Math.max(0, Math.round(state.elapsedMs)),
    playerGroup,
    // Balls the player has taken off the table. Zero while the table is open,
    // which is honest: an unassigned ball belongs to nobody yet.
    playerBallsPocketed: playerGroup === null ? 0 : groupSize - playerRemaining,
    opponentBallsPocketed: opponentGroup === null ? 0 : groupSize - opponentRemaining,
    remainingOpponentBalls: opponentRemaining,
    playerShots: state.stats.playerShots,
    playerSuccessfulShots: state.stats.playerSuccessfulShots,
    playerScratches: state.stats.playerScratches,
    opponentScratches: state.stats.opponentScratches,
    playerFouls: state.stats.playerFouls,
    longestPlayerRun: state.stats.longestPlayerRun,
    // "Early" is the player's own mistake, so it is only true when the player
    // was the one shooting. The opponent doing it is simply a win.
    earlyEightLoss:
      outcome === 'loss' &&
      state.lastShooter === 'player' &&
      (state.ending === 'early-eight' || state.ending === 'eight-with-scratch'),
    legalEightFinish: outcome === 'win' && state.ending === 'legal-eight',
    completedNaturally: state.phase === 'over',
    stats: state.stats,
  };
}

export interface BuildPoolResultInput {
  readonly runId: string;
  readonly machineId: string;
  readonly gameId: string;
  readonly match: PoolMatchResult;
  /** Epoch ms when the break setup ended and play began. */
  readonly startedAt: number;
  /** Epoch ms when the match ended. */
  readonly endedAt: number;
}

/**
 * Build the one immutable {@link ArcadeGameResult} a finished match produces.
 *
 * `score` is how many of their own balls the player took off the table, because
 * that is the only number in this game a player would call a score — it runs 0
 * to 7 whether they won or lost, and it is the honest measure of how the frame
 * went. The arcade contract requires a non-negative integer, which it always is.
 *
 * `cleared` is a WIN, not a completion. Losing 7–0 is a completed match and an
 * uncleared one, and a future reward policy should be able to tell them apart
 * without reading the ball counts back out.
 */
export function buildPoolResult(input: BuildPoolResultInput): ArcadeGameResult {
  const { match } = input;
  return {
    runId: input.runId,
    gameId: input.gameId,
    machineId: input.machineId,
    difficulty: match.difficulty,
    cleared: match.outcome === 'win',
    score: Math.max(0, Math.round(match.playerBallsPocketed)),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    stats: {
      [POOL_STAT_KEYS.won]: match.outcome === 'win' ? 1 : 0,
      [POOL_STAT_KEYS.completedNaturally]: match.completedNaturally ? 1 : 0,
      [POOL_STAT_KEYS.durationMs]: match.durationMs,
      [POOL_STAT_KEYS.playerBalls]: match.playerBallsPocketed,
      [POOL_STAT_KEYS.opponentBalls]: match.opponentBallsPocketed,
      [POOL_STAT_KEYS.remainingOpponentBalls]: match.remainingOpponentBalls,
      [POOL_STAT_KEYS.ballDifference]: match.playerBallsPocketed - match.opponentBallsPocketed,
      [POOL_STAT_KEYS.playerShots]: match.playerShots,
      [POOL_STAT_KEYS.playerSuccessfulShots]: match.playerSuccessfulShots,
      [POOL_STAT_KEYS.playerScratches]: match.playerScratches,
      [POOL_STAT_KEYS.opponentScratches]: match.opponentScratches,
      [POOL_STAT_KEYS.playerFouls]: match.playerFouls,
      [POOL_STAT_KEYS.longestPlayerRun]: match.longestPlayerRun,
      [POOL_STAT_KEYS.earlyEightLoss]: match.earlyEightLoss ? 1 : 0,
      [POOL_STAT_KEYS.legalEightFinish]: match.legalEightFinish ? 1 : 0,
      [POOL_STAT_KEYS.playerGroup]:
        match.playerGroup === null ? -1 : GROUP_CODE[match.playerGroup],
    },
  };
}

/**
 * Read a {@link PoolMatchResult} back out of an {@link ArcadeGameResult}.
 *
 * The inverse of {@link buildPoolResult} for everything the results panel shows,
 * and the reason that panel needs no state of its own: the lifecycle already
 * holds the one immutable result, so the panel derives its display from THAT
 * rather than from a parallel copy the controller would have to keep in step. A
 * round-trip test pins the two together.
 *
 * Missing or malformed stats degrade to zero rather than throwing — a results
 * screen is not the place to discover a schema problem, and the validated result
 * that reached the reducer cannot have any.
 */
export function poolSummaryFromResult(result: ArcadeGameResult): PoolMatchResult {
  const stat = (key: string) => {
    const value = result.stats[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };

  const stats: PoolMatchStats = {
    playerShots: stat(POOL_STAT_KEYS.playerShots),
    opponentShots: 0,
    playerSuccessfulShots: stat(POOL_STAT_KEYS.playerSuccessfulShots),
    opponentSuccessfulShots: 0,
    playerFouls: stat(POOL_STAT_KEYS.playerFouls),
    opponentFouls: 0,
    playerScratches: stat(POOL_STAT_KEYS.playerScratches),
    opponentScratches: stat(POOL_STAT_KEYS.opponentScratches),
    ballsPocketed: stat(POOL_STAT_KEYS.playerBalls) + stat(POOL_STAT_KEYS.opponentBalls),
    cushionHits: 0,
    ballContacts: 0,
    longestPlayerRun: stat(POOL_STAT_KEYS.longestPlayerRun),
  };

  return {
    outcome: stat(POOL_STAT_KEYS.won) === 1 ? 'win' : 'loss',
    difficulty: result.difficulty === 'easy' ? 'easy' : 'normal',
    durationMs: stat(POOL_STAT_KEYS.durationMs),
    playerGroup: groupFromCode(
      typeof result.stats[POOL_STAT_KEYS.playerGroup] === 'number'
        ? (result.stats[POOL_STAT_KEYS.playerGroup] as number)
        : -1,
    ),
    playerBallsPocketed: stat(POOL_STAT_KEYS.playerBalls),
    opponentBallsPocketed: stat(POOL_STAT_KEYS.opponentBalls),
    remainingOpponentBalls: stat(POOL_STAT_KEYS.remainingOpponentBalls),
    playerShots: stats.playerShots,
    playerSuccessfulShots: stats.playerSuccessfulShots,
    playerScratches: stats.playerScratches,
    opponentScratches: stats.opponentScratches,
    playerFouls: stats.playerFouls,
    longestPlayerRun: stats.longestPlayerRun,
    earlyEightLoss: stat(POOL_STAT_KEYS.earlyEightLoss) === 1,
    legalEightFinish: stat(POOL_STAT_KEYS.legalEightFinish) === 1,
    completedNaturally: stat(POOL_STAT_KEYS.completedNaturally) === 1,
    stats,
  };
}

/** Did the player win this result? Reads the recorded flag, never re-derives it. */
export function wonPool(result: ArcadeGameResult): boolean {
  return result.stats[POOL_STAT_KEYS.won] === 1;
}

/** "2 min 14 s", for the results panel. */
export function formatPoolDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
