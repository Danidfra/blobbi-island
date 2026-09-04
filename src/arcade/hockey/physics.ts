/**
 * Air Hockey: the physics, as pure functions over plain numbers.
 *
 * Every function here takes a state and returns a new one. No `Date.now()`, no
 * `Math.random()`, no DOM, no React, no mutation of an argument. That is not
 * purity for its own sake: it is what lets `physics.test.ts` assert a rebound
 * angle, a clamped speed or an anti-stick separation by calling a function with
 * numbers, instead of rendering a canvas and hoping.
 *
 * ## The five rules the puck obeys, in order
 *
 * A single step resolves them in exactly this sequence, and the order matters:
 *
 *  1. **Integrate**: position advances by velocity × dt.
 *  2. **Drag**: velocity decays exponentially, framerate-independently.
 *  3. **Walls**: reflect off the four rails, except through a goal mouth.
 *  4. **Mallets**: separate, then transfer momentum.
 *  5. **Clamp**: speed to {@link PUCK_MAX_SPEED}, position into the table.
 *
 * Walls before mallets, because a puck squeezed between a mallet and a rail must
 * end up outside the mallet and inside the table, not the other way round. The
 * final clamp is the backstop that makes "inside the table" true whatever
 * happened above it.
 *
 * ## Tunnelling, and the one place a sweep is needed
 *
 * The puck cannot tunnel: at the fixed 1/120 s step it moves at most
 * `170/120 ≈ 1.4` units against its own 4-unit radius, and `physics.test.ts`
 * pins that arithmetic so a future speed increase fails a test rather than
 * producing a puck that occasionally passes through a rail.
 *
 * A MALLET can, because the player's is no longer speed-limited; it is
 * wherever the pointer is, which is the only way direct manipulation feels
 * direct. {@link resolveMalletSwept} covers that by testing the path the mallet
 * travelled rather than only the point it stopped at, and it collapses to the
 * plain discrete test whenever the mallet moved less than the puck's radius,
 * which is every step of ordinary play, for both sides.
 */

import {
  GOAL_HALF_WIDTH,
  MALLET_MIN_SEPARATION_SPEED,
  MALLET_RADIUS,
  MALLET_RESTITUTION,
  MALLET_TANGENT_FRICTION,
  PUCK_DRAG_PER_SECOND,
  PUCK_MAX_SPEED,
  PUCK_MIN_SPEED,
  PUCK_RADIUS,
  TABLE_CENTER_X,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  WALL_RESTITUTION,
  type HockeyZone,
} from './table';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A puck: where it is and how fast it is going. Nothing else. */
export interface PuckState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/**
 * A mallet. `vx`/`vy` are DERIVED, the velocity it actually achieved last step,
 * never a thing the caller sets. A strike reads them, so a mallet that was
 * rate-limited hits with the speed it really had rather than the speed the
 * pointer asked for.
 */
export interface MalletState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Which end of the table. Also the two sides that can score. */
export type HockeySide = 'player' | 'opponent';

export const ZERO_VELOCITY = Object.freeze({ vx: 0, vy: 0 });

// ── Small vector helpers ────────────────────────────────────────────────────

export function speedOf(v: { readonly vx: number; readonly vy: number }): number {
  return Math.hypot(v.vx, v.vy);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Scale a velocity down to `max` if it exceeds it. Direction is preserved
 * exactly, which is why this is a scale and not a per-axis clamp, clamping
 * `vx` and `vy` separately turns a fast diagonal into a different angle.
 */
export function clampSpeed(vx: number, vy: number, max: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed <= max || speed === 0) return { vx, vy };
  const scale = max / speed;
  return { vx: vx * scale, vy: vy * scale };
}

/** Raise a velocity to `min` if it is slower, keeping direction. Zero stays zero. */
export function floorSpeed(vx: number, vy: number, min: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed >= min || speed === 0) return { vx, vy };
  const scale = min / speed;
  return { vx: vx * scale, vy: vy * scale };
}

// ── Recovery ────────────────────────────────────────────────────────────────

