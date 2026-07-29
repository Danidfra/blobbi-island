/**
 * The match state machine — one shot at a time, and exactly once each.
 *
 * Everything here drives the REAL `stepPoolMatch` with numbers. No canvas, no
 * React, no clock: a whole frame is a loop over a pure function, which is what
 * makes "a shot resolves exactly once" and "a ball is pocketed exactly once"
 * assertable rather than assumed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  applyPlayerShot,
  canPlaceCueBallAt,
  createPoolMatch,
  dragPlayerCueBall,
  isOnTheEight,
  isPlayerTurnInteractive,
  isPoolMatchOver,
  lastFoul,
  opponentRemaining,
  placePlayerCueBall,
  playerRemaining,
  stepPoolMatch,
  type PoolEvent,
  type PoolMatchState,
} from './match';
import {
  BALL_DIAMETER,
  FIXED_STEP_MS,
  FOOT_SPOT,
  HEAD_SPOT,
  MAX_SHOT_MS,
  POCKETS,
  READY_MS,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './table';
import {
  CUE_BALL,
  EIGHT_BALL,
  allBallsStopped,
  findBall,
  isLegalBallPosition,
  type PoolBall,
} from './physics';
import { poolSeedFrom } from './rack';
import { groupOf } from './rules';
import { createPoolPhysicsWorld, type PoolPhysicsWorld } from './pool-physics-world';

const DT = FIXED_STEP_MS / 1000;

function ball(number: number, x: number, y: number, pocketed = false): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed };
}

/**
 * The world the current test is driving.
 *
 * A module-level handle rather than a parameter on every helper: the match no
 * longer owns the simulation, so every test needs one, and threading it through
 * each call would bury what the tests are actually about. It is rebuilt in
 * `beforeEach`, so no state crosses between tests.
 */
let world: PoolPhysicsWorld;

beforeEach(() => {
  world = createPoolPhysicsWorld();
});

afterEach(() => {
  world.dispose();
});

/** Step until `done`, collecting every event. Fails loudly rather than hanging. */
function runUntil(
  start: PoolMatchState,
  done: (s: PoolMatchState) => boolean,
  maxSteps = 60_000,
): { state: PoolMatchState; events: PoolEvent[]; steps: number } {
  let state = start;
  const events: PoolEvent[] = [];
  let steps = 0;
  while (!done(state) && steps < maxSteps) {
    const out = stepPoolMatch(state, DT, world);
    state = out.state;
    events.push(...out.events);
    steps += 1;
  }
  return { state, events, steps };
}

/** A fresh match, loaded into the world, past the break-setup beat. */
function ready(state = createPoolMatch({ seed: 1 })): PoolMatchState {
  world.reset(state.balls);
  return runUntil(state, (s) => s.phase === 'aiming').state;
}

/**
 * A hand-built table, loaded into the world.
 *
 * Since Planck owns the bodies, changing `state.balls` alone changes nothing —
 * the world has to be told too. Every fixture below goes through here.
 */
function load(state: PoolMatchState): PoolMatchState {
  world.reset(state.balls);
  return { ...state, balls: world.snapshot() };
}

/**
 * A hand-built table, so a rule can be reached without playing a real frame.
 *
 * Deliberately built from the REAL state shape rather than a fixture type: the
 * step function under test is the shipping one, and a state it would refuse is
 * not worth testing against.
 */
function withTable(base: PoolMatchState, balls: PoolBall[], patch: Partial<PoolMatchState> = {}) {
  return load({ ...base, balls, ...patch });
}

