/**
 * Blobbi Dance → the shared arcade result contract.
 *
 * `ArcadeGameResult` is deliberately generic: an id, a score, two timestamps and
 * an open map of NUMBERS. This module is the single place the dance game's
 * vocabulary is translated into it, so the stat KEYS the reward policy reads are
 * defined once and cannot be misspelled into existence somewhere else.
 *
 * ## Why the stats are numbers and not booleans
 *
 * `stats` is `Record<string, number>` by contract (Phase 2, `types.ts`), which
 * the results UI renders generically and the reward policy reads from. Two facts
 * the policy needs are logically boolean, "did the run finish naturally?" and
 * "was it a full combo?": so they travel as `1` / `0`. That is a real cost in
 * legibility, and it buys something worth more: no change to a persisted,
 * validated result shape that Phase 2 shipped and that a stored pending claim
 * must still parse after a refresh.
 */

import type { ArcadeGameResult } from '../types';
import type { DanceChart } from './chart';
import type { DanceRunSummary } from './judgment';
import type { DanceTrack } from './track';

/** Every stat key the dance game reports. The reward policy reads from here. */
export const DANCE_STAT_KEYS = {
  accuracy: 'accuracy',
  maxCombo: 'maxCombo',
  perfect: 'perfect',
  good: 'good',
  okay: 'okay',
  miss: 'miss',
  totalNotes: 'totalNotes',
  maxBaseScore: 'maxBaseScore',
  baseScore: 'baseScore',
  fullCombo: 'fullCombo',
  completedNaturally: 'completedNaturally',
  durationMs: 'durationMs',
  averageAbsoluteOffsetMs: 'averageAbsoluteOffsetMs',
  ghostInputs: 'ghostInputs',
  chartVersion: 'chartVersion',
} as const;

/**
 * Accuracy at or above which a run counts as CLEARED.
 *
 * The same 60% that earns the first accuracy tier, and deliberately so: below it
 * a run pays the shared participation floor and nothing else, at or above it the
 * dance policy's own tiers take over. One threshold, one meaning.
 */
export const DANCE_CLEAR_ACCURACY = 60;

export interface BuildDanceResultInput {
  readonly runId: string;
  readonly machineId: string;
  readonly gameId: string;
  readonly chart: DanceChart;
  readonly track: DanceTrack;
  readonly summary: DanceRunSummary;
  /** Epoch ms when the countdown ended and the clock started. */
  readonly startedAt: number;
  /** Epoch ms when the run ended. */
  readonly endedAt: number;
  /**
   * True only when the song reached its end.
   *
   * A run that was closed, quit or interrupted never reaches this function, the
   * lifecycle reducer refuses a result outside `playing` and an aborted run has
   * none. The flag exists so the reward policy can state its eligibility rule in
   * terms of the RESULT rather than in terms of a lifecycle state it cannot see.
   */
  readonly completedNaturally: boolean;
}

/**
 * Build the one immutable result a finished run produces.
 *
 * Deterministic given its input: no clock, no randomness, no I/O. The caller
 * supplies both timestamps precisely so that a test can assert an exact result
 * object rather than a shape.
 */
export function buildDanceResult(input: BuildDanceResultInput): ArcadeGameResult {
  const { summary } = input;
  const cleared = input.completedNaturally && summary.accuracy >= DANCE_CLEAR_ACCURACY;

  return {
    runId: input.runId,
    gameId: input.gameId,
    machineId: input.machineId,
    // One authored chart, one difficulty. `difficulty` is echoed from the chart
    // rather than hardcoded, so a second chart cannot forget to change it.
    difficulty: input.chart.difficulty,
    cleared,
    score: Math.max(0, Math.round(summary.score)),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    stats: {
      [DANCE_STAT_KEYS.accuracy]: summary.accuracy,
      [DANCE_STAT_KEYS.maxCombo]: summary.maxCombo,
      [DANCE_STAT_KEYS.perfect]: summary.perfect,
      [DANCE_STAT_KEYS.good]: summary.good,
      [DANCE_STAT_KEYS.okay]: summary.okay,
      [DANCE_STAT_KEYS.miss]: summary.miss,
      [DANCE_STAT_KEYS.totalNotes]: summary.totalNotes,
      [DANCE_STAT_KEYS.maxBaseScore]: summary.maxBaseScore,
      [DANCE_STAT_KEYS.baseScore]: summary.baseScore,
      [DANCE_STAT_KEYS.fullCombo]: summary.fullCombo ? 1 : 0,
      [DANCE_STAT_KEYS.completedNaturally]: input.completedNaturally ? 1 : 0,
      [DANCE_STAT_KEYS.durationMs]: Math.max(0, input.endedAt - input.startedAt),
      [DANCE_STAT_KEYS.averageAbsoluteOffsetMs]: summary.averageAbsoluteOffsetMs,
      [DANCE_STAT_KEYS.ghostInputs]: summary.ghostInputs,
      [DANCE_STAT_KEYS.chartVersion]: input.chart.version,
    },
  };
}

/** Did this result come from a run that reached the end of the song? */
export function completedNaturally(result: ArcadeGameResult): boolean {
  return result.stats[DANCE_STAT_KEYS.completedNaturally] === 1;
}

/** Was every note in the chart hit? */
export function wasFullCombo(result: ArcadeGameResult): boolean {
  return result.stats[DANCE_STAT_KEYS.fullCombo] === 1;
}

/** Accuracy as a 0–100 percentage, or `null` when the stat is unusable. */
export function resultAccuracy(result: ArcadeGameResult): number | null {
  const value = result.stats[DANCE_STAT_KEYS.accuracy];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}
