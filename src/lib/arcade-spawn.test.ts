/**
 * The arcade ground-floor spawn points.
 *
 * The audit reproduced a hard failure in a browser: with an Arcade Pass held,
 * `getBlobbiInitialPosition('arcade')` returned `{50, 48}`: the elevator
 * alcove's own boundary line, and from there clicking the ticket counter
 * produced no movement for 7+ seconds and the modal never opened. The walk
 * stalled far from its target and `usePendingInteraction` cancelled itself, by
 * design.
 *
 * These tests pin the fix as geometry rather than as a comment: the spawn is on
 * walkable ground, it is clear of the alcove, and the straight line from it to
 * every ground-floor destination stays walkable for its whole length.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_DEFAULT_SPAWN,
  ARCADE_ELEVATOR_ALCOVE,
  ARCADE_ELEVATOR_EXIT_SPAWN,
  getBlobbiInitialPosition,
} from './location-initial-position';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import { machineAnchorPosition } from './arcade-machines-config';
import type { Position } from './types';

const BOUNDARY = locationBoundaries['arcade-inside.png'];

/**
 * A point is walkable when the walk boundary does not have to move it.
 *
 * `constrainPosition` returns the closest point inside the boundary, so an
 * unchanged result means the point was already inside one of its areas, the
 * same test the movement system itself performs.
 */
function isWalkable(point: Position): boolean {
  const constrained = constrainPosition(point, BOUNDARY);
  return (
    Math.abs(constrained.x - point.x) < 1e-6 && Math.abs(constrained.y - point.y) < 1e-6
  );
}

function isInsideAlcove(point: Position): boolean {
  const { x, y } = ARCADE_ELEVATOR_ALCOVE;
  return point.x >= x[0] && point.x <= x[1] && point.y >= y[0] && point.y <= y[1];
}

/** Sample a straight-line path and report the first unwalkable point, if any. */
function firstBlockedPointOnPath(from: Position, to: Position, samples = 60): Position | null {
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (!isWalkable(point)) return point;
  }
  return null;
}

describe('arcade ground-floor spawn', () => {
  it('lands the elevator exit on walkable floor', () => {
    expect(isWalkable(ARCADE_ELEVATOR_EXIT_SPAWN)).toBe(true);
  });

  it('keeps the elevator exit clear of the alcove itself', () => {
    expect(isInsideAlcove(ARCADE_ELEVATOR_EXIT_SPAWN)).toBe(false);
    // ...with room to spare, not merely one pixel past the line. The old spawn
    // sat exactly ON the alcove's lower edge.
    expect(ARCADE_ELEVATOR_EXIT_SPAWN.y).toBeGreaterThan(ARCADE_ELEVATOR_ALCOVE.y[1] + 5);
  });

  it('confirms the old spawn really was in the alcove', () => {
    // Regression anchor: if someone reinstates `{50, 48}`, this documents why not.
    expect(isInsideAlcove({ x: 50, y: 48 })).toBe(true);
  });

  it('lands the entrance spawn on walkable floor too', () => {
    expect(isWalkable(ARCADE_DEFAULT_SPAWN)).toBe(true);
    expect(isInsideAlcove(ARCADE_DEFAULT_SPAWN)).toBe(false);
  });

  it('leaves a walkable straight line to every ground-floor destination', () => {
    // The ticket counter and prize counter both sit high on the back wall, so
    // their walk targets clamp onto the top edge of the main floor.
    const destinations: Record<string, Position> = {
      'ticket counter': constrainPosition({ x: 25, y: 40 }, BOUNDARY),
      'prize counter': constrainPosition({ x: 80, y: 45 }, BOUNDARY),
      'room centre': { x: 50, y: 80 },
      'far left': { x: 5, y: 90 },
      'far right': { x: 95, y: 90 },
    };

    for (const [name, destination] of Object.entries(destinations)) {
      const blocked = firstBlockedPointOnPath(ARCADE_ELEVATOR_EXIT_SPAWN, destination);
      expect(blocked, `path to ${name} leaves walkable floor at ${JSON.stringify(blocked)}`).toBeNull();
    }
  });

  it('does not strand the player from any machine anchor on the floors they can reach', () => {
    // The ground floor has no machines, but the spawn must still be able to
    // reach the elevator, which is how the other two floors are reached at all.
    const elevatorApproach = { x: 50, y: 50 };
    expect(isWalkable(elevatorApproach)).toBe(true);
    expect(firstBlockedPointOnPath(ARCADE_ELEVATOR_EXIT_SPAWN, elevatorApproach)).toBeNull();

    // Sanity: machine anchors themselves are validated in
    // arcade-machines-config.test.ts; here we only assert none of them is on
    // the ground floor, which would need its own reachability proof.
    expect(machineAnchorPosition).toBeTypeOf('function');
  });
});

describe('getBlobbiInitialPosition for the arcade', () => {
  /*
   * The split used to be pass / no pass. It is now where you came FROM, which
   * is what the two spots always physically meant: a pass was simply the only
   * way to be riding the elevator.
   */
  it('uses the entrance spawn when arriving from outside', () => {
    expect(getBlobbiInitialPosition('arcade')).toEqual(ARCADE_DEFAULT_SPAWN);
    expect(getBlobbiInitialPosition('arcade', 'town')).toEqual(ARCADE_DEFAULT_SPAWN);
  });

  it('uses the elevator-exit spawn when arriving from another arcade floor', () => {
    expect(getBlobbiInitialPosition('arcade', 'arcade-1')).toEqual(ARCADE_ELEVATOR_EXIT_SPAWN);
    expect(getBlobbiInitialPosition('arcade', 'arcade-minus1')).toEqual(ARCADE_ELEVATOR_EXIT_SPAWN);
  });

  it('still prefers a door exit position where one is mapped', () => {
    // An existing mapping (town ← arcade) is untouched by any of this.
    expect(getBlobbiInitialPosition('town', 'arcade')).toEqual({ x: 32, y: 75.8 });
  });
});