describe('a fresh match', () => {
  it('racks up with the player to break and nobody on a colour', () => {
    const match = createPoolMatch({ seed: 42, difficulty: 'easy' });
    expect(match.phase).toBe('ready');
    expect(match.turn).toBe('player');
    expect(match.broken).toBe(false);
    expect(match.assignment).toEqual({ player: null, opponent: null });
    expect(match.winner).toBeNull();
    expect(match.difficulty).toBe('easy');
    expect(match.balls).toHaveLength(16);
    expect(playerRemaining(match)).toBeNull();
    expect(opponentRemaining(match)).toBeNull();
  });

  it('holds the break-setup beat for exactly its length, then hands over', () => {
    const { state, events, steps } = runUntil(createPoolMatch({ seed: 1 }), (s) => s.phase === 'aiming');
    expect(steps).toBeGreaterThanOrEqual(Math.floor(READY_MS / FIXED_STEP_MS));
    expect(state.phase).toBe('aiming');
    expect(events.filter((e) => e.type === 'ready-complete')).toHaveLength(1);
    expect(isPlayerTurnInteractive(state)).toBe(true);
  });

  it('is JSON, so a whole match could be persisted or replayed', () => {
    const match = ready();
    expect(JSON.parse(JSON.stringify(match))).toEqual(match);
  });

  it('is reproducible from its seed', () => {
    const a = createPoolMatch({ seed: poolSeedFrom('run-x') });
    const b = createPoolMatch({ seed: poolSeedFrom('run-x') });
    expect(a).toEqual(b);
  });
});

describe('taking a shot', () => {
  it('refuses input unless it is the player’s turn to aim', () => {
    // The structural guarantee behind "no input while balls are moving": the UI
    // also disables the controls, but a disabled control is a courtesy.
    const notYet = createPoolMatch({ seed: 1 }); // still `ready`
    expect(applyPlayerShot(notYet, 0, 1, world).state).toBe(notYet);

    const rolling = applyPlayerShot(ready(), 0, 1, world).state;
    expect(rolling.phase).toBe('rolling');
    expect(applyPlayerShot(rolling, 1.5, 1, world).state).toBe(rolling);

    const theirs = { ...ready(), turn: 'opponent' as const };
    expect(applyPlayerShot(theirs, 0, 1, world).state).toBe(theirs);
  });

  it('refuses a shot that is not a number', () => {
    const start = ready();
    expect(applyPlayerShot(start, Number.NaN, 0.5, world).state).toBe(start);
    expect(applyPlayerShot(start, 0, Number.NaN, world).state).toBe(start);
  });

  it('clamps an over-powered shot rather than refusing it', () => {
    const out = applyPlayerShot(ready(), 0, 99, world);
    const cue = findBall(out.state.balls, CUE_BALL)!;
    expect(Math.hypot(cue.vx, cue.vy)).toBeLessThanOrEqual(190);
    expect(out.events[0]).toMatchObject({ type: 'strike', by: 'player', power: 1 });
  });

  it('breaks the rack, settles, and reports the shot exactly once', () => {
    const struck = applyPlayerShot(ready(), 0, 1, world).state;
    const { state, events } = runUntil(struck, (s) => s.phase !== 'rolling');

    expect(state.broken).toBe(true);
    expect(allBallsStopped(state.balls)).toBe(true);
    expect(events.filter((e) => e.type === 'shot-resolved')).toHaveLength(1);
    expect(state.phase).toBe('banner');
    expect(state.lastShooter).toBe('player');
    expect(state.shot).toBeNull();
  });

  it('pockets each ball exactly once, however long the shot runs', () => {
    const struck = applyPlayerShot(ready(), 0, 1, world).state;
    const { state, events } = runUntil(struck, (s) => s.phase !== 'rolling');

    const potted = events.filter((e): e is Extract<PoolEvent, { type: 'pocket' }> => e.type === 'pocket');
    const numbers = potted.map((e) => e.ball);
    expect(new Set(numbers).size).toBe(numbers.length);

    // And every ball the events named is actually down, with nothing else down.
    const down = state.balls.filter((b) => b.pocketed).map((b) => b.number);
    for (const n of down) {
      // The cue ball is restored to the table after a scratch, so it may be
      // named by an event and still be up.
      expect(numbers, String(n)).toContain(n);
    }
  });

  it('never resolves a shot before every ball has stopped', () => {
    let state = applyPlayerShot(ready(), 0, 1, world).state;
    let resolvedAt: PoolMatchState | null = null;
    for (let i = 0; i < 60_000 && resolvedAt === null; i += 1) {
      const before = state;
      const out = stepPoolMatch(state, DT, world);
      state = out.state;
      if (out.events.some((e) => e.type === 'shot-resolved')) {
        expect(before.phase).toBe('rolling');
        resolvedAt = state;
      }
    }
    expect(resolvedAt).not.toBeNull();
    expect(allBallsStopped(resolvedAt!.balls)).toBe(true);
  });

  it('gives up on a shot that will not settle rather than freezing the match', () => {
    // Cannot be produced by real physics — constant deceleration guarantees a
    // stop — so the backstop is exercised by asserting its bound directly.
    expect(MAX_SHOT_MS).toBeGreaterThan((190 / 26) * 1000);
    const struck = applyPlayerShot(ready(), 0, 1, world).state;
    const { state } = runUntil(struck, (s) => s.phase !== 'rolling');
    expect(state.shot).toBeNull();
  });
});

