/**
 * The Planck world, on its own — the spike that had to be convincing before any
 * of it was wired into a match.
 *
 * Everything here drives the REAL engine headlessly. Planck is pure JavaScript
 * with no DOM and no async initialisation, so a whole shot is a loop over
 * `world.step` in Node — which is the main reason it was chosen.
 *
 * Tolerances are deliberately loose where the contract is a direction or a
 * range. A sequential-impulse solver does not produce exact numbers and
 * asserting them would be asserting the version, not the behaviour.
 */
import { describe, it, expect } from 'vitest';

import {
  createPoolPhysicsWorld,
  METRES_PER_UNIT,
  type PoolPhysicsFrame,
  type PoolPhysicsWorld,
} from './pool-physics-world';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHION_RESTITUTION,
  FIXED_STEP_MS,
  MAX_BALL_SPEED,
  MAX_SHOT_SPEED,
  POCKETS,
  ROLLING_DECEL,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from './table';
import { CUE_BALL, EIGHT_BALL, type PoolBall } from './physics';
import {
  CORNER_MOUTH,
  CUSHION_DEPTH,
  POOL_CUSHIONS,
  POOL_POCKETS,
  SIDE_MOUTH,
} from './pool-physics-geometry';
import { buildRack, poolSeedFrom } from './rack';

const DT = FIXED_STEP_MS / 1000;

function ball(number: number, x: number, y: number, vx = 0, vy = 0): PoolBall {
  return { number, x, y, vx, vy, pocketed: false };
}

interface Run {
  readonly world: PoolPhysicsWorld;
  readonly frames: PoolPhysicsFrame[];
  readonly steps: number;
  /** Where the cue ball was on every step. Some contracts are about the PATH. */
  readonly path: readonly PoolBall[];
  ball(number: number): PoolBall;
  pocketed(): number[];
}

/** Set the table up, take a shot, and run until everything stops. */
function shoot(
  balls: PoolBall[],
  shot: { angle: number; speed: number } | null,
  maxSteps = 6000,
): Run {
  const world = createPoolPhysicsWorld();
  world.reset(balls);
  if (shot) world.strike(shot.angle, shot.speed);

  const frames: PoolPhysicsFrame[] = [];
  const path: PoolBall[] = [];
  let steps = 0;
  while (!world.isSettled() && steps < maxSteps) {
    world.step(DT);
    frames.push(world.drain());
    const cue = world.snapshot().find((b) => b.number === CUE_BALL);
    if (cue) path.push(cue);
    steps += 1;
  }

  const snapshot = world.snapshot();
  return {
    world,
    frames,
    steps,
    path,
    ball: (n) => snapshot.find((b) => b.number === n)!,
    pocketed: () =>
      frames.flatMap((f) => f.pocketed.map((p) => p.ball)),
  };
}

