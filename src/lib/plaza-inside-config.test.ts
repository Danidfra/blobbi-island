/**
 * The Plaza interior's geometry, checked against itself.
 *
 * Every number in `plaza-inside-config.ts` was measured on the redrawn plate;
 * these tests hold the numbers that have to AGREE with each other, the spawn
 * with the boundary, the stand points with the floor and the blockers, the
 * door sprite with the door painted behind it, the fountain's plinth with its
 * blocker: and walk the routes a player actually takes, the way
 * `mall-routing.test.ts` does, so a boundary edit that strands the balcony or
 * the shops fails here rather than in someone's hands.
 */
import { describe, it, expect } from 'vitest';

import {
  PLAZA_CORRIDOR,
  PLAZA_DOOR,
  PLAZA_FOUNTAIN,
  PLAZA_INSIDE_BACKGROUND,
  PLAZA_INSIDE_SPAWN,
  PLAZA_OCCLUSION,
  PLAZA_STAIRS,
  PLAZA_STAIRS_WALK_BOTTOM,
  PLAZA_STAIRS_WALK_TOP,
  plazaCorridorPaths,
  plazaCorridorPointAt,
  plazaCorridorY,
  plazaInsideBlockers,
  plazaStorefronts,
} from './plaza-inside-config';
import { blobbiHalfHeightPercent } from './blobbi-ground';
import { getBlobbiSizeForLocation } from './location-blobbi-sizes';
import { resolveBlobbiScale } from './blobbi-world-render';
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
 * Run the walk the controller would run, the same simulation
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
      expect(storefrontAccessibleName(store)).toBe(`${store.name}: coming soon`);
    }
    // The contract for opening one later: a destination, nothing else.
    expect(storefrontAccessibleName({ name: 'Books', destination: 'plaza' })).toBe('Books: go inside');
  });

  it('are reached on foot from the landing, the ground floor ones by the stairs', () => {
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
  const farLeft = plazaCorridorPointAt(PLAZA_CORRIDOR.left);
  const farRight = plazaCorridorPointAt(PLAZA_CORRIDOR.right);

  it('runs the whole visible parapet, frame edge to frame edge, without leaving the floor', () => {
    // The plate paints the balcony floor edge to edge; the corridor reaches to
    // within a body's width of both frame edges.
    expect(PLAZA_CORRIDOR.left).toBeLessThanOrEqual(4);
    expect(PLAZA_CORRIDOR.right).toBeGreaterThanOrEqual(96);
    expect(isOnFloor(farLeft, PLAZA)).toBe(true);
    expect(isOnFloor(farRight, PLAZA)).toBe(true);
    const result = routeAndWalk(farLeft, farRight);
    expect(result.arrived).toBe(true);
    expect(result.offFloor).toEqual([]);
    // Along the way it crosses the landing in front of the door.
    expect(result.path.some((p) => p.x > 47 && p.x < 53 && p.y < PLAZA_OCCLUSION.railingBase)).toBe(true);
  });

  it('is one line: every step across it is on the centreline, level along the centre run', () => {
    const result = routeAndWalk(farLeft, farRight);
    for (const p of result.path) {
      if (p.x > PLAZA_OCCLUSION.stairsX[0] && p.x < PLAZA_OCCLUSION.stairsX[1]) {
        // The landing is crossed at the corridor's own row.
        expect(p.y, `${p.x},${p.y}`).toBeCloseTo(PLAZA_CORRIDOR.y, 6);
        continue;
      }
      expect(p.y, `${p.x},${p.y}`).toBeCloseTo(plazaCorridorPointAt(p.x).y, 4);
      // Level from the end of one blend to the start of the other.
      if (p.x >= PLAZA_CORRIDOR.kinks[0] + PLAZA_CORRIDOR.blend && p.x <= PLAZA_CORRIDOR.kinks[1] - PLAZA_CORRIDOR.blend) {
        expect(p.y, `${p.x},${p.y}`).toBeCloseTo(PLAZA_CORRIDOR.y, 6);
      }
    }
  });

  it('follows the parapet: flat along the centre run, climbing at its slope along the wings, mirrored', () => {
    const { y, kinks, wingSlope, blend } = PLAZA_CORRIDOR;
    // The parapet's top edge, probed on the overlay: flat at 43.8 from x = 27
    // to 73, then 40.7 at x = 15, 39.2 at x = 10, 38.0 at x = 6, 37.0 at x = 3.
    const parapetTop = (x: number) => 43.8 - wingSlope * Math.max(0, kinks[0] - x, x - kinks[1]);
    expect(parapetTop(15)).toBeCloseTo(40.7, 0);
    expect(parapetTop(10)).toBeCloseTo(39.2, 0);
    expect(parapetTop(3)).toBeCloseTo(37.0, 0);
    // Same immersion behind the plate everywhere outside the blend.
    const immersion = y - 43.8;
    for (const x of [PLAZA_CORRIDOR.left, 10, 15, 21.8, 35, 50, 65, 78, 85, 90, PLAZA_CORRIDOR.right]) {
      if (Math.abs(x - kinks[0]) < blend || Math.abs(x - kinks[1]) < blend) continue;
      expect(plazaCorridorY(x) - parapetTop(x), `x=${x}`).toBeCloseTo(immersion, 6);
      expect(plazaCorridorY(x), `x=${x}`).toBeCloseTo(plazaCorridorY(100 - x), 6);
    }
    // The wing ends are well up the parapet, not on the row the run uses.
    expect(plazaCorridorY(PLAZA_CORRIDOR.left)).toBeLessThan(y - 6);
  });

  it('bends smoothly through each kink: monotone, small turns, tangent at both ends', () => {
    const { y, kinks, wingSlope, blend, blendStep } = PLAZA_CORRIDOR;
    for (const kink of kinks) {
      const sign = kink < 50 ? -1 : 1;
      const inside = kink - sign * blend;
      const outside = kink + sign * blend;
      expect(plazaCorridorY(inside)).toBeCloseTo(y, 9);
      expect(plazaCorridorY(outside)).toBeCloseTo(y - wingSlope * blend, 9);
      // Slope grows from 0 to the wing's, never beyond, never backwards.
      let previous = 0;
      for (let x = inside; sign * (x - outside) < 0; x += sign * blendStep) {
        const slope = (plazaCorridorY(x) - plazaCorridorY(x + sign * blendStep)) / blendStep;
        expect(slope).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(slope).toBeLessThanOrEqual(wingSlope + 1e-9);
        previous = slope;
      }
      expect(previous).toBeGreaterThan(wingSlope * 0.7);
    }
    // The chain the walk follows has a vertex at every sample, so it IS the
    // curve at those points, and its joints turn by only a few degrees.
    for (const chain of Object.values(plazaCorridorPaths())) {
      for (let i = 1; i < chain.length - 1; i++) {
        const a = Math.atan2((chain[i].y - chain[i - 1].y) * (WORLD_HEIGHT / 100), (chain[i].x - chain[i - 1].x) * (WORLD_WIDTH / 100));
        const b = Math.atan2((chain[i + 1].y - chain[i].y) * (WORLD_HEIGHT / 100), (chain[i + 1].x - chain[i].x) * (WORLD_WIDTH / 100));
        expect(Math.abs(a - b) * (180 / Math.PI), `joint at x=${chain[i].x}`).toBeLessThan(6);
      }
    }
  });

  it('projects a click above or below the parapet onto the line', () => {
    for (const x of [6, 10, 21.8, 35, 70, 78, 92]) {
      const on = plazaCorridorPointAt(x);
      for (const dy of [-6, -2, 0, 1.5, 3]) {
        const landed = constrainPosition({ x, y: on.y + dy }, PLAZA);
        expect(isOnFloor(landed, PLAZA), `${x},${on.y + dy}`).toBe(true);
        // Onto the line, near the same x: the drop onto a wing is
        // perpendicular to its slope, which shifts x by about a quarter of
        // the distance dropped.
        expect(Math.abs(landed.x - x), `${x},${on.y + dy}`).toBeLessThanOrEqual(Math.abs(dy) * 0.3 + 1e-9);
        expect(landed.y, `${x},${on.y + dy}`).toBeCloseTo(plazaCorridorPointAt(landed.x).y, 4);
      }
    }
    // A click behind the door lands on the landing's top row, not the line.
    expect(constrainPosition({ x: 50, y: 40 }, PLAZA)).toEqual({ x: 50, y: PLAZA_STAIRS.landingTop });
  });

  it('keeps the feet behind the parapet\'s plate at every column', () => {
    // The plate's base, probed per column: 46.2 at x = 1, 46.7 at x = 4,
    // 47.6 at x = 10, 48.3 at x = 15, 49.3 along the centre run, and its top
    // edge 2.2 below the corridor everywhere (see the parapet test above).
    const plateBase = (x: number) => (Math.min(x, 100 - x) >= 27 ? 49.3 : 46.2 + (Math.min(x, 100 - x) - 1) * (3.1 / 26));
    for (const x of [PLAZA_CORRIDOR.left, 4, 10, 15, 21.8, 35, 65, 78, 90, PLAZA_CORRIDOR.right]) {
      expect(plazaCorridorY(x), `x=${x}`).toBeLessThan(plateBase(x));
    }
    expect(PLAZA_CORRIDOR.y).toBeGreaterThanOrEqual(PLAZA_STAIRS.landingTop);
  });

  it('the upper stand points and the door target are on the line', () => {
    expect(PLAZA_DOOR.walkTarget.y).toBe(PLAZA_CORRIDOR.y);
    for (const store of plazaStorefronts) {
      if (store.standPoint.y < PLAZA_OCCLUSION.railingBase) {
        expect(store.standPoint, store.id).toEqual(plazaCorridorPointAt(store.standPoint.x));
        expect(isOnFloor(store.standPoint, PLAZA), store.id).toBe(true);
      }
    }
  });

  it('leaves the stairs two-dimensional: a click on the flight lands where it was aimed', () => {
    for (const p of [{ x: 50, y: 50 }, { x: 48, y: 60 }, { x: 52, y: 70 }, { x: 50, y: 45 }]) {
      expect(constrainPosition(p, PLAZA)).toEqual(p);
    }
  });

  it('descends the stairs to the ground floor and comes back up', () => {
    // Onto the rug, which is walkable; the fountain below it is not.
    const down = routeAndWalk(PLAZA_INSIDE_SPAWN, { x: 50, y: 84 });
    expect(down.arrived).toBe(true);
    expect(down.offFloor).toEqual([]);
    expect(usedStairs(down.path)).toBe(true);
    const up = routeAndWalk({ x: 50, y: 84 }, PLAZA_INSIDE_SPAWN);
    expect(up.arrived).toBe(true);
    expect(usedStairs(up.path)).toBe(true);
  });
});