describe('turns', () => {
  it('hands the table to the rival after a miss, and it plans once', () => {
    // A soft shot straight up the table into nothing.
    const struck = applyPlayerShot({ ...ready(), broken: true }, Math.PI, 0.1, world).state;
    const { state, events } = runUntil(struck, (s) => s.phase === 'thinking' || s.phase === 'over');

    expect(state.turn).toBe('opponent');
    expect(state.plan).not.toBeNull();
    expect(events.filter((e) => e.type === 'ai-planned')).toHaveLength(1);
  });

  it('plays the rival’s plan unchanged, through the same strike path', () => {
    const struck = applyPlayerShot({ ...ready(), broken: true }, Math.PI, 0.1, world).state;
    const thinking = runUntil(struck, (s) => s.phase === 'thinking').state;
    const plan = thinking.plan!;

    const shooting = runUntil(thinking, (s) => s.phase === 'rolling').state;
    const cue = findBall(shooting.balls, CUE_BALL)!;
    // The velocity the plan asked for, and no other.
    expect(Math.atan2(cue.vy, cue.vx)).toBeCloseTo(plan.angle, 6);
    expect(shooting.plan).toBeNull();
    expect(shooting.shot?.shooter).toBe('opponent');
    expect(shooting.stats.opponentShots).toBe(1);
  });

  it('counts a shot for whoever took it', () => {
    const after = runUntil(applyPlayerShot(ready(), 0, 1, world).state, (s) => s.phase !== 'rolling').state;
    expect(after.stats.playerShots).toBe(1);
    expect(after.stats.opponentShots).toBe(0);
  });
});