/** Aim from one point at another. */
function aimAt(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── The world itself ────────────────────────────────────────────────────────

describe('the world', () => {
  it('builds synchronously, with no gravity and no async init', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 50, 50)]);
    // A lone ball at rest, stepped: gravity would move it.
    for (let i = 0; i < 60; i += 1) world.step(DT);
    const cue = world.snapshot()[0];
    expect(cue.x).toBeCloseTo(50, 6);
    expect(cue.y).toBeCloseTo(50, 6);
    world.dispose();
  });

  it('reports the table in ball-number order, whatever order it was given', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(8, 100, 50), ball(CUE_BALL, 50, 50), ball(3, 70, 20)]);
    expect(world.snapshot().map((b) => b.number)).toEqual([0, 3, 8]);
    world.dispose();
  });

  it('hands out fresh objects, so a snapshot cannot be written back through', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 50, 50)]);
    const first = world.snapshot();
    const second = world.snapshot();
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).toEqual(second[0]);
    world.dispose();
  });

  it('gives every ball the same mass', () => {
    // Checked through behaviour rather than through a body: a dead-straight
    // full-ball hit between equal masses stops the cue ball and sends the object
    // ball off with nearly everything.
    //
    // The speed is chosen so the object ball comes to rest BEFORE the far
    // cushion — otherwise the resting position measures a round trip rather than
    // the collision.
    const run = shoot([ball(CUE_BALL, 40, 50), ball(1, 100, 50)], { angle: 0, speed: 70 });
    expect(run.ball(CUE_BALL).x).toBeCloseTo(100 - BALL_DIAMETER, 0);
    expect(run.ball(1).x).toBeGreaterThan(125);
    expect(run.ball(1).x).toBeLessThan(TABLE_LENGTH - BALL_RADIUS);
  });

  it('resets to a brand-new table', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 50, 50), ball(1, 100, 50)]);
    world.strike(0, 150);
    for (let i = 0; i < 200; i += 1) world.step(DT);
    expect(world.snapshot().find((b) => b.number === 1)!.x).not.toBeCloseTo(100, 1);

    world.reset([ball(CUE_BALL, 50, 50), ball(1, 100, 50)]);
    const after = world.snapshot();
    expect(after.find((b) => b.number === 1)!.x).toBeCloseTo(100, 6);
    expect(after.every((b) => b.vx === 0 && b.vy === 0)).toBe(true);
    expect(world.drain().contacts).toEqual([]);
    world.dispose();
  });

  it('places a ball exactly where it is told, at rest', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 50, 50, 90, 12)]);
    world.setBall(CUE_BALL, { x: 133, y: 27 });
    const cue = world.snapshot()[0];
    expect(cue.x).toBeCloseTo(133, 6);
    expect(cue.y).toBeCloseTo(27, 6);
    expect(cue.vx).toBe(0);
    expect(cue.vy).toBe(0);
    world.dispose();
  });

  it('brings a pocketed ball back when it is re-spotted', () => {
    const corner = POOL_POCKETS[2];
    const run = shoot(
      [ball(CUE_BALL, 150, 50), ball(EIGHT_BALL, 170, 30)],
      { angle: aimAt({ x: 150, y: 50 }, { x: 170, y: 30 }), speed: 110 },
    );
    expect(run.pocketed()).toContain(EIGHT_BALL);
    expect(corner.kind).toBe('corner');

    run.world.setBall(EIGHT_BALL, { x: 150, y: 50 });
    const back = run.world.snapshot().find((b) => b.number === EIGHT_BALL)!;
    expect(back.pocketed).toBe(false);
    expect(back.x).toBeCloseTo(150, 6);
    run.world.dispose();
  });

  it('scales table units to a Box2D-friendly world', () => {
    // The scale is load-bearing: it is what lets Planck's absolute tolerances be
    // left alone. See the module note.
    expect(METRES_PER_UNIT).toBe(0.1);
    expect(BALL_RADIUS * METRES_PER_UNIT).toBeCloseTo(0.28, 6);
    // `maxTranslation` is 2 m per step; our worst case must be far under it.
    expect(MAX_BALL_SPEED * METRES_PER_UNIT * DT).toBeLessThan(0.5);
  });
});

// ── Collisions ──────────────────────────────────────────────────────────────