/**
 * A puck that is guaranteed to be usable, or `null` when the one supplied was
 * not.
 *
 * Returns `null` for a non-finite coordinate or a position well outside the
 * table: the two shapes an invalid physics state actually takes. The caller
 * (the match step) turns a `null` into a fresh serve, so a state that should be
 * impossible costs a point-restart rather than a frozen or exploding game.
 *
 * A small overshoot is NOT invalid: the clamp at the end of every step handles
 * a puck a hair outside a rail, and treating that as corruption would restart a
 * point over a rounding error.
 */
export function sanitisePuck(puck: PuckState): PuckState | null {
  if (
    !Number.isFinite(puck.x) ||
    !Number.isFinite(puck.y) ||
    !Number.isFinite(puck.vx) ||
    !Number.isFinite(puck.vy)
  ) {
    return null;
  }
  const margin = TABLE_HEIGHT; // one table length of slack before we give up
  if (
    puck.x < -margin ||
    puck.x > TABLE_WIDTH + margin ||
    puck.y < -margin ||
    puck.y > TABLE_HEIGHT + margin
  ) {
    return null;
  }
  return puck;
}

// ── Step 1 & 2: integrate and drag ──────────────────────────────────────────

/**
 * Advance the puck by `dt` seconds, with framerate-independent drag.
 *
 * `Math.exp(-k · dt)` rather than a per-frame multiplier: a multiplier applied
 * once per frame makes the puck slow down twice as fast at 120 Hz as at 60 Hz,
 * which is a physics engine that plays differently on different hardware.
 */
export function integratePuck(puck: PuckState, dt: number): PuckState {
  const decay = Math.exp(-PUCK_DRAG_PER_SECOND * dt);
  return {
    x: puck.x + puck.vx * dt,
    y: puck.y + puck.vy * dt,
    vx: puck.vx * decay,
    vy: puck.vy * decay,
  };
}

// ── Step 3: walls ───────────────────────────────────────────────────────────

/** Which rail was hit, for sound and for a spark. `null` when none was. */
export type WallHit = 'side' | 'end' | null;

export interface WallResolution {
  readonly puck: PuckState;
  readonly hit: WallHit;
}

/** True when this x lies within the goal mouth, so the end rail is open there. */
export function isWithinGoalMouth(x: number): boolean {
  return Math.abs(x - TABLE_CENTER_X) <= GOAL_HALF_WIDTH;
}

/**
 * Reflect the puck off the rails.
 *
 * The end rails have a hole in them. Inside {@link isWithinGoalMouth} the puck
 * passes straight through, which is what makes {@link detectGoal} the ONLY
 * thing that decides a goal; there is no second, disagreeing notion of "the
 * puck reached the end" hidden in here.
 */
export function resolveWalls(puck: PuckState): WallResolution {
  let { x, y, vx, vy } = puck;
  let hit: WallHit = null;

  if (x - PUCK_RADIUS < 0) {
    x = PUCK_RADIUS;
    if (vx < 0) vx = -vx * WALL_RESTITUTION;
    hit = 'side';
  } else if (x + PUCK_RADIUS > TABLE_WIDTH) {
    x = TABLE_WIDTH - PUCK_RADIUS;
    if (vx > 0) vx = -vx * WALL_RESTITUTION;
    hit = 'side';
  }

  const throughMouth = isWithinGoalMouth(x);
  if (!throughMouth) {
    if (y - PUCK_RADIUS < 0) {
      y = PUCK_RADIUS;
      if (vy < 0) vy = -vy * WALL_RESTITUTION;
      hit = 'end';
    } else if (y + PUCK_RADIUS > TABLE_HEIGHT) {
      y = TABLE_HEIGHT - PUCK_RADIUS;
      if (vy > 0) vy = -vy * WALL_RESTITUTION;
      hit = 'end';
    }
  }

  return { puck: { x, y, vx, vy }, hit };
}

// ── Step 4: mallets ─────────────────────────────────────────────────────────

export interface MalletResolution {
  readonly puck: PuckState;
  /** True when contact happened this step. */
  readonly hit: boolean;
  /** Closing speed along the contact normal, how hard it was. `0` when no hit. */
  readonly impactSpeed: number;
}

