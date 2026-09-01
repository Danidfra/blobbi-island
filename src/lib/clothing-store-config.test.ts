/**
 * The Clothing Store's scene and its movement geometry.
 *
 * Two kinds of claim are checked here, and neither is a coordinate snapshot:
 *
 *  1. the ASSETS are where the repository says assets live, and nothing still
 *     points at the temporary folder they arrived in;
 *  2. the room's collision behaves — the open floor is reachable, the furniture
 *     is not, and the ways around it still are — run through the REAL clamp
 *     (`constrainPosition`) and the REAL blocker rule against the REAL config.
 *
 * All coordinates are GROUND-ANCHOR (feet), like every boundary in the game.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { constrainPosition, type Boundary } from './boundaries';
import { locationBoundaries } from './location-boundaries';
import { getBackgroundForLocation } from './location-backgrounds';
import { LOCATION_INITIAL_POSITIONS, EXIT_POSITIONS } from './location-initial-position';
import {
  CLOTHING_STORE_CHECKOUT,
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreObjects,
} from './clothing-store-config';
import type { Position } from './types';

const LOCATION = 'clothing-store-inside';
const BACKGROUND = 'clothing-store-inside.png';

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
 */
function walkable(from: Position, to: Position, steps = 240): boolean {
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

describe('the artwork lives where assets live', () => {
  it('every scene object points at a file that exists', () => {
    for (const object of clothingStoreObjects) {
      const path = join('public', object.src.replace(/^\//, ''));
      expect(existsSync(path), `${object.id} → ${object.src}`).toBe(true);
    }
  });

  it('every object is under the LocationId-named folder, as the asset doc requires', () => {
    for (const object of clothingStoreObjects) {
      expect(object.src, object.id).toMatch(
        /^\/assets\/locations\/clothing-store-inside\//,
      );
      // kebab-case, and not repeating the folder it sits in.
      const basename = object.src.split('/').pop()!;
      expect(basename).toMatch(/^[a-z0-9-]+\.(png|webp)$/);
      expect(basename).not.toContain('clothing-store');
    }
  });

  it('the temporary drop folder is gone and nothing references it', () => {
    expect(existsSync('public/clo-aqui')).toBe(false);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx|css|html|json|md)$/.test(entry.name)) {
          if (readFileSync(path, 'utf8').includes('clo-aqui')) offenders.push(path);
        }
      }
    };
    walk('src');
    // This file names the folder in prose; everything else must not.
    expect(offenders.filter((p) => !p.endsWith('clothing-store-config.test.ts'))).toEqual(
      [],
    );
  });

  it('every object keeps a stable id, so a future interaction can attach to it', () => {
    const ids = clothingStoreObjects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'clothing-store-rug',
      'clothing-store-sign',
      'clothing-store-poster-dress-up',
      'clothing-store-poster-mirror',
      'clothing-store-checkout',
      'clothing-store-fitting-room',
      'clothing-store-hat-shelf',
      'clothing-store-display-table',
    ]);
  });

  it('scenery carries no accessible name, because it does nothing yet', () => {
    // An `alt` that CAN be wrong is how thirty arcade props ended up announcing
    // themselves as a ticket counter. A name arrives with a behaviour.
    for (const object of clothingStoreObjects) {
      expect(object.alt, object.id).toBeNull();
    }
  });

  it('is placed in world percent, never raw pixels', () => {
    for (const object of clothingStoreObjects) {
      expect(object.className, object.id).toMatch(/w-\[[\d.]+%\]/);
      expect(object.className, object.id).not.toMatch(/\[\d+px\]/);
    }
  });
});

describe('the room is still a valid location', () => {
  it('keeps its background, boundary and spawn', () => {
    expect(getBackgroundForLocation(LOCATION)).toBe(BACKGROUND);
    expect(boundary).toBeDefined();
    expect(standable(SPAWN)).toBe(true);
  });

  it('still returns to the mall on walkable floor', () => {
    const back = EXIT_POSITIONS[`shop:${LOCATION}`];
    expect(onFloor(back, mallBoundary)).toBe(true);
  });
});

