/**
 * Room furniture geometry: every chair's three points agree with each other,
 * with the room's floor, and with the obstacles around it.
 */
import { describe, it, expect } from 'vitest';

import {
  baseFootprint,
  getRoomSeat,
  roomSeatAnchorPosition,
  roomSeatApproachPosition,
  roomSeats,
  roomSeatsFor,
  roomTables,
  roomTablesFor,
  spriteHeightPercent,
  type FurnitureFootprint,
} from './room-seats-config';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import { resolveSeatedRender } from './blobbi-world-render';
import { resolveActorRender } from './blobbi-pose';
import { isBlocked } from './blobbi-route';
import { calculateBlobbiZIndex } from './interactive-elements-config';
import { getBlobbiInitialPosition } from './location-initial-position';
import type { Position } from './types';

const ROOMS = ['shopping-mall-inside.png', 'arcade-minus1.png', 'nostr-station-inside.png'];

function footprintsIn(room: string): FurnitureFootprint[] {
  return [
    ...roomSeatsFor(room).flatMap((seat) => (seat.footprint ? [seat.footprint] : [])),
    ...roomTablesFor(room).map((table) => table.footprint),
  ];
}

function onFloor(point: Position, room: string): boolean {
  const clamped = constrainPosition(point, locationBoundaries[room]);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

describe('sprite geometry', () => {
  it('derives a sprite height from its width and pixel ratio', () => {
    // A square sprite 10% wide over the 1046 × 697 box is 15% tall.
    expect(spriteHeightPercent(10, 100, 100)).toBeCloseTo((104.6 / 697) * 100, 6);
  });

  it('cuts a footprint from the bottom of the box, full width', () => {
    const fp = baseFootprint({ leftPercent: 10, bottomPercent: 5, widthPercent: 8, heightPercent: 20 }, 0.25);
    expect(fp).toEqual({ x: 10, y: 90, width: 8, height: 5 });
  });
});

describe('every room seat', () => {
  it('has a unique id and a unique accessible name', () => {
    expect(new Set(roomSeats.map((s) => s.id)).size).toBe(roomSeats.length);
    expect(new Set(roomSeats.map((s) => s.alt)).size).toBe(roomSeats.length);
    expect(roomSeats.length).toBe(4 + 4 + 4);
  });

  it('keeps its APPROACH on the room floor and out of every obstacle', () => {
    for (const seat of roomSeats) {
      const approach = roomSeatApproachPosition(seat);
      expect(onFloor(approach, seat.room), `${seat.id} approach ${JSON.stringify(approach)}`).toBe(true);
      expect(isBlocked(approach, footprintsIn(seat.room)), `${seat.id} approach is inside furniture`).toBe(false);
    }
  });

  it('keeps its SEAT anchor above its own footprint and inside the sprite box', () => {
    for (const seat of roomSeats) {
      const anchor = roomSeatAnchorPosition(seat);
      const top = 100 - seat.bottomPercent - seat.heightPercent;
      expect(anchor.y).toBeGreaterThan(top);
      expect(anchor.y).toBeLessThan(100 - seat.bottomPercent);
      if (seat.footprint) {
        expect(anchor.y, `${seat.id} anchor must not sit in the legs band`).toBeLessThan(seat.footprint.y);
      }
    }
  });

  it('draws the sitter in front of its own chair and behind the table', () => {
    for (const seat of roomSeats) {
      expect(seat.seatedZIndex).toBeGreaterThan(seat.zIndex);
      for (const table of roomTablesFor(seat.room)) {
        expect(table.zIndex).toBeGreaterThan(seat.seatedZIndex);
      }
    }
  });

  it('resolves through the SAME seated resolver the theater uses (local and remote parity)', () => {
    const seat = getRoomSeat('mall-terrace-1-left-chair')!;
    const seated = resolveSeatedRender(seat.id)!;
    expect(seated.position).toEqual(roomSeatAnchorPosition(seat));
    expect(seated.zIndex).toBe(seat.seatedZIndex);
    expect(seated.facing).toBe('front');
    expect(seated.hideShadow).toBe(true);
    expect(seated.disableFloat).toBe(true);

    const render = resolveActorRender(
      { kind: 'seated', seatId: seat.id },
      { groundPosition: { x: 10, y: 95 }, backgroundFile: seat.room, boundary: locationBoundaries[seat.room] },
    );
    expect(render.seatedIn).toBe(seat.id);
    expect(render.renderPosition).toEqual(seated.position);
    expect(render.zIndex).toBe(seat.seatedZIndex);
  });

  it('refuses unknown ids', () => {
    expect(resolveSeatedRender('mall-terrace-9-left-chair')).toBeNull();
    expect(getRoomSeat(undefined)).toBeUndefined();
  });
});

describe('depth around furniture', () => {
  it('draws a standing Blobbi behind a chair when its feet are above the base, and in front below it', () => {
    for (const seat of roomSeats) {
      if (seat.behindWithin < 1) continue;
      const base = 100 - seat.bottomPercent;
      const top = base - seat.heightPercent;
      const x = seat.leftPercent + seat.widthPercent / 2;
      const behind = calculateBlobbiZIndex((top + base) / 2, seat.room, x);
      const inFront = calculateBlobbiZIndex(base + 0.5, seat.room, x);
      expect(behind, `${seat.id} behind`).toBeLessThan(seat.zIndex);
      expect(inFront, `${seat.id} in front`).toBeGreaterThan(seat.zIndex);
      for (const table of roomTablesFor(seat.room)) {
        expect(inFront, `${seat.id} in front of the table`).toBeGreaterThan(table.zIndex);
      }
    }
  });

  it('keeps a bucket seat\'s front edge in front of the chair (the approach stands in it)', () => {
    const chair = getRoomSeat('nostr-station-chair-1')!;
    const approach = roomSeatApproachPosition(chair);
    expect(calculateBlobbiZIndex(approach.y, chair.room, approach.x)).toBeGreaterThan(chair.zIndex);
    const top = 100 - chair.bottomPercent - chair.heightPercent;
    expect(calculateBlobbiZIndex(top + 2, chair.room, approach.x)).toBeLessThan(chair.zIndex);
  });

  it('never changes the seated z: the sitter is between its chair and its table', () => {
    for (const seat of roomSeats) {
      const seated = resolveSeatedRender(seat.id)!;
      expect(seated.zIndex).toBe(seat.seatedZIndex);
    }
  });

  it('leaves the room band alone outside the furniture span', () => {
    const seat = getRoomSeat('mall-terrace-1-left-chair')!;
    const base = 100 - seat.bottomPercent;
    const outside = calculateBlobbiZIndex(base - 2, seat.room, 20);
    const inside = calculateBlobbiZIndex(base - 2, seat.room, seat.leftPercent + 1);
    expect(inside).toBe(seat.zIndex - 1);
    expect(outside).not.toBe(seat.zIndex - 1);
  });
});

describe('tables', () => {
  it('stand between their two chairs on the same floor line', () => {
    for (const table of roomTables) {
      const [left, right] = roomSeatsFor(table.room).filter((s) => s.id.startsWith(table.id.replace(/-table$/, '')));
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      expect(table.leftPercent).toBeGreaterThan(left.leftPercent);
      expect(table.leftPercent + table.widthPercent).toBeLessThan(right.leftPercent + right.widthPercent);
      expect(Math.abs(table.bottomPercent - left.bottomPercent)).toBeLessThan(1);
    }
  });

  it('keeps their footprint inside the walk boundary, so the planner can route round it', () => {
    for (const table of roomTables) {
      const fp = table.footprint;
      const centre = { x: fp.x + fp.width / 2, y: fp.y + fp.height / 2 };
      expect(onFloor(centre, table.room), table.id).toBe(true);
    }
  });
});

describe('room spawns', () => {
  it.each(ROOMS)('%s spawns outside every piece of furniture', (room) => {
    const location = room === 'shopping-mall-inside.png' ? 'shop' : room === 'arcade-minus1.png' ? 'arcade-minus1' : 'nostr-station-inside';
    const spawn = getBlobbiInitialPosition(location);
    expect(isBlocked(spawn, footprintsIn(room)), `${location} spawn ${JSON.stringify(spawn)}`).toBe(false);
  });
});
