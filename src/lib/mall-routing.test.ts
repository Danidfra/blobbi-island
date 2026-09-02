/**
 * The shopping mall's staircase — the regression that obstacle avoidance caused,
 * and the contract that keeps it fixed.
 *
 * ## The bug this file exists for
 *
 * The mall is the one location whose walkable floor is not a blob: three levels
 * joined by narrow stair columns. It also contains ZERO `MovementBlocker`s —
 * every storefront is painted scenery.
 *
 * The first route planner treated "this straight line leaves the walkable
 * polygon" as an obstruction. So a walk from the ground floor to any upper-level
 * target found a segment that left the floor, looked for the blocker
 * responsible, found none — the mall has none — and returned `null`. `goTo`
 * refuses a null route, so the Blobbi did not move a single pixel. Every
 * storefront on the middle level, and the whole top level, became unreachable;
 * the click was silently dropped, then the pending interaction stalled itself
 * out. Measured before the fix: all four upper-level destinations, from all five
 * start positions, in both directions — `null` every time.
 *
 * ## What actually distinguishes the two things
 *
 * Furniture is impassable and the room's contour is not. The movement loop has
 * always clamped each step back onto the floor, and that clamp is how a walk
 * follows a wall, turns a corner, and climbs these stairs. The planner's job is
 * furniture; the contour was never its business.
 *
 * So these tests do not stop at "a route was returned". They SIMULATE the walk
 * the controller would run — same fixed-timestep stepping, same
 * `constrainPosition` clamp, same waypoint advance — and assert that it arrives,
 * that it stays on the floor, and that it goes up the stairs to get there.
 */

import { describe, it, expect } from 'vitest';

import { planRoute, isOnFloor, type RouteBlocker } from './blobbi-route';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition, type Boundary } from './boundaries';
import { EXIT_POSITIONS, LOCATION_INITIAL_POSITIONS } from './location-initial-position';
import { MOVEMENT_SNAP_PX } from './blobbi-ground';
import {
  worldDistancePx,
  worldPercentToDesignPx,
  designPxToWorldPercent,
} from './world-coordinates';
import type { Position } from './types';
import { CARE_STORE_FACADE } from './care-store-config';
import { BADGES_STORE_FACADE } from './badges-store-config';

const MALL: Boundary = locationBoundaries['shopping-mall-inside.png'];
const GROUND = LOCATION_INITIAL_POSITIONS['shop'];

/** The middle level's walkway strip, from the boundary itself. */
const MIDDLE_STRIP = { y: [62.1, 63.1] } as const;
/** The left stair column that joins the ground floor to that strip. */
const LEFT_STAIR = { x: [0, 7], y: [62.1, 90.6] } as const;
/** The right stair column that carries on from the strip to the top level. */
const RIGHT_STAIR = { x: [93, 100], y: [32.5, 62.1] } as const;

/** Where each middle-level storefront asks the player to stand. */
const STOREFRONTS: { name: string; target: Position }[] = [
  { name: 'Badges Store', target: BADGES_STORE_FACADE.walkTarget },
  { name: 'Care Store', target: CARE_STORE_FACADE.walkTarget },
  // The Clothing Store passes `EXIT_POSITIONS` straight through as its walk
  // target, so this is literally the value the facade uses.
  { name: 'Clothing Store', target: EXIT_POSITIONS['shop:clothing-store-inside'] },
];

/** Several honest starting points on the ground floor, not one lucky one. */
const GROUND_STARTS: Position[] = [
  GROUND,
  { x: 10, y: 95 },
  { x: 90, y: 95 },
  { x: 50, y: 92 },
  { x: 99, y: 99 },
  { x: 1, y: 99 },
];

interface WalkResult {
  arrived: boolean;
  /** Every position the walk passed through, in order. */
  path: Position[];
  frames: number;
  /** Positions the boundary had to move — there should never be any. */
  offFloor: Position[];
}

/**
 * Run the walk the controller would run.
 *
 * Deliberately a re-implementation of the rAF body rather than a mock of it:
 * fixed 16 ms steps at the default 120 design-px/s, move toward the current
 * waypoint, clamp with `constrainPosition`, advance when inside
 * `MOVEMENT_SNAP_PX`. Behaviour is asserted, not frame counts — the only thing
 * the frame budget does is stop a stuck walk from running forever.
 */
function walk(
  start: Position,
  route: Position[],
  boundary: Boundary,
  blockers: readonly RouteBlocker[] = [],
  { speed = 120, maxFrames = 4000 } = {},
): WalkResult {
  let position = start;
  let remaining = [...route];
  const path: Position[] = [start];
  const offFloor: Position[] = [];
  const step = speed * (16 / 1000);

  let frames = 0;
  for (; frames < maxFrames && remaining.length > 0; frames++) {
    const target = remaining[0];
    if (worldDistancePx(position, target) < MOVEMENT_SNAP_PX) {
      position = target;
      remaining = remaining.slice(1);
      path.push(position);
      continue;
    }
    const here = worldPercentToDesignPx(position);
    const there = worldPercentToDesignPx(target);
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const length = Math.hypot(dx, dy);
    const next = constrainPosition(
      designPxToWorldPercent({
        x: here.x + (dx / length) * step,
        y: here.y + (dy / length) * step,
      }),
      boundary,
    );
    // The controller stops dead if a step lands inside furniture.
    if (blockers.some((b) =>
      next.x >= b.x && next.x <= b.x + b.width && next.y >= b.y && next.y <= b.y + b.height,
    )) {
      break;
    }
    if (!isOnFloor(next, boundary)) offFloor.push(next);
    position = next;
    path.push(position);
  }

  return { arrived: remaining.length === 0, path, frames, offFloor };
}