/**
 * Resolve one mallet against the puck: separate first, then transfer momentum.
 *
 * The mallet is treated as INFINITELY heavy; it is attached to a hand, or to an
 * AI that does not care about recoil, so all of the impulse lands on the puck.
 * The strike therefore accounts for all four things a player can feel:
 *
 *  - **contact direction**, through the normal `n`;
 *  - **puck velocity**, because the impulse is computed on the RELATIVE speed;
 *  - **mallet velocity**, for the same reason, driving into a puck adds the
 *    mallet's closing speed twice over at `e = 0.9`, which is what makes a
 *    committed swing feel different from a block;
 *  - **mallet direction**, through {@link MALLET_TANGENT_FRICTION}, so a
 *    sideways sweep curves the puck instead of returning it down the same line.
 *
 * Two guarantees stop the fun parts from becoming bugs. The separation happens
 * BEFORE the impulse, so a puck can never be left inside the mallet; and the
 * outgoing normal speed is floored at {@link MALLET_MIN_SEPARATION_SPEED}, so a
 * puck nudged by a barely-moving mallet still leaves rather than being carried.
 */
export function resolveMallet(
  puck: PuckState,
  mallet: MalletState,
  restitution = MALLET_RESTITUTION,
): MalletResolution {
  const sumRadii = PUCK_RADIUS + MALLET_RADIUS;
  let dx = puck.x - mallet.x;
  let dy = puck.y - mallet.y;
  let distance = Math.hypot(dx, dy);

  if (distance >= sumRadii) return { puck, hit: false, impactSpeed: 0 };

  // Dead centre: pick a deterministic normal rather than dividing by zero. Away
  // from the mallet's own goal is the least surprising direction, and it is the
  // same every time, so a replay of the same inputs produces the same game.
  if (distance === 0 || !Number.isFinite(distance)) {
    dx = 0;
    dy = mallet.y < TABLE_HEIGHT / 2 ? 1 : -1;
    distance = 1;
  }

  const nx = dx / distance;
  const ny = dy / distance;

  // Separate: place the puck exactly on the contact circle.
  const x = mallet.x + nx * sumRadii;
  const y = mallet.y + ny * sumRadii;

  // Relative velocity, split into normal and tangential parts.
  const rvx = puck.vx - mallet.vx;
  const rvy = puck.vy - mallet.vy;
  const vn = rvx * nx + rvy * ny;

  let vx = puck.vx;
  let vy = puck.vy;

  // Only resolve an APPROACH. A puck already moving away has been dealt with
  // (or is being overtaken by the mallet) and re-resolving it would add energy
  // on every step for as long as the overlap lasted.
  if (vn < 0) {
    const impulse = -(1 + restitution) * vn;
    vx += impulse * nx;
    vy += impulse * ny;
  }

  // Tangential drag: a little of the mallet's sideways motion, for spin-like
  // deflection. Applied to the RELATIVE tangential velocity, so a mallet moving
  // with the puck adds nothing.
  const tx = -ny;
  const ty = nx;
  const vt = (puck.vx - mallet.vx) * tx + (puck.vy - mallet.vy) * ty;
  vx -= vt * MALLET_TANGENT_FRICTION * tx;
  vy -= vt * MALLET_TANGENT_FRICTION * ty;

  // Anti-stick: guarantee the puck leaves, measured against the MALLET rather
  // than against the table, because a mallet chasing the puck at 200 units/s
  // would otherwise satisfy any absolute test while still carrying it.
  const outgoingNormal = (vx - mallet.vx) * nx + (vy - mallet.vy) * ny;
  if (outgoingNormal < MALLET_MIN_SEPARATION_SPEED) {
    const correction = MALLET_MIN_SEPARATION_SPEED - outgoingNormal;
    vx += correction * nx;
    vy += correction * ny;
  }

  const clamped = clampSpeed(vx, vy, PUCK_MAX_SPEED);
  return {
    puck: { x, y, vx: clamped.vx, vy: clamped.vy },
    hit: true,
    impactSpeed: Math.abs(vn),
  };
}

/**
 * How far apart two sampled mallet positions may be during a sweep, in table
 * units. Half the puck's radius, so no contact can fall between two samples.
 */