describe('the stair rails', () => {
  const size = getBlobbiSizeForLocation('plaza-inside');
  /** Half the rendered rig's width at `y`, in world x-percent (the rig is square). */
  const halfWidthAt = (y: number) =>
    (blobbiHalfHeightPercent(size, resolveBlobbiScale({ x: 50, y }, PLAZA_INSIDE_BACKGROUND, PLAZA)) *
      WORLD_HEIGHT) /
    WORLD_WIDTH;

  it('inset the walkable column from the painted rails on both sides, top and bottom', () => {
    expect(PLAZA_STAIRS.railMargin).toBeGreaterThan(0);
    expect(PLAZA_STAIRS_WALK_TOP[0]).toBe(PLAZA_STAIRS.railsTop[0] + PLAZA_STAIRS.railMargin);
    expect(PLAZA_STAIRS_WALK_TOP[1]).toBe(PLAZA_STAIRS.railsTop[1] - PLAZA_STAIRS.railMargin);
    expect(PLAZA_STAIRS_WALK_BOTTOM[0]).toBe(PLAZA_STAIRS.railsBottom[0] + PLAZA_STAIRS.railMargin);
    expect(PLAZA_STAIRS_WALK_BOTTOM[1]).toBe(PLAZA_STAIRS.railsBottom[1] - PLAZA_STAIRS.railMargin);
  });

  it('keep the painted body off the rails without narrowing the flight by more than the rails themselves', () => {
    // The painted body fills about three quarters of the rig's square box; the
    // margin must cover that half-width wherever the flight is walked, and must
    // not exceed the rig's full half-width (which would be a corridor, not a
    // staircase).
    const BODY_FRACTION = 0.75;
    for (const y of [PLAZA_STAIRS.landingTop, 55, 65, PLAZA_STAIRS.foot]) {
      expect(PLAZA_STAIRS.railMargin, `y=${y}`).toBeGreaterThanOrEqual(halfWidthAt(y) * BODY_FRACTION);
      expect(PLAZA_STAIRS.railMargin, `y=${y}`).toBeLessThanOrEqual(halfWidthAt(y) + 0.5);
    }
  });

  /** The rails' inner faces at height `y`, following the flight as it widens. */
  function railFacesAt(y: number): [number, number] {
    const t = (y - PLAZA_STAIRS.flightTop) / (PLAZA_STAIRS.foot - PLAZA_STAIRS.flightTop);
    const clampedT = Math.max(0, Math.min(1, t));
    return [
      PLAZA_STAIRS.railsTop[0] + (PLAZA_STAIRS.railsBottom[0] - PLAZA_STAIRS.railsTop[0]) * clampedT,
      PLAZA_STAIRS.railsTop[1] + (PLAZA_STAIRS.railsBottom[1] - PLAZA_STAIRS.railsTop[1]) * clampedT,
    ];
  }

  it('a click on a rail is projected inside the column, and the walk never touches the rail', () => {
    // From the flight proper down. Beside the landing (y < 49) the corridor
    // line, one row up, is nearer to the rail than the column is, and a click
    // there lands behind the railing instead, also floor, also off the rail.
    for (const y of [50, 60, 70]) {
      const [left, right] = railFacesAt(y);
      // The nearest floor to a point on the rail is the column's slanted edge,
      // a margin's width inside the rail (a touch less, measured straight
      // across, since the projection is perpendicular to the slant).
      const fromLeft = constrainPosition({ x: left, y }, PLAZA);
      const fromRight = constrainPosition({ x: right, y }, PLAZA);
      expect(isOnFloor(fromLeft, PLAZA), `${left},${y}`).toBe(true);
      expect(isOnFloor(fromRight, PLAZA), `${right},${y}`).toBe(true);
      expect(fromLeft.x - railFacesAt(fromLeft.y)[0], `${left},${y}`).toBeGreaterThanOrEqual(PLAZA_STAIRS.railMargin - 0.1);
      expect(railFacesAt(fromRight.y)[1] - fromRight.x, `${right},${y}`).toBeGreaterThanOrEqual(PLAZA_STAIRS.railMargin - 0.1);
    }
    // Hug the left rail all the way down, then the right rail all the way up.
    const down = routeAndWalk({ x: PLAZA_STAIRS_WALK_TOP[0], y: 47 }, { x: 30, y: 76 });
    const up = routeAndWalk({ x: 70, y: 76 }, { x: PLAZA_STAIRS_WALK_TOP[1], y: 47 });
    for (const p of [...down.path, ...up.path]) {
      if (p.y < PLAZA_STAIRS.foot && p.y > PLAZA_STAIRS.landingTop && p.x > 35 && p.x < 65) {
        const [left, right] = railFacesAt(p.y);
        expect(p.x, `${p.x},${p.y}`).toBeGreaterThanOrEqual(left + PLAZA_STAIRS.railMargin - 1e-6);
        expect(p.x, `${p.x},${p.y}`).toBeLessThanOrEqual(right - PLAZA_STAIRS.railMargin + 1e-6);
      }
    }
  });
});

