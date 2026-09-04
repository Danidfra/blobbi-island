/**
 * The Plaza interior's geometry, checked against itself.
 *
 * Every number in `plaza-inside-config.ts` was measured on the redrawn plate;
 * these tests hold the numbers that have to AGREE with each other — the spawn
 * with the boundary, the stand points with the floor and the blockers, the
 * door sprite with the door painted behind it, the fountain's plinth with its
 * blocker — and walk the routes a player actually takes, the way
 * `mall-routing.test.ts` does, so a boundary edit that strands the balcony or
 * the shops fails here rather than in someone's hands.
 */
import { describe, it, expect } from 'vitest';

import {
  PLAZA_DOOR,
  PLAZA_FOUNTAIN,
  PLAZA_INSIDE_BACKGROUND,
  PLAZA_INSIDE_SPAWN,
  PLAZA_OCCLUSION,
  plazaInsideBlockers,
  plazaStorefronts,
} from './plaza-inside-config';
import { isStorefrontOpen, storefrontAccessibleName } from './storefront-hotspots';
import { locationBoundaries } from './location-boundaries';
import { LOCATION_BACKGROUNDS } from './location-backgrounds';
import { LOCATION_INITIAL_POSITIONS } from './location-initial-position';
import { constrainPosition, type Boundary } from './boundaries';
import { isBlocked, isOnFloor, planRoute, type RouteBlocker } from './blobbi-route';
import { MOVEMENT_SNAP_PX } from './blobbi-ground';
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  designPxToWorldPercent,
  worldDistancePx,
  worldPercentToDesignPx,
} from './world-coordinates';
import type { Position } from './types';

const PLAZA: Boundary = locationBoundaries[PLAZA_INSIDE_BACKGROUND];
const BLOCKERS: readonly RouteBlocker[] = plazaInsideBlockers;

/** The staircase column, from the boundary itself. */
const STAIRS = { x: PLAZA_OCCLUSION.stairsX, y: [PLAZA_OCCLUSION.landingTop, 73.6] } as const;

/**
 * Run the walk the controller would run — the same simulation
 * `mall-routing.test.ts` uses: fixed 16 ms steps, move toward the waypoint,
 * clamp with `constrainPosition`, advance inside `MOVEMENT_SNAP_PX`.
 */
function walk(start: Position, route: Position[], { speed = 120, maxFrames = 4000 } = {}) {
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
      designPxToWorldPercent({ x: here.x + (dx / length) * step, y: here.y + (dy / length) * step }),
      PLAZA,
    );
    if (isBlocked(next, BLOCKERS)) break;
    if (!isOnFloor(next, PLAZA)) offFloor.push(next);
    position = next;
    path.push(position);
  }
  return { arrived: remaining.length === 0, path, offFloor };
}

const usedStairs = (path: Position[]) =>
  path.some((p) => p.x >= STAIRS.x[0] && p.x <= STAIRS.x[1] && p.y > 50 && p.y < 72);

function routeAndWalk(start: Position, target: Position) {
  const route = planRoute(start, target, PLAZA, BLOCKERS);
  expect(route, `route ${start.x},${start.y} → ${target.x},${target.y}`).not.toBeNull();
  return walk(start, route!);
}

describe('the room is wired up by its background', () => {
  it('is the background the location table names', () => {
    expect(LOCATION_BACKGROUNDS['plaza-inside']).toBe(PLAZA_INSIDE_BACKGROUND);
    expect(PLAZA).toBeDefined();
  });
});

describe('the landing at the top of the stairs', () => {
  it('is where the player arrives, and where the door walks back to', () => {
    expect(LOCATION_INITIAL_POSITIONS['plaza-inside']).toEqual(PLAZA_INSIDE_SPAWN);
    expect(PLAZA_DOOR.walkTarget).toEqual(PLAZA_INSIDE_SPAWN);
  });

  it('is on the floor, between the stair rails, in front of the painted door', () => {
    expect(isOnFloor(PLAZA_INSIDE_SPAWN, PLAZA)).toBe(true);
    expect(isBlocked(PLAZA_INSIDE_SPAWN, BLOCKERS)).toBe(false);
    expect(PLAZA_INSIDE_SPAWN.x).toBeGreaterThan(PLAZA_OCCLUSION.stairsX[0]);
    expect(PLAZA_INSIDE_SPAWN.x).toBeLessThan(PLAZA_OCCLUSION.stairsX[1]);
    expect(PLAZA_INSIDE_SPAWN.y).toBeGreaterThanOrEqual(PLAZA_OCCLUSION.landingTop);
    expect(PLAZA_INSIDE_SPAWN.y).toBeLessThan(PLAZA_OCCLUSION.railingBase);
    expect(PLAZA_INSIDE_SPAWN.x).toBeGreaterThan(PLAZA_DOOR.painted.left);
    expect(PLAZA_INSIDE_SPAWN.x).toBeLessThan(PLAZA_DOOR.painted.right);
  });
});

