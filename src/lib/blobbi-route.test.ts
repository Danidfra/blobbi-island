/**
 * Route planning around room furniture.
 *
 * These are GEOMETRIC tests, not animation snapshots. The planner is pure,
 * positions in, waypoints out, so what is asserted is what a route must be
 * true of: it never enters a blocker, it never leaves the floor, it ends at the
 * destination the caller asked for, and it terminates.
 *
 * A route is checked by walking it the way the movement loop does, in small
 * steps, rather than by comparing it to an expected list of corners. Pinning
 * the exact corners would make every clearance tweak a test failure while
 * proving nothing about whether the Blobbi gets through.
 */

import { describe, it, expect } from 'vitest';

import type { Boundary } from './boundaries';
import type { Position } from './types';
import {
  firstBlockerOnSegment,
  isBlocked,
  planRoute,
  routeLengthPx,
  segmentHitsBlocker,
  segmentStaysOnFloor,
  type RouteBlocker,
} from './blobbi-route';

/** A plain open room, so a test's geometry is only what it declares. */
const OPEN_ROOM: Boundary = { shape: 'rectangle', x: [0, 100], y: [0, 100] };

/** Walk a route in small steps and report every rule it breaks. */
function auditRoute(
  start: Position,
  route: readonly Position[],
  boundary: Boundary,
  blockers: readonly RouteBlocker[],
): string[] {
  const problems: string[] = [];
  let from = start;
  for (const leg of route) {
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point = { x: from.x + (leg.x - from.x) * t, y: from.y + (leg.y - from.y) * t };
      if (isBlocked(point, blockers)) {
        problems.push(`enters a blocker at (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
        break;
      }
    }
    if (!segmentStaysOnFloor(from, leg, boundary)) {
      problems.push(`leaves the floor between (${from.x}, ${from.y}) and (${leg.x}, ${leg.y})`);
    }
    from = leg;
  }
  return problems;
}

function expectValidRoute(
  start: Position,
  target: Position,
  boundary: Boundary,
  blockers: readonly RouteBlocker[],
): Position[] {
  const route = planRoute(start, target, boundary, blockers);
  expect(route, 'a route should exist').not.toBeNull();
  expect(auditRoute(start, route!, boundary, blockers)).toEqual([]);
  // The caller's destination is never quietly swapped for somewhere easier.
  expect(route![route!.length - 1]).toEqual(target);
  return route!;
}

describe('segment geometry', () => {
  const box: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };

  it('detects a crossing, including one that steps clean over a thin blocker', () => {
    expect(segmentHitsBlocker({ x: 0, y: 50 }, { x: 100, y: 50 }, box)).toBe(true);
    // A fast frame can hop a 2 %-deep footprint entirely; a sampled test would
    // call this clear, which is why the check is analytic.
    const thin: RouteBlocker = { x: 40, y: 49.5, width: 20, height: 1 };
    expect(segmentHitsBlocker({ x: 50, y: 45 }, { x: 50, y: 55 }, thin)).toBe(true);
  });

  it('does not invent crossings for lines that pass by', () => {
    expect(segmentHitsBlocker({ x: 0, y: 10 }, { x: 100, y: 10 }, box)).toBe(false);
    expect(segmentHitsBlocker({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(false);
  });

  it('counts a segment that starts or ends inside', () => {
    expect(segmentHitsBlocker({ x: 50, y: 50 }, { x: 90, y: 90 }, box)).toBe(true);
    expect(segmentHitsBlocker({ x: 90, y: 90 }, { x: 50, y: 50 }, box)).toBe(true);
  });

  it('picks the blocker the walk meets first', () => {
    const near: RouteBlocker = { x: 20, y: 45, width: 5, height: 10 };
    const far: RouteBlocker = { x: 70, y: 45, width: 5, height: 10 };
    expect(firstBlockerOnSegment({ x: 0, y: 50 }, { x: 100, y: 50 }, [far, near])).toBe(
      near,
    );
  });
});

describe('an unobstructed walk is unchanged', () => {
  it('returns the target and nothing else', () => {
    expect(planRoute({ x: 10, y: 10 }, { x: 90, y: 90 }, OPEN_ROOM, [])).toEqual([
      { x: 90, y: 90 },
    ]);
  });

  it('is unchanged by blockers that are not in the way', () => {
    const aside: RouteBlocker = { x: 0, y: 80, width: 10, height: 10 };
    expect(planRoute({ x: 20, y: 20 }, { x: 80, y: 20 }, OPEN_ROOM, [aside])).toEqual([
      { x: 80, y: 20 },
    ]);
  });
});

describe('one blocker between start and target', () => {
  const shelf: RouteBlocker = { x: 40, y: 30, width: 20, height: 40 };

  it('produces a detour that reaches the target without entering it', () => {
    const route = expectValidRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf]);
    expect(route.length).toBeGreaterThan(1);
  });

  it('goes round the near side rather than the long way', () => {
    // The target sits below the shelf's centre line, so the bottom is shorter.
    const route = expectValidRoute({ x: 10, y: 65 }, { x: 90, y: 68 }, OPEN_ROOM, [shelf]);
    expect(route[0].y).toBeGreaterThan(shelf.y + shelf.height / 2);
  });

  it('reaches floor directly BEHIND the blocker, the case that used to fail', () => {
    // A click just past a display: the straight line hits it, a route exists.
    const route = expectValidRoute({ x: 50, y: 85 }, { x: 50, y: 20 }, OPEN_ROOM, [shelf]);
    expect(route.length).toBeGreaterThan(1);
  });

  it('never returns a route longer than a sane way round', () => {
    const route = planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf])!;
    // Straight line is ~837 design px; a detour round a 40 %-tall shelf should
    // not cost more than roughly double that.
    expect(routeLengthPx({ x: 10, y: 50 }, route)).toBeLessThan(1800);
  });
});

describe('choosing a side', () => {
  it('rejects the side that would leave the room', () => {
    // A shelf hard against the left wall: only the right-hand way round is on
    // the floor at all.
    const room: Boundary = { shape: 'rectangle', x: [10, 90], y: [10, 90] };
    const wallShelf: RouteBlocker = { x: 0, y: 40, width: 30, height: 20 };

    const route = expectValidRoute({ x: 15, y: 20 }, { x: 15, y: 80 }, room, [wallShelf]);
    // Every waypoint is inside the room, so the impossible left side was not
    // chosen: the audit above already proves it never leaves the floor.
    for (const point of route) {
      expect(point.x).toBeGreaterThanOrEqual(10);
      expect(point.x).toBeLessThanOrEqual(90);
    }
    expect(route[0].x).toBeGreaterThan(wallShelf.x + wallShelf.width);
  });

  it('keeps a clearance margin instead of grazing the corner', () => {
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    const route = planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf])!;
    const corner = route[0];
    // Strictly outside the rectangle, not sitting on its edge, grazing is what
    // made the walk stall for a frame and read as scraping the furniture.
    expect(isBlocked(corner, [shelf])).toBe(false);
    const outside =
      corner.x < shelf.x ||
      corner.x > shelf.x + shelf.width ||
      corner.y < shelf.y ||
      corner.y > shelf.y + shelf.height;
    expect(outside).toBe(true);
  });
});

describe('more than one blocker', () => {
  it('navigates between two separated obstacles', () => {
    const left: RouteBlocker = { x: 30, y: 30, width: 10, height: 40 };
    const right: RouteBlocker = { x: 60, y: 30, width: 10, height: 40 };
    expectValidRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [left, right]);
  });

  it('navigates a second obstacle met on the detour leg', () => {
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    const stand: RouteBlocker = { x: 40, y: 66, width: 20, height: 6 };
    expectValidRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf, stand]);
  });

  it('routes round a room full of real-shaped furniture', () => {
    // Shallow feet-only footprints, the shape every shop room now uses.
    const room: Boundary = { shape: 'rectangle', x: [3, 96], y: [63, 99] };
    const furniture: RouteBlocker[] = [
      { x: 40, y: 59, width: 18, height: 5 },
      { x: 12, y: 78, width: 18, height: 3 },
      { x: 70, y: 78, width: 18, height: 3 },
    ];
    expectValidRoute({ x: 50, y: 95 }, { x: 20, y: 70 }, room, furniture);
    expectValidRoute({ x: 50, y: 95 }, { x: 79, y: 70 }, room, furniture);
  });
});

describe('when there is no way through', () => {
  it('returns null for a wall the room cannot get round', () => {
    const wall: RouteBlocker = { x: 45, y: -10, width: 10, height: 120 };
    expect(planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [wall])).toBeNull();
  });

  it('returns null for a fully enclosed destination', () => {
    const enclosure: RouteBlocker[] = [
      { x: 40, y: 40, width: 20, height: 3 },
      { x: 40, y: 57, width: 20, height: 3 },
      { x: 40, y: 40, width: 3, height: 20 },
      { x: 57, y: 40, width: 3, height: 20 },
    ];
    expect(planRoute({ x: 10, y: 50 }, { x: 50, y: 50 }, OPEN_ROOM, enclosure)).toBeNull();
  });

  it('refuses a destination inside the furniture', () => {
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    expect(planRoute({ x: 10, y: 50 }, { x: 50, y: 50 }, OPEN_ROOM, [shelf])).toBeNull();
    // …including exactly on its edge, which is where the blocker context's own
    // inclusive test would already have stopped the walk.
    expect(planRoute({ x: 10, y: 50 }, { x: 40, y: 50 }, OPEN_ROOM, [shelf])).toBeNull();
  });

  it('refuses a destination off the floor', () => {
    const room: Boundary = { shape: 'rectangle', x: [10, 90], y: [10, 90] };
    expect(planRoute({ x: 50, y: 50 }, { x: 50, y: 200 }, room, [])).toBeNull();
  });

  it('terminates: it does not search forever', () => {
    // A maze the bounded planner cannot solve. If depth were unbounded this
    // would hang rather than fail.
    const maze: RouteBlocker[] = Array.from({ length: 9 }, (_, i) => ({
      x: 10 + i * 9,
      y: i % 2 === 0 ? 0 : 20,
      width: 4,
      height: 80,
    }));
    const started = Date.now();
    expect(planRoute({ x: 5, y: 50 }, { x: 95, y: 50 }, OPEN_ROOM, maze)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('the planner is deterministic', () => {
  it('gives the same route for the same inputs', () => {
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    const once = planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf]);
    const twice = planRoute({ x: 10, y: 50 }, { x: 90, y: 50 }, OPEN_ROOM, [shelf]);
    expect(once).toEqual(twice);
  });

  it('does not emit duplicate or zero-length legs', () => {
    const shelf: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };
    const start = { x: 10, y: 50 };
    const route = planRoute(start, { x: 90, y: 50 }, OPEN_ROOM, [shelf])!;
    let from = start;
    for (const leg of route) {
      // A zero-length leg is how a walk sits still and re-plans forever.
      expect(from).not.toEqual(leg);
      from = leg;
    }
  });
});
