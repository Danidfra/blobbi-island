/**
 * The geometry the game reasons with — the queries, not the solver.
 *
 * Since Planck arrived, integration, collision response, cushion rebounds and
 * pocket capture are `pool-physics-world.test.ts`'s subject. What is tested here
 * is everything that ASKS a question about a table: the aim guide, the AI's
 * blocked-path check, ball-in-hand placement, and the recovery helpers.
 *
 * All of it is still pure, so all of it is still numbers in, numbers out.
 */
import { describe, it, expect } from 'vitest';

import {
  BALL_DIAMETER,
  BALL_RADIUS,
  MAX_BALL_SPEED,
  MIN_SHOT_POWER,
  MIN_SHOT_SPEED,
  MAX_SHOT_SPEED,
  POCKETS,
  ROLLING_DECEL,
  TABLE_LENGTH,
  TABLE_WIDTH,
  powerFromPull,
  shotSpeedFor,
} from './table';
import {
  CUE_BALL,
  allBallsStopped,
  clampBall,
  clampSpeed,
  isLegalBallPosition,
  isMoving,
  nearestLegalPosition,
  nearestMouthCrossing,
  normalise,
  pathIsClear,
  predictCuePath,
  sanitiseBall,
  separateOverlaps,
  speedOf,
  unitFromAngle,
  type PoolBall,
} from './physics';
import { POOL_POCKETS, isOverPocketMouth } from './pool-physics-geometry';

function ball(number: number, x: number, y: number, vx = 0, vy = 0): PoolBall {
  return { number, x, y, vx, vy, pocketed: false };
}

describe('vector helpers', () => {
  it('measures and caps a speed without turning it', () => {
    expect(speedOf({ vx: 3, vy: 4 })).toBe(5);
    const scaled = clampSpeed(300, 400, 100);
    expect(Math.hypot(scaled.vx, scaled.vy)).toBeCloseTo(100, 9);
    expect(scaled.vx / scaled.vy).toBeCloseTo(300 / 400, 9);
    // Under the cap it is left exactly alone.
    expect(clampSpeed(3, 4, 100)).toEqual({ vx: 3, vy: 4 });
  });

  it('turns an angle into a unit vector and back', () => {
    for (const angle of [0, 0.7, -2.2, Math.PI]) {
      const unit = unitFromAngle(angle);
      expect(Math.hypot(unit.x, unit.y)).toBeCloseTo(1, 9);
      expect(Math.atan2(unit.y, unit.x)).toBeCloseTo(
        Math.atan2(Math.sin(angle), Math.cos(angle)),
        9,
      );
    }
  });

  it('refuses to normalise a vector with no direction', () => {
    expect(normalise(0, 0)).toBeNull();
    expect(normalise(Number.NaN, 1)).toBeNull();
    expect(normalise(3, 4)).toEqual({ x: 0.6, y: 0.8 });
  });

  it('knows a moving ball from a resting one, and ignores a pocketed one', () => {
    expect(isMoving(ball(1, 50, 50, 10, 0))).toBe(true);
    expect(isMoving(ball(1, 50, 50))).toBe(false);
    expect(isMoving({ ...ball(1, 50, 50, 10, 0), pocketed: true })).toBe(false);
    expect(allBallsStopped([ball(1, 50, 50), { ...ball(2, 0, 0, 9, 9), pocketed: true }])).toBe(true);
    expect(allBallsStopped([ball(1, 50, 50), ball(2, 60, 50, 1, 0)])).toBe(false);
  });
});