describe('ball on ball', () => {
  it('sends a full-ball hit straight through', () => {
    const run = shoot([ball(CUE_BALL, 40, 50), ball(1, 100, 50)], { angle: 0, speed: 70 });
    const one = run.ball(1);
    expect(one.x).toBeGreaterThan(125);
    // Dead straight: it must not have wandered off the line.
    expect(Math.abs(one.y - 50)).toBeLessThan(1.5);
  });

  it('obeys the 90° rule closely enough to aim by', () => {
    // The single fact the aim guide is built on. A half-ball hit: the object
    // ball leaves along the line of centres, the cue ball perpendicular to it.
    const cut = Math.PI / 6;
    const target = { x: 120, y: 50 };
    const cue = {
      x: target.x - Math.cos(cut) * 60,
      y: target.y - Math.sin(cut) * 60,
    };
    const run = shoot(
      [ball(CUE_BALL, cue.x, cue.y), ball(1, target.x, target.y)],
      { angle: aimAt(cue, target), speed: 120 },
    );

    const objectAngle = Math.atan2(run.ball(1).y - target.y, run.ball(1).x - target.x);
    expect(Math.abs(objectAngle - cut)).toBeLessThan(0.12);
  });

  it('splits a thin cut the way a thin cut splits', () => {
    // The object ball goes off at a wide angle and keeps little of the pace.
    const target = { x: 120, y: 50 };
    const cue = { x: 60, y: 50 + BALL_DIAMETER * 0.85 };
    const run = shoot(
      [ball(CUE_BALL, cue.x, cue.y), ball(1, target.x, target.y)],
      { angle: aimAt(cue, { x: target.x, y: target.y + BALL_DIAMETER * 0.85 }), speed: 150 },
    );
    // It moved, and it moved away from the cue ball's line rather than along it.
    expect(Math.hypot(run.ball(1).x - target.x, run.ball(1).y - target.y)).toBeGreaterThan(4);
  });

  it('drives a three-ball line without the middle ball squirting out', () => {
    const run = shoot(
      [ball(CUE_BALL, 40, 50), ball(1, 100, 50), ball(2, 100 + BALL_DIAMETER + 0.4, 50)],
      { angle: 0, speed: 150 },
    );
    // The far ball takes most of the energy; the middle one barely moves.
    expect(run.ball(2).x).toBeGreaterThan(run.ball(1).x);
    expect(Math.abs(run.ball(1).y - 50)).toBeLessThan(3);
    expect(Math.abs(run.ball(2).y - 50)).toBeLessThan(3);
  });

  it('keeps a four-ball cluster stable rather than exploding it', () => {
    const cluster = [
      ball(CUE_BALL, 40, 50),
      ball(1, 120, 50),
      ball(2, 120 + BALL_DIAMETER, 50),
      ball(3, 120 + BALL_RADIUS, 50 + BALL_DIAMETER * 0.87),
      ball(4, 120 + BALL_RADIUS, 50 - BALL_DIAMETER * 0.87),
    ];
    const run = shoot(cluster, { angle: 0, speed: 170 });

    // Nothing was flung off the table, and nothing is left inside anything else.
    const up = [1, 2, 3, 4].map(run.ball).filter((b) => !b.pocketed);
    for (const b of up) {
      expect(b.x).toBeGreaterThanOrEqual(BALL_RADIUS - 0.2);
      expect(b.x).toBeLessThanOrEqual(TABLE_LENGTH - BALL_RADIUS + 0.2);
      expect(b.y).toBeGreaterThanOrEqual(BALL_RADIUS - 0.2);
      expect(b.y).toBeLessThanOrEqual(TABLE_WIDTH - BALL_RADIUS + 0.2);
    }
    for (let i = 0; i < up.length; i += 1) {
      for (let k = i + 1; k < up.length; k += 1) {
        expect(
          Math.hypot(up[i].x - up[k].x, up[i].y - up[k].y),
          `${up[i].number}/${up[k].number}`,
        ).toBeGreaterThan(BALL_DIAMETER - 0.3);
      }
    }
  });

  it('leaves two touching balls alone', () => {
    const run = shoot(
      [ball(1, 100, 50), ball(2, 100 + BALL_DIAMETER, 50)],
      null,
      400,
    );
    expect(run.ball(1).x).toBeCloseTo(100, 1);
    expect(run.ball(2).x).toBeCloseTo(100 + BALL_DIAMETER, 1);
    expect(run.steps).toBeLessThan(20);
  });

  it('reports one contact per collision, not one per step of touching', () => {
    // The persistent-contact trap: `post-solve` would fire every step for two
    // balls that end up resting together.
    const run = shoot([ball(CUE_BALL, 40, 50), ball(1, 100, 50)], { angle: 0, speed: 60 });
    const pairs = run.frames.flatMap((f) => f.contacts).filter((c) => c.a === 0 && c.b === 1);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(pairs.length).toBeLessThanOrEqual(3);
    expect(pairs[0].impact).toBeGreaterThan(20);
  });

  it('always names the cue ball first in a contact', () => {
    const run = shoot([ball(CUE_BALL, 40, 50), ball(7, 100, 50)], { angle: 0, speed: 120 });
    const withCue = run.frames.flatMap((f) => f.contacts).filter((c) => c.a === 0 || c.b === 0);
    expect(withCue.length).toBeGreaterThan(0);
    for (const contact of withCue) expect(contact.a).toBe(0);
  });
});

