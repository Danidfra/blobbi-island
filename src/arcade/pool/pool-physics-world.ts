/**
 * Pool — the physics world, and the ONLY module that knows Planck exists.
 *
 * Everything above this file — the match state machine, the rules, the AI, the
 * result, the renderer — speaks in {@link PoolBall} snapshots and table units.
 * Nothing above it ever sees a `Body`, a `Fixture` or a `Vec2` from the engine,
 * which is what makes the engine replaceable and what keeps `rules.ts` a pure
 * function of numbers.
 *
 * ## Why Planck
 *
 * Planck 1.5 is a TypeScript port of Box2D 2.4: MIT, zero runtime dependencies,
 * first-party type declarations, a synchronous constructor, and an ESM build
 * Vite consumes without a plugin. The two things that decided it over the
 * alternatives are both about *circles*:
 *
 *  - Box2D has a true `Circle` shape with an exact circle-circle manifold. A
 *    pool game lives or dies on the collision normal being the real line of
 *    centres; Matter.js approximates circles as 25-gons, which produces exactly
 *    the faceted, slightly-wrong rebound this work was commissioned to fix.
 *  - Its sequential-impulse solver with position correction handles the fifteen
 *    simultaneous contacts of a rack without the cluster exploding.
 *
 * Rapier's solver is at least as good and it was rejected on integration cost:
 * WebAssembly, an async `init()` before a world can exist, and either a Vite
 * WASM plugin this repository does not have or a base64-inlined build several
 * times Planck's size.
 *
 * ## Units
 *
 * The game thinks in **table units** (200 × 100, ball radius 2.8). Box2D is
 * tuned for **metres** and its tolerances are absolute: `linearSlop` is 5 mm,
 * `maxTranslation` is 2 m per step. So the world runs at
 * {@link METRES_PER_UNIT} = 0.1 — a 20 × 10 m table with 0.28 m balls — and this
 * module converts at the boundary. That scale was chosen so the defaults land
 * well and **no Planck global has to be mutated**:
 *
 * | tolerance | default | in table units | verdict |
 * | --- | --- | --- | --- |
 * | `linearSlop` | 0.005 m | 0.05 | 1.8% of a ball's radius — invisible |
 * | `maxTranslation` | 2 m/step | 20/step | our worst is 1.6 |
 * | `velocityThreshold` | 1 m/s | 10 u/s | below this, contacts are inelastic — and a ball below 10 u/s stops within 2 units anyway |
 *
 * ## Rolling friction is ours, not the engine's
 *
 * `linearDamping` is left at zero and a **constant deceleration** is applied
 * after each step, exactly as the pre-Planck implementation did. Two reasons,
 * and the second is the important one:
 *
 *  - damping is exponential and never actually stops a ball, and "every ball has
 *    stopped" is the event the whole turn structure hangs off;
 *  - `d = v² / 2a` is the model the AI's power calculation is built from. Keeping
 *    it means the migration did not have to retune the opponent.
 *
 * It is applied uniformly to every ball after the solver has finished, so it
 * never fights the solver — it is a velocity edit between steps, not a force.
 */

import { Circle, Polygon, Vec2, World, type Body, type Contact } from 'planck';

import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  CUSHION_RESTITUTION,
  MAX_BALL_SPEED,
  ROLLING_DECEL,
  STOP_SPEED,
} from './table';
import { CUE_BALL, clampSpeed, type PoolBall, type Vec2 as PoolVec2 } from './physics';
import {
  POOL_CUSHIONS,
  capturingPocket,
  hasEscapedTable,
  nearestPocket,
} from './pool-physics-geometry';

/** Physics metres per table unit. See the module note. */
export const METRES_PER_UNIT = 0.1;
const UNITS_PER_METRE = 1 / METRES_PER_UNIT;

