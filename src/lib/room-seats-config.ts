/**
 * Room furniture: the chairs and tables a Blobbi can walk around and sit on
 * outside the theater, one configuration for every room that has any.
 *
 * ## Three different points per chair
 *
 * A chair is not one place. It is:
 *
 *  - an OBSTACLE: the floor band its legs stand on (`footprint`), registered
 *    as a movement blocker so the route planner walks round it;
 *  - an APPROACH: the ground point the walk ends on (`approach`, a fraction
 *    of the sprite box, normally just below its base), always outside the
 *    footprint and clamped into the room's walk boundary;
 *  - a SEAT: the pose anchor the body is pinned to while seated
 *    (`seatContact`, the fraction of the sprite box where the body's bottom
 *    meets the cushion), which may be on the furniture, because furniture is
 *    not floor.
 *
 * The three used to be one number (a `{50, 85}` fraction the feet aimed at),
 * so the Blobbi stood on the chair instead of sitting in it, and nothing
 * stopped anyone walking through the table. The theater keeps its own
 * config (`theater-seats-config.ts`); this one covers the rooms whose chairs
 * are drawn from the front.
 *
 * Every value is world percent over the 1046 × 697 design box, DOM-free, so
 * every client and every test computes the same anchors.
 */

import type { BlobbiRenderSize } from '@blobbi/react';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import type { Position } from '@/lib/types';
import { WORLD_HEIGHT, WORLD_WIDTH } from '@/lib/world-coordinates';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface FurnitureFootprint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Placement of a sprite whose width is set and whose height follows the art. */
export interface SpriteBox {
  readonly leftPercent: number;
  readonly bottomPercent: number;
  readonly widthPercent: number;
  /** Derived from the artwork's intrinsic ratio; never set by hand. */
  readonly heightPercent: number;
}

/**
 * A presentation-only prop a seated Blobbi wears while it is in this chair.
 * It is not equipment: it is never published, never in the inventory, never
 * a placement, and it disappears the moment the Blobbi stands up.
 */
export type SeatedAccessory = 'vr-headset';

export interface RoomSeatConfig extends SpriteBox {
  readonly id: string;
  /** The background file of the room this seat lives in. */
  readonly room: string;
  readonly src: string;
  readonly alt: string;
  /** Stacking order of the chair sprite. */
  readonly zIndex: number;
  /**
   * Stacking order of a seated Blobbi. These chairs are drawn from the front,
   * so the sitter is IN FRONT of the chair and behind whatever the room puts
   * in front of the chair (a table).
   */
  readonly seatedZIndex: number;
  /** Where the walk ends: fraction of the sprite box, ground semantics. */
  readonly approach: { readonly x: number; readonly y: number };
  /** Where the seated body's bottom lands: fraction of the sprite box. */
  readonly seatContact: { readonly x: number; readonly y: number };
  readonly seatedScale: number;
  readonly facing: 'front' | 'back';
  /** The room's Blobbi size token, for documentation and tests. */
  readonly size: BlobbiRenderSize;
  /** The floor band the chair stands on. Absent when the boundary already keeps the Blobbi out. */
  readonly footprint?: FurnitureFootprint;
  /**
   * How far down the sprite box (as a fraction of its height) a standing
   * Blobbi's feet may be and still count as BEHIND the chair. `1` means the
   * whole box: feet anywhere above the chair's base are behind it. A deep
   * bucket seat uses its cushion line instead, so a Blobbi standing at the
   * chair's front edge (the approach) is drawn in front of it.
   */
  readonly behindWithin: number;
  /**
   * A deep bucket seat wraps round the sitter: the part of the chair from
   * this fraction of the sprite box DOWN (the cushion's front face, the cup,
   * the pedestal) is drawn again IN FRONT of a seated Blobbi, so the body sinks
   * into the seat instead of perching on its lip. Absent for chairs drawn
   * entirely behind the sitter (the terrace and basement chairs, whose tables
   * do that job). Only painted while this seat is occupied: a standing Blobbi
   * at the chair's front edge must not vanish behind its own chair's pedestal.
   */
  readonly foregroundFrom?: number;
  /** What a seated Blobbi wears here, if anything. Presentation only. */
  readonly seatedAccessory?: SeatedAccessory;
}

export interface RoomTableConfig extends SpriteBox {
  readonly id: string;
  readonly room: string;
  readonly src: string;
  readonly zIndex: number;
  readonly footprint: FurnitureFootprint;
}

// ── Geometry helpers ────────────────────────────────────────────────────────

/** Height in world percent of a sprite `widthPercent` wide with pixel ratio `w × h`. */
export function spriteHeightPercent(widthPercent: number, pixelWidth: number, pixelHeight: number): number {
  const widthPx = (widthPercent / 100) * WORLD_WIDTH;
  const heightPx = widthPx * (pixelHeight / pixelWidth);
  return (heightPx / WORLD_HEIGHT) * 100;
}