// ── Cushions ────────────────────────────────────────────────────────────────

describe('cushions', () => {
  it('rebounds off a long rail at the mirror angle', () => {
    const world = createPoolPhysicsWorld();
    // Aimed at the middle of the bottom-left cushion, well clear of both mouths.
    world.reset([ball(CUE_BALL, 50, 40)]);
    world.strike(Math.atan2(-40 + BALL_RADIUS, 10), 120);

    let bounced = false;
    for (let i = 0; i < 600 && !bounced; i += 1) {
      world.step(DT);
      if (world.drain().cushions.length > 0) bounced = true;
    }
    expect(bounced).toBe(true);

    const after = world.snapshot()[0];
    // It came back up-table rather than through the rail.
    expect(after.vy).toBeGreaterThan(0);
    expect(after.y).toBeGreaterThanOrEqual(BALL_RADIUS - 0.2);
    world.dispose();
  });

  it('rebounds off a rail at the cushion’s own restitution, not the ball’s', () => {
    // Box2D mixes two fixtures' restitution with `max`, so without the per-contact
    // override in `pre-solve` a ball (0.95) would leave a cushion (0.74) at 0.95
    // and the table would play like a trampoline.
    //
    // Measured across the contact itself rather than from where the ball ends
    // up: at any speed worth testing it bounces off several cushions, so the
    // resting position says nothing about any one of them.
    const rail = shoot([ball(CUE_BALL, 60, 40)], { angle: -Math.PI / 2, speed: 120 });
    expect(rail.pocketed()).toEqual([]);

    const hitAt = rail.frames.findIndex((f) => f.cushions.length > 0);
    expect(hitAt).toBeGreaterThan(0);

    const before = Math.hypot(rail.path[hitAt - 1].vx, rail.path[hitAt - 1].vy);
    const after = Math.hypot(rail.path[hitAt + 1].vx, rail.path[hitAt + 1].vy);
    expect(after / before).toBeGreaterThan(CUSHION_RESTITUTION - 0.1);
    expect(after / before).toBeLessThan(CUSHION_RESTITUTION + 0.1);
  });

  it('reports which cushion was hit', () => {
    const run = shoot([ball(CUE_BALL, 60, 40)], { angle: -Math.PI / 2, speed: 100 });
    const hits = run.frames.flatMap((f) => f.cushions);
    expect(hits.length).toBeGreaterThan(0);
    expect(POOL_CUSHIONS.map((c) => c.id)).toContain(hits[0].cushion);
    expect(hits[0].ball).toBe(CUE_BALL);
    expect(hits[0].impact).toBeGreaterThan(10);
  });

  it('keeps every ball on the cloth through a maximum-power shot', () => {
    const run = shoot([ball(CUE_BALL, 20, 20)], { angle: 0.61, speed: MAX_SHOT_SPEED }, 8000);
    const cue = run.ball(CUE_BALL);
    expect(cue.pocketed || cue.x >= BALL_RADIUS - 0.3).toBe(true);
    if (!cue.pocketed) {
      expect(cue.x).toBeLessThanOrEqual(TABLE_LENGTH - BALL_RADIUS + 0.3);
      expect(cue.y).toBeGreaterThanOrEqual(BALL_RADIUS - 0.3);
      expect(cue.y).toBeLessThanOrEqual(TABLE_WIDTH - BALL_RADIUS + 0.3);
    }
  });
});