describe('the depth ramp', () => {
  const scaleAt = (y: number) => resolveBlobbiScale({ x: 50, y }, PLAZA_INSIDE_BACKGROUND, PLAZA);

  it('runs from the frame\'s bottom edge to the landing, with the balcony at the far end', () => {
    // The corridor and the landing are the same depth: same row, same scale.
    expect(scaleAt(PLAZA_CORRIDOR.y)).toBeCloseTo(scaleAt(PLAZA_DOOR.walkTarget.y), 6);
    // Front to back is a clear step down, with no jump anywhere on the flight.
    expect(scaleAt(99.5) / scaleAt(PLAZA_DOOR.walkTarget.y)).toBeGreaterThanOrEqual(1.6);
    let previous = scaleAt(99.5);
    for (let y = 99; y >= PLAZA_STAIRS.landingTop; y -= 0.5) {
      const s = scaleAt(y);
      expect(s).toBeLessThanOrEqual(previous);
      expect(previous - s).toBeLessThan(0.01);
      previous = s;
    }
  });

  it('leaves a Blobbi at the door clearly shorter than the door, and its head above the balcony rail', () => {
    const size = getBlobbiSizeForLocation('plaza-inside');
    const height = 2 * blobbiHalfHeightPercent(size, scaleAt(PLAZA_DOOR.walkTarget.y));
    const door = PLAZA_DOOR.painted.bottom - PLAZA_DOOR.painted.top;
    expect(height / door).toBeLessThan(0.8);
    expect(height / door).toBeGreaterThan(0.6);
    // The top rail runs at y ≈ 41.1 along the centre run of the balcony.
    expect(PLAZA_CORRIDOR.y - height).toBeLessThan(41.1 - 2);
  });

  it('keeps the head above the top rail all the way out along the wings, where the ramp is at its floor', () => {
    const size = getBlobbiSizeForLocation('plaza-inside');
    // The top rail, probed on the overlay: 41.1 along the centre run, 38.8 at
    // x = 19, 37.2 at x = 15, 35.4 at x = 10, 33.8 at x = 6, 32.7 at x = 3.
    const railTop = (x: number) => 41.1 - (0.283 + 0.07) * Math.max(0, 27 - Math.min(x, 100 - x));
    expect(railTop(15)).toBeCloseTo(37.2, 0);
    expect(railTop(3)).toBeCloseTo(32.7, 0);
    for (const x of [PLAZA_CORRIDOR.left, 6, 10, 15, 21.8, 35, 65, 78, 90, PLAZA_CORRIDOR.right]) {
      const feet = plazaCorridorY(x);
      const head = feet - 2 * blobbiHalfHeightPercent(size, scaleAt(feet));
      expect(railTop(x) - head, `x=${x}`).toBeGreaterThan(1);
    }
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

  it('is the room\'s centrepiece: a fifth of the floor wide, centred, with open floor on both sides and in front', () => {
    const plinth = plinthFootprint();
    const { placement } = PLAZA_FOUNTAIN;
    expect(placement.centerX).toBe(50);
    expect(placement.width).toBeGreaterThanOrEqual(20);
    expect(placement.width).toBeLessThanOrEqual(25);
    // A strip of floor in front of the plinth, so the Blobbi can pass in front.
    expect(99.5 - plinth.bottom).toBeGreaterThanOrEqual(2);
    // Two fifths of the floor clear on either side.
    expect(plinth.left).toBeGreaterThanOrEqual(40);
    expect(plinth.right).toBeLessThanOrEqual(60);
  });

  it('the Blobbi passes behind it above the plinth and in front of it below', () => {
    const plinth = plinthFootprint();
    const behind = { x: 50, y: plinth.top - 0.5 };
    const inFront = { x: 50, y: plinth.bottom + 0.5 };
    expect(isOnFloor(behind, PLAZA)).toBe(true);
    expect(isBlocked(behind, BLOCKERS)).toBe(false);
    expect(isOnFloor(inFront, PLAZA)).toBe(true);
    expect(isBlocked(inFront, BLOCKERS)).toBe(false);
    const across = routeAndWalk({ x: 30, y: inFront.y }, { x: 70, y: inFront.y });
    expect(across.arrived).toBe(true);
    expect(across.path.every((p) => p.y >= plinth.bottom)).toBe(true);
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
