/**
 * Route planning against the REAL rooms, not synthetic rectangles.
 *
 * `blobbi-route.test.ts` proves the algorithm on geometry chosen to exercise it.
 * This file asks a different question: does the shipped furniture in the shipped
 * rooms still leave every interactive thing reachable now that a blocked walk
 * goes AROUND rather than stopping?
 *
 * That matters in both directions. Routing turns rooms that were quietly
 * half-broken into working ones — but it can also expose a room whose furniture
 * was only ever passable because the walk gave up politely. So every stand point
 * in the Care Store, the Clothing Store and the Badges Store is checked for a
 * real route from that room's own spawn, and the routes are checked leg by leg
 * for blocker entries and floor departures.
 *
 * No blocker geometry was rewritten to make this pass. If a room needed that, it
 * would be a finding about the room, not a reason to loosen the planner.
 */

import { describe, it, expect } from 'vitest';

import { careStoreBlockers, CARE_STORE_CHECKOUT } from './care-store-config';
import {
  clothingStoreBlockers,
  clothingStoreHotspots,
} from './clothing-store-config';
import {
  BADGES_STORE_CHECKOUT,
  BADGES_STORE_CHECKOUT_BLOCKER,
  badgesStoreBlockers,
  badgesStoreInteractiveObjects,
} from './badges-store-config';
import { locationBoundaries } from './location-boundaries';
import { LOCATION_INITIAL_POSITIONS } from './location-initial-position';
import type { Position } from './types';
import type { Boundary } from './boundaries';
import {
  isBlocked,
  isOnFloor,
  planRoute,
  segmentHitsBlocker,
  segmentStaysOnFloor,
  type RouteBlocker,
} from './blobbi-route';

interface Room {
  name: string;
  boundary: Boundary;
  spawn: Position;
  blockers: RouteBlocker[];
  /** Every point an interaction walks the Blobbi to. */
  standPoints: { id: string; point: Position }[];
}

const ROOMS: Room[] = [
  {
    name: 'Care Store',
    boundary: locationBoundaries['care-store-inside.webp'],
    spawn: LOCATION_INITIAL_POSITIONS['care-store-inside'],
    blockers: careStoreBlockers.map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    })),
    standPoints: [{ id: 'care-store-checkout', point: CARE_STORE_CHECKOUT.standPoint }],
  },
  {
    name: 'Clothing Store',
    boundary: locationBoundaries['clothing-store.webp'],
    spawn: LOCATION_INITIAL_POSITIONS['clothing-store-inside'],
    blockers: clothingStoreBlockers.map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    })),
    standPoints: clothingStoreHotspots.map((hotspot) => ({
      id: hotspot.id,
      point: hotspot.standPoint,
    })),
  },
  {
    name: 'Badges Store',
    boundary: locationBoundaries['badges-store-inside.webp'],
    spawn: LOCATION_INITIAL_POSITIONS['badges-store-inside'],
    blockers: [
      ...badgesStoreBlockers.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      })),
      BADGES_STORE_CHECKOUT_BLOCKER,
    ],
    standPoints: [
      ...badgesStoreInteractiveObjects.map((object) => ({
        id: object.id,
        point: object.interaction!.standPoint,
      })),
      { id: BADGES_STORE_CHECKOUT.id, point: BADGES_STORE_CHECKOUT.standPoint },
    ],
  },
];

/**
 * Walk a planned route leg by leg and report anything it should never do.
 *
 * Geometric, not frame-by-frame: a route is correct or not regardless of how
 * fast it is animated, and an animation snapshot would break on a speed change
 * without telling anyone anything true.
 */
function auditRoute(start: Position, route: Position[], room: Room): string[] {
  const problems: string[] = [];
  let from = start;
  for (const [index, leg] of route.entries()) {
    for (const blocker of room.blockers) {
      if (segmentHitsBlocker(from, leg, blocker)) {
        problems.push(`leg ${index} crosses a blocker`);
      }
    }
    if (!segmentStaysOnFloor(from, leg, room.boundary)) {
      problems.push(`leg ${index} leaves the floor`);
    }
    from = leg;
  }
  return problems;
}

describe.each(ROOMS)('$name', (room) => {
  it('spawns on floor, clear of its own furniture', () => {
    expect(isOnFloor(room.spawn, room.boundary)).toBe(true);
    expect(isBlocked(room.spawn, room.blockers)).toBe(false);
  });

  it('keeps every blocker inside the room', () => {
    for (const blocker of room.blockers) {
      expect(blocker.width).toBeGreaterThan(0);
      expect(blocker.height).toBeGreaterThan(0);
    }
  });

  it('routes from the spawn to every stand point without cheating', () => {
    for (const { id, point } of room.standPoints) {
      const route = planRoute(room.spawn, point, room.boundary, room.blockers);
      expect(route, `${room.name}: no route to ${id}`).not.toBeNull();
      // The caller's destination is never quietly replaced by somewhere easier.
      expect(route![route!.length - 1], id).toEqual(point);
      expect(auditRoute(room.spawn, route!, room), id).toEqual([]);
    }
  });

  it('routes BETWEEN stand points, not just out from the spawn', () => {
    for (const from of room.standPoints) {
      for (const to of room.standPoints) {
        if (from.id === to.id) continue;
        const route = planRoute(from.point, to.point, room.boundary, room.blockers);
        expect(route, `${from.id} → ${to.id}`).not.toBeNull();
        expect(auditRoute(from.point, route!, room), `${from.id} → ${to.id}`).toEqual(
          [],
        );
      }
    }
  });

  it('still refuses to walk into the furniture', () => {
    for (const blocker of room.blockers) {
      const middle = {
        x: blocker.x + blocker.width / 2,
        y: blocker.y + blocker.height / 2,
      };
      expect(planRoute(room.spawn, middle, room.boundary, room.blockers)).toBeNull();
    }
  });
});