describe('recovery', () => {
  it('rejects a non-finite ball', () => {
    expect(sanitiseBall(ball(1, Number.NaN, 50))).toBeNull();
    expect(sanitiseBall(ball(1, 50, Number.POSITIVE_INFINITY))).toBeNull();
    expect(sanitiseBall(ball(1, 50, 50, Number.NaN, 0))).toBeNull();
  });

  it('rejects a ball far off the table, and accepts a hair of overshoot', () => {
    expect(sanitiseBall(ball(1, -TABLE_LENGTH * 3, 50))).toBeNull();
    const nudged = ball(1, BALL_RADIUS - 0.001, 50);
    expect(sanitiseBall(nudged)).toBe(nudged);
  });

  it('clamps a NaN position back onto the cloth instead of propagating it', () => {
    // A plain clamp does NOT do this — every comparison against NaN is false —
    // and one bad sample would otherwise reach a Planck body and poison the
    // whole world.
    const fixed = clampBall(ball(1, Number.NaN, Number.NaN, 10, 10));
    expect(Number.isFinite(fixed.x)).toBe(true);
    expect(Number.isFinite(fixed.y)).toBe(true);
  });

  it('caps a runaway speed while preserving direction', () => {
    const fast = clampBall(ball(1, 100, 50, 9000, 9000));
    expect(speedOf(fast)).toBeCloseTo(MAX_BALL_SPEED, 6);
    expect(fast.vx).toBeCloseTo(fast.vy, 6);
  });

  it('pushes overlapping balls apart without touching their velocities', () => {
    const stacked = [ball(1, 100, 50, 12, -4), ball(2, 100.4, 50.2, -3, 8), ball(3, 100.2, 50.4)];
    const fixed = separateOverlaps(stacked);

    for (let i = 0; i < fixed.length; i += 1) {
      for (let k = i + 1; k < fixed.length; k += 1) {
        expect(
          Math.hypot(fixed[i].x - fixed[k].x, fixed[i].y - fixed[k].y),
        ).toBeGreaterThanOrEqual(BALL_DIAMETER - 1e-6);
      }
    }
    expect(fixed[0].vx).toBe(12);
    expect(fixed[1].vy).toBe(8);
  });
});

describe('legal placement', () => {
  const table = [ball(CUE_BALL, 50, 50), ball(1, 120, 50), ball(8, 150, 50)];

  it('accepts an empty spot on the cloth', () => {
    expect(isLegalBallPosition({ x: 80, y: 30 }, table)).toBe(true);
  });

  it('refuses a spot inside another ball', () => {
    expect(isLegalBallPosition({ x: 120, y: 50 }, table)).toBe(false);
    expect(isLegalBallPosition({ x: 120 + BALL_DIAMETER - 0.01, y: 50 }, table)).toBe(false);
    expect(isLegalBallPosition({ x: 120 + BALL_DIAMETER + 0.01, y: 50 }, table)).toBe(true);
  });

  it('refuses a pocket mouth', () => {
    for (const pocket of POCKETS) {
      expect(isLegalBallPosition({ x: pocket.x, y: pocket.y }, table), `${pocket.x},${pocket.y}`).toBe(
        false,
      );
    }
    // …and the mouth itself, not merely the hole behind it.
    for (const target of POOL_POCKETS) {
      expect(isLegalBallPosition(target.mouthMid, table), `mouth ${target.index}`).toBe(false);
    }
  });

  it('allows the cloth right up to a cushion', () => {
    // The mouth guard must not swallow the whole rail: a ball frozen on a
    // cushion between two pockets is an ordinary and legal position.
    expect(isLegalBallPosition({ x: 60, y: BALL_RADIUS }, table)).toBe(true);
    expect(isLegalBallPosition({ x: 140, y: TABLE_WIDTH - BALL_RADIUS }, table)).toBe(true);
    expect(isOverPocketMouth({ x: 60, y: BALL_RADIUS })).toBe(false);
  });

  it('refuses anything off the cloth', () => {
    expect(isLegalBallPosition({ x: -5, y: 50 }, table)).toBe(false);
    expect(isLegalBallPosition({ x: TABLE_LENGTH + 5, y: 50 }, table)).toBe(false);
    expect(isLegalBallPosition({ x: 100, y: TABLE_WIDTH + 1 }, table)).toBe(false);
    expect(isLegalBallPosition({ x: 100, y: Number.NaN }, table)).toBe(false);
  });

  it('ignores the ball being moved, so the cue ball may stay where it is', () => {
    expect(isLegalBallPosition({ x: 50, y: 50 }, table, CUE_BALL)).toBe(true);
  });

  it('always finds a legal spot near an illegal request', () => {
    for (const request of [
      { x: 120, y: 50 }, // inside a ball
      { x: 0, y: 0 }, // down a pocket
      { x: -400, y: 900 }, // off the table
      { x: Number.NaN, y: Number.NaN }, // nonsense
    ]) {
      const spot = nearestLegalPosition(request, table);
      expect(isLegalBallPosition(spot, table), JSON.stringify(request)).toBe(true);
    }
  });

  it('returns the request unchanged when it is already legal', () => {
    expect(nearestLegalPosition({ x: 80, y: 30 }, table)).toEqual({ x: 80, y: 30 });
  });
});

