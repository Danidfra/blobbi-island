/**
 * The Clothing Store's geometry, against the artwork that is now the room.
 *
 * The old file for this room tested a SCENE: nine sprites, their placements,
 * their sizes relative to one another and the depth bands derived from their
 * painted bases. That composition is gone — `clothing-store.webp` contains the
 * furniture those sprites drew — and the coordinate claims went with it rather
 * than being kept alive against furniture nobody renders. What replaces them is
 * not a coordinate snapshot either. Three kinds of claim are checked here:
 *
 *  1. the room POINTS AT the new artwork, and no trace of the old composition
 *     is left behind in the repository or in the configs keyed by filename;
 *  2. the walkable floor matches the picture — the Blobbi stands on visible
 *     boards, the furniture painted on them is solid, and the room is still one
 *     connected space with every control reachable;
 *  3. the hotspots sit OVER the things they name, and each opens exactly one of
 *     the room's two surfaces.
 *
 * Floor claims run through the REAL clamp (`constrainPosition`) and the REAL
 * blocker rule against the REAL config. All coordinates are GROUND-ANCHOR
 * (feet), like every boundary in the game.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { constrainPosition, type Boundary } from './boundaries';
import { locationBoundaries } from './location-boundaries';
import { locationScalingConfig } from './location-scaling-config';
import { getBackgroundForLocation } from './location-backgrounds';
import { LOCATION_INITIAL_POSITIONS, EXIT_POSITIONS } from './location-initial-position';
import { calculateBlobbiZIndex } from './interactive-elements-config';
import { WORLD_ASPECT } from './world-coordinates';
import {
  CLOTHING_STORE_CHECKOUT,
  CLOTHING_STORE_FACADE,
  CLOTHING_STORE_FITTING_ROOM_LEFT,
  CLOTHING_STORE_FITTING_ROOM_RIGHT,
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreFittingRooms,
  clothingStoreHotspot,
  clothingStoreHotspots,
} from './clothing-store-config';
import type { Position } from './types';

const LOCATION = 'clothing-store-inside';
const BACKGROUND = 'clothing-store.webp';
/** The empty shell the room used to be composed onto. */
const OLD_BACKGROUND = 'clothing-store-inside.png';
/** The folder the nine obsolete furniture sprites lived in. */
const OLD_ART_DIR = 'public/assets/locations/clothing-store-inside';
/** The two-sprite storefront the new facade replaced. */
const OLD_FACADE = 'public/assets/locations/shop/clothing-store.png';
const OLD_FACADE_DOOR = 'public/assets/locations/shop/doors/clothing-store-door.png';

const boundary = locationBoundaries[BACKGROUND];
const mallBoundary = locationBoundaries['shopping-mall-inside.png'];

/** The exact rule `MovementBlockerContext.isPositionBlocked` applies. */
function isBlocked(point: Position): boolean {
  return clothingStoreBlockers.some(
    (b) =>
      point.x >= b.x &&
      point.x <= b.x + b.width &&
      point.y >= b.y &&
      point.y <= b.y + b.height,
  );
}

/** A point the walk boundary does not have to move — i.e. real floor. */
function onFloor(point: Position, b: Boundary = boundary): boolean {
  const clamped = constrainPosition(point, b);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

function standable(point: Position): boolean {
  return onFloor(point) && !isBlocked(point);
}

/**
 * Can the Blobbi walk from `from` to `to` without being stopped?
 *
 * Mirrors the movement loop: no pathfinding, one straight line, each step
 * clamped into the boundary and halted the moment it lands in a blocker.
 * `room-routing.test.ts` asks the harder question — whether the shared planner
 * finds a way round when this fails — so a `false` here is a statement about
 * the straight line only.
 */
function walkable(from: Position, to: Position, steps = 400): boolean {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const stepped = constrainPosition(
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      boundary,
    );
    if (isBlocked(stepped)) return false;
  }
  return true;
}

const SPAWN = LOCATION_INITIAL_POSITIONS[LOCATION];

