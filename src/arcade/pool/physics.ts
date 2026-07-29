/**
 * Pool — the geometry the game reasons with, as pure functions over plain
 * numbers.
 *
 * ## What this is, since Planck arrived
 *
 * This module used to be the solver as well. It is not any more: integration,
 * collision response, cushion rebounds and pocket capture all moved into
 * `pool-physics-world.ts`, which wraps Planck. What is left is everything that
 * ASKS QUESTIONS about a table rather than advancing one:
 *
 *  - the ball and vector types the whole game speaks in;
 *  - `predictCuePath` — the aim guide;
 *  - `pathIsClear` — what the AI uses to reject a blocked shot;
 *  - `isLegalBallPosition` / `nearestLegalPosition` — ball-in-hand;
 *  - `separateOverlaps` and `sanitiseBall` — building a rack, and recovery.
 *
 * All of it is still pure: no `Date.now()`, no `Math.random()`, no DOM, no
 * React, no Planck. That is what lets the AI and the aim guide be tested by
 * calling a function with numbers, and it is why the engine swap did not touch
 * either of them.
 *
 * ## The geometry these answers use is the REAL geometry
 *
 * Every pocket question here goes through `pool-physics-geometry.ts` — the same
 * cushion polygons and mouth planes the physics world is built from and the
 * renderer draws. The previous implementation had its own idea of where a pocket
 * was (a circle of radius 4.2 around the corner point) which agreed with neither
 * the picture nor the cushions, and that disagreement was most of what made the
 * old game feel wrong.
 */

import {
  BALL_BOUNDS,
  BALL_DIAMETER,
  BALL_RADIUS,
  MAX_BALL_SPEED,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './table';
/*
  The pocket queries come from the shared geometry, so this module and the
  physics world cannot disagree about where a pocket is.

  There is a cycle here and it is only in the types: `pool-physics-geometry.ts`
  imports this module's `Vec2` with `import type`, which TypeScript erases. At
  run time the dependency runs one way — physics → geometry — so there is no
  initialisation order to get wrong.
*/
import {
  isOverPocketMouth,
  nearestCushionContact,
  nearestMouthCrossing,
} from './pool-physics-geometry';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * One ball.
 *
 * `number` is the identity: `0` is the cue ball, `1`–`15` are the object balls,
 * and it is the same integer the rules, the physics world, the renderer and the
 * result all use. There is deliberately no separate `id` — a second key would be
 * a second thing to keep in step.
 *
 * This is a SNAPSHOT. The authoritative state during a shot lives in Planck
 * bodies; these are read out of the world once per step and are what everything
 * above the physics boundary sees.
 */
export interface PoolBall {
  readonly number: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Off the table. A pocketed ball is not simulated, drawn on the felt, or hit. */
  readonly pocketed: boolean;
}

export const CUE_BALL = 0;
export const EIGHT_BALL = 8;

// ── Small helpers ───────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function speedOf(v: { readonly vx: number; readonly vy: number }): number {
  return Math.hypot(v.vx, v.vy);
}

/**
 * Scale a velocity down to `max` if it exceeds it, preserving direction exactly.
 *
 * A scale rather than a per-axis clamp: clamping `vx` and `vy` separately turns
 * a fast diagonal into a different angle, which would mean the cue ball leaving
 * at a direction the player did not aim.
 */
export function clampSpeed(vx: number, vy: number, max: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed <= max || speed === 0) return { vx, vy };
  const scale = max / speed;
  return { vx: vx * scale, vy: vy * scale };
}

