/**
 * Air Hockey result — the join between a match and the shared arcade contract.
 *
 * The whole point of these tests is that a result is the ONE thing that leaves
 * the game: the lifecycle validates it, the results panel renders it, and one
 * day a reward policy will read it. So the tests check three properties, in
 * order of how badly a break would hurt:
 *
 *  1. it passes `validateArcadeGameResult`, or the reducer refuses it and the
 *     match silently produces nothing;
 *  2. it survives a JSON round trip, or a persisted claim could never be
 *     replayed;
 *  3. it round-trips back to the game's own summary, so the panel and the
 *     reward policy read the same match the player played.
 */

import { describe, it, expect } from 'vitest';

import { validateArcadeGameResult, findNonSerialisable } from '../types';
import { createHockeyMatch, stepHockeyMatch, type HockeyMatchState } from './match';
import { FIXED_STEP_MS, TABLE_CENTER_X, TABLE_HEIGHT } from './table';
import {
  HOCKEY_STAT_KEYS,
  buildAirHockeyResult,
  formatMatchDuration,
  summariseHockeyMatch,
  summaryFromResult,
  wonAirHockey,
} from './hockey-result';

const DT = FIXED_STEP_MS / 1000;

/** A finished match with a known scoreline, built without playing one. */
function decided(playerScore: number, opponentScore: number): HockeyMatchState {
  return {
    ...createHockeyMatch({ difficulty: 'normal', targetGoals: 7, seed: 5 }),
    phase: 'over',
    playerScore,
    opponentScore,
    elapsedMs: 154_320.6,
    stats: { playerHits: 41, opponentHits: 38, wallBounces: 96, topPuckSpeed: 168.44 },
  };
}

const RESULT_INPUT = {
  runId: 'hockey-run-1',
  machineId: 'arcade-air-hockey',
  gameId: 'blobbi-air-hockey',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_154_320,
};

describe('summarising a match', () => {
  it('reads a win as a win, with the margin', () => {
    const summary = summariseHockeyMatch(decided(7, 4));
    expect(summary.outcome).toBe('win');
    expect(summary.scoreDifference).toBe(3);
    expect(summary.completedNaturally).toBe(true);
  });

  it('reads a loss as a loss, with a negative margin', () => {
    const summary = summariseHockeyMatch(decided(2, 7));
    expect(summary.outcome).toBe('loss');
    expect(summary.scoreDifference).toBe(-5);
  });

  it('rounds the duration to whole milliseconds and never goes negative', () => {
    expect(summariseHockeyMatch(decided(7, 0)).durationMs).toBe(154_321);
    expect(
      summariseHockeyMatch({ ...decided(7, 0), elapsedMs: -5 }).durationMs,
    ).toBe(0);
  });

  it('refuses to call an unfinished match completed', () => {
    // The flag a future reward policy would gate on. A match still in play has
    // a scoreline, and it is not a result.
    const midMatch = { ...decided(3, 2), phase: 'live' as const };
    expect(summariseHockeyMatch(midMatch).completedNaturally).toBe(false);
  });
});