const SWEEP_SAMPLE_SPACING = PUCK_RADIUS / 2;
/**
 * Hard cap on sweep samples. The player's zone is 100 × 80, so its longest
 * possible single-step displacement is about 128 units: 64 samples at 2 units
 * apart covers it exactly, and the cap only ever binds on a teleport.
 */
const MAX_SWEEP_SAMPLES = 64;
/**
 * Below this displacement the sweep collapses to a single test at the mallet's
 * final position: which is the plain discrete test, unchanged.
 *
 * Not an optimisation. A mallet that moved less than the puck's radius cannot
 * pass through it, so there is nothing for a sweep to catch; and sampling it
 * anyway is actively WRONG. Measured: it resolved an ordinary hand-speed contact
 * at the midpoint of the step instead of the end, which both weakened the
 * impulse and left the remaining motion to be applied as a position-only nudge.
 * Because the opponent's mallet is slower it stayed on one sample and the player
 * did not, so the two sides silently stopped playing the same game, the
 * opponent went from losing 6 matches in 6 to winning all of them.
 */
const SWEEP_DIRECT_LIMIT = PUCK_RADIUS;

/**
 * Resolve a mallet against the puck along the PATH it travelled this step, not
 * just at the point it stopped.
 *
 * This is what replaced the player mallet's speed limit, and it is a strictly
 * better guarantee. The old rule was "the mallet may not move further than the
 * puck's radius in one step, therefore it cannot pass through it": true, and it
 * cost 117 ms of input lag. This rule is "wherever the mallet went, we check
 * every point it passed through", which permits an instantaneous mallet and
 * still cannot skip a contact.
 *
 * Sampling rather than solving a quadratic, deliberately: the samples are two
 * units apart against a four-unit radius, so the discrete test at each sample is
 * exact for the same reason it was exact before, and it reuses
 * {@link resolveMallet}: one tested impulse, not two implementations of one.
 * A mallet that barely moved produces ONE sample at its final position, so a
 * slow mallet and the opponent behave exactly as they did.
 *
 * At most one impulse per step: the first sample that makes contact wins, and
 * the puck is then pushed clear of wherever the mallet finished so it can never
 * be left inside it.
 */
export function resolveMalletSwept(
  puck: PuckState,
  from: Vec2,
  mallet: MalletState,
  restitution = MALLET_RESTITUTION,
): MalletResolution {
  const dx = mallet.x - from.x;
  const dy = mallet.y - from.y;
  const distance = Math.hypot(dx, dy);

  const samples =
    Number.isFinite(distance) && distance > SWEEP_DIRECT_LIMIT
      ? Math.min(MAX_SWEEP_SAMPLES, Math.ceil(distance / SWEEP_SAMPLE_SPACING))
      : 1;

  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    // The velocity is the whole step's, at every sample: it is the speed the
    // mallet was travelling when it made contact, which is the honest thing for
    // the impulse to use.
    const at: MalletState = {
      x: from.x + dx * t,
      y: from.y + dy * t,
      vx: mallet.vx,
      vy: mallet.vy,
    };
    const contact = resolveMallet(puck, at, restitution);
    if (contact.hit) {
      return {
        // Contact may have happened early in the sweep, with the mallet
        // continuing past. Clear it of the FINAL position too, so the step can
        // never end with the puck geometrically inside the mallet.
        puck: nudgeClearOfMallet(contact.puck, mallet),
        hit: true,
        impactSpeed: contact.impactSpeed,
      };
    }
  }

  return { puck, hit: false, impactSpeed: 0 };
}

/**
 * Push the puck clear of a mallet WITHOUT hitting it.
 *
 * Position only: no impulse, no restitution, no velocity change at all. It
 * exists for exactly one moment, the serve, and the distinction matters.
 *
 * The puck is served from the centre spot, and the centre spot is a legal place
 * for either mallet's centre to be (the zones meet on the line). A player
 * parked there had the puck placed INSIDE their mallet, which the next step
 * resolved as a full-strength hit: a free opening touch for standing still, and
 * for one frame a puck geometrically inside a mallet. Separating first makes the
 * serve neutral wherever anybody is standing.
 */