describe('ball-in-hand', () => {
  /** A table where the player has scratched and must place the cue ball. */
  function scratched(): PoolMatchState {
    const base = ready();
    return withTable(
      base,
      [ball(CUE_BALL, HEAD_SPOT.x, HEAD_SPOT.y), ball(1, 120, 50), ball(EIGHT_BALL, 150, 50)],
      { phase: 'ball-in-hand', turn: 'player', ballInHand: true, broken: true },
    );
  }

  it('lets the player drag the cue ball anywhere on the cloth', () => {
    const moved = dragPlayerCueBall(scratched(), { x: 70, y: 25 }, world);
    const cue = findBall(moved.balls, CUE_BALL)!;
    expect(cue.x).toBeCloseTo(70, 6);
    expect(cue.y).toBeCloseTo(25, 6);
    expect(cue.pocketed).toBe(false);
  });

  it('follows the finger even somewhere illegal, and clamps to the cloth', () => {
    // Deliberately permissive: a ball that refuses to go where you point feels
    // broken. The confirm snaps it.
    const onABall = dragPlayerCueBall(scratched(), { x: 120, y: 50 }, world);
    expect(findBall(onABall.balls, CUE_BALL)!.x).toBeCloseTo(120, 6);

    const offTable = dragPlayerCueBall(scratched(), { x: -500, y: 9000 }, world);
    const cue = findBall(offTable.balls, CUE_BALL)!;
    expect(cue.x).toBeGreaterThan(0);
    expect(cue.x).toBeLessThan(TABLE_LENGTH);
    expect(cue.y).toBeGreaterThan(0);
    expect(cue.y).toBeLessThan(TABLE_WIDTH);
  });

  it('confirms to a legal spot and goes back to aiming', () => {
    const placed = placePlayerCueBall(scratched(), world, { x: 70, y: 25 });
    expect(placed.phase).toBe('aiming');
    expect(placed.ballInHand).toBe(false);
    expect(canPlaceCueBallAt(placed, { x: 70, y: 25 })).toBe(true);
  });

  it('snaps an illegal request rather than refusing the confirm', () => {
    for (const request of [
      { x: 120, y: 50 }, // inside the 1-ball
      { x: POCKETS[0].x, y: POCKETS[0].y }, // down a pocket
      { x: -80, y: -80 }, // off the cloth
    ]) {
      const placed = placePlayerCueBall(scratched(), world, request);
      const cue = findBall(placed.balls, CUE_BALL)!;
      expect(placed.phase, JSON.stringify(request)).toBe('aiming');
      expect(isLegalBallPosition(cue, placed.balls, CUE_BALL), JSON.stringify(request)).toBe(true);
    }
  });

  it('has a safe default for a player who never drags at all', () => {
    // The brief's "safe default placement if the player does not understand the
    // interaction": pressing the button with no drag must just work.
    const placed = placePlayerCueBall(scratched(), world);
    const cue = findBall(placed.balls, CUE_BALL)!;
    expect(placed.phase).toBe('aiming');
    expect(isLegalBallPosition(cue, placed.balls, CUE_BALL)).toBe(true);
  });

  it('refuses to place or drag outside the placement phase', () => {
    const aiming = ready();
    expect(placePlayerCueBall(aiming, world, { x: 70, y: 25 })).toBe(aiming);
    expect(dragPlayerCueBall(aiming, { x: 70, y: 25 }, world)).toBe(aiming);

    const theirs = { ...scratched(), turn: 'opponent' as const };
    expect(placePlayerCueBall(theirs, world, { x: 70, y: 25 })).toBe(theirs);
    expect(dragPlayerCueBall(theirs, { x: 70, y: 25 }, world)).toBe(theirs);
  });

  it('restores the cue ball to a legal spot the instant a scratch resolves', () => {
    // Invariant 5: there is never a moment with no cue ball to draw or drag.
    const base = ready();
    const scratchable = withTable(
      base,
      [
        ball(CUE_BALL, 40, 40),
        ball(1, 120, 50),
        ball(EIGHT_BALL, 150, 50),
      ],
      { broken: true, assignment: { player: 'solids', opponent: 'stripes' } },
    );
    // Straight at the top-left corner pocket.
    const struck = applyPlayerShot(scratchable, Math.atan2(-40, -40), 0.6, world).state;
    const { state } = runUntil(struck, (s) => s.phase !== 'rolling');

    expect(lastFoul(state)).toBe('scratch');
    expect(state.ballInHand).toBe(true);
    expect(state.turn).toBe('opponent');
    const cue = findBall(state.balls, CUE_BALL)!;
    expect(cue.pocketed).toBe(false);
    expect(isLegalBallPosition(cue, state.balls, CUE_BALL)).toBe(true);
    expect(state.stats.playerScratches).toBe(1);
  });

  it('lets the rival place the cue ball legally too', () => {
    const base = ready();
    const theirTurn = withTable(
      base,
      [ball(CUE_BALL, HEAD_SPOT.x, HEAD_SPOT.y), ball(9, 120, 50), ball(EIGHT_BALL, 150, 50)],
      {
        phase: 'banner',
        timerMs: 1,
        turn: 'opponent',
        ballInHand: true,
        broken: true,
        assignment: { player: 'solids', opponent: 'stripes' },
      },
    );
    const thinking = runUntil(theirTurn, (s) => s.phase === 'thinking').state;
    const cue = findBall(thinking.balls, CUE_BALL)!;
    expect(thinking.ballInHand).toBe(false);
    expect(isLegalBallPosition(cue, thinking.balls, CUE_BALL)).toBe(true);
  });
});