/**
 * Solver iterations.
 *
 * Box2D's defaults are 8 and 3. The position count is raised because a rack is
 * fifteen bodies in simultaneous contact and three passes leaves the back of it
 * visibly interpenetrating for a few frames after the break. Measured on a full
 * break, 8/8 costs about 0.1 ms a step more than 8/3 and removes it.
 */
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 8;

/**
 * How many consecutive steps every ball must be stopped before the table counts
 * as settled.
 *
 * Six steps is 50 ms at 120 Hz. It is not there to wait for slow balls — the
 * friction rule zeroes anything under {@link STOP_SPEED}, so "stopped" is exact
 * — it is there so that a ball which is momentarily stationary at the top of a
 * bounce, or between two frames of a contact being resolved, cannot end the shot
 * early.
 */
const SETTLE_STEPS = 6;

/** A ball-on-ball contact, as the match and the audio engine want it. */
export interface PoolContactFact {
  /** The lower ball number. The cue ball, `0`, is always `a` when involved. */
  readonly a: number;
  readonly b: number;
  readonly at: PoolVec2;
  /** Closing speed along the contact normal, in table units per second. */
  readonly impact: number;
}

/** A ball-on-cushion contact. */
export interface PoolCushionFact {
  readonly ball: number;
  readonly cushion: string;
  readonly at: PoolVec2;
  readonly impact: number;
}

export interface PoolPocketFact {
  readonly ball: number;
  readonly pocket: number;
  readonly at: PoolVec2;
}

/**
 * Everything that happened during the steps since the last drain.
 *
 * Drained rather than subscribed to, so a contact callback can never reach React
 * state and the queues cannot grow without bound.
 */
export interface PoolPhysicsFrame {
  readonly contacts: readonly PoolContactFact[];
  readonly cushions: readonly PoolCushionFact[];
  readonly pocketed: readonly PoolPocketFact[];
  /** A ball reached an impossible state and was recovered. */
  readonly recovered: readonly number[];
}

const EMPTY_FRAME: PoolPhysicsFrame = Object.freeze({
  contacts: Object.freeze([]),
  cushions: Object.freeze([]),
  pocketed: Object.freeze([]),
  recovered: Object.freeze([]),
});

/**
 * The domain-level physics API.
 *
 * Deliberately small, and deliberately in table units. Every verb is something
 * the game wants to do; none of them mentions a body.
 */
export interface PoolPhysicsWorld {
  /** Replace the whole table. Used to rack up and to start a replay. */
  reset(balls: readonly PoolBall[]): void;
  /** Move a ball and stop it. Placement, the 8-ball re-spot, scratch recovery. */
  setBall(number: number, at: PoolVec2): void;
  /** Send the cue ball off at `speed` table units per second along `angle`. */
  strike(angle: number, speed: number): void;
  /** Advance by one fixed step. `dt` in seconds. */
  step(dt: number): void;
  /** Everything observed since the last call. Clears the queues. */
  drain(): PoolPhysicsFrame;
  /** The table, in ball-number order. A fresh array of fresh objects each call. */
  snapshot(): PoolBall[];
  /** True once every ball has been stopped for {@link SETTLE_STEPS} steps. */
  isSettled(): boolean;
  /** Forget any settling progress. Called when a shot begins. */
  resetSettling(): void;
  /** Release every body. The world is unusable afterwards. */
  dispose(): void;
}

interface BallRecord {
  readonly number: number;
  readonly body: Body;
  pocketed: boolean;
}

type FixtureKind =
  | { readonly kind: 'ball'; readonly number: number }
  | { readonly kind: 'cushion'; readonly id: string };

const toMetres = (units: number) => units * METRES_PER_UNIT;
const toUnits = (metres: number) => metres * UNITS_PER_METRE;

/**
 * Build a world.
 *
 * Synchronous, and cheap enough to build one per run — which is what the game
 * does, so a replay can never inherit a body from the frame before it.
 */
