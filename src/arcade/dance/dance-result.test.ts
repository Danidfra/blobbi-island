/**
 * Result-contract tests.
 *
 * The result is the object that crosses every boundary in the arcade: it is
 * validated, persisted into a pending claim, read by the reward policy, and
 * rendered. So the things worth pinning are that it VALIDATES, that it
 * SERIALISES, and that the stat keys the reward policy reads are the stat keys
 * the game writes.
 */
import { describe, it, expect } from 'vitest';

import {
  DANCE_CLEAR_ACCURACY,
  DANCE_STAT_KEYS,
  buildDanceResult,
  completedNaturally,
  resultAccuracy,
  wasFullCombo,
} from './dance-result';
import { NEON_HOP_CHART } from './chart';
import { NEON_HOP_TRACK } from './track';
import type { DanceRunSummary } from './judgment';
import { findNonSerialisable, validateArcadeGameResult } from '../types';

function summary(overrides: Partial<DanceRunSummary> = {}): DanceRunSummary {
  return {
    score: 128_400,
    maxBaseScore: 110_000,
    baseScore: 104_500,
    accuracy: 95,
    grade: 'S',
    perfect: 100,
    good: 8,
    okay: 2,
    miss: 0,
    maxCombo: 110,
    totalNotes: 110,
    resolvedNotes: 110,
    fullCombo: true,
    averageAbsoluteOffsetMs: 24.5,
    ghostInputs: 3,
    ...overrides,
  };
}

const build = (
  summaryOverrides: Partial<DanceRunSummary> = {},
  completed = true,
) =>
  buildDanceResult({
    runId: 'run-1',
    machineId: 'arcade-dance-machine',
    gameId: 'blobbi-dance',
    chart: NEON_HOP_CHART,
    track: NEON_HOP_TRACK,
    summary: summary(summaryOverrides),
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_068_000,
    completedNaturally: completed,
  });

describe('building a result', () => {
  it('produces a result the shared validator accepts', () => {
    expect(validateArcadeGameResult(build())).toEqual({ ok: true });
  });

  it('is JSON-serialisable, so a pending claim can survive a refresh', () => {
    expect(findNonSerialisable(build())).toEqual([]);
    expect(JSON.parse(JSON.stringify(build()))).toEqual(build());
  });

  it('is deterministic: same input, identical object', () => {
    expect(build()).toEqual(build());
  });

  it('echoes the chart difficulty rather than hardcoding one', () => {
    expect(build().difficulty).toBe(NEON_HOP_CHART.difficulty);
  });

  it('carries the run, machine and game identity through unchanged', () => {
    expect(build()).toMatchObject({
      runId: 'run-1',
      machineId: 'arcade-dance-machine',
      gameId: 'blobbi-dance',
    });
  });

  it('records the duration from the two timestamps, never from a clock', () => {
    expect(build().stats[DANCE_STAT_KEYS.durationMs]).toBe(68_000);
  });

  it('reports the chart version, so an old result can be interpreted later', () => {
    expect(build().stats[DANCE_STAT_KEYS.chartVersion]).toBe(NEON_HOP_CHART.version);
  });

  it('stores every stat as a finite number', () => {
    for (const [key, value] of Object.entries(build().stats)) {
      expect(Number.isFinite(value), `${key} is not finite`).toBe(true);
    }
  });
});

describe('cleared', () => {
  it('needs both a natural finish and the clear accuracy', () => {
    expect(build({ accuracy: DANCE_CLEAR_ACCURACY }).cleared).toBe(true);
    expect(build({ accuracy: DANCE_CLEAR_ACCURACY - 0.1 }).cleared).toBe(false);
    expect(build({ accuracy: 100 }, false).cleared).toBe(false);
  });
});

describe('the accessors the reward policy reads through', () => {
  it('reports a natural completion as a 1, not a boolean', () => {
    expect(build().stats[DANCE_STAT_KEYS.completedNaturally]).toBe(1);
    expect(build({}, false).stats[DANCE_STAT_KEYS.completedNaturally]).toBe(0);
    expect(completedNaturally(build())).toBe(true);
    expect(completedNaturally(build({}, false))).toBe(false);
  });

  it('reports a full combo the same way', () => {
    expect(wasFullCombo(build())).toBe(true);
    expect(wasFullCombo(build({ fullCombo: false }))).toBe(false);
  });

  it('refuses an accuracy outside 0–100 rather than passing it on', () => {
    expect(resultAccuracy(build({ accuracy: 95 }))).toBe(95);
    expect(resultAccuracy(build({ accuracy: 101 }))).toBeNull();
    expect(resultAccuracy(build({ accuracy: -1 }))).toBeNull();
    const noStats = { ...build(), stats: {} };
    expect(resultAccuracy(noStats)).toBeNull();
  });
});
