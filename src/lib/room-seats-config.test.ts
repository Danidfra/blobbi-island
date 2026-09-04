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

describe('Nostr Station VR chairs', () => {
  const chairs = roomSeatsFor('nostr-station-inside.png');
  // Lines measured on `chair.png` (fractions of the sprite height), see the
  // table above `stationChair` in room-seats-config.ts.
  const PAD_FRONT_SEAM = 0.615;
  const CUP_RIM = 0.73;
  // The visible body ends this far above the anchor: the empty bottom of the
  // renderer box, scaled to this room's `lg` box and depth ramp, over the
  // chair's height. (96 px × ~1.32 × 12 % ≈ 15 px ≈ 2.2 % of 697; the chair is
  // 27.4 % tall.)
  const BODY_GAP_OF_CHAIR = 0.08;
  // The visible body's height over the chair's height: the body spans ~75 %
  // of the box (baby 12.5–88 %), and the box is ~0.66 of the chair.
  const BODY_HEIGHT_OF_CHAIR = 0.5;
  // The body spans this share of the box above its bottom edge (12.5–88 %).
  const BODY_TOP_OF_BOX = 0.125;

  it('has four chairs that share one seat-contact configuration', () => {
    expect(chairs).toHaveLength(4);
    const first = chairs[0];
    for (const chair of chairs) {
      expect(chair.seatContact).toEqual(first.seatContact);
      expect(chair.approach).toEqual(first.approach);
      expect(chair.seatedScale).toBe(1);
      expect(chair.seatedAccessory).toBe('vr-headset');
      expect(chair.bottomPercent).toBe(first.bottomPercent);
      expect(chair.widthPercent).toBe(first.widthPercent);
    }
  });

  it('pins the visible body bottom inside the cup: below the cushion lip, above the rim', () => {
    for (const chair of chairs) {
      const bodyBottom = chair.seatContact.y - BODY_GAP_OF_CHAIR;
      expect(bodyBottom, chair.id).toBeGreaterThan(PAD_FRONT_SEAM);
      expect(bodyBottom, chair.id).toBeLessThan(CUP_RIM);
      // Never through the pedestal or the floor.
      expect(chair.seatContact.y, chair.id).toBeLessThan(0.8);
    }
  });

  it('paints NOTHING over the sitter: the entire Blobbi stays visible in a VR chair', () => {
    // The explicit requirement: full visibility beats realistic occlusion.
    for (const chair of chairs) {
      expect(chair.foregroundFrom, chair.id).toBeUndefined();
      // The sitter is drawn above the whole chair sprite.
      expect(chair.seatedZIndex, chair.id).toBeGreaterThan(chair.zIndex);
    }
  });

  it('the seated body lies entirely within the chair sprite\'s box, so the room clips none of it', () => {
    for (const chair of chairs) {
      const bodyBottom = chair.seatContact.y - BODY_GAP_OF_CHAIR;
      // The box is ~0.66 of the chair; the body's top is 12.5 % of the box below the box top.
      const boxTop = chair.seatContact.y - 0.66;
      const bodyTop = boxTop + 0.66 * BODY_TOP_OF_BOX;
      expect(bodyTop, chair.id).toBeGreaterThanOrEqual(0);
      expect(bodyBottom, chair.id).toBeLessThanOrEqual(1);
      expect(bodyBottom - bodyTop, chair.id).toBeCloseTo(BODY_HEIGHT_OF_CHAIR, 1);
    }
  });

  it('centres the body on the chair and its corridor', () => {
    const boundary = locationBoundaries['nostr-station-inside.png'];
    for (const chair of chairs) {
      const anchor = roomSeatAnchorPosition(chair);
      const chairCentre = chair.leftPercent + chair.widthPercent / 2;
      expect(anchor.x, chair.id).toBeCloseTo(chairCentre, 6);
      // The corridor the boundary carves into this chair is centred on it too,
      // so a seated body and a walking body share one column.
      const approach = roomSeatApproachPosition(chair, boundary);
      expect(approach.x, chair.id).toBeCloseTo(chairCentre, 6);
    }
  });

  it('keeps the approach on the corridor floor, in front of the seat anchor, and routeable', () => {
    for (const chair of chairs) {
      const approach = roomSeatApproachPosition(chair);
      const anchor = roomSeatAnchorPosition(chair);
      expect(onFloor(approach, chair.room), chair.id).toBe(true);
      expect(approach.y, chair.id).toBeGreaterThan(anchor.y);
      expect(isBlocked(approach, footprintsIn(chair.room)), chair.id).toBe(false);
    }
  });

  it('renders the seated Blobbi over the chair, and under the room\'s front-floor band', () => {
    for (const chair of chairs) {
      const seated = resolveSeatedRender(chair.id)!;
      expect(seated.zIndex).toBeGreaterThan(chair.zIndex);
      // The sitter must stay below the room's front-floor band (20) so a
      // Blobbi walking past in front of the chairs is still drawn over them.
      expect(seated.zIndex).toBeLessThan(20);
    }
  });

  it('the headset is a consequence of the seat, and only of these seats', () => {
    for (const chair of chairs) {
      expect(resolveSeatedRender(chair.id)!.accessory).toBe('vr-headset');
    }
    for (const seat of roomSeats.filter((s) => s.room !== 'nostr-station-inside.png')) {
      expect(resolveSeatedRender(seat.id)!.accessory, seat.id).toBeNull();
      expect(seat.foregroundFrom, seat.id).toBeUndefined();
    }
  });
});
