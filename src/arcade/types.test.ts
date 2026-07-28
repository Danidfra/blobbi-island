import { describe, it, expect } from 'vitest';

import {
  ARCADE_DIFFICULTIES,
  findNonSerialisable,
  isArcadeDifficulty,
  isJsonSerialisable,
  validateArcadeGameResult,
  type ArcadeGameResult,
} from './types';

function result(overrides: Partial<ArcadeGameResult> = {}): ArcadeGameResult {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    difficulty: 'normal',
    cleared: true,
    score: 1200,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_090_000,
    stats: { accuracy: 92 },
    ...overrides,
  };
}

const problemFields = (r: ArcadeGameResult) => {
  const v = validateArcadeGameResult(r);
  return v.ok ? [] : v.problems.map((p) => p.field);
};

describe('ArcadeGameResult validation', () => {
  it('accepts a well-formed result, with and without a seed', () => {
    expect(validateArcadeGameResult(result()).ok).toBe(true);
    expect(validateArcadeGameResult(result({ seed: 'abc' })).ok).toBe(true);
  });

  it('accepts an empty stats map', () => {
    expect(validateArcadeGameResult(result({ stats: {} })).ok).toBe(true);
  });

  it.each([
    ['runId', { runId: '' }],
    ['gameId', { gameId: '   ' }],
    ['machineId', { machineId: '' }],
    ['cleared', { cleared: 'yes' as unknown as boolean }],
    ['score', { score: -1 }],
    ['score', { score: 1.5 }],
    ['score', { score: Number.NaN }],
    ['score', { score: Number.POSITIVE_INFINITY }],
    ['startedAt', { startedAt: 0 }],
    ['endedAt', { endedAt: -5 }],
    ['seed', { seed: '' }],
  ])('rejects an invalid %s', (field, overrides) => {
    expect(problemFields(result(overrides as Partial<ArcadeGameResult>))).toContain(field);
  });

  it('rejects a run that ended before it started', () => {
    expect(problemFields(result({ startedAt: 100, endedAt: 99 }))).toContain('endedAt');
  });

  it('accepts a zero-length run (started and ended in the same millisecond)', () => {
    expect(validateArcadeGameResult(result({ startedAt: 100, endedAt: 100 })).ok).toBe(true);
  });

  it('rejects a difficulty outside the closed set', () => {
    expect(
      problemFields(result({ difficulty: 'impossible' as unknown as 'normal' })),
    ).toContain('difficulty');
  });

  it('rejects a non-numeric or non-finite stat, naming the stat', () => {
    expect(
      problemFields(result({ stats: { accuracy: Number.NaN } })),
    ).toContain('stats.accuracy');
    expect(
      problemFields(result({ stats: { combo: 'lots' as unknown as number } })),
    ).toContain('stats.combo');
  });

  it('rejects stats that are not a plain object', () => {
    expect(problemFields(result({ stats: [] as unknown as Record<string, number> }))).toContain(
      'stats',
    );
  });

  it('reports every problem, not just the first', () => {
    const v = validateArcadeGameResult(result({ runId: '', score: -1, endedAt: -1 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('recognises exactly the three difficulties', () => {
    expect([...ARCADE_DIFFICULTIES]).toEqual(['easy', 'normal', 'hard']);
    for (const d of ARCADE_DIFFICULTIES) expect(isArcadeDifficulty(d)).toBe(true);
    expect(isArcadeDifficulty('nightmare')).toBe(false);
    expect(isArcadeDifficulty(3)).toBe(false);
  });
});

describe('serialisability', () => {
  it('accepts a plain result', () => {
    expect(isJsonSerialisable(result())).toBe(true);
    expect(isJsonSerialisable(result({ seed: undefined }))).toBe(true);
  });

  it('names a function hiding in the payload', () => {
    const dirty = { ...result(), controller: () => {} };
    expect(findNonSerialisable(dirty)).toEqual(['controller']);
    expect(isJsonSerialisable(dirty)).toBe(false);
  });

  it('names a non-plain object, which JSON would silently mangle', () => {
    expect(findNonSerialisable({ ...result(), when: new Date() })).toEqual(['when']);
    expect(findNonSerialisable({ ...result(), lookup: new Map() })).toEqual(['lookup']);
  });

  it('finds problems nested inside stats and arrays', () => {
    expect(findNonSerialisable({ stats: { bad: Number.NaN } })).toEqual(['stats.bad']);
    expect(findNonSerialisable({ list: [1, undefined, 3] })).toEqual(['list[1]']);
  });
});