export function nudgeClearOfMallet(puck: PuckState, mallet: MalletState): PuckState {
  const sumRadii = PUCK_RADIUS + MALLET_RADIUS;
  const dx = puck.x - mallet.x;
  const dy = puck.y - mallet.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= sumRadii) return puck;

  // Dead centre: push toward the mallet's own goal, so a serve is never nudged
  // into the server's attacking half.
  const nx = distance === 0 ? 0 : dx / distance;
  const ny = distance === 0 ? (mallet.y < TABLE_HEIGHT / 2 ? -1 : 1) : dy / distance;
  return { ...puck, x: mallet.x + nx * sumRadii, y: mallet.y + ny * sumRadii };
}

// ── Step 5: clamps ──────────────────────────────────────────────────────────

/**
 * The last thing every step does: keep the puck inside the table and inside its
 * speed band.
 *
 * The position clamp deliberately allows the goal mouths through, so a puck on
 * its way in is not shoved back out one step before {@link detectGoal} sees it.
 */
export function clampPuck(puck: PuckState, live: boolean): PuckState {
  const inMouth = isWithinGoalMouth(puck.x);
  const minY = inMouth ? -PUCK_RADIUS * 3 : PUCK_RADIUS;
  const maxY = inMouth ? TABLE_HEIGHT + PUCK_RADIUS * 3 : TABLE_HEIGHT - PUCK_RADIUS;

  const speedBand = live
    ? floorSpeed(puck.vx, puck.vy, PUCK_MIN_SPEED)
    : { vx: puck.vx, vy: puck.vy };
  const capped = clampSpeed(speedBand.vx, speedBand.vy, PUCK_MAX_SPEED);

  return {
    x: clamp(puck.x, PUCK_RADIUS, TABLE_WIDTH - PUCK_RADIUS),
    y: clamp(puck.y, minY, maxY),
    vx: capped.vx,
    vy: capped.vy,
  };
}

// ── Goals ───────────────────────────────────────────────────────────────────

/**
 * Who just scored, or `null`.
 *
 * `'player'` means the puck crossed the OPPONENT's goal line at the top. The
 * test is on the puck's leading edge reaching the line, so the moment of the
 * goal is the moment it looks like a goal.
 *
 * Detecting it is all this does. Scoring exactly once is the match state
 * machine's job: it moves to a phase in which the puck is frozen, so this is
 * never asked twice about the same event.
 */
export function detectGoal(puck: PuckState): HockeySide | null {
  if (!isWithinGoalMouth(puck.x)) return null;
  if (puck.y - PUCK_RADIUS <= 0) return 'player';
  if (puck.y + PUCK_RADIUS >= TABLE_HEIGHT) return 'opponent';
  return null;
}

// ── Mallets ─────────────────────────────────────────────────────────────────

/**
 * Keep a mallet centre inside its own half. The player's cannot cross the line.
 *
 * A non-finite coordinate falls back to the middle of the zone rather than
 * propagating. `clamp` alone would not do it; every comparison against `NaN`
 * is false, so a plain clamp returns the `NaN` untouched and one bad pointer
 * sample poisons a mallet permanently. This is the boundary; it is where that
 * stops.
 */
export function clampToZone(point: Vec2, zone: HockeyZone): Vec2 {
  const x = Number.isFinite(point.x) ? point.x : (zone.minX + zone.maxX) / 2;
  const y = Number.isFinite(point.y) ? point.y : (zone.minY + zone.maxY) / 2;
  return {
    x: clamp(x, zone.minX, zone.maxX),
    y: clamp(y, zone.minY, zone.maxY),
  };
}

export interface MoveMalletOptions {
  /** Units per second the mallet may travel. */
  readonly maxSpeed: number;
  /**
   * Distance within which the mallet eases in rather than arriving at full
   * speed. Zero disables it.
   *
   * The player's mallet uses zero, a hand does not decelerate politely, and
   * pretending it does reads as input lag. The AI uses a non-zero value, which
   * is what stops it vibrating around a target it can never sit exactly on.
   */
  readonly arriveRadius?: number;
}