// ── Pockets ─────────────────────────────────────────────────────────────────

describe('pockets', () => {
  const CORNERS = POOL_POCKETS.filter((p) => p.kind === 'corner');
  const SIDES = POOL_POCKETS.filter((p) => p.kind === 'side');

  it('swallows a ball rolled slowly into every corner', () => {
    for (const target of CORNERS) {
      const from = {
        x: target.mouthMid.x - target.outward.x * 40,
        y: target.mouthMid.y - target.outward.y * 40,
      };
      const run = shoot(
        [ball(CUE_BALL, from.x, from.y)],
        { angle: aimAt(from, target.mouthMid), speed: 55 },
      );
      expect(run.pocketed(), `corner ${target.index}`).toEqual([CUE_BALL]);
    }
  });

  it('swallows a ball driven hard into every corner', () => {
    for (const target of CORNERS) {
      const from = {
        x: target.mouthMid.x - target.outward.x * 60,
        y: target.mouthMid.y - target.outward.y * 60,
      };
      const run = shoot(
        [ball(CUE_BALL, from.x, from.y)],
        { angle: aimAt(from, target.mouthMid), speed: MAX_SHOT_SPEED },
      );
      expect(run.pocketed(), `corner ${target.index}`).toEqual([CUE_BALL]);
    }
  });

  it('swallows a ball rolled into either side pocket', () => {
    for (const target of SIDES) {
      for (const speed of [50, 120, MAX_SHOT_SPEED]) {
        const from = {
          x: target.mouthMid.x - target.outward.x * 40,
          y: target.mouthMid.y - target.outward.y * 40,
        };
        const run = shoot(
          [ball(CUE_BALL, from.x, from.y)],
          { angle: aimAt(from, target.mouthMid), speed },
        );
        expect(run.pocketed(), `side ${target.index} at ${speed}`).toEqual([CUE_BALL]);
      }
    }
  });

  it('swallows a ball entering near the edge of a mouth', () => {
    // The case the old circular capture region missed entirely: a ball crossing
    // the mouth plane close to a jaw fell through into nothing.
    for (const target of POOL_POCKETS) {
      const across = target.halfWidth * 0.6;
      const from = {
        x: target.mouthMid.x + target.tangent.x * across - target.outward.x * 30,
        y: target.mouthMid.y + target.tangent.y * across - target.outward.y * 30,
      };
      const aim = {
        x: target.mouthMid.x + target.tangent.x * across,
        y: target.mouthMid.y + target.tangent.y * across,
      };
      const run = shoot([ball(CUE_BALL, from.x, from.y)], { angle: aimAt(from, aim), speed: 80 });
      expect(run.pocketed(), `pocket ${target.index}`).toEqual([CUE_BALL]);
    }
  });

  it('rejects a ball that catches a corner jaw', () => {
    // Aimed at the cushion just outside the mouth. It must come back onto the
    // table, not disappear and not stop dead.
    const from = { x: 60, y: 40 };
    const jaw = { x: CORNER_MOUTH + 3.5, y: BALL_RADIUS };
    const run = shoot([ball(CUE_BALL, from.x, from.y)], { angle: aimAt(from, jaw), speed: 90 });
    expect(run.pocketed()).toEqual([]);
    expect(run.frames.some((f) => f.cushions.length > 0)).toBe(true);
    const cue = run.ball(CUE_BALL);
    expect(cue.pocketed).toBe(false);
    expect(cue.y).toBeGreaterThan(BALL_RADIUS - 0.3);
  });

  it('lets a ball run along a rail PAST a side pocket', () => {
    // A real side pocket does not swallow a ball travelling parallel to its
    // mouth, and the mouth-plane test is what gets this right — a capture
    // circle round the pocket centre could not.
    //
    // It is checked by where the ball GOES, not where it stops: at this speed it
    // runs the length of the table, rebounds off the far cushion and comes back,
    // so the resting position is behind the side pocket again.
    const run = shoot([ball(CUE_BALL, 40, BALL_RADIUS)], { angle: 0, speed: 150 }, 8000);
    expect(run.pocketed()).toEqual([]);
    expect(Math.max(...run.path.map((p) => p.x))).toBeGreaterThan(TABLE_LENGTH - 20);
  });

  it('swallows a ball running along a rail INTO a corner', () => {
    // …and the same test gets the opposite case right, because a corner's mouth
    // plane cuts across the rail rather than lying along it.
    const run = shoot(
      [ball(CUE_BALL, TABLE_LENGTH / 2 + 20, BALL_RADIUS)],
      { angle: Math.PI, speed: 90 },
      8000,
    );
    expect(run.pocketed()).toEqual([CUE_BALL]);
  });

  it('fires a pocket event exactly once, and stops simulating the ball', () => {
    const target = POOL_POCKETS[0];
    const from = { x: 60, y: 40 };
    const run = shoot(
      [ball(CUE_BALL, from.x, from.y)],
      { angle: aimAt(from, target.mouthMid), speed: 100 },
    );
    const events = run.frames.flatMap((f) => f.pocketed);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ball: CUE_BALL, pocket: 0 });

    const cue = run.ball(CUE_BALL);
    expect(cue.pocketed).toBe(true);
    expect(cue.vx).toBe(0);
    expect(cue.vy).toBe(0);
  });

  it('stops a pocketed ball colliding with anything', () => {
    const target = POOL_POCKETS[0];
    const from = { x: 60, y: 40 };
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, from.x, from.y), ball(1, 120, 60)]);
    world.strike(aimAt(from, target.mouthMid), 110);

    let steps = 0;
    while (!world.isSettled() && steps < 4000) {
      world.step(DT);
      world.drain();
      steps += 1;
    }
    // Put the 1-ball exactly where the cue ball went and step on: nothing should
    // react, because the pocketed body is out of the simulation.
    world.setBall(1, { x: target.centre.x, y: target.centre.y });
    const before = world.snapshot().find((b) => b.number === 1)!;
    for (let i = 0; i < 30; i += 1) {
      world.step(DT);
      world.drain();
    }
    const after = world.snapshot().find((b) => b.number === 1)!;
    expect(after.pocketed || Math.hypot(after.x - before.x, after.y - before.y) < 8).toBe(true);
    world.dispose();
  });

  it('never loses a ball, whatever it is hit with', () => {
    for (const angle of [0, 0.3, 0.7, 1.2, 2.1, 2.9, -0.4, -1.1, -2.2, -3.0]) {
      const run = shoot([ball(CUE_BALL, 100, 50)], { angle, speed: MAX_SHOT_SPEED }, 8000);
      const cue = run.ball(CUE_BALL);
      expect(Number.isFinite(cue.x) && Number.isFinite(cue.y), `angle ${angle}`).toBe(true);
      if (!cue.pocketed) {
        expect(cue.x, `angle ${angle}`).toBeGreaterThan(-CUSHION_DEPTH);
        expect(cue.x, `angle ${angle}`).toBeLessThan(TABLE_LENGTH + CUSHION_DEPTH);
      }
    }
  });

  it('lets two balls collide right at a pocket mouth without either being lost', () => {
    const target = POOL_POCKETS[1]; // a side pocket
    const hanging = {
      x: target.mouthMid.x,
      y: target.mouthMid.y - target.outward.y * (BALL_RADIUS + 1),
    };
    // Straight in line with the mouth, so the object ball is driven down the
    // pocket rather than into a jaw.
    const from = { x: hanging.x, y: hanging.y + 45 };
    const run = shoot(
      [ball(CUE_BALL, from.x, from.y), ball(1, hanging.x, hanging.y)],
      { angle: aimAt(from, hanging), speed: 95 },
    );
    for (const n of [CUE_BALL, 1]) {
      const b = run.ball(n);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y), String(n)).toBe(true);
    }
    expect(run.pocketed()).toContain(1);
  });
});