describe('the furniture cannot be walked through', () => {
  it('the checkout counter is solid across its whole width', () => {
    for (const x of [36, 45, 50, 58, 64]) {
      expect(isBlocked({ x, y: 82 }), `x=${x}`).toBe(true);
    }
  });

  it('there is no walking behind the till', () => {
    // The blocker reaches the wall line, so the strip between counter and wall
    // is sealed rather than merely narrow.
    for (const y of [79.5, 82, 85.5]) {
      expect(standable({ x: 50, y }), `y=${y}`).toBe(false);
    }
  });

  it('the fitting room is solid', () => {
    for (const point of [
      { x: 5, y: 88 },
      { x: 14, y: 85 },
      { x: 23, y: 82 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('the hat shelf is solid', () => {
    for (const point of [
      { x: 81, y: 88 },
      { x: 90, y: 84 },
      { x: 97, y: 80 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('the display table is solid', () => {
    for (const point of [
      { x: 61, y: 94 },
      { x: 67, y: 96 },
      { x: 74, y: 93 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('a walk straight through the display table is stopped', () => {
    expect(walkable({ x: 67, y: 99.5 }, { x: 67, y: 90 })).toBe(false);
  });

  it('a walk straight into the counter is stopped', () => {
    expect(walkable({ x: 50, y: 95 }, { x: 50, y: 79 })).toBe(false);
  });

  it('wall art blocks nothing — it is not on the floor', () => {
    const wallArt = ['clothing-store-sign', 'clothing-store-poster-dress-up', 'clothing-store-poster-mirror'];
    for (const id of wallArt) {
      expect(clothingStoreObjects.find((o) => o.id === id)!.blocker).toBeUndefined();
    }
  });

  it('the rug blocks nothing — it is walked on, not around', () => {
    expect(
      clothingStoreObjects.find((o) => o.id === 'clothing-store-rug')!.blocker,
    ).toBeUndefined();
    expect(standable({ x: 33, y: 92 })).toBe(true);
  });
});

describe('the room is still walkable', () => {
  const openFloor: [string, Position][] = [
    ['spawn, in front of the counter', SPAWN],
    ['the checkout stand point', CLOTHING_STORE_CHECKOUT.standPoint],
    ['front centre', { x: 50, y: 97 }],
    ['on the rug', { x: 33, y: 93 }],
    ['left of the display table', { x: 52, y: 95 }],
    ['right of the display table', { x: 78, y: 96 }],
    ['in front of the fitting room', { x: 20, y: 95 }],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  it('the front of the room is one continuous walk, wall to wall', () => {
    expect(walkable({ x: 18, y: 99.5 }, { x: 82, y: 99.5 })).toBe(true);
  });

  it('the spawn can reach the checkout in a straight line', () => {
    expect(walkable(SPAWN, CLOTHING_STORE_CHECKOUT.standPoint)).toBe(true);
  });

  it('the display table can be walked around on both sides', () => {
    expect(walkable({ x: 55, y: 95 }, { x: 55, y: 99 })).toBe(true);
    expect(walkable({ x: 78, y: 95 }, { x: 78, y: 99 })).toBe(true);
  });

  it('the Blobbi cannot leave the room floor', () => {
    for (const point of [
      { x: 50, y: 130 },
      { x: -20, y: 90 },
      { x: 140, y: 90 },
      { x: 50, y: 5 },
    ]) {
      const clamped = constrainPosition(point, boundary);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.x).toBeLessThanOrEqual(100);
      expect(clamped.y).toBeGreaterThanOrEqual(79.2);
      expect(clamped.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('the checkout', () => {
  it('stands the player on open floor in front of the counter, never behind it', () => {
    expect(standable(CLOTHING_STORE_CHECKOUT.standPoint)).toBe(true);
    expect(isBlocked(CLOTHING_STORE_CHECKOUT.standPoint)).toBe(false);
  });

  it('is close enough to the counter to read as being served', () => {
    const counter = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-checkout',
    )!;
    const gap = CLOTHING_STORE_CHECKOUT.standPoint.y - (counter.y + counter.height);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(3);
    expect(CLOTHING_STORE_CHECKOUT.standPoint.x).toBeGreaterThan(counter.x);
    expect(CLOTHING_STORE_CHECKOUT.standPoint.x).toBeLessThan(counter.x + counter.width);
  });

  it('keeps its hotspot over the counter it belongs to', () => {
    // The hotspot's box and the sprite's painted face are both stated in world
    // percent; they must describe the same rectangle.
    expect(CLOTHING_STORE_CHECKOUT.className).toContain('left-[35.2%]');
    expect(CLOTHING_STORE_CHECKOUT.className).toContain('w-[29.6%]');
    const counter = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-checkout',
    )!;
    // …and the same stretch of floor the blocker seals.
    expect(Math.abs(35.2 - counter.x)).toBeLessThan(1);
    expect(Math.abs(35.2 + 29.6 - (counter.x + counter.width))).toBeLessThan(1);
  });
});

describe('the scene geometry is self-consistent', () => {
  it('every blocker belongs to an object that exists', () => {
    for (const blocker of clothingStoreBlockers) {
      expect(clothingStoreObjects.some((o) => o.id === blocker.id)).toBe(true);
    }
  });

  it('every blocker is inside the world and has real area', () => {
    for (const b of clothingStoreBlockers) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(100);
      expect(b.y + b.height).toBeLessThanOrEqual(100);
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('no two floor objects overlap on the floor', () => {
    for (const a of clothingStoreBlockers) {
      for (const b of clothingStoreBlockers) {
        if (a.id >= b.id) continue;
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it('puts the shop shortcut in the lower-right, in world percent', () => {
    expect(CLOTHING_STORE_SHOP_BUTTON.className).toMatch(/\bbottom-\[[\d.]+%\]/);
    expect(CLOTHING_STORE_SHOP_BUTTON.className).toMatch(/\bright-\[[\d.]+%\]/);
  });
});