/** Did the walk actually go through the stair column? */
const usedLeftStair = (path: Position[]) =>
  path.some(
    (p) =>
      p.x >= LEFT_STAIR.x[0] &&
      p.x <= LEFT_STAIR.x[1] &&
      p.y >= LEFT_STAIR.y[0] &&
      p.y <= LEFT_STAIR.y[1],
  );

const usedRightStair = (path: Position[]) =>
  path.some(
    (p) =>
      p.x >= RIGHT_STAIR.x[0] &&
      p.x <= RIGHT_STAIR.x[1] &&
      p.y >= RIGHT_STAIR.y[0] &&
      p.y <= RIGHT_STAIR.y[1],
  );

/** Did it reach the middle walkway? */
const reachedMiddle = (path: Position[]) =>
  path.some((p) => p.y >= MIDDLE_STRIP.y[0] && p.y <= MIDDLE_STRIP.y[1]);

describe('the regression itself', () => {
  it('plans a route between two valid points whose straight line leaves the floor', () => {
    // This is the exact condition that broke: both endpoints are real floor, no
    // blocker exists anywhere, and yet no straight line between them stays
    // inside the composite. That must be a route, not a refusal.
    const start = GROUND;
    const target = BADGES_STORE_FACADE.walkTarget;

    expect(isOnFloor(start, MALL)).toBe(true);
    expect(isOnFloor(target, MALL)).toBe(true);
    // Nothing solid is involved at all — the mall registers no blockers.
    expect(planRoute(start, target, MALL, [])).not.toBeNull();
  });

  it('does not need a blocker to exist in order to answer', () => {
    // The old planner asked "which blocker is in the way?", got `null`, and gave
    // up. An empty blocker list must never turn a walk into a refusal.
    for (const start of GROUND_STARTS) {
      for (const { name, target } of STOREFRONTS) {
        expect(planRoute(start, target, MALL, []), `${name} from ${start.x},${start.y}`)
          .not.toBeNull();
      }
    }
  });
});

describe('ground floor → middle level', () => {
  it.each(STOREFRONTS)('$name is reachable from anywhere on the ground floor', ({ target }) => {
    for (const start of GROUND_STARTS) {
      const route = planRoute(start, target, MALL, [])!;
      expect(route, `from ${start.x},${start.y}`).not.toBeNull();
      // The caller's destination is never swapped for somewhere easier.
      expect(route[route.length - 1]).toEqual(target);

      const result = walk(start, route, MALL);
      expect(result.arrived, `from ${start.x},${start.y}`).toBe(true);
      expect(result.offFloor, `from ${start.x},${start.y}`).toEqual([]);
    }
  });

  it.each(STOREFRONTS)('$name is reached BY CLIMBING, not by cutting through', ({ target }) => {
    const route = planRoute(GROUND, target, MALL, [])!;
    const { path } = walk(GROUND, route, MALL);
    expect(usedLeftStair(path)).toBe(true);
    expect(reachedMiddle(path)).toBe(true);
  });

  it('does not stall at the stair corner', () => {
    // The corner is where the ground floor, the connector triangle and the
    // stair column meet. A walk that gets stuck there stops making progress
    // while still far from its target — which is precisely what "it gets stuck
    // around a stair corner" looked like.
    const target = BADGES_STORE_FACADE.walkTarget;
    const route = planRoute(GROUND, target, MALL, [])!;
    const { path, arrived } = walk(GROUND, route, MALL);

    expect(arrived).toBe(true);

    // No long stationary run anywhere along the way.
    let stationary = 0;
    for (let i = 1; i < path.length; i++) {
      stationary = worldDistancePx(path[i - 1], path[i]) < 0.05 ? stationary + 1 : 0;
      expect(stationary, `stalled at ${JSON.stringify(path[i])}`).toBeLessThan(30);
    }
    // And it genuinely ends up where it was sent.
    expect(worldDistancePx(path[path.length - 1], target)).toBeLessThan(MOVEMENT_SNAP_PX);
  });

  it('reaches the TOP level by using BOTH staircases', () => {
    // The mall has two: the left column joins the ground floor to the middle
    // walkway, and the right one carries on from the walkway to the top. A walk
    // to the top has to use them in that order, and nothing in this file (or in
    // the planner) knows that — it falls out of the boundary data.
    const top = { x: 50, y: 33 };
    expect(isOnFloor(top, MALL)).toBe(true);
    const route = planRoute(GROUND, top, MALL, [])!;
    expect(route).not.toBeNull();

    const { arrived, offFloor, path } = walk(GROUND, route, MALL, [], {
      maxFrames: 8000,
    });
    expect(arrived).toBe(true);
    expect(offFloor).toEqual([]);
    expect(usedLeftStair(path)).toBe(true);
    expect(usedRightStair(path)).toBe(true);
    // In that order: left column first, right column after.
    const firstLeft = path.findIndex(
      (p) => p.x <= LEFT_STAIR.x[1] && p.y >= LEFT_STAIR.y[0] && p.y <= LEFT_STAIR.y[1],
    );
    const firstRight = path.findIndex(
      (p) => p.x >= RIGHT_STAIR.x[0] && p.y >= RIGHT_STAIR.y[0] && p.y <= RIGHT_STAIR.y[1],
    );
    expect(firstLeft).toBeGreaterThanOrEqual(0);
    expect(firstRight).toBeGreaterThan(firstLeft);
  });
});