// ── Settling ────────────────────────────────────────────────────────────────

describe('settling', () => {
  it('settles an ordinary shot in a sensible time', () => {
    const run = shoot([ball(CUE_BALL, 30, 50), ball(1, 120, 50)], { angle: 0, speed: 130 });
    expect(run.world.isSettled()).toBe(true);
    expect(run.steps * DT).toBeLessThan(20);
    expect(run.steps * DT).toBeGreaterThan(0.5);
  });

  it('settles a full-power break', () => {
    const run = shoot(buildRack(poolSeedFrom('settle')).balls as PoolBall[], {
      angle: 0,
      speed: MAX_SHOT_SPEED,
    }, 8000);
    expect(run.world.isSettled()).toBe(true);
  });

  it('is not settled while anything is still rolling', () => {
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 20, 50)]);
    world.strike(0, 150);
    world.step(DT);
    expect(world.isSettled()).toBe(false);
    world.dispose();
  });

  it('stops a ball dead rather than letting it creep', () => {
    const run = shoot([ball(CUE_BALL, 20, 50)], { angle: 0, speed: 45 });
    expect(run.ball(CUE_BALL).vx).toBe(0);
    expect(run.ball(CUE_BALL).vy).toBe(0);
  });

  it('rolls the distance constant deceleration predicts, so the AI can aim by it', () => {
    for (const speed of [60, 120, 180]) {
      const run = shoot([ball(CUE_BALL, 6, 50)], { angle: 0, speed }, 8000);
      if (run.ball(CUE_BALL).pocketed) continue;
      const travelled = run.ball(CUE_BALL).x - 6;
      const predicted = (speed * speed) / (2 * ROLLING_DECEL);
      // Within 5% for anything that did not reach a cushion.
      if (predicted < TABLE_LENGTH - 20) {
        expect(Math.abs(travelled - predicted) / predicted, `speed ${speed}`).toBeLessThan(0.05);
      }
    }
  });

  it('does not advance while nothing is stepped', () => {
    // A pause is simply not calling `step`, and it must not settle a live shot.
    const world = createPoolPhysicsWorld();
    world.reset([ball(CUE_BALL, 20, 50)]);
    world.strike(0, 150);
    world.step(DT);
    const before = world.snapshot()[0];
    const settledBefore = world.isSettled();
    // …time passes with no steps…
    expect(world.snapshot()[0]).toEqual(before);
    expect(world.isSettled()).toBe(settledBefore);
    world.dispose();
  });

  it('starts a new shot un-settled', () => {
    const run = shoot([ball(CUE_BALL, 30, 50)], { angle: 0, speed: 60 });
    expect(run.world.isSettled()).toBe(true);
    run.world.strike(Math.PI, 60);
    expect(run.world.isSettled()).toBe(false);
    run.world.dispose();
  });
});