describe('the door sprite covers the door painted behind it', () => {
  /** Where the sprite's painted body lands, in world percent. */
  function spriteBody() {
    const { placement, sprite, scaleY } = PLAZA_DOOR;
    const widthPx = (placement.width / 100) * WORLD_WIDTH;
    const naturalHeight = ((widthPx * (sprite.height / sprite.width)) / WORLD_HEIGHT) * 100;
    const height = naturalHeight * scaleY;
    return {
      left: placement.left + (sprite.body.left / sprite.width) * placement.width,
      right: placement.left + (sprite.body.right / sprite.width) * placement.width,
      top: placement.top + (sprite.body.top / sprite.height) * height,
      bottom: placement.top + (sprite.body.bottom / sprite.height) * height,
    };
  }

  it('on every edge, with a little to spare, without spilling onto the lamps', () => {
    const body = spriteBody();
    const painted = PLAZA_DOOR.painted;
    expect(body.left).toBeLessThan(painted.left);
    expect(body.right).toBeGreaterThan(painted.right);
    expect(body.top).toBeLessThan(painted.top);
    expect(body.bottom).toBeGreaterThan(painted.bottom);
    // The lamps hang at x ≈ 44.3–45.8 and 54.2–55.7; the leaves stay off them.
    expect(body.left).toBeGreaterThan(45.7);
    expect(body.right).toBeLessThan(54.3);
  });

  it('stands on the landing, where the staircase overlay hides its base', () => {
    const body = spriteBody();
    expect(body.bottom).toBeGreaterThan(PLAZA_OCCLUSION.landingTop);
    expect(body.bottom).toBeLessThan(PLAZA_OCCLUSION.railingBase);
  });
});