/** The band of floor under a sprite: its lowest `fraction` of height, full width. */
export function baseFootprint(box: SpriteBox, fraction: number): FurnitureFootprint {
  const height = box.heightPercent * fraction;
  return {
    x: box.leftPercent,
    y: 100 - box.bottomPercent - height,
    width: box.widthPercent,
    height,
  };
}

function boxTop(box: SpriteBox): number {
  return 100 - box.bottomPercent - box.heightPercent;
}

function fractionPoint(box: SpriteBox, fraction: { x: number; y: number }): Position {
  return {
    x: box.leftPercent + box.widthPercent * fraction.x,
    y: boxTop(box) + box.heightPercent * fraction.y,
  };
}

/** The seated POSE anchor: where the body's bottom rests on the cushion. */
export function roomSeatAnchorPosition(seat: RoomSeatConfig): Position {
  return fractionPoint(seat, seat.seatContact);
}

/**
 * DOM-free mirror of the runtime approach target: the ground point in front
 * of the chair, clamped into the room's walk boundary.
 */
export function roomSeatApproachPosition(seat: RoomSeatConfig, boundary?: Boundary): Position {
  const raw = fractionPoint(seat, seat.approach);
  const clampInto = boundary ?? locationBoundaries[seat.room];
  return clampInto ? constrainPosition(raw, clampInto) : raw;
}

// ── The rooms ───────────────────────────────────────────────────────────────

const SHOP = '/assets/locations/shop';
const B1 = '/assets/locations/arcade/level-b1';
const STATION = '/assets/locations/nostr-station';

/** Sprite pixel sizes, measured from the files. */
const ART = {
  shopChair: { w: 58, h: 92 },
  shopTable: { w: 88, h: 81 },
  b1Chair: { w: 178, h: 278 },
  b1Table: { w: 265, h: 255 },
  stationChair: { w: 171, h: 260 },
} as const;

/** Chair legs: the lowest fifth of the sprite is what stands on the floor. */
const CHAIR_FOOTPRINT_FRACTION = 0.2;
/** A table's base plate: its lowest quarter. */
const TABLE_FOOTPRINT_FRACTION = 0.25;
/** Just below the chair's base: the feet stop on the floor in front of it. */
const FRONT_CHAIR_APPROACH = { x: 0.5, y: 1.03 } as const;

function box(leftPercent: number, bottomPercent: number, widthPercent: number, art: { w: number; h: number }): SpriteBox {
  return { leftPercent, bottomPercent, widthPercent, heightPercent: spriteHeightPercent(widthPercent, art.w, art.h) };
}

interface ClusterSpec {
  readonly room: string;
  readonly idPrefix: string;
  readonly altPrefix: string;
  readonly chairArt: { w: number; h: number };
  readonly tableArt: { w: number; h: number };
  readonly chairSrc: { left: string; right: string };
  readonly tableSrc: string;
  readonly chairWidth: number;
  readonly tableWidth: number;
  readonly chairZ: number;
  readonly seatContact: { x: number; y: number };
  readonly seatedScale: number;
  readonly size: BlobbiRenderSize;
}

/**
 * A table with a chair on each side, all standing on one floor line. The
 * table is drawn in front of both chairs and of a seated Blobbi.
 */
function cluster(
  spec: ClusterSpec,
  index: number,
  placement: { leftChairX: number; tableX: number; rightChairX: number; bottom: number; tableBottom: number },
): { seats: RoomSeatConfig[]; table: RoomTableConfig } {
  const seat = (side: 'left' | 'right', x: number): RoomSeatConfig => {
    const sprite = box(x, placement.bottom, spec.chairWidth, spec.chairArt);
    return {
      id: `${spec.idPrefix}-${index}-${side}-chair`,
      room: spec.room,
      src: spec.chairSrc[side],
      alt: `${spec.altPrefix} ${index}, ${side} chair`,
      ...sprite,
      zIndex: spec.chairZ,
      seatedZIndex: spec.chairZ + 1,
      approach: FRONT_CHAIR_APPROACH,
      seatContact: spec.seatContact,
      seatedScale: spec.seatedScale,
      facing: 'front',
      size: spec.size,
      footprint: baseFootprint(sprite, CHAIR_FOOTPRINT_FRACTION),
      behindWithin: 1,
    };
  };
  const tableBox = box(placement.tableX, placement.tableBottom, spec.tableWidth, spec.tableArt);
  return {
    seats: [seat('left', placement.leftChairX), seat('right', placement.rightChairX)],
    table: {
      id: `${spec.idPrefix}-${index}-table`,
      room: spec.room,
      src: spec.tableSrc,
      ...tableBox,
      zIndex: spec.chairZ + 2,
      footprint: baseFootprint(tableBox, TABLE_FOOTPRINT_FRACTION),
    },
  };
}