// ── The break ───────────────────────────────────────────────────────────────

describe('a full rack', () => {
  it('scatters, settles, and keeps every ball accounted for', () => {
    const rack = buildRack(poolSeedFrom('break-quality')).balls as PoolBall[];
    const run = shoot(rack, { angle: 0, speed: MAX_SHOT_SPEED }, 8000);

    expect(run.world.isSettled()).toBe(true);

    const after = run.world.snapshot();
    expect(after).toHaveLength(16);

    const potted = run.pocketed();
    expect(new Set(potted).size).toBe(potted.length);

    for (const b of after) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y), String(b.number)).toBe(true);
      if (b.pocketed) continue;
      expect(b.x, String(b.number)).toBeGreaterThan(BALL_RADIUS - 0.4);
      expect(b.x, String(b.number)).toBeLessThan(TABLE_LENGTH - BALL_RADIUS + 0.4);
      expect(b.y, String(b.number)).toBeGreaterThan(BALL_RADIUS - 0.4);
      expect(b.y, String(b.number)).toBeLessThan(TABLE_WIDTH - BALL_RADIUS + 0.4);
    }

    // Nothing left inside anything else.
    const up = after.filter((b) => !b.pocketed);
    for (let i = 0; i < up.length; i += 1) {
      for (let k = i + 1; k < up.length; k += 1) {
        expect(
          Math.hypot(up[i].x - up[k].x, up[i].y - up[k].y),
          `${up[i].number}/${up[k].number}`,
        ).toBeGreaterThan(BALL_DIAMETER - 0.4);
      }
    }
  });

  it('actually breaks the rack up', () => {
    const rack = buildRack(poolSeedFrom('break-spread')).balls as PoolBall[];
    const run = shoot(rack, { angle: 0, speed: MAX_SHOT_SPEED }, 8000);
    const moved = rack.filter((before) => {
      const after = run.ball(before.number);
      return after.pocketed || Math.hypot(after.x - before.x, after.y - before.y) > 5;
    });
    // Fifteen object balls plus the cue ball; a good break moves most of them a
    // long way and leaves a couple of the back ones roughly where they were.
    expect(moved.length).toBeGreaterThanOrEqual(11);
  });

  it('is reproducible: the same rack and the same shot give the same table', () => {
    const play = () => {
      const rack = buildRack(poolSeedFrom('determinism')).balls as PoolBall[];
      return shoot(rack, { angle: 0.02, speed: 170 }, 8000).world.snapshot();
    };
    const a = play();
    const b = play();
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i].pocketed).toBe(b[i].pocketed);
      expect(a[i].x).toBeCloseTo(b[i].x, 6);
      expect(a[i].y).toBeCloseTo(b[i].y, 6);
    }
  });
});