describe('building the arcade result', () => {
  const result = buildAirHockeyResult({
    ...RESULT_INPUT,
    match: summariseHockeyMatch(decided(7, 4)),
  });

  it('passes the shared validator', () => {
    // The reducer runs exactly this check before accepting a result, so a
    // failure here is a match that finishes and produces nothing.
    expect(validateArcadeGameResult(result)).toEqual({ ok: true });
  });

  it('is serialisable, so a persisted claim could survive a refresh', () => {
    expect(findNonSerialisable(result)).toEqual([]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('carries the identity it was given, never one it derived', () => {
    expect(result.runId).toBe('hockey-run-1');
    expect(result.gameId).toBe('blobbi-air-hockey');
    expect(result.machineId).toBe('arcade-air-hockey');
    expect(result.difficulty).toBe('normal');
  });

  it('scores the player’s goals, because that is the only score in this game', () => {
    expect(result.score).toBe(7);
  });

  it('treats a WIN as cleared, not a completed match', () => {
    // Finishing a 0–7 loss is a completed match and an uncleared one, and a
    // reward policy must be able to tell them apart.
    expect(result.cleared).toBe(true);
    const lost = buildAirHockeyResult({
      ...RESULT_INPUT,
      match: summariseHockeyMatch(decided(1, 7)),
    });
    expect(lost.cleared).toBe(false);
    expect(lost.score).toBe(1);
    expect(validateArcadeGameResult(lost)).toEqual({ ok: true });
  });

  it('carries a negative margin in stats, where negatives are legal', () => {
    // `score` must be a non-negative integer by contract, so the margin — which
    // is the interesting number and can be negative — travels separately.
    const lost = buildAirHockeyResult({
      ...RESULT_INPUT,
      match: summariseHockeyMatch(decided(1, 7)),
    });
    expect(lost.stats[HOCKEY_STAT_KEYS.goalDifference]).toBe(-6);
    expect(validateArcadeGameResult(lost)).toEqual({ ok: true });
  });

  it('reports every stat as a finite number', () => {
    for (const [key, value] of Object.entries(result.stats)) {
      expect(Number.isFinite(value), key).toBe(true);
    }
  });

  it('records the boolean facts as 1 and 0', () => {
    expect(result.stats[HOCKEY_STAT_KEYS.won]).toBe(1);
    expect(result.stats[HOCKEY_STAT_KEYS.completedNaturally]).toBe(1);
    expect(wonAirHockey(result)).toBe(true);
  });

  it('is deterministic: no clock, no randomness', () => {
    const again = buildAirHockeyResult({
      ...RESULT_INPUT,
      match: summariseHockeyMatch(decided(7, 4)),
    });
    expect(again).toEqual(result);
  });
});

describe('reading a result back', () => {
  it('round-trips to the same summary the panel would have rendered', () => {
    // Why the results panel needs no state of its own: the lifecycle holds the
    // one immutable result, and the display is derived from it.
    const summary = summariseHockeyMatch(decided(7, 4));
    const result = buildAirHockeyResult({ ...RESULT_INPUT, match: summary });
    expect(summaryFromResult(result)).toEqual({
      ...summary,
      // The only lossy field: top speed is rounded on the way into `stats`.
      stats: { ...summary.stats, topPuckSpeed: Math.round(summary.stats.topPuckSpeed) },
    });
  });

  it('degrades a missing stat to zero rather than throwing', () => {
    const result = buildAirHockeyResult({
      ...RESULT_INPUT,
      match: summariseHockeyMatch(decided(7, 4)),
    });
    const stripped = { ...result, stats: {} };
    expect(() => summaryFromResult(stripped)).not.toThrow();
    expect(summaryFromResult(stripped).playerScore).toBe(0);
  });
});

describe('a result built from a real played match', () => {
  it('validates end to end', () => {
    // Nothing synthetic: play a one-goal match to its conclusion and check the
    // object it produces is one the arcade will accept.
    let state = createHockeyMatch({ targetGoals: 1, seed: 21 });
    state = {
      ...state,
      phase: 'live',
      puck: { x: TABLE_CENTER_X, y: 8, vx: 0, vy: -120 },
    };
    for (let i = 0; i < 400 && state.phase !== 'over'; i += 1) {
      state = stepHockeyMatch(state, DT, {
        playerTarget: { x: TABLE_CENTER_X, y: TABLE_HEIGHT - 26 },
      }).state;
    }

    expect(state.phase).toBe('over');
    const result = buildAirHockeyResult({
      ...RESULT_INPUT,
      match: summariseHockeyMatch(state),
    });
    expect(validateArcadeGameResult(result)).toEqual({ ok: true });
    expect(result.score).toBe(1);
    expect(result.cleared).toBe(true);
  });
});

describe('formatting a duration', () => {
  it('reads as minutes and seconds once past a minute', () => {
    expect(formatMatchDuration(154_321)).toBe('2m 34s');
    expect(formatMatchDuration(60_000)).toBe('1m 00s');
  });

  it('reads as plain seconds under a minute', () => {
    expect(formatMatchDuration(42_000)).toBe('42s');
  });

  it('never reports a negative', () => {
    expect(formatMatchDuration(-1)).toBe('0s');
  });
});
