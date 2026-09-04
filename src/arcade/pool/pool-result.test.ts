/**
 * Pool's result: the join point a future reward policy would read.
 *
 * Two things are being pinned:
 *
 *  - the SHAPE survives the arcade's own validator, so a finished frame can
 *    actually reach the lifecycle reducer;
 *  - the round trip is lossless for everything the results screen shows, which
 *    is why that screen needs no state of its own.
 */
import { describe, it, expect } from 'vitest';

import { findNonSerialisable, validateArcadeGameResult } from '../types';
import {
  POOL_STAT_KEYS,
  buildPoolResult,
  formatPoolDuration,
  poolSummaryFromResult,
  summarisePoolMatch,
  wonPool,
} from './pool-result';
import {
  applyPlayerShot,
  createPoolMatch,
  placePlayerCueBall,
  stepPoolMatch,
  type PoolMatchState,
} from './match';
import { FIXED_STEP_MS, POCKETS } from './table';
import { CUE_BALL, EIGHT_BALL, findBall, type PoolBall } from './physics';
import { poolSeedFrom } from './rack';
import { createPoolPhysicsWorld, type PoolPhysicsWorld } from './pool-physics-world';

const DT = FIXED_STEP_MS / 1000;

function ball(number: number, x: number, y: number, pocketed = false): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed };
}

/**
 * A world per fixture.
 *
 * The frames below are played for real, so each one needs its own simulation,
 * the match holds snapshots, not bodies.
 */
function freshWorld(balls: readonly PoolBall[]): PoolPhysicsWorld {
  const world = createPoolPhysicsWorld();
  world.reset(balls);
  return world;
}

function runUntil(
  start: PoolMatchState,
  world: PoolPhysicsWorld,
  done: (s: PoolMatchState) => boolean,
  max = 60_000,
) {
  let state = start;
  for (let i = 0; i < max && !done(state); i += 1) state = stepPoolMatch(state, DT, world).state;
  return state;
}

/** A frame the player wins by potting the 8-ball cleanly. */
function wonFrame(): PoolMatchState {
  const corner = POCKETS[2];
  const eight = { x: corner.x - 40, y: corner.y + 20 };
  const dx = corner.x - eight.x;
  const dy = corner.y - eight.y;
  const length = Math.hypot(dx, dy);
  const cue = { x: eight.x - (dx / length) * 40, y: eight.y - (dy / length) * 40 };

  const start = createPoolMatch({ seed: 5 });
  const world = freshWorld(start.balls);
  const base = runUntil(start, world, (s) => s.phase === 'aiming');
  const onTheEight: PoolMatchState = {
    ...base,
    broken: true,
    assignment: { player: 'solids', opponent: 'stripes' },
    balls: [
      ball(CUE_BALL, cue.x, cue.y),
      ball(EIGHT_BALL, eight.x, eight.y),
      ball(9, 60, 90),
      ball(10, 40, 20),
      // The player's seven are all down; two of the rival's are too.
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ball(n, 0, 0, true)),
      ...[11, 12].map((n) => ball(n, 0, 0, true)),
      ...[13, 14, 15].map((n, i) => ball(n, 150 + i * 8, 70)),
    ],
    stats: {
      ...base.stats,
      playerShots: 9,
      playerSuccessfulShots: 7,
      playerScratches: 1,
      opponentScratches: 2,
      playerFouls: 1,
      longestPlayerRun: 4,
    },
  };

  world.reset(onTheEight.balls);
  const settled = runUntil(
    applyPlayerShot({ ...onTheEight, balls: world.snapshot() }, Math.atan2(dy, dx), 0.55, world)
      .state,
    world,
    (s) => s.phase !== 'rolling',
  );
  const over = runUntil(settled, world, (s) => s.phase === 'over');
  world.dispose();
  return over;
}