describe('middle level → ground floor', () => {
  it.each(STOREFRONTS)('comes back down from outside $name', ({ target }) => {
    const route = planRoute(target, GROUND, MALL, [])!;
    expect(route).not.toBeNull();
    expect(route[route.length - 1]).toEqual(GROUND);

    const { arrived, path, offFloor } = walk(target, route, MALL);
    expect(arrived).toBe(true);
    expect(offFloor).toEqual([]);
    // Down the same connector it came up.
    expect(usedLeftStair(path)).toBe(true);
  });

  it('comes down from the top level, using both staircases in reverse', () => {
    const top = { x: 50, y: 33 };
    const { arrived, path, offFloor } = walk(
      top,
      planRoute(top, GROUND, MALL, [])!,
      MALL,
      [],
      { maxFrames: 8000 },
    );
    expect(arrived).toBe(true);
    expect(offFloor).toEqual([]);
    expect(usedRightStair(path)).toBe(true);
    expect(usedLeftStair(path)).toBe(true);
  });
});

describe('the mall still refuses what it should', () => {
  it('will not walk to a point outside the mall floor', () => {
    // Off the walkable polygon entirely — mid-air between two levels.
    const midAir = { x: 50, y: 75 };
    expect(isOnFloor(midAir, MALL)).toBe(false);
    expect(planRoute(GROUND, midAir, MALL, [])).toBeNull();
  });

  it('still refuses to walk into furniture, in a room that has some', () => {
    const room: Boundary = { shape: 'rectangle', x: [0, 100], y: [0, 100] };
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    expect(planRoute({ x: 10, y: 50 }, { x: 50, y: 50 }, room, [shelf])).toBeNull();
  });

  it('terminates on a genuinely impossible route', () => {
    const room: Boundary = { shape: 'rectangle', x: [0, 100], y: [0, 100] };
    const wall: RouteBlocker = { x: 45, y: -10, width: 10, height: 120 };
    const started = Date.now();
    expect(planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, room, [wall])).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('every mall storefront asks for somewhere that exists', () => {
  it.each(STOREFRONTS)('$name stands on the walkway strip', ({ target }) => {
    // The generic guard the Clothing Store needed: a storefront's walk target
    // has to be real floor. All three sit on the middle level's strip.
    expect(isOnFloor(target, MALL)).toBe(true);
    expect(target.y).toBeGreaterThanOrEqual(MIDDLE_STRIP.y[0]);
    expect(target.y).toBeLessThanOrEqual(MIDDLE_STRIP.y[1]);
  });

  it('a target derived from a storefront sprite base is NOT floor', () => {
    // What the Clothing Store used before it was given an explicit target:
    // `InteractiveElement` derives the walk point from the door sprite's base,
    // which lands above the strip because the storefront is set back against
    // the wall. Refusing it is correct; the fix was to state a real one, not to
    // loosen the refusal.
    const derivedFromSpriteBase = { x: 57.7, y: 61.0 };
    expect(isOnFloor(derivedFromSpriteBase, MALL)).toBe(false);
    expect(planRoute(GROUND, derivedFromSpriteBase, MALL, [])).toBeNull();
    // And the point actually used instead is only a little below it — the
    // correction is minimal, not a relocation.
    const used = EXIT_POSITIONS['shop:clothing-store-inside'];
    expect(Math.abs(used.x - derivedFromSpriteBase.x)).toBeLessThan(1);
    expect(Math.abs(used.y - derivedFromSpriteBase.y)).toBeLessThan(2);
  });

  it('going in and coming back out use the same point', () => {
    // Badges and Care already guarantee this in their configs; the Clothing
    // Store now does too, by construction.
    expect(EXIT_POSITIONS['shop:badges-store-inside']).toEqual(
      BADGES_STORE_FACADE.walkTarget,
    );
    expect(EXIT_POSITIONS['shop:care-store-inside']).toEqual(
      CARE_STORE_FACADE.walkTarget,
    );
  });
});