describe('winning and losing', () => {
  /** Only the 8-ball and one rival ball left; the player is on the 8. */
  function onTheEight(cueAt: { x: number; y: number }, eightAt: { x: number; y: number }) {
    return withTable(
      ready(),
      [ball(CUE_BALL, cueAt.x, cueAt.y), ball(EIGHT_BALL, eightAt.x, eightAt.y), ball(9, 60, 90)],
      { broken: true, assignment: { player: 'solids', opponent: 'stripes' } },
    );
  }

  it('knows when a side is on the 8-ball', () => {
    const state = onTheEight({ x: 30, y: 50 }, { x: 120, y: 50 });
    expect(isOnTheEight(state, 'player')).toBe(true);
    expect(isOnTheEight(state, 'opponent')).toBe(false);
    expect(playerRemaining(state)).toEqual([]);
    expect(opponentRemaining(state)).toEqual([9]);
  });

  it('wins the frame on a clean 8-ball into a corner', () => {
    // Cue ball, 8-ball and the bottom-right corner in a straight line.
    const corner = POCKETS[2];
    const eight = { x: corner.x - 40, y: corner.y + 20 };
    const dx = corner.x - eight.x;
    const dy = corner.y - eight.y;
    const length = Math.hypot(dx, dy);
    const cue = { x: eight.x - (dx / length) * 40, y: eight.y - (dy / length) * 40 };

    const struck = applyPlayerShot(
      onTheEight(cue, eight),
      Math.atan2(dy, dx),
      0.55,
      world,
    ).state;
    const settled = runUntil(struck, (s) => s.phase !== 'rolling').state;

    expect(settled.winner).toBe('player');
    expect(settled.ending).toBe('legal-eight');

    const over = runUntil(settled, isPoolMatchOver);
    expect(over.state.phase).toBe('over');
    expect(over.events.filter((e) => e.type === 'match-over')).toHaveLength(1);
    // Terminal: stepping it again changes nothing at all.
    expect(stepPoolMatch(over.state, DT, world).state).toBe(over.state);
    expect(stepPoolMatch(over.state, DT, world).events).toEqual([]);
  });

  it('loses the frame on an early 8-ball', () => {
    const corner = POCKETS[2];
    const eight = { x: corner.x - 40, y: corner.y + 20 };
    const dx = corner.x - eight.x;
    const dy = corner.y - eight.y;
    const length = Math.hypot(dx, dy);
    const cue = { x: eight.x - (dx / length) * 40, y: eight.y - (dy / length) * 40 };

    // Same shot, but the player still has a solid up, so the 8 is not theirs to
    // take — and hitting it first is a foul into the bargain.
    const early = withTable(
      ready(),
      [
        ball(CUE_BALL, cue.x, cue.y),
        ball(EIGHT_BALL, eight.x, eight.y),
        ball(3, 30, 20),
        ball(9, 60, 90),
      ],
      { broken: true, assignment: { player: 'solids', opponent: 'stripes' } },
    );

    const settled = runUntil(
      applyPlayerShot(early, Math.atan2(dy, dx), 0.55, world).state,
      (s) => s.phase !== 'rolling',
    ).state;

    expect(settled.winner).toBe('opponent');
    expect(settled.ending).toBe('early-eight');
    expect(settled.lastShooter).toBe('player');
  });

  it('re-spots the 8-ball when it drops on the break', () => {
    const corner = POCKETS[2];
    const eight = { x: corner.x - 30, y: corner.y + 15 };
    const dx = corner.x - eight.x;
    const dy = corner.y - eight.y;
    const length = Math.hypot(dx, dy);
    const cue = { x: eight.x - (dx / length) * 40, y: eight.y - (dy / length) * 40 };

    // `broken` is false, so this shot IS the break.
    const breaking = withTable(ready(), [
      ball(CUE_BALL, cue.x, cue.y),
      ball(EIGHT_BALL, eight.x, eight.y),
      ball(1, 40, 20),
      ball(9, 60, 90),
    ]);

    const settled = runUntil(
      applyPlayerShot(breaking, Math.atan2(dy, dx), 0.55, world).state,
      (s) => s.phase !== 'rolling',
    ).state;

    expect(settled.winner).toBeNull();
    const eightBall = findBall(settled.balls, EIGHT_BALL)!;
    expect(eightBall.pocketed).toBe(false);
    expect(Math.hypot(eightBall.x - FOOT_SPOT.x, eightBall.y - FOOT_SPOT.y)).toBeLessThan(
      BALL_DIAMETER * 3,
    );
    expect(isLegalBallPosition(eightBall, settled.balls, EIGHT_BALL)).toBe(true);
  });
});