/**
 * The mall's coffee-shop terrace: two tables on the ground floor band
 * (y 90.6–100). Positions are the ones the old flex groups rendered at,
 * shifted so the room's spawn (x = 56) lands between the two clusters
 * instead of on the first table.
 */
const MALL: ClusterSpec = {
  room: 'shopping-mall-inside.png',
  idPrefix: 'mall-terrace',
  altPrefix: 'Shop table',
  chairArt: ART.shopChair,
  tableArt: ART.shopTable,
  chairSrc: { left: `${SHOP}/left-chair.png`, right: `${SHOP}/right-chair.png` },
  tableSrc: `${SHOP}/table.png`,
  chairWidth: 5.8,
  tableWidth: 8.2,
  chairZ: 27,
  // The cushion sits a little past the middle of this small chair.
  seatContact: { x: 0.5, y: 0.68 },
  seatedScale: 0.85,
  size: 'lg',
};

const mallClusters = [
  cluster(MALL, 1, { leftChairX: 35.5, tableX: 39.6, rightChairX: 46.2, bottom: 3, tableBottom: 2.7 }),
  cluster(MALL, 2, { leftChairX: 61.5, tableX: 65.6, rightChairX: 72.2, bottom: 3, tableBottom: 2.7 }),
];

/**
 * The arcade basement: two clusters facing the karaoke stage, in the lower
 * side bands of the floor (x 26.5–42 and 58–73.5, y 75.7–89.5). The old
 * markup absolutely positioned both chairs of a cluster at nearly the same
 * x, so they overlapped, floating above the table.
 */
const BASEMENT: ClusterSpec = {
  room: 'arcade-minus1.png',
  idPrefix: 'arcade-b1-table',
  altPrefix: 'Table',
  chairArt: ART.b1Chair,
  tableArt: ART.b1Table,
  chairSrc: { left: `${B1}/left-chair.png`, right: `${B1}/right-chair.png` },
  tableSrc: `${B1}/table.png`,
  chairWidth: 6.6,
  tableWidth: 7.3,
  chairZ: 25,
  seatContact: { x: 0.5, y: 0.66 },
  seatedScale: 0.85,
  size: 'lg',
};

const basementClusters = [
  cluster(BASEMENT, 1, { leftChairX: 26.5, tableX: 31, rightChairX: 35.4, bottom: 14, tableBottom: 13.5 }),
  cluster(BASEMENT, 2, { leftChairX: 58, tableX: 62.5, rightChairX: 66.9, bottom: 14, tableBottom: 13.5 }),
];

/**
 * The Nostr Station's four VR gaming chairs. The room's walk boundary carves a
 * corridor into each chair (x 20–26, 33–39, 61–67, 74–80), which is what
 * keeps the Blobbi out of the chair bodies, so these carry no footprint;
 * the approach lands in the corridor and the seat anchor sits inside it.
 *
 * ## Seat contact, measured on `chair.png` (171 × 260)
 *
 * Fractions of the sprite's height, read off the artwork's alpha and seams:
 *
 *  | line                                   | fraction |
 *  | -------------------------------------- | -------- |
 *  | cushion pad, rear seam (meets backrest)| 0.56     |
 *  | cushion pad, front seam (the lip)      | 0.615    |
 *  | cup's front face                       | 0.62–0.72|
 *  | neon rim at the bottom of the cup      | 0.73     |
 *  | pedestal                               | 0.75–1.0 |
 *
 * The pose anchor pins the BOTTOM OF THE RENDERER BOX, and every Blobbi body
 * ends above that: the artwork leaves the lowest ~12 % of the square box empty
 * (see `BLOBBI_BODY_BOTTOM_PERCENT`). At this room's `lg` size and ~1.32 depth
 * scale the box is ~0.66 of the chair's height, so the visible body bottom is
 * ~0.08 of the chair ABOVE the anchor. The old anchor (0.68) therefore put the
 * body's bottom on the pad's front lip (0.60) with the whole cup face showing
 * beneath it: perched, not seated.
 *
 * Now the anchor is 0.76: the body bottom lands at ~0.68, inside the cup's
 * front face, and `foregroundFrom` repaints the chair from the lip (0.615)
 * down in front of the sitter, so the cushion overlaps the lowest ~0.06 of
 * the chair's height of the body. Adult variants whose bodies end a little
 * higher or lower in the box (0.79–0.90) all land inside that overlap band,
 * which is what makes the four chairs read the same for every Blobbi.
 */
const STATION_SEAT_CONTACT = { x: 0.5, y: 0.76 } as const;
/** The cushion's front seam: everything below it is repainted over the sitter. */
const STATION_FOREGROUND_FROM = 0.615;

