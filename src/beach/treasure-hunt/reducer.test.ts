/**
 * Reducer — the round lifecycle and its invariants.
 *
 * The invariants under test: a round starts once, ends exactly once and for
 * the documented reason; a rejected action returns the SAME state reference;
 * nothing mutates after `finished`; time never goes negative or past the
 * duration; and the whole run is reproducible from `(seed, actions)`.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_TREASURE_HUNT_POLICY, type TreasureHuntPolicy } from './policy';
import {
  createTreasureHuntRound,
  treasureHuntReducer,
  treasureHuntRoundId,
  validateRoundState,
  type TreasureHuntRound,
} from './reducer';
import { distanceBetween } from './geometry';
import type { Point, TreasureHuntAction } from './types';

const POLICY = DEFAULT_TREASURE_HUNT_POLICY;

function makeRound(seed = 'reducer-seed', policy: TreasureHuntPolicy = POLICY): TreasureHuntRound {
  const created = createTreasureHuntRound({ seed, policy });
  if (!created.ok) throw new Error('round creation unexpectedly failed');
  return created.round;
}

function startedRound(seed = 'reducer-seed', policy: TreasureHuntPolicy = POLICY): TreasureHuntRound {
  return treasureHuntReducer(makeRound(seed, policy), { type: 'start' });
}

/** A dig point guaranteed to miss every unresolved target. */
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

/** A policy whose rounds always contain exactly one litter target. */
function singleTargetPolicy(shovelUses: number): TreasureHuntPolicy {
  return {
    ...POLICY,
    targetCount: 1,
    shovelUses,
    categories: {
      litter: { ...POLICY.categories.litter, minCount: 1, maxCount: 1 },
      valuable: { ...POLICY.categories.valuable, minCount: 0, maxCount: 0 },
      special: { ...POLICY.categories.special, minCount: 0, maxCount: 0 },
    },
  };
}