/** A hotspot's placement, read back out of its Tailwind class string. */
function placement(className: string) {
  const pct = (prop: string) => {
    const found = className.match(new RegExp(`${prop}-\\[(-?[\\d.]+)%\\]`));
    return found ? Number(found[1]) : undefined;
  };
  const left = pct('left');
  const top = pct('top');
  const width = pct('w');
  const height = pct('h');
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    throw new Error(`Not placed in world percent: "${className}"`);
  }
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// ---------------------------------------------------------------------------
// 1. The room points at the new artwork, and only at it
// ---------------------------------------------------------------------------

describe('the new interior is the room', () => {
  it('the location renders the new furnished artwork', () => {
    expect(getBackgroundForLocation(LOCATION)).toBe(BACKGROUND);
    expect(existsSync(join('public/assets/world/backgrounds', BACKGROUND))).toBe(true);
  });

  it('the empty shell is gone from the repository and from every config', () => {
    expect(existsSync(join('public/assets/world/backgrounds', OLD_BACKGROUND))).toBe(false);
    expect(locationBoundaries[OLD_BACKGROUND]).toBeUndefined();
    expect(locationScalingConfig[OLD_BACKGROUND]).toBeUndefined();
    // No depth bands either: an unknown background falls back to the default.
    expect(calculateBlobbiZIndex(90, OLD_BACKGROUND)).toBe(
      calculateBlobbiZIndex(90, 'no-such-background.png'),
    );
  });

  it('the nine obsolete furniture sprites are deleted, not orphaned', () => {
    expect(existsSync(OLD_ART_DIR)).toBe(false);
  });

  it('nothing in the source still POINTS AT the old composition', () => {
    // Quoted, because the config's own prose explains what it replaced and
    // that documentation is worth keeping. What must be gone is every USE:
    // the filename as a config key or background value, and the art folder as
    // an asset path.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // This file names the old assets on purpose, to assert they are gone.
        if (path.endsWith('clothing-store-config.test.ts')) continue;
        const source = readFileSync(path, 'utf8');
        const usesFilename = source.includes(`'${OLD_BACKGROUND}'`);
        const usesArtFolder = source.includes(OLD_ART_DIR.replace('public', ''));
        if (usesFilename || usesArtFolder) offenders.push(path);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });

  it('the room keeps its canonical id, its boundary and one entry in every table', () => {
    expect(boundary).toBeDefined();
    expect(locationScalingConfig[BACKGROUND]).toBeDefined();
    // Exactly one Clothing Store location: no second id was invented for the
    // new artwork.
    const clothingLocations = Object.keys(LOCATION_INITIAL_POSITIONS).filter((id) =>
      id.includes('clothing'),
    );
    expect(clothingLocations).toEqual([LOCATION]);
  });
});