/** A unit vector for an angle in radians. */
export function unitFromAngle(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Normalise, or `null` when the vector has no direction to speak of. */
export function normalise(x: number, y: number): Vec2 | null {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return { x: x / length, y: y / length };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True while this ball is on the table and actually going somewhere. */
export function isMoving(ball: PoolBall): boolean {
  return !ball.pocketed && (ball.vx !== 0 || ball.vy !== 0);
}

/**
 * True when every ball in a SNAPSHOT is at rest.
 *
 * A convenience for reading a snapshot, not the settling rule. Whether a shot
 * has finished is `PoolPhysicsWorld.isSettled()`, which additionally requires
 * the table to have stayed still for several consecutive steps — see
 * `pool-physics-world.ts`.
 */
export function allBallsStopped(balls: readonly PoolBall[]): boolean {
  for (const ball of balls) {
    if (isMoving(ball)) return false;
  }
  return true;
}

export function activeBalls(balls: readonly PoolBall[]): PoolBall[] {
  return balls.filter((ball) => !ball.pocketed);
}

export function findBall(balls: readonly PoolBall[], number: number): PoolBall | undefined {
  return balls.find((ball) => ball.number === number);
}

// ── Recovery ────────────────────────────────────────────────────────────────

/**
 * A ball that is guaranteed to be usable, or `null` when the one supplied was
 * not.
 *
 * Returns `null` for a non-finite coordinate or a position well outside the
 * table. The caller decides what a `null` costs: the cue ball becomes a foul, an
 * object ball is returned to the table. Either is better than propagating a
 * `NaN` into a Planck body, which would poison the whole world.
 */
export function sanitiseBall(ball: PoolBall): PoolBall | null {
  if (
    !Number.isFinite(ball.x) ||
    !Number.isFinite(ball.y) ||
    !Number.isFinite(ball.vx) ||
    !Number.isFinite(ball.vy)
  ) {
    return null;
  }
  const margin = TABLE_LENGTH; // one table length of slack before we give up
  if (
    ball.x < -margin ||
    ball.x > TABLE_LENGTH + margin ||
    ball.y < -margin ||
    ball.y > TABLE_WIDTH + margin
  ) {
    return null;
  }
  return ball;
}

/** Keep a ball inside the playfield and under the speed ceiling. */
export function clampBall(ball: PoolBall): PoolBall {
  if (ball.pocketed) return ball;
  const capped = clampSpeed(ball.vx, ball.vy, MAX_BALL_SPEED);
  const x = clamp(
    Number.isFinite(ball.x) ? ball.x : BALL_BOUNDS.minX,
    BALL_BOUNDS.minX,
    BALL_BOUNDS.maxX,
  );
  const y = clamp(
    Number.isFinite(ball.y) ? ball.y : BALL_BOUNDS.minY,
    BALL_BOUNDS.minY,
    BALL_BOUNDS.maxY,
  );
  if (x === ball.x && y === ball.y && capped.vx === ball.vx && capped.vy === ball.vy) return ball;
  return { ...ball, x, y, vx: capped.vx, vy: capped.vy };
}

/**
 * Push apart every overlapping pair WITHOUT touching a velocity.
 *
 * Setup, not physics. It exists for two moments — building a rack, and placing a
 * ball by hand — where the world is about to be loaded from a list of positions
 * and two of them must not start inside each other. Giving them an impulse
 * instead would mean the table moved on its own before anyone hit anything.
 */
export function separateOverlaps(balls: readonly PoolBall[], passes = 6): PoolBall[] {
  const next = balls.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (let i = 0; i < next.length; i += 1) {
      if (next[i].pocketed) continue;
      for (let k = i + 1; k < next.length; k += 1) {
        if (next[k].pocketed) continue;
        const a = next[i];
        const b = next[k];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= BALL_DIAMETER) continue;
        if (dist === 0 || !Number.isFinite(dist)) {
          dx = 1;
          dy = 0;
          dist = 1e-6;
        }
        const push = (BALL_DIAMETER - dist) / 2 + 1e-4;
        const nx = dx / dist;
        const ny = dy / dist;
        next[i] = clampBall({ ...a, x: a.x - nx * push, y: a.y - ny * push });
        next[k] = clampBall({ ...b, x: b.x + nx * push, y: b.y + ny * push });
        moved = true;
      }
    }
    if (!moved) break;
  }

  return next;
}