describe('createTreasureHuntRound', () => {
  it('creates a ready round with the policy budgets and the initial coil position', () => {
    const round = makeRound();
    expect(round.status).toBe('ready');
    expect(round.seed).toBe('reducer-seed');
    expect(round.targets).toHaveLength(POLICY.targetCount);
    expect(round.coilPosition).toEqual(POLICY.initialCoilPosition);
    expect(round.shovelUsesRemaining).toBe(POLICY.shovelUses);
    expect(round.elapsedSeconds).toBe(0);
    expect(round.digHistory).toEqual([]);
    expect(round.foundTargetIds).toEqual([]);
    expect(round.endReason).toBeNull();
    expect(validateRoundState(round)).toEqual([]);
  });

  it('derives a deterministic round id from seed and round key', () => {
    expect(makeRound('same-seed').roundId).toBe(makeRound('same-seed').roundId);
    expect(treasureHuntRoundId('s', 'attempt-1')).not.toBe(treasureHuntRoundId('s', 'attempt-2'));
    expect(treasureHuntRoundId('s')).toMatch(/^treasure-round-[0-9a-f]{8}$/);
  });

  it('propagates a typed generation failure', () => {
    const created = createTreasureHuntRound({
      seed: 'impossible',
      policy: { ...POLICY, minTargetSeparation: 0.9, maxPlacementAttempts: 30 },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.failure.code).toBe('placement-exhausted');
  });

  it('throws on an invalid policy', () => {
    expect(() =>
      createTreasureHuntRound({ seed: 's', policy: { ...POLICY, shovelUses: -1 } })
    ).toThrow(/shovelUses/);
  });
});

describe('start', () => {
  it('moves ready to searching', () => {
    const round = makeRound();
    const started = treasureHuntReducer(round, { type: 'start' });
    expect(started.status).toBe('searching');
    expect(round.status).toBe('ready'); // previous state untouched
  });

  it('is rejected while already searching', () => {
    const started = startedRound();
    expect(treasureHuntReducer(started, { type: 'start' })).toBe(started);
  });

  it('gameplay actions are rejected before start', () => {
    const round = makeRound();
    expect(treasureHuntReducer(round, { type: 'move-detector', position: { x: 0.2, y: 0.2 } })).toBe(round);
    expect(treasureHuntReducer(round, { type: 'dig', position: { x: 0.2, y: 0.2 } })).toBe(round);
    expect(treasureHuntReducer(round, { type: 'advance-time', seconds: 1 })).toBe(round);
    expect(treasureHuntReducer(round, { type: 'end-round' })).toBe(round);
  });
});

describe('move-detector', () => {
  it('moves the coil to an in-field position', () => {
    const started = startedRound();
    const moved = treasureHuntReducer(started, {
      type: 'move-detector',
      position: { x: 0.25, y: 0.75 },
    });
    expect(moved.coilPosition).toEqual({ x: 0.25, y: 0.75 });
  });

  it('rejects out-of-field and non-finite positions — no silent clamping', () => {
    const started = startedRound();
    expect(
      treasureHuntReducer(started, { type: 'move-detector', position: { x: 1.4, y: 0.5 } })
    ).toBe(started);
    expect(
      treasureHuntReducer(started, { type: 'move-detector', position: { x: Number.NaN, y: 0.5 } })
    ).toBe(started);
  });
});

describe('dig', () => {
  it('records a hit: target flagged, id listed, use consumed, history appended', () => {
    const started = startedRound();
    const buried = started.targets[0];
    const dug = treasureHuntReducer(started, { type: 'dig', position: buried.position });
    expect(dug.foundTargetIds).toEqual([buried.id]);
    expect(dug.targets.find((t) => t.id === buried.id)?.found).toBe(true);
    expect(dug.shovelUsesRemaining).toBe(started.shovelUsesRemaining - 1);
    expect(dug.digHistory).toEqual([
      { position: buried.position, outcome: 'hit', targetId: buried.id },
    ]);
    expect(validateRoundState(dug)).toEqual([]);
    // The previous state was not mutated.
    expect(started.targets.find((t) => t.id === buried.id)?.found).toBe(false);
    expect(started.foundTargetIds).toEqual([]);
  });

  it('records a miss and still consumes a use', () => {
    const started = startedRound();
    const point = missPoint(started);
    const dug = treasureHuntReducer(started, { type: 'dig', position: point });
    expect(dug.digHistory).toEqual([{ position: point, outcome: 'miss', targetId: null }]);
    expect(dug.foundTargetIds).toEqual([]);
    expect(dug.shovelUsesRemaining).toBe(started.shovelUsesRemaining - 1);
    expect(validateRoundState(dug)).toEqual([]);
  });

  it('a rejected dig changes nothing and consumes nothing', () => {
    const started = startedRound();
    expect(
      treasureHuntReducer(started, { type: 'dig', position: { x: Number.NaN, y: 0.5 } })
    ).toBe(started);
    expect(
      treasureHuntReducer(started, { type: 'dig', position: { x: 2, y: 0.5 } })
    ).toBe(started);
  });

  it('cannot find the same target twice', () => {
    const started = startedRound();
    const buried = started.targets[0];
    const once = treasureHuntReducer(started, { type: 'dig', position: buried.position });
    const twice = treasureHuntReducer(once, { type: 'dig', position: buried.position });
    if (twice.status === 'finished') return; // budget ran out — equally fine
    expect(twice.foundTargetIds.filter((id) => id === buried.id)).toHaveLength(1);
    expect(twice.digHistory[1].outcome).toBe('miss');
  });
});

describe('advance-time', () => {
  it('accumulates explicit deltas', () => {
    const started = startedRound();
    const later = treasureHuntReducer(
      treasureHuntReducer(started, { type: 'advance-time', seconds: 10 }),
      { type: 'advance-time', seconds: 5.5 }
    );
    expect(later.elapsedSeconds).toBeCloseTo(15.5, 10);
    expect(later.status).toBe('searching');
  });

  it('rejects zero, negative and non-finite deltas', () => {
    const started = startedRound();
    expect(treasureHuntReducer(started, { type: 'advance-time', seconds: 0 })).toBe(started);
    expect(treasureHuntReducer(started, { type: 'advance-time', seconds: -3 })).toBe(started);
    expect(treasureHuntReducer(started, { type: 'advance-time', seconds: Number.NaN })).toBe(started);
  });

  it('ends the round as time-expired, capping elapsed at the duration', () => {
    const started = startedRound();
    const ended = treasureHuntReducer(started, {
      type: 'advance-time',
      seconds: POLICY.roundDurationSeconds + 999,
    });
    expect(ended.status).toBe('finished');
    expect(ended.endReason).toBe('time-expired');
    expect(ended.elapsedSeconds).toBe(POLICY.roundDurationSeconds);
    expect(validateRoundState(ended)).toEqual([]);
  });

  it('ends exactly at the boundary too', () => {
    const started = startedRound();
    const ended = treasureHuntReducer(started, {
      type: 'advance-time',
      seconds: POLICY.roundDurationSeconds,
    });
    expect(ended.endReason).toBe('time-expired');
  });
});

describe('round endings', () => {
  it('ends with no-shovel-uses when the last dig misses with targets left', () => {
    const started = startedRound('depletion', singleTargetPolicy(1));
    const ended = treasureHuntReducer(started, { type: 'dig', position: missPoint(started) });
    expect(ended.status).toBe('finished');
    expect(ended.endReason).toBe('no-shovel-uses');
    expect(ended.shovelUsesRemaining).toBe(0);
  });

  it('ends with all-targets-found when the last target is dug up', () => {
    const started = startedRound('sweep', singleTargetPolicy(5));
    const ended = treasureHuntReducer(started, {
      type: 'dig',
      position: started.targets[0].position,
    });
    expect(ended.status).toBe('finished');
    expect(ended.endReason).toBe('all-targets-found');
    expect(ended.shovelUsesRemaining).toBe(4);
  });

  it('precedence: success outranks shovel depletion when both trigger on one dig', () => {
    const started = startedRound('photo-finish', singleTargetPolicy(1));
    const ended = treasureHuntReducer(started, {
      type: 'dig',
      position: started.targets[0].position,
    });
    expect(ended.shovelUsesRemaining).toBe(0); // both conditions genuinely true
    expect(ended.foundTargetIds).toHaveLength(1);
    expect(ended.endReason).toBe('all-targets-found');
  });

  it('ends by the player, only from searching', () => {
    const started = startedRound();
    const ended = treasureHuntReducer(started, { type: 'end-round' });
    expect(ended.status).toBe('finished');
    expect(ended.endReason).toBe('ended-by-player');
  });

  it('a finished round is inert: every action returns the same reference', () => {
    const ended = treasureHuntReducer(startedRound(), { type: 'end-round' });
    const actions: TreasureHuntAction[] = [
      { type: 'start' },
      { type: 'move-detector', position: { x: 0.4, y: 0.4 } },
      { type: 'dig', position: { x: 0.4, y: 0.4 } },
      { type: 'advance-time', seconds: 10 },
      { type: 'end-round' },
    ];
    for (const action of actions) {
      expect(treasureHuntReducer(ended, action)).toBe(ended);
    }
  });
});

describe('determinism end to end', () => {
  it('replays the same actions to the same final state', () => {
    const script: TreasureHuntAction[] = [
      { type: 'start' },
      { type: 'move-detector', position: { x: 0.3, y: 0.4 } },
      { type: 'advance-time', seconds: 12 },
      { type: 'dig', position: { x: 0.3, y: 0.4 } },
      { type: 'advance-time', seconds: 30 },
      { type: 'end-round' },
    ];
    const run = () => script.reduce(treasureHuntReducer, makeRound('replay'));
    expect(run()).toEqual(run());
  });
});

describe('validateRoundState', () => {
  it('flags inconsistent found bookkeeping and shovel arithmetic', () => {
    const started = startedRound();
    const corrupted: TreasureHuntRound = {
      ...started,
      foundTargetIds: ['target-1'],
      shovelUsesRemaining: started.shovelUsesRemaining + 1,
    };
    const violations = validateRoundState(corrupted);
    expect(violations.some((v) => v.includes('foundTargetIds'))).toBe(true);
    expect(violations.some((v) => v.includes('shovelUsesRemaining'))).toBe(true);
  });
});