describe('the aim guide', () => {
  const table = [ball(CUE_BALL, 50, 50), ball(1, 120, 50), ball(8, 150, 20)];

  it('finds the first ball in the way and where it would go', () => {
    const path = predictCuePath({ x: 50, y: 50 }, { x: 1, y: 0 }, table);
    expect(path.end).toBe('ball');
    expect(path.ballNumber).toBe(1);
    expect(path.contact.x).toBeCloseTo(120 - BALL_DIAMETER, 6);
    expect(path.objectDirection?.x).toBeCloseTo(1, 6);
    expect(path.objectDirection?.y).toBeCloseTo(0, 6);
  });

  it('reports the line of centres for a cut, not the cue ball’s direction', () => {
    const cut = predictCuePath({ x: 50, y: 47 }, { x: 1, y: 0 }, table);
    expect(cut.end).toBe('ball');
    expect(cut.objectDirection!.y).toBeGreaterThan(0);
    const angle = Math.atan2(cut.objectDirection!.y, cut.objectDirection!.x);
    const expected = Math.atan2(50 - cut.contact.y, 120 - cut.contact.x);
    expect(angle).toBeCloseTo(expected, 6);
  });

  it('reports a cushion when nothing is in the way', () => {
    // Deliberately not x = 100: that is the side pocket's own line, and aiming
    // up it is a scratch rather than a cushion — which the next case checks.
    const path = predictCuePath({ x: 80, y: 50 }, { x: 0, y: -1 }, [ball(CUE_BALL, 80, 50)]);
    expect(path.end).toBe('cushion');
    expect(path.ballNumber).toBeNull();
    expect(path.contact.y).toBeCloseTo(BALL_RADIUS, 6);
  });

  it('warns when the cue ball is headed straight down a pocket', () => {
    const path = predictCuePath({ x: 40, y: 40 }, { x: -1, y: -1 }, [ball(CUE_BALL, 40, 40)]);
    expect(path.end).toBe('pocket');
  });

  it('warns about a scratch straight down a side pocket', () => {
    // The case the old rectangular cushion model could not see: it drew a rail
    // across the mouth and reported `cushion` for a shot that scratches.
    const intoIt = predictCuePath({ x: 100, y: 40 }, { x: 0, y: -1 }, [ball(CUE_BALL, 100, 40)]);
    expect(intoIt.end).toBe('pocket');
    expect(intoIt.contact.y).toBeLessThan(BALL_RADIUS);
  });

  it('sends a rail runner to the CORNER, never into the side pocket it passes', () => {
    // The asymmetry the mouth-plane model produces, and the guide shows the same
    // one the physics applies — verified against the engine in
    // `pool-physics-world.test.ts`.
    const along = nearestMouthCrossing({ x: 40, y: BALL_RADIUS }, { x: 1, y: 0 });
    expect(along).not.toBeNull();
    expect(POOL_POCKETS[along!.pocket.index].kind).toBe('corner');
    expect(along!.pocket.index).not.toBe(1);
  });

  it('never runs backwards from the cue ball', () => {
    const path = predictCuePath({ x: 121, y: 50 }, { x: 1, y: 0 }, table);
    expect(path.travel).toBeGreaterThan(0);
  });

  it('survives a zero direction rather than producing NaN', () => {
    const path = predictCuePath({ x: 50, y: 50 }, { x: 0, y: 0 }, table);
    expect(Number.isFinite(path.contact.x)).toBe(true);
    expect(Number.isFinite(path.travel)).toBe(true);
  });
});