// ── Aim assistance ──────────────────────────────────────────────────────────

/** What the cue ball would run into first, travelling in a straight line. */
export type CuePathEnd = 'ball' | 'cushion' | 'pocket';

export interface CuePathPrediction {
  /** Where the cue ball's CENTRE would be at the moment of the event. */
  readonly contact: Vec2;
  /** How far the centre travelled to get there, in table units. */
  readonly travel: number;
  readonly end: CuePathEnd;
  /** The ball that would be struck. Present only when `end === 'ball'`. */
  readonly ballNumber: number | null;
  /**
   * The direction the struck ball would set off in — the line of centres.
   *
   * Exact, and verified against the engine: `pool-physics-world.test.ts` plays a
   * half-ball hit and checks the object ball leaves within 0.12 rad of this.
   * It holds because the balls carry no spin and no tangential friction, so the
   * collision is a pure normal impulse.
   */
  readonly objectDirection: Vec2 | null;
}

/** Smallest positive root of `t² + 2bt + c = 0`, or `null` when there is none. */
function firstRoot(b: number, c: number): number | null {
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = -b - root;
  if (t0 > 1e-6) return t0;
  const t1 = -b + root;
  return t1 > 1e-6 ? t1 : null;
}

/**
 * Where a shot along `direction` first meets something.
 *
 * The aim assistance, and the whole of it. It answers one question — "what does
 * the cue ball hit first, and which way does that ball go?" — using the same
 * geometry the simulation uses, so the line it draws is the line the shot takes.
 *
 * ## What it deliberately does not do
 *
 * It does not continue past the first contact, does not follow the object ball
 * to a pocket, does not unfold cushion rebounds, and does not model
 * deceleration. Every one of those would be easy to add and every one would move
 * the game a step closer to playing itself.
 *
 * The one thing it DOES look past a ball for is a scratch: `end: 'pocket'` means
 * the cue ball is on its way down a hole, which is the mistake a beginner cannot
 * see coming. It is computed against the real pocket MOUTHS, so it agrees with
 * what the physics will do.
 */
export function predictCuePath(
  cue: Vec2,
  direction: Vec2,
  balls: readonly PoolBall[],
): CuePathPrediction {
  const unit = normalise(direction.x, direction.y) ?? { x: 1, y: 0 };

  let bestTravel = Infinity;
  let bestBall: PoolBall | null = null;

  for (const ball of balls) {
    if (ball.pocketed || ball.number === CUE_BALL) continue;
    const fx = cue.x - ball.x;
    const fy = cue.y - ball.y;
    const b = fx * unit.x + fy * unit.y;
    const c = fx * fx + fy * fy - BALL_DIAMETER * BALL_DIAMETER;
    const t = firstRoot(b, c);
    if (t !== null && t < bestTravel) {
      bestTravel = t;
      bestBall = ball;
    }
  }

  const mouth = nearestMouthCrossing(cue, unit);
  const pocketTravel = mouth?.travel ?? Infinity;
  // Against the real cushions, which have holes in them — not against the
  // playfield rectangle, which does not. A rectangle would draw a rail across
  // every pocket mouth and never warn about a scratch into a side pocket.
  const rail = nearestCushionContact(cue, unit);

  const travel = Math.min(bestTravel, pocketTravel, rail);
  const contact = { x: cue.x + unit.x * travel, y: cue.y + unit.y * travel };

  if (bestBall !== null && bestTravel <= pocketTravel && bestTravel <= rail) {
    return {
      contact,
      travel,
      end: 'ball',
      ballNumber: bestBall.number,
      objectDirection:
        normalise(bestBall.x - contact.x, bestBall.y - contact.y) ?? { x: unit.x, y: unit.y },
    };
  }

  return {
    contact,
    travel,
    end: pocketTravel <= rail ? 'pocket' : 'cushion',
    ballNumber: null,
    objectDirection: null,
  };
}

