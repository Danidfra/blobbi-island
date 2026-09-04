/**
 * Air Hockey physics, the rules a rally depends on, checked with numbers.
 *
 * Every test here calls a pure function. Nothing renders, nothing waits for a
 * frame, and nothing asserts a pixel: that is the whole point of keeping the
 * simulation out of the component. A rebound angle, a clamped speed and an
 * anti-stick separation are all arithmetic, and arithmetic is the one thing a
 * test can pin exactly.
 */

import { describe, it, expect } from 'vitest';

import {
  clampPuck,
  clampSpeed,
  clampToZone,
  detectGoal,
  floorSpeed,
  integratePuck,
  isWithinGoalMouth,
  movePlayerMallet,
  moveMalletToward,
  predictCrossingX,
  resolveMallet,
  resolveMalletSwept,
  resolveWalls,
  sanitisePuck,
  speedOf,
  type MalletState,
  type PuckState,
} from './physics';
import {
  FIXED_STEP_MS,
  GOAL_HALF_WIDTH,
  MALLET_RADIUS,
  OPPONENT_ZONE,
  PLAYER_MALLET_MAX_STRIKE_SPEED,
  PLAYER_ZONE,
  PUCK_MAX_SPEED,
  PUCK_MIN_SPEED,
  PUCK_RADIUS,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './table';

const puck = (over: Partial<PuckState> = {}): PuckState => ({
  x: TABLE_CENTER_X,
  y: TABLE_CENTER_Y,
  vx: 0,
  vy: 0,
  ...over,
});

const mallet = (over: Partial<MalletState> = {}): MalletState => ({
  x: TABLE_CENTER_X,
  y: TABLE_CENTER_Y,
  vx: 0,
  vy: 0,
  ...over,
});

describe('integration and drag', () => {
  it('advances by velocity times dt', () => {
    const next = integratePuck(puck({ x: 10, y: 20, vx: 60, vy: -30 }), 0.5);
    expect(next.x).toBeCloseTo(40, 6);
    expect(next.y).toBeCloseTo(5, 6);
  });

  it('is framerate independent: many small steps equal one big one', () => {
    // The reason drag is exponential rather than a per-frame multiplier. A
    // multiplier would make the puck slow down twice as fast at 120 Hz as at
    // 60 Hz, which is a game that plays differently on different hardware.
    let small = puck({ vx: 100, vy: 40 });
    for (let i = 0; i < 120; i += 1) small = integratePuck(small, 1 / 120);
    const big = integratePuck(puck({ vx: 100, vy: 40 }), 1);

    // Velocity is EXACTLY equal, which is the property that matters: the puck
    // has the same energy after a second whatever rate it was stepped at.
    expect(small.vx).toBeCloseTo(big.vx, 6);
    expect(small.vy).toBeCloseTo(big.vy, 6);

    // Position is Euler-integrated, so it agrees to the size of the step rather
    // than exactly. Over a tenth of a second, six frames, far longer than the
    // loop ever accumulates, twelve fixed steps and one big one land within
    // 0.2 of a table unit of each other, a twentieth of the puck's radius and
    // well below anything a collision can notice.
    let short = puck({ vx: 100, vy: 40 });
    for (let i = 0; i < 12; i += 1) short = integratePuck(short, 1 / 120);
    const oneTenth = integratePuck(puck({ vx: 100, vy: 40 }), 0.1);
    expect(Math.abs(short.x - oneTenth.x)).toBeLessThan(0.2);
  });

  it('never speeds the puck up', () => {
    const before = puck({ vx: 90, vy: 90 });
    const after = integratePuck(before, 1 / 120);
    expect(speedOf(after)).toBeLessThan(speedOf(before));
  });
});

describe('speed clamping', () => {
  it('caps the magnitude and keeps the direction exactly', () => {
    const clamped = clampSpeed(300, 400, PUCK_MAX_SPEED);
    expect(Math.hypot(clamped.vx, clamped.vy)).toBeCloseTo(PUCK_MAX_SPEED, 6);
    // A per-axis clamp would change this ratio, turning a fast diagonal into a
    // different angle: which is why it is a scale and not two clamps.
    expect(clamped.vy / clamped.vx).toBeCloseTo(400 / 300, 6);
  });

  it('leaves a legal velocity untouched', () => {
    expect(clampSpeed(3, 4, 10)).toEqual({ vx: 3, vy: 4 });
  });

  it('raises a slow velocity to the floor, keeping direction', () => {
    const floored = floorSpeed(1, 0, PUCK_MIN_SPEED);
    expect(floored.vx).toBeCloseTo(PUCK_MIN_SPEED, 6);
    expect(floored.vy).toBeCloseTo(0, 6);
  });

  it('leaves a dead-stopped puck stopped', () => {
    // A frozen puck between points must not be given a direction out of nowhere.
    expect(floorSpeed(0, 0, PUCK_MIN_SPEED)).toEqual({ vx: 0, vy: 0 });
  });

  it('holds a live puck inside the speed band', () => {
    const slow = clampPuck(puck({ vx: 2, vy: 0 }), true);
    expect(speedOf(slow)).toBeCloseTo(PUCK_MIN_SPEED, 5);

    const fast = clampPuck(puck({ vx: 900, vy: 0 }), true);
    expect(speedOf(fast)).toBeCloseTo(PUCK_MAX_SPEED, 5);
  });

  it('does not apply the floor to a puck that is not live', () => {
    expect(clampPuck(puck({ vx: 0, vy: 0 }), false).vx).toBe(0);
  });
});

describe('wall rebounds', () => {
  it('reflects off a side rail and loses a little energy', () => {
    const bounced = resolveWalls(puck({ x: 1, y: 80, vx: -100, vy: 20 }));
    expect(bounced.hit).toBe('side');
    expect(bounced.puck.x).toBe(PUCK_RADIUS);
    expect(bounced.puck.vx).toBeGreaterThan(0);
    expect(bounced.puck.vx).toBeLessThan(100);
    // The tangential component is untouched: an air hockey rail is not sticky.
    expect(bounced.puck.vy).toBe(20);
  });

  it('reflects off an end rail outside the goal mouth', () => {
    const x = TABLE_CENTER_X + GOAL_HALF_WIDTH + 5;
    const bounced = resolveWalls(puck({ x, y: 1, vx: 0, vy: -100 }));
    expect(bounced.hit).toBe('end');
    expect(bounced.puck.vy).toBeGreaterThan(0);
  });

  it('lets the puck through the goal mouth, the end rail has a hole in it', () => {
    const open = resolveWalls(puck({ x: TABLE_CENTER_X, y: 1, vx: 0, vy: -100 }));
    expect(open.hit).toBeNull();
    expect(open.puck.vy).toBe(-100);
  });

  it('knows where the mouth is', () => {
    expect(isWithinGoalMouth(TABLE_CENTER_X)).toBe(true);
    expect(isWithinGoalMouth(TABLE_CENTER_X + GOAL_HALF_WIDTH)).toBe(true);
    expect(isWithinGoalMouth(TABLE_CENTER_X + GOAL_HALF_WIDTH + 0.1)).toBe(false);
  });

  it('never leaves the puck outside a rail it just hit', () => {
    for (const start of [
      puck({ x: -30, y: 80, vx: -200 }),
      puck({ x: TABLE_WIDTH + 30, y: 80, vx: 200 }),
    ]) {
      const settled = clampPuck(resolveWalls(start).puck, true);
      expect(settled.x).toBeGreaterThanOrEqual(PUCK_RADIUS);
      expect(settled.x).toBeLessThanOrEqual(TABLE_WIDTH - PUCK_RADIUS);
    }
  });
});

describe('mallet strikes', () => {
  it('does nothing when there is no contact', () => {
    const outcome = resolveMallet(puck({ y: 10 }), mallet({ y: 120 }));
    expect(outcome.hit).toBe(false);
    expect(outcome.impactSpeed).toBe(0);
  });

  it('separates the puck to exactly the contact distance', () => {
    // The anti-trap rule: a puck can never be left INSIDE a mallet, however
    // deeply it was overlapping when the step began.
    const contact = resolveMallet(puck({ x: 50, y: 80 }), mallet({ x: 50, y: 79 }));
    const distance = Math.hypot(contact.puck.x - 50, contact.puck.y - 79);
    expect(distance).toBeCloseTo(PUCK_RADIUS + MALLET_RADIUS, 6);
  });

  it('a moving mallet drives a stationary puck away from it', () => {
    // Mallet below the puck, moving up: the puck must go up.
    const contact = resolveMallet(
      puck({ x: 50, y: 80 }),
      mallet({ x: 50, y: 90, vy: -150 }),
    );
    expect(contact.hit).toBe(true);
    expect(contact.puck.vy).toBeLessThan(-100);
    expect(contact.impactSpeed).toBeCloseTo(150, 5);
  });

  it('a faster mallet hits harder', () => {
    const soft = resolveMallet(puck({ x: 50, y: 80 }), mallet({ x: 50, y: 90, vy: -40 }));
    const hard = resolveMallet(puck({ x: 50, y: 80 }), mallet({ x: 50, y: 90, vy: -160 }));
    expect(Math.abs(hard.puck.vy)).toBeGreaterThan(Math.abs(soft.puck.vy));
  });

  it('never sends the puck above the speed cap, however hard it is hit', () => {
    const absurd = resolveMallet(
      puck({ x: 50, y: 80, vy: -PUCK_MAX_SPEED }),
      mallet({ x: 50, y: 90, vy: -5000 }),
    );
    expect(speedOf(absurd.puck)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
  });

  it('accounts for contact direction, not just mallet direction', () => {
    // Same mallet motion, contact from the side: the puck leaves sideways.
    const side = resolveMallet(
      puck({ x: 60, y: 80 }),
      mallet({ x: 50, y: 80, vx: 150 }),
    );
    expect(side.puck.vx).toBeGreaterThan(0);
    expect(Math.abs(side.puck.vy)).toBeLessThan(Math.abs(side.puck.vx));
  });

  it('drags a little of the mallet’s sideways motion into the puck', () => {
    // A sliced hit curves. Contact is straight up the normal, so any vx at all
    // can only have come from the tangential term.
    const sliced = resolveMallet(
      puck({ x: 50, y: 80 }),
      mallet({ x: 50, y: 90, vx: 200, vy: -100 }),
    );
    expect(sliced.puck.vx).toBeGreaterThan(0);
  });

  it('guarantees the puck leaves a barely-moving mallet', () => {
    // Without the separation floor a puck rests against an advancing mallet,
    // is re-resolved every step, and rides it around the table.
    const carried = resolveMallet(
      puck({ x: 50, y: 80, vy: -1 }),
      mallet({ x: 50, y: 90, vy: -1 }),
    );
    const separation = (carried.puck.vy - -1) * -1; // along the normal (0, -1)
    expect(separation).toBeGreaterThan(0);
    expect(carried.puck.vy).toBeLessThan(-1);
  });

  it('picks a deterministic normal when the puck is dead centre', () => {
    // Division by zero would produce NaN and lose the puck; the same input must
    // always give the same answer, so a replay stays a replay.
    const first = resolveMallet(puck({ x: 50, y: 40 }), mallet({ x: 50, y: 40 }));
    const second = resolveMallet(puck({ x: 50, y: 40 }), mallet({ x: 50, y: 40 }));
    expect(first.puck).toEqual(second.puck);
    expect(Number.isFinite(first.puck.x)).toBe(true);
    expect(Number.isFinite(first.puck.vy)).toBe(true);
    // Pushed away from the mallet's own goal, the opponent's end here.
    expect(first.puck.vy).toBeGreaterThan(0);
  });
});

describe('goals', () => {
  it('is scored by the player when the puck reaches the top line inside the mouth', () => {
    expect(detectGoal(puck({ x: TABLE_CENTER_X, y: PUCK_RADIUS }))).toBe('player');
  });

  it('is scored by the opponent at the bottom line', () => {
    expect(detectGoal(puck({ x: TABLE_CENTER_X, y: TABLE_HEIGHT - PUCK_RADIUS }))).toBe(
      'opponent',
    );
  });

  it('is not scored outside the mouth, however far the puck goes', () => {
    const wide = TABLE_CENTER_X + GOAL_HALF_WIDTH + 1;
    expect(detectGoal(puck({ x: wide, y: -20 }))).toBeNull();
  });

  it('is not scored mid-table', () => {
    expect(detectGoal(puck({ x: TABLE_CENTER_X, y: TABLE_CENTER_Y }))).toBeNull();
  });
});

describe('mallet movement limits', () => {
  it('keeps the player out of the opponent’s half and off the rails', () => {
    const escaped = clampToZone({ x: -500, y: -500 }, PLAYER_ZONE);
    expect(escaped.x).toBe(PLAYER_ZONE.minX);
    expect(escaped.y).toBe(TABLE_CENTER_Y);

    const far = clampToZone({ x: 9999, y: 9999 }, PLAYER_ZONE);
    expect(far.x).toBe(PLAYER_ZONE.maxX);
    expect(far.y).toBe(PLAYER_ZONE.maxY);
  });

  it('keeps the opponent out of the player’s half', () => {
    expect(clampToZone({ x: 50, y: 9999 }, OPPONENT_ZONE).y).toBe(TABLE_CENTER_Y);
    expect(clampToZone({ x: 50, y: -9999 }, OPPONENT_ZONE).y).toBe(MALLET_RADIUS);
  });

  it('the two halves meet exactly at the centre line and never overlap', () => {
    expect(PLAYER_ZONE.minY).toBe(TABLE_CENTER_Y);
    expect(OPPONENT_ZONE.maxY).toBe(TABLE_CENTER_Y);
  });

  it('rate-limits the OPPONENT, which is still steered rather than held', () => {
    const dt = FIXED_STEP_MS / 1000;
    const moved = moveMalletToward(mallet({ x: 10, y: 20 }), { x: 90, y: 70 }, dt, {
      maxSpeed: 180,
    });
    const travelled = Math.hypot(moved.x - 10, moved.y - 20);
    expect(travelled).toBeCloseTo(180 * dt, 6);
  });

  it('keeps the puck slower in one step than its own radius', () => {
    // Still true, and still what makes the per-sample discrete test exact. The
    // MALLET half of this claim moved to the swept resolver, which no longer
    // needs the mallet to be slow.
    const dt = FIXED_STEP_MS / 1000;
    expect(PUCK_MAX_SPEED * dt).toBeLessThan(PUCK_RADIUS);
  });

  it('reports the velocity it actually achieved, not the one it was asked for', () => {
    const dt = 0.1;
    const moved = moveMalletToward(mallet({ x: 50, y: 150 }), { x: 50, y: 149 }, dt, {
      maxSpeed: 300,
    });
    // One unit in a tenth of a second, not the 300 it was allowed.
    expect(moved.vy).toBeCloseTo(-10, 6);
  });

  it('stops dead on the target rather than oscillating around it', () => {
    const moved = moveMalletToward(mallet({ x: 50, y: 150 }), { x: 50, y: 150 }, 0.1, {
      maxSpeed: 300,
    });
    expect(moved).toEqual({ x: 50, y: 150, vx: 0, vy: 0 });
  });

  it('eases in when asked to, so a controller can settle instead of buzzing', () => {
    const dt = 1 / 120;
    const eased = moveMalletToward(mallet({ x: 50, y: 20 }), { x: 50, y: 22 }, dt, {
      maxSpeed: 200,
      arriveRadius: 20,
    });
    const flat = moveMalletToward(mallet({ x: 50, y: 20 }), { x: 50, y: 22 }, dt, {
      maxSpeed: 200,
    });
    expect(Math.abs(eased.vy)).toBeLessThan(Math.abs(flat.vy));
  });
});

describe('the player\u2019s mallet is held, not steered', () => {
  const dt = FIXED_STEP_MS / 1000;

  it('is exactly where the pointer asked, on the very first step', () => {
    // The whole responsiveness fix, as one assertion. The old rate-limited
    // mallet needed 19 steps (158 ms) to cross the player's half; a hand needs
    // none, because a hand is already there.
    const asked = { x: 93, y: TABLE_HEIGHT - 7 };
    const moved = movePlayerMallet(mallet({ x: 50, y: 134 }), asked, dt, PLAYER_ZONE, PLAYER_MALLET_MAX_STRIKE_SPEED);
    expect(moved.x).toBeCloseTo(asked.x, 9);
    expect(moved.y).toBeCloseTo(asked.y, 9);
  });

  it('still cannot leave the player\u2019s half, however far the pointer goes', () => {
    // Immediate is not unbounded. This is the safety the rate limit was NOT
    // providing, and it is unchanged.
    const escaped = movePlayerMallet(
      mallet(),
      { x: 9_999, y: -9_999 },
      dt,
      PLAYER_ZONE,
      PLAYER_MALLET_MAX_STRIKE_SPEED,
    );
    expect(escaped.x).toBe(PLAYER_ZONE.maxX);
    expect(escaped.y).toBe(PLAYER_ZONE.minY);
  });

  it('survives a non-finite pointer sample without being poisoned', () => {
    const recovered = movePlayerMallet(
      mallet(),
      { x: Number.NaN, y: Number.NaN },
      dt,
      PLAYER_ZONE,
      PLAYER_MALLET_MAX_STRIKE_SPEED,
    );
    expect(Number.isFinite(recovered.x)).toBe(true);
    expect(Number.isFinite(recovered.y)).toBe(true);
    expect(Number.isFinite(recovered.vx)).toBe(true);
  });

  it('bounds the strike velocity a teleport implies', () => {
    // Displacement \u00f7 dt is enormous for a jump; the impulse must not be.
    const teleported = movePlayerMallet(
      mallet({ x: 7, y: 153 }),
      { x: 93, y: 80 },
      dt,
      PLAYER_ZONE,
      PLAYER_MALLET_MAX_STRIKE_SPEED,
    );
    expect(speedOf(teleported)).toBeLessThanOrEqual(PLAYER_MALLET_MAX_STRIKE_SPEED + 1e-6);
    // …and it still points the right way, so the hit is honest.
    expect(teleported.vx).toBeGreaterThan(0);
    expect(teleported.vy).toBeLessThan(0);
  });

  it('reports an ordinary hand movement\u2019s real velocity, unclamped', () => {
    const gentle = movePlayerMallet(mallet({ x: 50, y: 134 }), { x: 51, y: 134 }, dt, PLAYER_ZONE, PLAYER_MALLET_MAX_STRIKE_SPEED);
    expect(gentle.vx).toBeCloseTo(120, 6);
    expect(gentle.vy).toBeCloseTo(0, 6);
  });

  it('has no velocity when the step has no duration', () => {
    const still = movePlayerMallet(mallet(), { x: 60, y: 120 }, 0, PLAYER_ZONE, PLAYER_MALLET_MAX_STRIKE_SPEED);
    expect(still.vx).toBe(0);
    expect(still.vy).toBe(0);
  });
});

describe('swept mallet contact', () => {
  it('catches a puck the mallet jumped straight over', () => {
    // The guarantee that replaced the speed limit. The mallet starts well below
    // the puck and ends well above it: at no single position do the two
    // overlap, so the old end-of-step-only test would have missed it entirely.
    const stationary = puck({ x: 50, y: 80 });
    const from = { x: 50, y: 110 };
    const to = mallet({ x: 50, y: 50, vy: -300 });

    expect(resolveMallet(stationary, to).hit).toBe(false);

    const swept = resolveMalletSwept(stationary, from, to);
    expect(swept.hit).toBe(true);
    // Driven the way the mallet was going.
    expect(swept.puck.vy).toBeLessThan(0);
  });

  it('is byte-for-byte the discrete test for any sub-radius movement', () => {
    // The symmetry guarantee, and it is load-bearing. The opponent's mallet
    // never moves more than 1.6 units in a step and an ordinary hand never more
    // than about 2.7, so BOTH sides must take the plain path; otherwise the
    // sweep silently gives one side earlier, weaker contacts than the other.
    // Measured, when it did: the opponent went from losing every match to
    // winning every match.
    const start = puck({ x: 50, y: 80 });
    const target = mallet({ x: 50, y: 90, vy: -150 });
    const discrete = resolveMallet(start, target);

    for (const travelled of [0, 0.4, 1.55, 2.5, PUCK_RADIUS - 0.001]) {
      const swept = resolveMalletSwept(start, { x: 50, y: 90 + travelled }, target);
      expect(swept.hit, `travelled ${travelled}`).toBe(discrete.hit);
      expect(swept.puck.vx, `travelled ${travelled}`).toBeCloseTo(discrete.puck.vx, 9);
      expect(swept.puck.vy, `travelled ${travelled}`).toBeCloseTo(discrete.puck.vy, 9);
      expect(swept.puck.x, `travelled ${travelled}`).toBeCloseTo(discrete.puck.x, 9);
      expect(swept.puck.y, `travelled ${travelled}`).toBeCloseTo(discrete.puck.y, 9);
    }
  });

  it('engages only once a discrete test could actually miss', () => {
    // Just past the puck's radius the sweep turns on, and that is exactly the
    // point at which a mallet could step over the puck without touching it.
    const stationary = puck({ x: 50, y: 80 });
    const over = resolveMalletSwept(
      stationary,
      { x: 50, y: 80 + PUCK_RADIUS + 12 },
      mallet({ x: 50, y: 80 - PUCK_RADIUS - 12, vy: -300 }),
    );
    expect(over.hit).toBe(true);
  });

  it('reports no contact when the path genuinely misses', () => {
    const far = puck({ x: 10, y: 20 });
    const swept = resolveMalletSwept(far, { x: 90, y: 150 }, mallet({ x: 90, y: 90 }));
    expect(swept.hit).toBe(false);
    expect(swept.puck).toBe(far);
  });

  it('never leaves the puck inside the mallet\u2019s final position', () => {
    // Contact can happen early in a sweep with the mallet carrying on. The step
    // must still end with the two separated.
    const stationary = puck({ x: 50, y: 80 });
    const swept = resolveMalletSwept(stationary, { x: 50, y: 120 }, mallet({ x: 50, y: 80, vy: -300 }));
    expect(swept.hit).toBe(true);
    const gap = Math.hypot(swept.puck.x - 50, swept.puck.y - 80);
    expect(gap).toBeGreaterThanOrEqual(PUCK_RADIUS + MALLET_RADIUS - 1e-6);
  });

  it('applies exactly one impulse, however long the sweep', () => {
    // A second impulse in one step would double a hit's strength on a flick.
    const short = resolveMalletSwept(
      puck({ x: 50, y: 80 }),
      { x: 50, y: 91 },
      mallet({ x: 50, y: 90, vy: -200 }),
    );
    const long = resolveMalletSwept(
      puck({ x: 50, y: 80 }),
      { x: 50, y: 150 },
      mallet({ x: 50, y: 90, vy: -200 }),
    );
    // Same contact geometry and the same mallet velocity, so the same outcome.
    expect(long.puck.vy).toBeCloseTo(short.puck.vy, 6);
  });
});

describe('interception prediction', () => {
  it('projects a straight run onto the line', () => {
    expect(predictCrossingX(puck({ x: 20, y: 100, vx: 0, vy: -100 }), 30)).toBeCloseTo(20, 6);
  });

  it('unfolds a rail bounce', () => {
    // Heading up and right from the middle, far enough to bounce once.
    const crossing = predictCrossingX(puck({ x: 50, y: 100, vx: 100, vy: -100 }), 30);
    expect(crossing).not.toBeNull();
    expect(crossing!).toBeGreaterThanOrEqual(PUCK_RADIUS);
    expect(crossing!).toBeLessThanOrEqual(TABLE_WIDTH - PUCK_RADIUS);
  });

  it('refuses to predict a puck that is not going there', () => {
    expect(predictCrossingX(puck({ y: 100, vy: 100 }), 30)).toBeNull();
    expect(predictCrossingX(puck({ y: 100, vy: 0 }), 30)).toBeNull();
  });
});

describe('recovery from an invalid state', () => {
  it('rejects a non-finite puck', () => {
    expect(sanitisePuck(puck({ x: Number.NaN }))).toBeNull();
    expect(sanitisePuck(puck({ vy: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('rejects a puck that has escaped the table entirely', () => {
    expect(sanitisePuck(puck({ y: -10_000 }))).toBeNull();
  });

  it('accepts a puck a little past a rail, which is a rounding error, not corruption', () => {
    const nearly = puck({ x: -1, y: TABLE_HEIGHT + 2 });
    expect(sanitisePuck(nearly)).toEqual(nearly);
  });
});