describe('the six storefronts', () => {
  it('are six, each painted bay pressable exactly once', () => {
    expect(plazaStorefronts).toHaveLength(6);
    expect(new Set(plazaStorefronts.map((s) => s.id)).size).toBe(6);
    expect(plazaStorefronts.map((s) => s.name)).toEqual([
      'Toy Shop',
      'Books',
      'Garden Shop',
      'Creative Studio',
      'Music Store',
      'Chill Lounge',
    ]);
  });

  it('lie inside the frame and never overlap one another', () => {
    for (const store of plazaStorefronts) {
      const { x, y, width, height } = store.box;
      expect(x, store.id).toBeGreaterThanOrEqual(0);
      expect(y, store.id).toBeGreaterThanOrEqual(0);
      expect(x + width, store.id).toBeLessThanOrEqual(100);
      expect(y + height, store.id).toBeLessThanOrEqual(100);
    }
    for (const a of plazaStorefronts) {
      for (const b of plazaStorefronts) {
        if (a === b) continue;
        const apart =
          a.box.x + a.box.width <= b.box.x ||
          b.box.x + b.box.width <= a.box.x ||
          a.box.y + a.box.height <= b.box.y ||
          b.box.y + b.box.height <= a.box.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it('keep their hands off the staircase', () => {
    // The flight's rails and treads run x 40–60 below the landing; no bay
    // reaches into them. (The newel posts at the foot of the flight stand a
    // little wider, x 36–64, and the two bays beside them stop at their own
    // frames rather than at the posts.)
    for (const store of plazaStorefronts) {
      const { x, width } = store.box;
      const insideStairs = x < 60 && x + width > 40;
      expect(insideStairs, store.id).toBe(false);
    }
  });

  it.each(plazaStorefronts.map((s) => [s.name, s] as const))(
    '%s: its stand point is on the floor, unblocked, and in front of its own bay',
    (_name, store) => {
      expect(isOnFloor(store.standPoint, PLAZA)).toBe(true);
      expect(isBlocked(store.standPoint, BLOCKERS)).toBe(false);
      expect(store.standPoint.x).toBeGreaterThan(store.box.x);
      expect(store.standPoint.x).toBeLessThan(store.box.x + store.box.width);
      // Below the bay's top and no further than a short step past its threshold
      // (the upper bays stop at the railing's top rail, a little above the
      // corridor their stand points are on).
      expect(store.standPoint.y).toBeGreaterThan(store.box.y);
      expect(store.standPoint.y).toBeLessThan(store.box.y + store.box.height + 8);
    },
  );

  it('are all "coming soon" until their rooms exist, and say so', () => {
    for (const store of plazaStorefronts) {
      expect(isStorefrontOpen(store), store.id).toBe(false);
      expect(storefrontAccessibleName(store)).toBe(`${store.name} — coming soon`);
    }
    // The contract for opening one later: a destination, nothing else.
    expect(storefrontAccessibleName({ name: 'Books', destination: 'plaza' })).toBe('Books — go inside');
  });

  it('are reached on foot from the landing — the ground floor ones by the stairs', () => {
    for (const store of plazaStorefronts) {
      const result = routeAndWalk(PLAZA_INSIDE_SPAWN, store.standPoint);
      expect(result.arrived, store.id).toBe(true);
      expect(result.offFloor, store.id).toEqual([]);
      const groundFloor = store.standPoint.y > STAIRS.y[1];
      expect(usedStairs(result.path), `${store.id} ${groundFloor ? 'should' : 'should not'} use the stairs`).toBe(
        groundFloor,
      );
    }
  });

  it('are reached on foot from the ground floor too, and the upper ones by the stairs', () => {
    const starts: Position[] = [
      { x: 50, y: 86 }, // on the rug
      { x: 8, y: 96 },
      { x: 92, y: 96 },
    ];
    for (const start of starts) {
      expect(isOnFloor(start, PLAZA)).toBe(true);
      for (const store of plazaStorefronts) {
        const result = routeAndWalk(start, store.standPoint);
        expect(result.arrived, `${store.id} from ${start.x},${start.y}`).toBe(true);
        expect(result.offFloor, store.id).toEqual([]);
        if (store.standPoint.y < STAIRS.y[0]) {
          expect(usedStairs(result.path), `${store.id} from ${start.x},${start.y}`).toBe(true);
        }
      }
    }
  });
});

describe('walking the balcony', () => {
  it('runs the whole corridor, wing to wing, without leaving the floor', () => {
    const farLeft = { x: 20, y: 46 };
    const farRight = { x: 80, y: 46 };
    expect(isOnFloor(farLeft, PLAZA)).toBe(true);
    expect(isOnFloor(farRight, PLAZA)).toBe(true);
    const result = routeAndWalk(farLeft, farRight);
    expect(result.arrived).toBe(true);
    expect(result.offFloor).toEqual([]);
    // Along the way it crosses the landing in front of the door.
    expect(result.path.some((p) => p.x > 47 && p.x < 53 && p.y < PLAZA_OCCLUSION.railingBase)).toBe(true);
  });

  it('descends the stairs to the ground floor and comes back up', () => {
    // Onto the rug, which is walkable; the fountain below it is not.
    const down = routeAndWalk(PLAZA_INSIDE_SPAWN, { x: 50, y: 86 });
    expect(down.arrived).toBe(true);
    expect(down.offFloor).toEqual([]);
    expect(usedStairs(down.path)).toBe(true);
    const up = routeAndWalk({ x: 50, y: 86 }, PLAZA_INSIDE_SPAWN);
    expect(up.arrived).toBe(true);
    expect(usedStairs(up.path)).toBe(true);
  });
});

describe('the fountain', () => {
  /** The plinth's footprint, from the group's placement and `floor.png`'s aspect. */
  function plinthFootprint() {
    const { placement, plinthSprite } = PLAZA_FOUNTAIN;
    const widthPx = (placement.width / 100) * WORLD_WIDTH;
    const height = ((widthPx * (plinthSprite.height / plinthSprite.width)) / WORLD_HEIGHT) * 100;
    const bottom = 100 - placement.bottom;
    return { left: placement.centerX - placement.width / 2, right: placement.centerX + placement.width / 2, top: bottom - height, bottom };
  }

  it('blocks exactly where its plinth stands', () => {
    const plinth = plinthFootprint();
    const { blocker } = PLAZA_FOUNTAIN;
    expect(blocker.x).toBeCloseTo(plinth.left, 1);
    expect(blocker.x + blocker.width).toBeCloseTo(plinth.right, 1);
    expect(blocker.y).toBeCloseTo(plinth.top, 0);
    expect(blocker.y + blocker.height).toBeCloseTo(plinth.bottom, 1);
    expect(PLAZA_FOUNTAIN.frontLineY).toBeCloseTo(plinth.bottom, 5);
  });

  it('stands on the open floor below the rug, clear of the bottom step', () => {
    const plinth = plinthFootprint();
    // The rug fills y 73.5–83.5; the bottom step ends at 72.9.
    expect(plinth.top).toBeGreaterThan(83.5);
    expect(plinth.bottom).toBeLessThanOrEqual(99.5);
    expect(isOnFloor({ x: plinth.left, y: plinth.top }, PLAZA)).toBe(true);
  });

  it('can be walked around from either side', () => {
    const left = { x: 30, y: 93 };
    const right = { x: 70, y: 93 };
    const result = routeAndWalk(left, right);
    expect(result.arrived).toBe(true);
    expect(result.offFloor).toEqual([]);
    expect(result.path.some((p) => isBlocked(p, BLOCKERS))).toBe(false);
  });
});

describe('the blockers', () => {
  it('all stand on the ground floor, inside its walkable band', () => {
    for (const blocker of plazaInsideBlockers) {
      expect(blocker.y, blocker.id).toBeGreaterThanOrEqual(73.6);
      expect(blocker.y + blocker.height, blocker.id).toBeLessThanOrEqual(99.5);
    }
  });

  it('have distinct ids', () => {
    expect(new Set(plazaInsideBlockers.map((b) => b.id)).size).toBe(plazaInsideBlockers.length);
  });
});