function stationChair(index: number, leftPercent: number): RoomSeatConfig {
  const sprite = box(leftPercent, 25, 12, ART.stationChair);
  return {
    id: `nostr-station-chair-${index}`,
    room: 'nostr-station-inside.png',
    src: `${STATION}/chair.png`,
    alt: `Nostr Station Chair ${index}`,
    ...sprite,
    // One under the room's depth band for this floor (15), so a Blobbi standing
    // at the chair's front edge is in front of it rather than tied with it.
    zIndex: 14,
    seatedZIndex: 16,
    // Deep bucket seat: the walk ends on the corridor floor at the chair's
    // front edge; the seat anchor is documented above.
    approach: { x: 0.5, y: 0.85 },
    seatContact: STATION_SEAT_CONTACT,
    seatedScale: 1,
    facing: 'front',
    size: 'lg',
    behindWithin: 0.68,
    foregroundFrom: STATION_FOREGROUND_FROM,
    seatedAccessory: 'vr-headset',
  };
}

const stationChairs = [stationChair(1, 17), stationChair(2, 30), stationChair(3, 58), stationChair(4, 71)];

export const roomSeats: readonly RoomSeatConfig[] = [
  ...mallClusters.flatMap((c) => c.seats),
  ...basementClusters.flatMap((c) => c.seats),
  ...stationChairs,
];

export const roomTables: readonly RoomTableConfig[] = [
  ...mallClusters.map((c) => c.table),
  ...basementClusters.map((c) => c.table),
];

const SEATS_BY_ID = new Map(roomSeats.map((seat) => [seat.id, seat]));

export function getRoomSeat(seatId: string | null | undefined): RoomSeatConfig | undefined {
  return seatId ? SEATS_BY_ID.get(seatId) : undefined;
}

export function roomSeatsFor(room: string): RoomSeatConfig[] {
  return roomSeats.filter((seat) => seat.room === room);
}

export function roomTablesFor(room: string): RoomTableConfig[] {
  return roomTables.filter((table) => table.room === room);
}

// ── Depth ───────────────────────────────────────────────────────────────────

/**
 * A depth band in the shape `interactive-elements-config.ts` uses: positions
 * are measured FROM THE BOTTOM of the world, and `xRange` limits the band to
 * the furniture's own span.
 */
export interface FurnitureDepthBand {
  readonly minPosition: number;
  readonly maxPosition: number;
  readonly zIndex: number;
  readonly xRange: readonly [number, number];
}

/**
 * Where a standing Blobbi is BEHIND a piece of furniture: its feet inside the
 * sprite box (above the base line), within the sprite's horizontal span. The
 * room's own depth bands are keyed to its painted background and know nothing
 * about the chairs placed on it, so without these a Blobbi standing behind a
 * chair could be drawn over it, and the layering jumped when it crossed a
 * background band instead of the chair's base.
 *
 * Below the base the room band applies, and every room here gives a Blobbi
 * whose feet are below the furniture's base a z above the furniture, so it is
 * in front. Seated actors use `seatedZIndex`, never these.
 */
export function furnitureDepthBands(room: string): FurnitureDepthBand[] {
  const bands: FurnitureDepthBand[] = [];
  for (const seat of roomSeatsFor(room)) {
    const top = 100 - seat.bottomPercent - seat.heightPercent;
    const behindBelowY = top + seat.heightPercent * seat.behindWithin;
    bands.push({
      minPosition: 100 - behindBelowY,
      maxPosition: 100 - top,
      zIndex: seat.zIndex - 1,
      xRange: [seat.leftPercent, seat.leftPercent + seat.widthPercent],
    });
  }
  for (const table of roomTablesFor(room)) {
    const top = 100 - table.bottomPercent - table.heightPercent;
    // Behind the table means behind the whole cluster: one step under its chairs.
    const chairZ = Math.min(...roomSeatsFor(room).map((seat) => seat.zIndex), table.zIndex);
    bands.push({
      minPosition: table.bottomPercent,
      maxPosition: 100 - top,
      zIndex: chairZ - 1,
      xRange: [table.leftPercent, table.leftPercent + table.widthPercent],
    });
  }
  return bands;
}

/** The furniture band a standing Blobbi falls in, if any. */
export function furnitureDepthZIndex(
  room: string,
  positionFromBottom: number,
  x: number | undefined,
): number | undefined {
  if (x === undefined) return undefined;
  const band = furnitureDepthBands(room).find(
    (b) =>
      positionFromBottom >= b.minPosition &&
      positionFromBottom <= b.maxPosition &&
      x >= b.xRange[0] &&
      x <= b.xRange[1],
  );
  return band?.zIndex;
}