describe('the mouth-crossing query', () => {
  it('is the one thing the guide and the AI both scratch-check with', () => {
    const hit = nearestMouthCrossing({ x: 40, y: 40 }, { x: -1 / Math.SQRT2, y: -1 / Math.SQRT2 });
    expect(hit).not.toBeNull();
    expect(hit!.pocket.index).toBe(0);
    expect(hit!.travel).toBeGreaterThan(0);
  });

  it('answers `null` when nothing is crossed', () => {
    expect(nearestMouthCrossing({ x: 100, y: 50 }, { x: 0, y: 0 })).toBeNull();
    // Parallel to the side mouths and clear of the corners.
    expect(nearestMouthCrossing({ x: 100, y: 50 }, { x: 1, y: 0 })).toBeNull();
  });

  it('picks the NEAREST mouth when a line crosses more than one', () => {
    // Straight down the middle of the table hits both side pockets; the answer
    // must be the one in front.
    const down = nearestMouthCrossing({ x: 100, y: 50 }, { x: 0, y: -1 });
    const up = nearestMouthCrossing({ x: 100, y: 50 }, { x: 0, y: 1 });
    expect(down!.pocket.index).toBe(1);
    expect(up!.pocket.index).toBe(4);
    expect(down!.travel).toBeCloseTo(50, 6);
  });
});

describe('blocked paths', () => {
  it('sees a ball sitting on the line', () => {
    expect(pathIsClear({ x: 50, y: 50 }, { x: 150, y: 50 }, [ball(2, 100, 50)])).toBe(false);
  });

  it('lets a ball squeeze past with a diameter to spare', () => {
    expect(
      pathIsClear({ x: 50, y: 50 }, { x: 150, y: 50 }, [ball(2, 100, 50 + BALL_DIAMETER + 0.1)]),
    ).toBe(true);
    expect(
      pathIsClear({ x: 50, y: 50 }, { x: 150, y: 50 }, [ball(2, 100, 50 + BALL_DIAMETER - 0.1)]),
    ).toBe(false);
  });

  it('ignores the balls it is told to ignore, and every pocketed one', () => {
    const blocker = ball(2, 100, 50);
    expect(pathIsClear({ x: 50, y: 50 }, { x: 150, y: 50 }, [blocker], [2])).toBe(true);
    expect(pathIsClear({ x: 50, y: 50 }, { x: 150, y: 50 }, [{ ...blocker, pocketed: true }])).toBe(
      true,
    );
  });
});

describe('cue power', () => {
  it('ignores a pull inside the dead zone, so a tap cannot fire', () => {
    expect(powerFromPull(0)).toBe(0);
    expect(powerFromPull(2.9)).toBe(0);
    expect(powerFromPull(2.9)).toBeLessThan(MIN_SHOT_POWER);
  });

  it('rises with the pull and stops at full', () => {
    expect(powerFromPull(24)).toBeGreaterThan(0);
    expect(powerFromPull(45)).toBe(1);
    expect(powerFromPull(4000)).toBe(1);
  });

  it('survives nonsense', () => {
    expect(powerFromPull(Number.NaN)).toBe(0);
    expect(powerFromPull(-50)).toBe(0);
  });

  it('maps power onto a playable speed band', () => {
    expect(shotSpeedFor(0)).toBe(MIN_SHOT_SPEED);
    expect(shotSpeedFor(1)).toBe(MAX_SHOT_SPEED);
    expect(shotSpeedFor(-3)).toBe(MIN_SHOT_SPEED);
    expect(shotSpeedFor(9)).toBe(MAX_SHOT_SPEED);
    expect(shotSpeedFor(0.5)).toBeCloseTo((MIN_SHOT_SPEED + MAX_SHOT_SPEED) / 2, 9);
  });

  it('makes even the softest legal shot go somewhere useful', () => {
    // A shot that dies after ten units is a wasted turn, not a soft shot.
    const softest = shotSpeedFor(MIN_SHOT_POWER);
    expect((softest * softest) / (2 * ROLLING_DECEL)).toBeGreaterThan(TABLE_LENGTH / 6);
  });

  it('keeps a full-power shot under the speed the fixed step is safe for', () => {
    expect(MAX_SHOT_SPEED).toBeLessThanOrEqual(MAX_BALL_SPEED);
  });
});