describe('a whole frame', () => {
  it('plays to a finish, with the score adding up', () => {
    // The player is driven by a fixed, dumb policy — always shoot at the
    // nearest legal ball — so the frame is real but reproducible.
    let state = ready(createPoolMatch({ seed: poolSeedFrom('whole-frame'), difficulty: 'normal' }));
    let guard = 0;

    while (!isPoolMatchOver(state) && guard < 400) {
      if (state.turn === 'player' && (state.phase === 'aiming' || state.phase === 'ball-in-hand')) {
        if (state.phase === 'ball-in-hand') state = placePlayerCueBall(state, world);
        const cue = findBall(state.balls, CUE_BALL)!;
        const target =
          state.balls
            .filter((b) => !b.pocketed && b.number !== CUE_BALL && b.number !== EIGHT_BALL)
            .sort(
              (a, b) =>
                Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y),
            )[0] ?? findBall(state.balls, EIGHT_BALL)!;
        state = applyPlayerShot(
          state,
          Math.atan2(target.y - cue.y, target.x - cue.x),
          0.75,
          world,
        ).state;
        guard += 1;
        continue;
      }
      state = stepPoolMatch(state, DT, world).state;
    }

    expect(isPoolMatchOver(state)).toBe(true);
    expect(state.winner === 'player' || state.winner === 'opponent').toBe(true);
    expect(state.ending).not.toBeNull();

    // Every ball is accounted for: still on the table, or down, never both.
    expect(state.balls).toHaveLength(16);
    expect(state.stats.playerShots).toBeGreaterThan(0);
    expect(state.stats.playerSuccessfulShots).toBeLessThanOrEqual(state.stats.playerShots);
    expect(state.stats.opponentSuccessfulShots).toBeLessThanOrEqual(state.stats.opponentShots);
    expect(state.stats.longestPlayerRun).toBeGreaterThanOrEqual(0);
    expect(state.elapsedMs).toBeGreaterThan(0);

    // The assigned groups are always opposites once the table has opened.
    if (state.assignment.player !== null) {
      expect(state.assignment.opponent).toBe(
        state.assignment.player === 'solids' ? 'stripes' : 'solids',
      );
    }
    // And nobody ever owned the 8-ball.
    expect(groupOf(EIGHT_BALL)).toBeNull();
  });

  it('is deterministic: the same seed and the same shots give the same frame', () => {
    const play = () => {
      let state = ready(createPoolMatch({ seed: 777 }));
      for (let shot = 0; shot < 4; shot += 1) {
        state = applyPlayerShot(state, 0.03 * shot, 0.7, world).state;
        state = runUntil(
          state,
          (s) => s.turn === 'player' && (s.phase === 'aiming' || s.phase === 'ball-in-hand'),
          80_000,
        ).state;
        if (state.phase === 'ball-in-hand') state = placePlayerCueBall(state, world);
        if (state.phase === 'over') break;
      }
      return state;
    };
    expect(play()).toEqual(play());
  });
});

describe('time and pausing', () => {
  it('does nothing at all for a zero or negative step', () => {
    const state = ready();
    expect(stepPoolMatch(state, 0, world).state).toBe(state);
    expect(stepPoolMatch(state, -1, world).state).toBe(state);
  });

  it('advances the clock while waiting for the player, and nothing else', () => {
    // Which is what makes pausing safe: stop calling `step` and the table is
    // exactly where it was, with the same player still to shoot.
    const before = ready();
    const after = stepPoolMatch(before, DT, world).state;
    expect(after.elapsedMs).toBeGreaterThan(before.elapsedMs);
    expect(after.balls).toEqual(before.balls);
    expect(after.phase).toBe(before.phase);
    expect(after.turn).toBe(before.turn);
  });

  it('resumes a rolling shot exactly where it stopped', () => {
    // A "pause" is simply not calling `step`. Nothing in the match decays on a
    // clock, and the world only advances when it is told to — so a frozen table
    // stays exactly frozen for as long as nobody steps it.
    const struck = applyPlayerShot(ready(), 0, 1, world).state;
    const midway = runUntil(struck, (s) => s.elapsedMs > struck.elapsedMs + 400).state;

    const before = world.snapshot();
    // …an arbitrary amount of real time passes, with no steps…
    expect(world.snapshot()).toEqual(before);
    expect(midway.phase).toBe('rolling');

    // And the very next step is an ordinary one, not a catch-up leap.
    const resumed = stepPoolMatch(midway, DT, world).state;
    const moved = Math.max(
      ...resumed.balls.map((b, i) => Math.hypot(b.x - before[i].x, b.y - before[i].y)),
    );
    expect(moved).toBeLessThan(2);
  });
});