/**
 * Whether a ball travelling from `from` to `to` would be blocked by anything.
 *
 * Used by the AI planner to reject a shot it cannot actually play. A ball
 * obstructs when its centre lies within one diameter of the travelling ball's
 * path, which is exactly the condition under which the two would touch.
 */
export function pathIsClear(
  from: Vec2,
  to: Vec2,
  balls: readonly PoolBall[],
  ignore: readonly number[] = [],
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return true;

  for (const ball of balls) {
    if (ball.pocketed) continue;
    if (ignore.includes(ball.number)) continue;

    // Closest approach of the segment to this ball's centre.
    const t = clamp(((ball.x - from.x) * dx + (ball.y - from.y) * dy) / lengthSq, 0, 1);
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    if (Math.hypot(ball.x - cx, ball.y - cy) < BALL_DIAMETER) return false;
  }
  return true;
}

// ── Placement ───────────────────────────────────────────────────────────────

/**
 * Whether a ball's centre may legally sit here.
 *
 * Three separate refusals, and each one is a real thing a player tries: off the
 * cloth, inside another ball, and — the one everybody tries once — in a pocket.
 */
export function isLegalBallPosition(
  point: Vec2,
  balls: readonly PoolBall[],
  ignoreNumber = CUE_BALL,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (
    point.x < BALL_BOUNDS.minX ||
    point.x > BALL_BOUNDS.maxX ||
    point.y < BALL_BOUNDS.minY ||
    point.y > BALL_BOUNDS.maxY
  ) {
    return false;
  }
  if (isOverPocketMouth(point)) return false;

  for (const ball of balls) {
    if (ball.pocketed || ball.number === ignoreNumber) continue;
    if (Math.hypot(ball.x - point.x, ball.y - point.y) < BALL_DIAMETER) return false;
  }
  return true;
}

/**
 * The nearest legal spot to `point`, searched outwards in rings.
 *
 * The safety net under ball-in-hand: whatever the player asks for — a pocket,
 * the middle of the rack, a coordinate off the cloth — there is always somewhere
 * to put the ball, and it is always close to where they pointed. The search is
 * bounded and deterministic, so two players asking for the same impossible spot
 * get the same answer.
 */
export function nearestLegalPosition(
  point: Vec2,
  balls: readonly PoolBall[],
  ignoreNumber = CUE_BALL,
): Vec2 {
  const start: Vec2 = {
    x: clamp(
      Number.isFinite(point.x) ? point.x : TABLE_LENGTH / 2,
      BALL_BOUNDS.minX,
      BALL_BOUNDS.maxX,
    ),
    y: clamp(
      Number.isFinite(point.y) ? point.y : TABLE_WIDTH / 2,
      BALL_BOUNDS.minY,
      BALL_BOUNDS.maxY,
    ),
  };
  if (isLegalBallPosition(start, balls, ignoreNumber)) return start;

  const STEP = BALL_RADIUS * 0.8;
  const RINGS = 40;
  const SPOKES = 16;
  for (let ring = 1; ring <= RINGS; ring += 1) {
    const radius = ring * STEP;
    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const angle = (spoke / SPOKES) * Math.PI * 2;
      const candidate: Vec2 = {
        x: clamp(start.x + Math.cos(angle) * radius, BALL_BOUNDS.minX, BALL_BOUNDS.maxX),
        y: clamp(start.y + Math.sin(angle) * radius, BALL_BOUNDS.minY, BALL_BOUNDS.maxY),
      };
      if (isLegalBallPosition(candidate, balls, ignoreNumber)) return candidate;
    }
  }
  return start;
}

/** Re-exported so callers have one place to import table geometry queries from. */
export {
  isOverPocketMouth,
  nearestCushionContact,
  nearestMouthCrossing,
} from './pool-physics-geometry';