/**
 * Move a mallet toward a target under a speed limit, and report the velocity it
 * actually achieved.
 *
 * The rate limit is the load-bearing part. It is simultaneously:
 *
 *  - the reason a pointer that jumps across the screen (or is dragged outside
 *    the canvas, or reappears after a resize) cannot teleport the mallet through
 *    the puck;
 *  - the reason a strike's speed is bounded, because the mallet velocity fed to
 *    {@link resolveMallet} is a real per-step displacement rather than a
 *    difference between two arbitrary pointer samples;
 *  - the reason the AI cannot cheat by snapping onto an interception point.
 */
export function moveMalletToward(
  mallet: MalletState,
  target: Vec2,
  dt: number,
  { maxSpeed, arriveRadius = 0 }: MoveMalletOptions,
): MalletState {
  if (dt <= 0) return { ...mallet, vx: 0, vy: 0 };

  const dx = target.x - mallet.x;
  const dy = target.y - mallet.y;
  const distance = Math.hypot(dx, dy);

  if (!Number.isFinite(distance) || distance < 1e-6) {
    return { ...mallet, vx: 0, vy: 0 };
  }

  const eased =
    arriveRadius > 0 ? maxSpeed * Math.min(1, distance / arriveRadius) : maxSpeed;
  const step = Math.min(distance, eased * dt);
  const x = mallet.x + (dx / distance) * step;
  const y = mallet.y + (dy / distance) * step;

  return { x, y, vx: (x - mallet.x) / dt, vy: (y - mallet.y) / dt };
}

/**
 * Put the player's mallet exactly where they asked, and report the velocity
 * that implies: bounded.
 *
 * The counterpart to {@link moveMalletToward}, and deliberately a different
 * function rather than an option on it, because the two answer different
 * questions. The opponent's mallet is *steered*: it has a top speed and it
 * accelerates toward a decision. The player's mallet is *held*: there is no
 * meaningful sense in which a hand "travels toward" the place the hand already
 * is. Modelling the player with the opponent's rate limiter is exactly what made
 * the mallet feel like a second AI, at a measured 117–158 ms of lag.
 *
 * Two safety properties survive the change, and they are the ones that matter:
 *
 *  - **The mallet stays legal.** `clampToZone` runs on every step, so a pointer
 *    dragged off the canvas, flung across the room, or reporting `NaN` after a
 *    resize can only ever produce a position inside the player's own half.
 *  - **The impulse stays bounded.** Velocity is displacement ÷ dt, which a
 *    teleport makes enormous; it is clamped to `maxStrikeSpeed` before anything
 *    reads it. What it is NOT bounded by is the mallet's ability to be
 *    somewhere, which is the part that was costing responsiveness.
 *
 * Tunnelling is prevented by {@link resolveMalletSwept}, not by this function.
 */
export function movePlayerMallet(
  previous: MalletState,
  target: Vec2,
  dt: number,
  zone: HockeyZone,
  maxStrikeSpeed: number,
): MalletState {
  const to = clampToZone(target, zone);
  if (dt <= 0) return { x: to.x, y: to.y, vx: 0, vy: 0 };

  const velocity = clampSpeed((to.x - previous.x) / dt, (to.y - previous.y) / dt, maxStrikeSpeed);
  return { x: to.x, y: to.y, vx: velocity.vx, vy: velocity.vy };
}

/**
 * Where the puck will cross a given line, accounting for side-rail bounces.
 *
 * Used by the AI to intercept rather than to chase. Deliberately ignores drag
 * and mallets: it is a *prediction*, and one that is slightly wrong is what
 * makes an opponent look like it is reading the play rather than solving it.
 *
 * `null` when the puck is not heading that way at all.
 */
export function predictCrossingX(puck: PuckState, lineY: number): number | null {
  const dy = lineY - puck.y;
  if (Math.abs(puck.vy) < 1e-4) return null;
  const t = dy / puck.vy;
  if (t < 0) return null;

  // Unfold the reflections: the puck's path in x is a triangle wave over the
  // playable width, so reflecting the raw projection back into range is exact.
  const span = TABLE_WIDTH - PUCK_RADIUS * 2;
  const raw = puck.x - PUCK_RADIUS + puck.vx * t;
  const period = span * 2;
  let folded = ((raw % period) + period) % period;
  if (folded > span) folded = period - folded;
  return folded + PUCK_RADIUS;
}