describe('recovery', () => {
  /**
   * A world that reports one recovery and then behaves.
   *
   * Corrupting a ball is no longer something a test can do by editing state —
   * the bodies live in Planck, and the match only ever sees snapshots. So the
   * contract under test is the one that actually exists: **if the world says it
   * had to recover a ball, what does the match make of it?**
   */
  function worldThatRecovers(balls: PoolBall[], lost: number): PoolPhysicsWorld {
    const real = createPoolPhysicsWorld();
    real.reset(balls);
    let reported = false;
    return {
      reset: (next) => real.reset(next),
      setBall: (n, at) => real.setBall(n, at),
      strike: (angle, speed) => real.strike(angle, speed),
      step: (dt) => real.step(dt),
      snapshot: () => real.snapshot(),
      isSettled: () => real.isSettled(),
      resetSettling: () => real.resetSettling(),
      dispose: () => real.dispose(),
      drain: () => {
        const frame = real.drain();
        if (reported) return frame;
        reported = true;
        return { ...frame, recovered: [lost] };
      },
    };
  }

  /** A table where it is the player's shot, loaded into `into`. */
  function tableFor(into: PoolPhysicsWorld): PoolMatchState {
    return {
      ...createPoolMatch({ seed: 1 }),
      phase: 'aiming',
      timerMs: 0,
      balls: into.snapshot(),
      broken: true,
      assignment: { player: 'solids', opponent: 'stripes' },
    };
  }

  function playOut(state: PoolMatchState, into: PoolPhysicsWorld) {
    const events: PoolEvent[] = [];
    let current = state;
    for (let i = 0; i < 60_000 && current.phase === 'rolling'; i += 1) {
      const out = stepPoolMatch(current, DT, into);
      current = out.state;
      events.push(...out.events);
    }
    return { state: current, events };
  }

  it('turns a cue ball the world could not keep into a foul, not a broken table', () => {
    const balls = [ball(CUE_BALL, 50, 50), ball(1, 120, 50), ball(EIGHT_BALL, 150, 50)];
    const broken = worldThatRecovers(balls, CUE_BALL);
    const { state, events } = playOut(
      applyPlayerShot(tableFor(broken), 0, 0.6, broken).state,
      broken,
    );

    expect(events.some((e) => e.type === 'recovered')).toBe(true);
    expect(lastFoul(state)).toBe('off-table');
    expect(state.ballInHand).toBe(true);
    const cue = findBall(state.balls, CUE_BALL)!;
    expect(Number.isFinite(cue.x) && Number.isFinite(cue.y)).toBe(true);
    expect(cue.pocketed).toBe(false);
    broken.dispose();
  });

  it('does not blame the player for an object ball the world recovered', () => {
    // A recovery that is not the cue ball's is reported and costs nothing: the
    // shot is still judged on what the cue ball did.
    const balls = [ball(CUE_BALL, 50, 50), ball(1, 120, 50), ball(EIGHT_BALL, 150, 50)];
    const broken = worldThatRecovers(balls, 1);
    const { state, events } = playOut(
      applyPlayerShot(tableFor(broken), 0, 0.6, broken).state,
      broken,
    );

    expect(events.some((e) => e.type === 'recovered')).toBe(true);
    expect(lastFoul(state)).not.toBe('off-table');
    expect(state.balls).toHaveLength(3);
    broken.dispose();
  });

  it('never leaves two balls inside each other after a shot', () => {
    const settled = runUntil(applyPlayerShot(ready(), 0, 1, world).state, (s) => s.phase !== 'rolling').state;
    const up = settled.balls.filter((b) => !b.pocketed);
    for (let i = 0; i < up.length; i += 1) {
      for (let k = i + 1; k < up.length; k += 1) {
        expect(
          Math.hypot(up[i].x - up[k].x, up[i].y - up[k].y),
          `${up[i].number}/${up[k].number}`,
        ).toBeGreaterThan(BALL_DIAMETER - 0.05);
      }
    }
  });
});