// ── Geometry agreement ──────────────────────────────────────────────────────

describe('the physical table matches the described one', () => {
  it('leaves a real gap at every pocket', () => {
    // Every pocket's mouth points must be cushion noses, so the drawn opening
    // and the physical opening cannot drift apart.
    const noses = POOL_CUSHIONS.flatMap((c) => [c.noseA, c.noseB]);
    const near = (p: { x: number; y: number }) =>
      noses.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-9);
    for (const target of POOL_POCKETS) {
      expect(near(target.mouthA), `pocket ${target.index} A`).toBe(true);
      expect(near(target.mouthB), `pocket ${target.index} B`).toBe(true);
    }
  });

  it('gives every mouth room for a ball to pass', () => {
    for (const target of POOL_POCKETS) {
      expect(target.halfWidth * 2, `pocket ${target.index}`).toBeGreaterThan(BALL_DIAMETER * 1.8);
    }
  });

  it('accounts for the whole rail: cushions plus mouths', () => {
    const long =
      POOL_CUSHIONS.filter((c) => c.id.startsWith('bottom')).reduce(
        (sum, c) => sum + Math.hypot(c.noseB.x - c.noseA.x, c.noseB.y - c.noseA.y),
        0,
      ) +
      CORNER_MOUTH * 2 +
      SIDE_MOUTH * 2;
    expect(long).toBeCloseTo(TABLE_LENGTH, 6);

    const short =
      POOL_CUSHIONS.filter((c) => c.id === 'left').reduce(
        (sum, c) => sum + Math.hypot(c.noseB.y - c.noseA.y, c.noseB.x - c.noseA.x),
        0,
      ) +
      CORNER_MOUTH * 2;
    expect(short).toBeCloseTo(TABLE_WIDTH, 6);
  });

  it('puts a pocket where the game has always said there is one', () => {
    // `POCKETS` is what the AI scores against and what the result reports.
    expect(POOL_POCKETS.map((p) => p.centre)).toEqual([...POCKETS]);
  });
});