describe('the storefront in the mall', () => {
  it('uses the new artwork and names the action, not the picture', () => {
    expect(CLOTHING_STORE_FACADE.src).toBe('/assets/locations/shop/clothing-store.webp');
    expect(CLOTHING_STORE_FACADE.alt).toMatch(/go inside/i);
    expect(existsSync(join('public', CLOTHING_STORE_FACADE.src))).toBe(true);
  });

  it('the old two-sprite storefront is deleted, door included', () => {
    expect(existsSync(OLD_FACADE)).toBe(false);
    expect(existsSync(OLD_FACADE_DOOR)).toBe(false);
  });

  it('nothing renders a Clothing Store door any more', () => {
    const source = readFileSync(
      'src/components/blobbi/InteractiveElements.tsx',
      'utf8',
    );
    // The comment explaining the deletion names the file; a rendered `src=`
    // would not be inside a comment, so assert on the JSX attribute form.
    expect(source).not.toContain('src="/assets/locations/shop/doors/clothing-store-door.png"');
    expect(source).not.toContain('src="/assets/locations/shop/clothing-store.png"');
  });

  it("puts the painted storefront exactly where the old one stood", () => {
    const cls = CLOTHING_STORE_FACADE.containerClassName;
    const width = Number(cls.match(/w-\[([\d.]+)%\]/)![1]);
    const left = Number(cls.match(/left-\[([\d.]+)%\]/)![1]);
    const boxBottomY = 100 - Number(cls.match(/bottom-\[([\d.]+)%\]/)![1]);

    // 1536×1024 with ink margins l/r 3.19 %, b 2.93 %.
    const heightPct = width * (1024 / 1536) * WORLD_ASPECT;
    const paintedLeft = left + width * 0.0319;
    const paintedRight = left + width * (1 - 0.0319);
    const paintedBase = boxBottomY - heightPct * 0.0293;

    // The extent the `.png` facade painted: x 50 → 74.5, base on y = 61.5 —
    // the same floor line the Care and Badges facades stand on.
    expect(paintedLeft).toBeCloseTo(50, 1);
    expect(paintedRight).toBeCloseTo(74.5, 1);
    expect(paintedBase).toBeCloseTo(61.5, 1);
  });

  it('puts the walk target on the walkway, not on the sprite base', () => {
    const clamped = constrainPosition(CLOTHING_STORE_FACADE.walkTarget, mallBoundary);
    expect(clamped).toEqual(CLOTHING_STORE_FACADE.walkTarget);
    // The middle level's strip, the same one its neighbours are entered from.
    expect(CLOTHING_STORE_FACADE.walkTarget.y).toBeGreaterThanOrEqual(62.1);
    expect(CLOTHING_STORE_FACADE.walkTarget.y).toBeLessThanOrEqual(63.1);
  });

  it('stands under its own storefront, not beside it', () => {
    expect(CLOTHING_STORE_FACADE.walkTarget.x).toBeGreaterThan(50);
    expect(CLOTHING_STORE_FACADE.walkTarget.x).toBeLessThan(74.5);
  });

  it('comes back out where it went in', () => {
    expect(EXIT_POSITIONS[`shop:${LOCATION}`]).toEqual(
      CLOTHING_STORE_FACADE.walkTarget,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The floor is the floor in the picture
// ---------------------------------------------------------------------------

describe('spawn and exit', () => {
  it('spawns on open floor, clear of every blocker', () => {
    expect(standable(SPAWN)).toBe(true);
  });

  it('spawns in front of the checkout, not behind the room', () => {
    expect(SPAWN.y).toBeGreaterThan(CLOTHING_STORE_CHECKOUT.standPoint.y);
  });

  it('still returns to the mall on walkable floor', () => {
    expect(onFloor(EXIT_POSITIONS[`shop:${LOCATION}`], mallBoundary)).toBe(true);
  });
});

describe('the Blobbi walks on visible floor', () => {
  /**
   * Points measured off `clothing-store.webp` itself: for each, the wooden
   * boards run unbroken from there to the bottom of the frame.
   */
  const openFloor: [string, Position][] = [
    ['spawn, on the rug', SPAWN],
    ['front centre', { x: 50, y: 97 }],
    ['front-left corner', { x: 3, y: 97 }],
    ['front-right corner', { x: 97, y: 97 }],
    ['in front of the left booth', CLOTHING_STORE_FITTING_ROOM_LEFT.standPoint],
    ['in front of the right booth', CLOTHING_STORE_FITTING_ROOM_RIGHT.standPoint],
    ['at the till', CLOTHING_STORE_CHECKOUT.standPoint],
    ['the aisle left of the till', { x: 30, y: 70 }],
    ['the aisle right of the till', { x: 70, y: 70 }],
    ['up at the clothing rack', { x: 70, y: 65.5 }],
    ['up at the wall shelving', { x: 32, y: 66.5 }],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  /**
   * Points that are WALL, ceiling or off-frame in the artwork. The clamp must
   * move every one of them.
   */
  const notFloor: [string, Position][] = [
    ['the back wall above the till', { x: 50, y: 45 }],
    ['the ceiling', { x: 50, y: 10 }],
    ['inside the left booth', { x: 5, y: 66 }],
    ['behind the right-hand bookcase', { x: 95, y: 66 }],
    ['off the left frame edge', { x: -10, y: 90 }],
    ['off the right frame edge', { x: 115, y: 90 }],
  ];

  it.each(notFloor)('%s is not floor', (_label, point) => {
    expect(onFloor(point)).toBe(false);
  });

  it('the clamp always lands inside the room', () => {
    for (const point of [
      { x: 50, y: 130 },
      { x: -20, y: 90 },
      { x: 140, y: 90 },
      { x: 50, y: 5 },
    ]) {
      const clamped = constrainPosition(point, boundary);
      expect(onFloor(clamped)).toBe(true);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.x).toBeLessThanOrEqual(100);
      // The floor's back edge is the furniture line at y ≈ 64.5.
      expect(clamped.y).toBeGreaterThanOrEqual(64.5);
      expect(clamped.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('the painted furniture is solid where it stands', () => {
  it('the checkout blocks its own footprint, across its whole width', () => {
    for (let x = 38; x <= 60; x += 1) {
      expect(isBlocked({ x, y: 66 }), `x=${x}`).toBe(true);
    }
  });

  it('there is no walking round the back of the till', () => {
    // The counter is wedged between the wall shelving and the rack's bench;
    // its blocker reaches back past the wall line, so the strip behind it is
    // neither floor nor reachable.
    for (const x of [40, 50, 60]) {
      expect(standable({ x, y: 63 })).toBe(false);
    }
  });

  it('a walk straight into the front of the till is stopped', () => {
    expect(walkable({ x: 49, y: 90 }, { x: 49, y: 65 })).toBe(false);
  });

  it('both fitting-room booths block the floor they occupy', () => {
    expect(isBlocked({ x: 6, y: 68 })).toBe(true);
    expect(isBlocked({ x: 16, y: 65 })).toBe(true);
  });

  it('a walk straight into either booth is stopped', () => {
    expect(walkable({ x: 6, y: 90 }, { x: 6, y: 66 })).toBe(false);
    expect(walkable({ x: 16, y: 90 }, { x: 16, y: 63 })).toBe(false);
  });

  it('the leaning mirror is solid, and only where it leans', () => {
    expect(isBlocked({ x: 23.5, y: 65 })).toBe(true);
    // A step in front of it is open aisle, not an invisible wall.
    expect(standable({ x: 23.5, y: 70 })).toBe(true);
  });

  it('no blocker is an oversized invisible wall', () => {
    for (const blocker of clothingStoreBlockers) {
      expect(blocker.width, blocker.id).toBeGreaterThan(0);
      expect(blocker.height, blocker.id).toBeGreaterThan(0);
      // The widest thing in the room is the checkout island, at 23 %.
      expect(blocker.width, blocker.id).toBeLessThanOrEqual(23);
      expect(blocker.height, blocker.id).toBeLessThanOrEqual(11);
      expect(blocker.x, blocker.id).toBeGreaterThanOrEqual(0);
      expect(blocker.x + blocker.width, blocker.id).toBeLessThanOrEqual(100);
    }
  });

  it('no blocker reaches down into the open front of the room', () => {
    // Everything in this room stands against the back half; the whole front
    // floor, rug included, is free.
    for (const blocker of clothingStoreBlockers) {
      expect(blocker.y + blocker.height, blocker.id).toBeLessThan(74);
    }
  });

  it('no two blockers overlap', () => {
    for (const a of clothingStoreBlockers) {
      for (const b of clothingStoreBlockers) {
        if (a.id === b.id) continue;
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it('every blocker id names a real fixture in the room', () => {
    expect(clothingStoreBlockers.map((b) => b.id)).toEqual([
      'clothing-store-fitting-room-left',
      'clothing-store-fitting-room-right',
      'clothing-store-mirror',
      'clothing-store-checkout',
    ]);
  });
});

describe('the room is one connected space', () => {
  it('the front of the room is one continuous walk, wall to wall', () => {
    expect(walkable({ x: 4, y: 97 }, { x: 96, y: 97 })).toBe(true);
  });

  it('the aisle in front of the till crosses the room', () => {
    // Just clear of the left booth's threshold (y = 72.5) and of the till's
    // base (y = 69.4): one straight walk past both, wall to wall.
    expect(walkable({ x: 12, y: 73 }, { x: 84, y: 73 })).toBe(true);
  });

  it('every stand point is somewhere the player can actually stand', () => {
    for (const hotspot of clothingStoreHotspots) {
      expect(standable(hotspot.standPoint), hotspot.id).toBe(true);
    }
  });

  it('the spawn reaches every hotspot in a straight line', () => {
    for (const hotspot of clothingStoreHotspots) {
      expect(walkable(SPAWN, hotspot.standPoint), hotspot.id).toBe(true);
    }
  });

  it('the till can be left for either booth without doubling back', () => {
    for (const booth of clothingStoreFittingRooms) {
      expect(
        walkable(CLOTHING_STORE_CHECKOUT.standPoint, booth.standPoint),
        booth.id,
      ).toBe(true);
    }
  });

  it('the two booths are reachable from each other', () => {
    expect(
      walkable(
        CLOTHING_STORE_FITTING_ROOM_LEFT.standPoint,
        CLOTHING_STORE_FITTING_ROOM_RIGHT.standPoint,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The hotspots sit over what they name
// ---------------------------------------------------------------------------

describe('the checkout hotspot', () => {
  const box = placement(CLOTHING_STORE_CHECKOUT.className);
  const counter = clothingStoreBlockers.find((b) => b.id === 'clothing-store-checkout')!;

  it('covers the counter painted in the artwork', () => {
    // The counter's plinth paints x 37.7 → 60.5, its worktop at y ≈ 52 and its
    // base at y ≈ 69.3. The hotspot spans the body, not the monitor above it.
    expect(box.left).toBeCloseTo(37.5, 1);
    expect(box.right).toBeCloseTo(60.5, 1);
    expect(box.top).toBeGreaterThan(50);
    expect(box.bottom).toBeGreaterThanOrEqual(69);
    expect(box.bottom).toBeLessThan(71);
  });

  it('sits over its own floor footprint, horizontally', () => {
    expect(box.left).toBeCloseTo(counter.x, 1);
    expect(box.right).toBeCloseTo(counter.x + counter.width, 1);
  });

  it('stands the player on the CUSTOMER side of the counter', () => {
    const { standPoint } = CLOTHING_STORE_CHECKOUT;
    expect(standPoint.y).toBeGreaterThan(counter.y + counter.height);
    expect(standPoint.x).toBeGreaterThan(counter.x);
    expect(standPoint.x).toBeLessThan(counter.x + counter.width);
    expect(standable(standPoint)).toBe(true);
  });

  it('opens the shop', () => {
    expect(CLOTHING_STORE_CHECKOUT.opens).toBe('shop');
  });
});

describe('the two fitting rooms', () => {
  it('there are exactly two, and both are on the LEFT', () => {
    expect(clothingStoreFittingRooms).toHaveLength(2);
    for (const booth of clothingStoreFittingRooms) {
      const box = placement(booth.className);
      expect(box.right, booth.id).toBeLessThan(25);
    }
  });

  it('they are two distinct hotspots that do not overlap', () => {
    const [left, right] = clothingStoreFittingRooms.map((b) => placement(b.className));
    expect(left.right).toBeLessThanOrEqual(right.left);
  });

  it('each covers its own painted booth', () => {
    // Left booth: frame posts at x 0.2–1.8 and 9.7–11.4, arch crown y ≈ 18.5.
    const left = placement(CLOTHING_STORE_FITTING_ROOM_LEFT.className);
    expect(left.left).toBeCloseTo(0, 1);
    expect(left.right).toBeCloseTo(11.5, 1);
    expect(left.top).toBeCloseTo(18.5, 1);

    // Right booth: posts at x 12.3–13.5 and 18.6–20.0, set further back, so
    // its arch crowns lower and its base sits higher.
    const right = placement(CLOTHING_STORE_FITTING_ROOM_RIGHT.className);
    expect(right.left).toBeCloseTo(12.2, 1);
    expect(right.right).toBeCloseTo(20.2, 1);
    expect(right.top).toBeGreaterThan(left.top);
    expect(right.bottom).toBeLessThan(left.bottom);
  });

  it('each has its own stand point, in front of its own booth', () => {
    const points = clothingStoreFittingRooms.map((b) => b.standPoint);
    expect(points[0]).not.toEqual(points[1]);

    for (const booth of clothingStoreFittingRooms) {
      const footprint = clothingStoreBlockers.find((b) => b.id === booth.id)!;
      const box = placement(booth.className);
      // In front of the booth it belongs to...
      expect(booth.standPoint.y, booth.id).toBeGreaterThan(
        footprint.y + footprint.height,
      );
      // ...and under it, not off beside some other fixture.
      expect(booth.standPoint.x, booth.id).toBeGreaterThanOrEqual(box.left);
      expect(booth.standPoint.x, booth.id).toBeLessThanOrEqual(box.right);
      expect(standable(booth.standPoint), booth.id).toBe(true);
    }
  });

  it('both open the fitting room, and neither opens the shop', () => {
    for (const booth of clothingStoreFittingRooms) {
      expect(booth.opens, booth.id).toBe('fitting-room');
    }
  });
});

describe('the room controls, as a set', () => {
  it('three hotspots walk the Blobbi; the corner button does not', () => {
    expect(clothingStoreHotspots.map((h) => h.id)).toEqual([
      'clothing-store-checkout',
      'clothing-store-fitting-room-left',
      'clothing-store-fitting-room-right',
    ]);
    expect(CLOTHING_STORE_SHOP_BUTTON).not.toHaveProperty('standPoint');
  });

  it('one hotspot opens the shop and two open the fitting room', () => {
    const opens = clothingStoreHotspots.map((h) => h.opens);
    expect(opens.filter((o) => o === 'shop')).toHaveLength(1);
    expect(opens.filter((o) => o === 'fitting-room')).toHaveLength(2);
  });

  it('every hotspot is named for what it opens', () => {
    for (const hotspot of clothingStoreHotspots) {
      expect(hotspot.label.length, hotspot.id).toBeGreaterThan(0);
      expect(hotspot.label, hotspot.id).toMatch(/clothing|fitting/i);
    }
  });

  it('every hotspot is placed in world percent, never raw pixels', () => {
    for (const hotspot of clothingStoreHotspots) {
      expect(() => placement(hotspot.className), hotspot.id).not.toThrow();
      expect(hotspot.className, hotspot.id).not.toMatch(/\[\d+px\]/);
    }
  });

  it('every hotspot sits below the Blobbi at every depth in the room', () => {
    // The furniture is painted into the background, so the Blobbi is always in
    // front of the scene; the hotspots must never come between them.
    const hotspotZ = clothingStoreHotspots.map(
      (h) => Number(h.className.match(/z-\[(\d+)\]/)![1]),
    );
    for (const y of [65, 70, 80, 90, 99]) {
      const blobbiZ = calculateBlobbiZIndex(y, BACKGROUND);
      for (const z of hotspotZ) expect(blobbiZ, `y=${y}`).toBeGreaterThan(z);
    }
  });

  it('`clothingStoreHotspot` refuses to invent one', () => {
    expect(clothingStoreHotspot('clothing-store-checkout').opens).toBe('shop');
    expect(() => clothingStoreHotspot('clothing-store-display-table')).toThrow(
      /No hotspot configured/,
    );
  });

  it('puts the shop shortcut in the lower-right, in world percent', () => {
    expect(CLOTHING_STORE_SHOP_BUTTON.className).toMatch(/bottom-\[[\d.]+%\]/);
    expect(CLOTHING_STORE_SHOP_BUTTON.className).toMatch(/right-\[[\d.]+%\]/);
    expect(CLOTHING_STORE_SHOP_BUTTON.label).toMatch(/clothing store/i);
  });
});
