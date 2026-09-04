/**
 * Result: a pure, economy-neutral projection of a finished round.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_TREASURE_HUNT_POLICY, type TreasureHuntPolicy } from './policy';
import {
  createTreasureHuntRound,
  treasureHuntReducer,
  type TreasureHuntRound,
} from './reducer';
import { buildTreasureHuntResult } from './result';
import { distanceBetween } from './geometry';
import type { Point } from './types';

const POLICY = DEFAULT_TREASURE_HUNT_POLICY;

function startedRound(seed: string, policy: TreasureHuntPolicy = POLICY): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed, policy });
  if (!created.ok) throw new Error('round creation unexpectedly failed');
  return treasureHuntReducer(created.round, { type: 'start' });
}

function missPoint(round: TreasureHuntRound): Point {
  for (let x = 0.02; x < round.policy.fieldWidth; x += 0.01) {
    for (let y = 0.02; y < round.policy.fieldHeight; y += 0.01) {
      const point = { x, y };
      const clear = round.targets.every(
        (target) => target.found || distanceBetween(point, target.position) > target.digRadius
      );
      if (clear) return point;
    }
  }
  throw new Error('no miss point exists on this field');
}

/** start → dig two targets → one miss → advance 45 s → end by the player. */
function playScriptedRound(seed = 'result-seed'): TreasureHuntRound {
  let round = startedRound(seed);
  round = treasureHuntReducer(round, { type: 'dig', position: round.targets[0].position });
  round = treasureHuntReducer(round, { type: 'dig', position: missPoint(round) });
  round = treasureHuntReducer(round, { type: 'dig', position: round.targets[1].position });
  round = treasureHuntReducer(round, { type: 'advance-time', seconds: 45 });
  return treasureHuntReducer(round, { type: 'end-round' });
}

describe('buildTreasureHuntResult', () => {
  it('refuses an unfinished round', () => {
    const created = createTreasureHuntRound({ seed: 'unfinished' });
    if (!created.ok) throw new Error('round creation unexpectedly failed');
    expect(() => buildTreasureHuntResult(created.round)).toThrow(/not finished/);
    const searching = treasureHuntReducer(created.round, { type: 'start' });
    expect(() => buildTreasureHuntResult(searching)).toThrow(/not finished/);
  });

  it('reports identity, end reason, duration and dig statistics', () => {
    const finished = playScriptedRound();
    const result = buildTreasureHuntResult(finished);
    expect(result.roundId).toBe(finished.roundId);
    expect(result.seed).toBe('result-seed');
    expect(result.endReason).toBe('ended-by-player');
    expect(result.durationSeconds).toBe(45);
    expect(result.shovelUsesSpent).toBe(3);
    expect(result.successfulDigs).toBe(2);
    expect(result.missedDigs).toBe(1);
  });

  it('groups finds by category with the policy unit values', () => {
    const finished = playScriptedRound();
    const result = buildTreasureHuntResult(finished);
    const foundTargets = finished.foundTargetIds.map((id) => {
      const target = finished.targets.find((t) => t.id === id);
      if (!target) throw new Error(`found id ${id} missing from targets`);
      return target;
    });
    const expectFinds = (category: 'litter' | 'valuable' | 'special') =>
      foundTargets
        .filter((t) => t.category === category)
        .map((t) => ({ targetId: t.id, kind: t.kind, rawValue: t.rawValue }));
    expect(result.litterFinds).toEqual(expectFinds('litter'));
    expect(result.valuableFinds).toEqual(expectFinds('valuable'));
    expect(result.specialFinds).toEqual(expectFinds('special'));
    expect(result.rawCleanupValue).toBe(
      result.litterFinds.reduce((sum, find) => sum + find.rawValue, 0)
    );
    expect(result.rawTreasureValue).toBe(
      result.valuableFinds.reduce((sum, find) => sum + find.rawValue, 0)
    );
  });

  it('is deterministic: the same finished round projects the same result', () => {
    expect(buildTreasureHuntResult(playScriptedRound())).toEqual(
      buildTreasureHuntResult(playScriptedRound())
    );
  });

  it('reports a special find as a candidate, never as granted inventory', () => {
    const specialOnly: TreasureHuntPolicy = {
      ...POLICY,
      targetCount: 1,
      categories: {
        litter: { ...POLICY.categories.litter, minCount: 0, maxCount: 0 },
        valuable: { ...POLICY.categories.valuable, minCount: 0, maxCount: 0 },
        special: { ...POLICY.categories.special, minCount: 1, maxCount: 1 },
      },
    };
    let round = startedRound('special-round', specialOnly);
    round = treasureHuntReducer(round, { type: 'dig', position: round.targets[0].position });
    const result = buildTreasureHuntResult(round);
    expect(round.endReason).toBe('all-targets-found');
    expect(result.specialCandidateFound).toBe(true);
    expect(result.specialFinds).toHaveLength(1);
    expect(result.specialFinds[0].kind).toBe('special-candidate');
    // The special slot contributes no units; nothing here prices a rare item.
    expect(result.rawTreasureValue).toBe(0);
    expect(result.rawCleanupValue).toBe(0);
  });

  it('exposes exactly the economy-neutral contract; no grant/address/Coin fields', () => {
    const result = buildTreasureHuntResult(playScriptedRound());
    expect(Object.keys(result).sort()).toEqual(
      [
        'roundId',
        'seed',
        'endReason',
        'durationSeconds',
        'shovelUsesSpent',
        'successfulDigs',
        'missedDigs',
        'litterFinds',
        'valuableFinds',
        'specialFinds',
        'rawCleanupValue',
        'rawTreasureValue',
        'specialCandidateFound',
      ].sort()
    );
    expect(Object.keys(result.litterFinds[0] ?? result.valuableFinds[0]).sort()).toEqual([
      'kind',
      'rawValue',
      'targetId',
    ]);
  });

  it('reflects a no-shovel-uses ending with all misses', () => {
    let round = startedRound('all-misses');
    for (let i = 0; i < POLICY.shovelUses; i += 1) {
      round = treasureHuntReducer(round, { type: 'dig', position: missPoint(round) });
    }
    expect(round.status).toBe('finished');
    const result = buildTreasureHuntResult(round);
    expect(result.endReason).toBe('no-shovel-uses');
    expect(result.successfulDigs).toBe(0);
    expect(result.missedDigs).toBe(POLICY.shovelUses);
    expect(result.rawCleanupValue).toBe(0);
    expect(result.rawTreasureValue).toBe(0);
    expect(result.specialCandidateFound).toBe(false);
  });
});