export function createPoolPhysicsWorld(): PoolPhysicsWorld {
  const world = new World({ gravity: new Vec2(0, 0), allowSleep: false });

  // ── Static geometry ──────────────────────────────────────────────────────
  //
  // One static body carrying every cushion polygon. There are six of them and
  // six real gaps; nothing spans a pocket mouth. See `pool-physics-geometry.ts`.
  const rails = world.createBody({ type: 'static' });
  for (const shape of POOL_CUSHIONS) {
    const fixture = rails.createFixture({
      shape: new Polygon(shape.vertices.map((v) => new Vec2(toMetres(v.x), toMetres(v.y)))),
      friction: 0,
      // Restitution is overridden per contact in `pre-solve`; Box2D's default
      // mixing is `max(a, b)`, which would give every ball-cushion contact the
      // ball's much livelier value.
      restitution: CUSHION_RESTITUTION,
    });
    fixture.setUserData({ kind: 'cushion', id: shape.id } satisfies FixtureKind);
  }

  // ── Balls ────────────────────────────────────────────────────────────────

  const balls = new Map<number, BallRecord>();

  function createBall(ball: PoolBall): BallRecord {
    const body = world.createBody({
      type: 'dynamic',
      position: new Vec2(toMetres(ball.x), toMetres(ball.y)),
      // No spin is modelled, so a ball has no reason to acquire angular
      // momentum — and letting it would only leak energy out of the solver into
      // a rotation nothing draws.
      fixedRotation: true,
      // Continuous collision. At 1/120 s a ball at top speed moves 0.16 m
      // against a 0.56 m diameter, so this should never be needed; it is on
      // because sixteen bodies make it free and a tunnelled ball is
      // unrecoverable.
      bullet: true,
      linearDamping: 0,
      linearVelocity: new Vec2(toMetres(ball.vx), toMetres(ball.vy)),
    });
    const fixture = body.createFixture({
      shape: new Circle(toMetres(BALL_RADIUS)),
      // Equal for every ball. The absolute value is irrelevant to a world with
      // no gravity and no joints; only the ratio between bodies matters, and it
      // is 1.
      density: 1,
      friction: 0,
      restitution: BALL_RESTITUTION,
    });
    fixture.setUserData({ kind: 'ball', number: ball.number } satisfies FixtureKind);
    body.setUserData(ball.number);
    return { number: ball.number, body, pocketed: false };
  }

  // ── Event collection ─────────────────────────────────────────────────────

  let contacts: PoolContactFact[] = [];
  let cushions: PoolCushionFact[] = [];
  let pocketed: PoolPocketFact[] = [];
  let recovered: number[] = [];

  const fixtureKind = (contact: Contact, which: 'A' | 'B'): FixtureKind | null => {
    const fixture = which === 'A' ? contact.getFixtureA() : contact.getFixtureB();
    return (fixture.getUserData() as FixtureKind | null) ?? null;
  };

  /**
   * Restitution, decided per contact.
   *
   * Box2D mixes the two fixtures' values with `max`, so a ball (0.95) touching a
   * cushion (0.74) would rebound at 0.95 and the table would play like a
   * trampoline. Setting it on the contact is the supported way to say "these two
   * materials, specifically".
   */
  world.on('pre-solve', (contact) => {
    const a = fixtureKind(contact, 'A');
    const b = fixtureKind(contact, 'B');
    if (!a || !b) return;
    const bothBalls = a.kind === 'ball' && b.kind === 'ball';
    contact.setRestitution(bothBalls ? BALL_RESTITUTION : CUSHION_RESTITUTION);
  });

  /**
   * Contacts are recorded on BEGIN, never on solve.
   *
   * `post-solve` fires every step for as long as two bodies stay touching, which
   * for two balls resting against each other is forever — and that is exactly
   * the "duplicate audio from persistent contacts" failure. Begin fires once per
   * contact, and the closing speed is still available at that moment because the
   * solver has not run yet.
   */
  world.on('begin-contact', (contact) => {
    const a = fixtureKind(contact, 'A');
    const b = fixtureKind(contact, 'B');
    if (!a || !b) return;

    const bodyA = contact.getFixtureA().getBody();
    const bodyB = contact.getFixtureB().getBody();
    const pa = bodyA.getPosition();
    const pb = bodyB.getPosition();
    const va = bodyA.getLinearVelocity();
    const vb = bodyB.getLinearVelocity();

    // Closing speed along the line between the two bodies. For a ball-cushion
    // contact the static body's "position" is the origin, so the normal is taken
    // from the manifold instead.
    let nx = pb.x - pa.x;
    let ny = pb.y - pa.y;
    const length = Math.hypot(nx, ny);
    if (a.kind === 'ball' && b.kind === 'ball' && length > 1e-9) {
      nx /= length;
      ny /= length;
    } else {
      const manifold = contact.getWorldManifold(null);
      if (manifold) {
        nx = manifold.normal.x;
        ny = manifold.normal.y;
      } else {
        nx = 0;
        ny = 0;
      }
    }
    const impactMetres = Math.abs((vb.x - va.x) * nx + (vb.y - va.y) * ny);
    const impact = toUnits(impactMetres);

    if (a.kind === 'ball' && b.kind === 'ball') {
      const at = { x: toUnits((pa.x + pb.x) / 2), y: toUnits((pa.y + pb.y) / 2) };
      contacts.push({
        a: Math.min(a.number, b.number),
        b: Math.max(a.number, b.number),
        at,
        impact,
      });
      return;
    }

    const ball = a.kind === 'ball' ? a : b.kind === 'ball' ? b : null;
    const rail = a.kind === 'cushion' ? a : b.kind === 'cushion' ? b : null;
    if (!ball || !rail) return;
    const ballBody = a.kind === 'ball' ? bodyA : bodyB;
    cushions.push({
      ball: ball.number,
      cushion: rail.id,
      at: { x: toUnits(ballBody.getPosition().x), y: toUnits(ballBody.getPosition().y) },
      impact,
    });
  });

  // ── Stepping ─────────────────────────────────────────────────────────────

  let settledSteps = 0;

  /**
   * Rolling resistance, applied after the solver.
   *
   * Constant deceleration, then a hard stop below {@link STOP_SPEED}. The hard
   * stop is what makes settling exact rather than asymptotic; the constant
   * deceleration is what keeps `d = v² / 2a` true, which is what the AI aims by.
   */
  function applyRollingFriction(dt: number): void {
    const decel = toMetres(ROLLING_DECEL) * dt;
    const stop = toMetres(STOP_SPEED);
    const cap = toMetres(MAX_BALL_SPEED);

    for (const record of balls.values()) {
      if (record.pocketed) continue;
      const v = record.body.getLinearVelocity();
      const speed = Math.hypot(v.x, v.y);
      if (speed === 0) continue;
      if (speed <= stop) {
        record.body.setLinearVelocity(new Vec2(0, 0));
        continue;
      }
      const next = Math.min(speed - decel, cap);
      if (next <= stop) {
        record.body.setLinearVelocity(new Vec2(0, 0));
        continue;
      }
      const scale = next / speed;
      record.body.setLinearVelocity(new Vec2(v.x * scale, v.y * scale));
    }
  }

  /** Take a ball off the table. Safe here: never called from inside a step. */
  function retire(record: BallRecord): void {
    record.pocketed = true;
    record.body.setLinearVelocity(new Vec2(0, 0));
    record.body.setActive(false);
  }

  /**
   * Pocket capture and the escape backstop.
   *
   * Runs outside `world.step`, so touching bodies here is safe, and it is
   * exhaustive rather than event-driven — a ball is pocketed the step its centre
   * crosses a mouth plane, in ball-number order, exactly once.
   */
  function collectPockets(): void {
    for (const record of balls.values()) {
      if (record.pocketed) continue;
      const p = record.body.getPosition();
      const at = { x: toUnits(p.x), y: toUnits(p.y) };

      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        // Not a pocket — a broken body. The caller decides what it costs.
        recovered.push(record.number);
        retire(record);
        continue;
      }

      const target = capturingPocket(at);
      if (target) {
        pocketed.push({ ball: record.number, pocket: target.index, at: target.centre });
        retire(record);
        continue;
      }

      if (hasEscapedTable(at)) {
        // Nothing should reach here: a ball past a mouth plane is captured on
        // the same step. It exists so that an impossible impulse costs a pocket
        // rather than a lost ball.
        const fallback = nearestPocket(at);
        recovered.push(record.number);
        pocketed.push({ ball: record.number, pocket: fallback.index, at: fallback.centre });
        retire(record);
      }
    }
  }

  return {
    reset(next) {
      for (const record of balls.values()) world.destroyBody(record.body);
      balls.clear();
      contacts = [];
      cushions = [];
      pocketed = [];
      recovered = [];
      settledSteps = 0;
      for (const ball of next) {
        const record = createBall(ball);
        if (ball.pocketed) retire(record);
        balls.set(ball.number, record);
      }
    },

    setBall(number, at) {
      const record = balls.get(number);
      if (!record) return;
      if (record.pocketed) {
        record.pocketed = false;
        record.body.setActive(true);
      }
      record.body.setLinearVelocity(new Vec2(0, 0));
      record.body.setPosition(new Vec2(toMetres(at.x), toMetres(at.y)));
      record.body.setAwake(true);
    },

    strike(angle, speed) {
      const record = balls.get(CUE_BALL);
      if (!record || record.pocketed) return;
      if (!Number.isFinite(angle) || !Number.isFinite(speed)) return;
      const capped = clampSpeed(Math.cos(angle) * speed, Math.sin(angle) * speed, MAX_BALL_SPEED);
      record.body.setLinearVelocity(
        new Vec2(toMetres(capped.vx), toMetres(capped.vy)),
      );
      record.body.setAwake(true);
      settledSteps = 0;
    },

    step(dt) {
      if (!(dt > 0)) return;
      world.step(dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
      applyRollingFriction(dt);
      collectPockets();

      let moving = false;
      for (const record of balls.values()) {
        if (record.pocketed) continue;
        const v = record.body.getLinearVelocity();
        if (v.x !== 0 || v.y !== 0) {
          moving = true;
          break;
        }
      }
      settledSteps = moving ? 0 : settledSteps + 1;
    },

    drain() {
      if (
        contacts.length === 0 &&
        cushions.length === 0 &&
        pocketed.length === 0 &&
        recovered.length === 0
      ) {
        return EMPTY_FRAME;
      }
      const frame: PoolPhysicsFrame = { contacts, cushions, pocketed, recovered };
      contacts = [];
      cushions = [];
      pocketed = [];
      recovered = [];
      return frame;
    },

    snapshot() {
      const out: PoolBall[] = [];
      for (const record of balls.values()) {
        const p = record.body.getPosition();
        const v = record.body.getLinearVelocity();
        out.push({
          number: record.number,
          x: toUnits(p.x),
          y: toUnits(p.y),
          vx: record.pocketed ? 0 : toUnits(v.x),
          vy: record.pocketed ? 0 : toUnits(v.y),
          pocketed: record.pocketed,
        });
      }
      out.sort((a, b) => a.number - b.number);
      return out;
    },

    isSettled() {
      return settledSteps >= SETTLE_STEPS;
    },

    resetSettling() {
      settledSteps = 0;
    },

    dispose() {
      for (const record of balls.values()) world.destroyBody(record.body);
      balls.clear();
      world.off('pre-solve', () => {});
      contacts = [];
      cushions = [];
      pocketed = [];
      recovered = [];
    },
  };
}