describe('summarising a frame', () => {
  const state = wonFrame();
  const summary = summarisePoolMatch(state);

  it('reads the frame the way a person would describe it', () => {
    expect(state.winner).toBe('player');
    expect(summary.outcome).toBe('win');
    expect(summary.legalEightFinish).toBe(true);
    expect(summary.earlyEightLoss).toBe(false);
    expect(summary.completedNaturally).toBe(true);
    expect(summary.playerGroup).toBe('solids');
  });

  it('counts each side’s own balls, not everything that dropped', () => {
    expect(summary.playerBallsPocketed).toBe(7);
    expect(summary.opponentBallsPocketed).toBe(2);
    expect(summary.remainingOpponentBalls).toBe(5);
    expect(summary.playerBallsPocketed + 0).toBe(7 - summary.remainingOpponentBalls + 5);
  });

  it('carries the counters the results screen shows', () => {
    expect(summary.playerShots).toBeGreaterThanOrEqual(9);
    expect(summary.playerSuccessfulShots).toBe(7);
    expect(summary.playerScratches).toBe(1);
    expect(summary.opponentScratches).toBe(2);
    expect(summary.longestPlayerRun).toBe(4);
    expect(summary.durationMs).toBeGreaterThan(0);
  });

  it('is deterministic and reads nothing outside its argument', () => {
    expect(summarisePoolMatch(state)).toEqual(summary);
  });

  it('reports an open table honestly rather than inventing a group', () => {
    const start = createPoolMatch({ seed: 3 });
    const world = freshWorld(start.balls);
    const open = runUntil(start, world, (s) => s.phase === 'aiming');
    world.dispose();
    const openSummary = summarisePoolMatch(open);
    expect(openSummary.playerGroup).toBeNull();
    expect(openSummary.playerBallsPocketed).toBe(0);
    expect(openSummary.opponentBallsPocketed).toBe(0);
    expect(openSummary.completedNaturally).toBe(false);
    expect(openSummary.outcome).toBe('loss');
  });

  it('blames an early 8-ball on the player only when the PLAYER shot it', () => {
    const start = createPoolMatch({ seed: 9 });
    const world = freshWorld(start.balls);
    const base = runUntil(start, world, (s) => s.phase === 'aiming');
    world.dispose();
    const mine: PoolMatchState = {
      ...base,
      phase: 'over',
      winner: 'opponent',
      ending: 'early-eight',
      lastShooter: 'player',
      assignment: { player: 'solids', opponent: 'stripes' },
    };
    expect(summarisePoolMatch(mine).earlyEightLoss).toBe(true);

    const theirs: PoolMatchState = { ...mine, winner: 'player', lastShooter: 'opponent' };
    expect(summarisePoolMatch(theirs).earlyEightLoss).toBe(false);
    expect(summarisePoolMatch(theirs).outcome).toBe('win');
  });
});

describe('the arcade contract', () => {
  const summary = summarisePoolMatch(wonFrame());
  const result = buildPoolResult({
    runId: 'pool-run-1',
    machineId: 'arcade-pool-table',
    gameId: 'blobbi-pool',
    match: summary,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_240_000,
  });

  it('passes the validator the lifecycle reducer runs', () => {
    expect(validateArcadeGameResult(result)).toEqual({ ok: true });
  });

  it('survives JSON, so a claim could be persisted across a refresh', () => {
    expect(findNonSerialisable(result)).toEqual([]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('scores the frame by the player’s own balls', () => {
    expect(result.score).toBe(summary.playerBallsPocketed);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('treats `cleared` as a WIN, not as a finished frame', () => {
    expect(result.cleared).toBe(true);
    expect(wonPool(result)).toBe(true);

    const lost = buildPoolResult({
      runId: 'pool-run-2',
      machineId: 'arcade-pool-table',
      gameId: 'blobbi-pool',
      match: { ...summary, outcome: 'loss', legalEightFinish: false },
      startedAt: 1,
      endedAt: 2,
    });
    expect(lost.cleared).toBe(false);
    expect(wonPool(lost)).toBe(false);
    expect(validateArcadeGameResult(lost)).toEqual({ ok: true });
  });

  it('reports only finite numbers, so a policy cannot read a NaN', () => {
    for (const [key, value] of Object.entries(result.stats)) {
      expect(Number.isFinite(value), key).toBe(true);
    }
  });

  it('names every stat exactly once, from one place', () => {
    const keys = Object.values(POOL_STAT_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(result.stats).sort()).toEqual([...keys].sort());
  });

  it('carries the group as a number, because stats are numbers only', () => {
    expect(result.stats[POOL_STAT_KEYS.playerGroup]).toBe(0); // solids
    const stripes = buildPoolResult({
      runId: 'r',
      machineId: 'm',
      gameId: 'g',
      match: { ...summary, playerGroup: 'stripes' },
      startedAt: 1,
      endedAt: 2,
    });
    expect(stripes.stats[POOL_STAT_KEYS.playerGroup]).toBe(1);
    const open = buildPoolResult({
      runId: 'r',
      machineId: 'm',
      gameId: 'g',
      match: { ...summary, playerGroup: null },
      startedAt: 1,
      endedAt: 2,
    });
    expect(open.stats[POOL_STAT_KEYS.playerGroup]).toBe(-1);
  });
});

describe('reading a result back', () => {
  const summary = summarisePoolMatch(wonFrame());
  const result = buildPoolResult({
    runId: 'pool-run-3',
    machineId: 'arcade-pool-table',
    gameId: 'blobbi-pool',
    match: summary,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_240_000,
  });

  it('round-trips everything the results screen shows', () => {
    const back = poolSummaryFromResult(result);
    expect(back.outcome).toBe(summary.outcome);
    expect(back.difficulty).toBe(summary.difficulty);
    expect(back.durationMs).toBe(summary.durationMs);
    expect(back.playerGroup).toBe(summary.playerGroup);
    expect(back.playerBallsPocketed).toBe(summary.playerBallsPocketed);
    expect(back.opponentBallsPocketed).toBe(summary.opponentBallsPocketed);
    expect(back.remainingOpponentBalls).toBe(summary.remainingOpponentBalls);
    expect(back.playerShots).toBe(summary.playerShots);
    expect(back.playerSuccessfulShots).toBe(summary.playerSuccessfulShots);
    expect(back.playerScratches).toBe(summary.playerScratches);
    expect(back.opponentScratches).toBe(summary.opponentScratches);
    expect(back.playerFouls).toBe(summary.playerFouls);
    expect(back.longestPlayerRun).toBe(summary.longestPlayerRun);
    expect(back.legalEightFinish).toBe(summary.legalEightFinish);
    expect(back.earlyEightLoss).toBe(summary.earlyEightLoss);
    expect(back.completedNaturally).toBe(summary.completedNaturally);
  });

  it('degrades to zero rather than throwing on a foreign result', () => {
    // The results screen is not the place to discover a schema problem.
    const foreign = { ...result, stats: {} };
    const back = poolSummaryFromResult(foreign);
    expect(back.outcome).toBe('loss');
    expect(back.playerBallsPocketed).toBe(0);
    expect(back.playerGroup).toBeNull();
    expect(back.durationMs).toBe(0);
  });

  it('reads the recorded win flag rather than re-deriving it', () => {
    // A future policy must not be able to disagree with the screen.
    const lying = { ...result, cleared: false };
    expect(wonPool(lying)).toBe(true);
    expect(poolSummaryFromResult(lying).outcome).toBe('win');
  });

  it('falls back to a known difficulty for an unexpected one', () => {
    const odd = poolSummaryFromResult({ ...result, difficulty: 'hard' });
    expect(odd.difficulty).toBe('normal');
  });
});

describe('duration copy', () => {
  it('reads the way a person would say it', () => {
    expect(formatPoolDuration(0)).toBe('0s');
    expect(formatPoolDuration(9_400)).toBe('9s');
    expect(formatPoolDuration(60_000)).toBe('1m 00s');
    expect(formatPoolDuration(134_000)).toBe('2m 14s');
    expect(formatPoolDuration(-5)).toBe('0s');
  });
});

describe('nothing here reaches a reward', () => {
  it('carries no ticket count, address or claim of any kind', () => {
    const result = buildPoolResult({
      runId: 'pool-run-4',
      machineId: 'arcade-pool-table',
      gameId: 'blobbi-pool',
      match: summarisePoolMatch(wonFrame()),
      startedAt: 1,
      endedAt: 2,
    });
    const serialised = JSON.stringify(result);
    for (const forbidden of ['ticket', 'reward', 'grant', 'claim', 'inventory', '31633', 'npub']) {
      expect(serialised.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('records who played where, and nothing about who they are', () => {
    const result = buildPoolResult({
      runId: 'pool-run-5',
      machineId: 'arcade-pool-table',
      gameId: 'blobbi-pool',
      match: summarisePoolMatch(wonFrame()),
      startedAt: 1,
      endedAt: 2,
    });
    expect(result.machineId).toBe('arcade-pool-table');
    expect(result.gameId).toBe('blobbi-pool');
    expect(Object.keys(result)).not.toContain('pubkey');
    expect(Object.keys(result)).not.toContain('owner');
  });
});

describe('a real frame end to end', () => {
  it('produces a valid result from a frame nobody staged', () => {
    // Played with a dumb but real policy, so the numbers come out of the
    // simulation rather than out of a fixture.
    const start = createPoolMatch({ seed: poolSeedFrom('end-to-end'), difficulty: 'easy' });
    const world = freshWorld(start.balls);
    let state = runUntil(start, world, (s) => s.phase === 'aiming');
    let guard = 0;
    while (state.phase !== 'over' && guard < 400) {
      if (state.turn === 'player' && (state.phase === 'aiming' || state.phase === 'ball-in-hand')) {
        if (state.phase === 'ball-in-hand') state = placePlayerCueBall(state, world);
        const cue = findBall(state.balls, CUE_BALL)!;
        const target =
          state.balls
            .filter((b) => !b.pocketed && b.number !== CUE_BALL && b.number !== EIGHT_BALL)
            .sort(
              (a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y),
            )[0] ?? findBall(state.balls, EIGHT_BALL)!;
        state = applyPlayerShot(
          state,
          Math.atan2(target.y - cue.y, target.x - cue.x),
          0.7,
          world,
        ).state;
        guard += 1;
        continue;
      }
      state = stepPoolMatch(state, DT, world).state;
    }
    world.dispose();

    expect(state.phase).toBe('over');
    const result = buildPoolResult({
      runId: 'pool-real',
      machineId: 'arcade-pool-table',
      gameId: 'blobbi-pool',
      match: summarisePoolMatch(state),
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_000 + Math.round(state.elapsedMs),
    });

    expect(validateArcadeGameResult(result)).toEqual({ ok: true });
    expect(result.stats[POOL_STAT_KEYS.playerBalls]).toBeLessThanOrEqual(7);
    expect(result.stats[POOL_STAT_KEYS.opponentBalls]).toBeLessThanOrEqual(7);
    expect(result.stats[POOL_STAT_KEYS.completedNaturally]).toBe(1);
    // Exactly one of the two 8-ball flags can be true, and only on a decided frame.
    const legal = result.stats[POOL_STAT_KEYS.legalEightFinish];
    const early = result.stats[POOL_STAT_KEYS.earlyEightLoss];
    expect(legal === 1 && early === 1).toBe(false);
  });
});
