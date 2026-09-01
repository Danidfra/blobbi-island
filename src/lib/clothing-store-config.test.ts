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
      'clothing-store-hat-shelf',
      'clothing-store-fitting-room',
      'clothing-store-display-table',
      'clothing-store-display-table-2',
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

/**
 * Painted geometry for each sprite, from its measured alpha box.
 *
 * The scene is configured in BOX terms; what a player sees is ink. A layout
 * claim ("the fitting room is on the right", "the rug is centred") is a claim
 * about ink, and asserting it on box coordinates would pass while the picture
 * disagreed — every one of these sprites carries 3–15 % transparent padding.
 */
const ART: Record<string, { imgW: number; imgH: number; l: number; r: number; b: number }> = {
  'clothing-store-rug': { imgW: 1536, imgH: 1024, l: 0.0182, r: 0.0195, b: 0.1816 },
  'clothing-store-sign': { imgW: 1448, imgH: 1086, l: 0.0124, r: 0.0124, b: 0.0783 },
  'clothing-store-poster-dress-up': { imgW: 1024, imgH: 1536, l: 0.0254, r: 0.0273, b: 0.071 },
  'clothing-store-poster-mirror': { imgW: 1024, imgH: 1536, l: 0.0557, r: 0.0547, b: 0.0924 },
  'clothing-store-checkout': { imgW: 1536, imgH: 1024, l: 0.0651, r: 0.0645, b: 0.1621 },
  'clothing-store-hat-shelf': { imgW: 1536, imgH: 1024, l: 0.1491, r: 0.1484, b: 0.0332 },
  'clothing-store-fitting-room': { imgW: 1536, imgH: 1024, l: 0.112, r: 0.1081, b: 0.0537 },
  'clothing-store-display-table': { imgW: 1448, imgH: 1086, l: 0, r: 0.0007, b: 0.0497 },
  'clothing-store-display-table-2': { imgW: 1536, imgH: 1024, l: 0.0645, r: 0.0645, b: 0.0645 },
};

const WORLD_ASPECT = 1046 / 697;

function num(className: string, prefix: string): number {
  const match = className.match(new RegExp(`(?:^| )(-?)${prefix}-\\[([\\d.]+)%\\]`));
  if (!match) throw new Error(`no ${prefix}-[…%] in "${className}"`);
  return Number(match[2]) * (match[1] === '-' ? -1 : 1);
}

/** Where an object's ink actually lands, in world percent. */
function painted(id: string) {
  const object = clothingStoreObjects.find((o) => o.id === id)!;
  const art = ART[id];
  const width = num(object.className, 'w');
  const boxHeight = width * (art.imgH / art.imgW) * WORLD_ASPECT;

  const boxLeft = object.className.includes('right-[')
    ? 100 - num(object.className, 'right') - width
    : num(object.className, 'left');

  const left = boxLeft + width * art.l;
  const right = boxLeft + width * (1 - art.r);
  const inkWidth = width * (1 - art.l - art.r);

  // Wall art hangs from `top-`; floor objects stand on `bottom-`.
  const base = object.className.includes('bottom-[')
    ? 100 - (num(object.className, 'bottom') + boxHeight * art.b)
    : num(object.className, 'top') + boxHeight * (1 - art.b);

  return { left, right, width: inkWidth, base, centre: (left + right) / 2 };
}

describe('the room reads as a boutique', () => {
  it('the fitting room is on the RIGHT', () => {
    const fitting = painted('clothing-store-fitting-room');
    expect(fitting.centre).toBeGreaterThan(70);
    expect(fitting.right).toBeLessThanOrEqual(100);
    // Clear of the counter, which paints to x 64.8.
    expect(fitting.left).toBeGreaterThan(painted('clothing-store-checkout').right);
  });

  it('the fitting room is substantially larger than the small one it replaced', () => {
    // It was 22.62 % of the world wide. "Noticeably larger" is not a rounding.
    const fitting = painted('clothing-store-fitting-room');
    expect(fitting.width).toBeGreaterThan(22.62 * 1.15);
    // …and still a room object, not a wall.
    expect(fitting.width).toBeLessThan(35);
  });

  it('the hat shelf is on the LEFT', () => {
    const hats = painted('clothing-store-hat-shelf');
    expect(hats.centre).toBeLessThan(30);
    expect(hats.left).toBeGreaterThanOrEqual(0);
    // It reads as a merchandise wall without dominating the room.
    expect(hats.width).toBeGreaterThan(15);
    expect(hats.width).toBeLessThan(painted('clothing-store-fitting-room').width);
  });

  it('they swapped sides — the shelf is left of the booth, not beside it', () => {
    expect(painted('clothing-store-hat-shelf').right).toBeLessThan(
      painted('clothing-store-fitting-room').left,
    );
  });

  it('the rug is centred', () => {
    const rug = painted('clothing-store-rug');
    expect(Math.abs(rug.centre - 50)).toBeLessThan(1);
  });

  it('the two display tables sit on opposite sides of the centre line', () => {
    const one = painted('clothing-store-display-table');
    const two = painted('clothing-store-display-table-2');
    expect(one.centre).toBeLessThan(50);
    expect(two.centre).toBeGreaterThan(50);
    // Each outside the rug, so the central anchor stays readable.
    expect(one.right).toBeLessThanOrEqual(painted('clothing-store-rug').left);
    expect(two.left).toBeGreaterThanOrEqual(painted('clothing-store-rug').right);
  });

  it('both tables use their own artwork', () => {
    const src = (id: string) => clothingStoreObjects.find((o) => o.id === id)!.src;
    expect(src('clothing-store-display-table')).toMatch(/display-table\.png$/);
    expect(src('clothing-store-display-table-2')).toMatch(/display-table-2\.png$/);
    expect(src('clothing-store-display-table')).not.toBe(
      src('clothing-store-display-table-2'),
    );
  });

  it('the checkout sits further back than the furniture flanking it', () => {
    const till = painted('clothing-store-checkout');
    expect(till.base).toBeLessThan(painted('clothing-store-hat-shelf').base);
    expect(till.base).toBeLessThan(painted('clothing-store-fitting-room').base);
    // …with real floor still visible between it and the wall at y = 77.
    expect(till.base).toBeGreaterThan(80);
    expect(till.base).toBeLessThan(84);
  });

  it('the wall art is small enough to decorate rather than dominate', () => {
    const sign = painted('clothing-store-sign');
    const left = painted('clothing-store-poster-dress-up');
    const right = painted('clothing-store-poster-mirror');

    // Each is meaningfully smaller than it was (20.48 / 10.42 / 9.79 wide).
    expect(sign.width).toBeLessThan(20.48 * 0.8);
    expect(left.width).toBeLessThan(10.42 * 0.8);
    expect(right.width).toBeLessThan(9.79 * 0.8);

    // Hierarchy preserved: the sign is still the main piece, and still central.
    expect(sign.width).toBeGreaterThan(left.width * 1.5);
    expect(sign.width).toBeGreaterThan(right.width * 1.5);
    expect(Math.abs(sign.centre - 50)).toBeLessThan(1);

    // Flanking it, and clear of everything standing on the floor.
    expect(left.right).toBeLessThan(sign.left);
    expect(right.left).toBeGreaterThan(sign.right);
    for (const art of [sign, left, right]) {
      expect(art.base).toBeLessThan(painted('clothing-store-checkout').base - 8);
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

describe('the furniture is solid where it actually stands', () => {
  it('the checkout blocks its own footprint, across its whole width', () => {
    for (const x of [36, 45, 50, 58, 64]) {
      expect(isBlocked({ x, y: 81.5 }), `x=${x}`).toBe(true);
    }
  });

  it('the fitting room footprint is blocked', () => {
    for (const point of [
      { x: 73, y: 88 },
      { x: 85, y: 90 },
      { x: 97, y: 86 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('the hat shelf footprint is blocked', () => {
    for (const point of [
      { x: 3, y: 87 },
      { x: 12, y: 89 },
      { x: 19, y: 85 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('both display tables block the floor their legs stand on', () => {
    expect(isBlocked({ x: 25, y: 97 })).toBe(true);
    expect(isBlocked({ x: 35, y: 96.5 })).toBe(true);
    expect(isBlocked({ x: 64, y: 97 })).toBe(true);
    expect(isBlocked({ x: 75, y: 96.5 })).toBe(true);
  });

  it('a walk straight into the front of the checkout is stopped', () => {
    expect(walkable({ x: 50, y: 95 }, { x: 50, y: 79 })).toBe(false);
  });

  it('a walk straight into a table leg is stopped', () => {
    expect(walkable({ x: 29, y: 99.5 }, { x: 29, y: 94 })).toBe(false);
    expect(walkable({ x: 69, y: 99.5 }, { x: 69, y: 94 })).toBe(false);
  });

  it('wall art and the rug block nothing', () => {
    for (const id of [
      'clothing-store-sign',
      'clothing-store-poster-dress-up',
      'clothing-store-poster-mirror',
      'clothing-store-rug',
    ]) {
      expect(clothingStoreObjects.find((o) => o.id === id)!.blocker).toBeUndefined();
    }
    // And the centred rug is stood on, not walked around.
    expect(standable({ x: 50, y: 90 })).toBe(true);
  });
});

describe('the room is open, not maze-like', () => {
  const openFloor: [string, Position][] = [
    ['spawn', SPAWN],
    ['the checkout stand point', CLOTHING_STORE_CHECKOUT.standPoint],
    ['front centre, on the rug', { x: 50, y: 93 }],
    ['behind the checkout', { x: 50, y: 79 }],
    ['left of the checkout', { x: 30, y: 82 }],
    ['right of the checkout', { x: 70, y: 82 }],
    ['behind display table 1', { x: 29, y: 92 }],
    ['behind display table 2', { x: 69, y: 92 }],
    ['front left corner', { x: 20, y: 99 }],
    ['front right corner', { x: 80, y: 99 }],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  it('the spawn can reach the checkout in a straight line', () => {
    expect(walkable(SPAWN, CLOTHING_STORE_CHECKOUT.standPoint)).toBe(true);
  });

  describe('behind the checkout', () => {
    it('the back of the room is a through-route, wall to wall', () => {
      // The whole point of turning the till from a wall into furniture.
      expect(walkable({ x: 25, y: 79 }, { x: 75, y: 79 })).toBe(true);
    });

    it('can be reached from the front around EITHER end of the counter', () => {
      // Left: up the open floor beside the counter, then in behind it.
      expect(walkable({ x: 30, y: 95 }, { x: 30, y: 79 })).toBe(true);
      expect(walkable({ x: 30, y: 79 }, { x: 50, y: 79 })).toBe(true);
      // Right: the mirror image.
      expect(walkable({ x: 70, y: 95 }, { x: 70, y: 79 })).toBe(true);
      expect(walkable({ x: 70, y: 79 }, { x: 50, y: 79 })).toBe(true);
    });

    it('is where the SHOPKEEPER stands, not the customer', () => {
      // The stand point stayed in front, deliberately: now that behind the till
      // is walkable, a carelessly derived point could easily land back there.
      const counter = clothingStoreBlockers.find(
        (b) => b.id === 'clothing-store-checkout',
      )!;
      expect(CLOTHING_STORE_CHECKOUT.standPoint.y).toBeGreaterThan(
        counter.y + counter.height,
      );
    });
  });

  describe('around the display tables', () => {
    it('there is floor BEHIND each table, not just in front of it', () => {
      // A table on legs has floor behind it, and the blocker is only its feet.
      expect(standable({ x: 29, y: 93 })).toBe(true);
      expect(standable({ x: 69, y: 93 })).toBe(true);
    });

    it('each table can be walked past on both sides', () => {
      // Table 1 paints x 21–38: pass at x 19 and at x 39.
      expect(walkable({ x: 19, y: 99 }, { x: 19, y: 93 })).toBe(true);
      expect(walkable({ x: 39, y: 99 }, { x: 39, y: 93 })).toBe(true);
      // Table 2 paints x 62–76.8.
      expect(walkable({ x: 60, y: 99 }, { x: 60, y: 93 })).toBe(true);
      expect(walkable({ x: 79, y: 99 }, { x: 79, y: 93 })).toBe(true);
    });

    it('the strip behind the tables joins the two sides of the room', () => {
      // Behind the tables' feet (y < 95.8) and in front of the flanking
      // furniture (y > 92): a clear lane across the whole room.
      expect(walkable({ x: 20, y: 94 }, { x: 80, y: 94 })).toBe(true);
    });

    it('neither table stands on the checkout path', () => {
      // The straight line a player walks from spawn to the till.
      expect(walkable({ x: 50, y: 99 }, CLOTHING_STORE_CHECKOUT.standPoint)).toBe(true);
    });
  });

  it('the fitting-room side is reachable', () => {
    expect(walkable({ x: 70, y: 99 }, { x: 82, y: 99 })).toBe(true);
    expect(standable({ x: 80, y: 94 })).toBe(true);
  });

  it('the hat-shelf side is reachable', () => {
    expect(walkable({ x: 30, y: 99 }, { x: 18, y: 99 })).toBe(true);
    expect(standable({ x: 18, y: 94 })).toBe(true);
  });

  it('the front of the room is one continuous walk, wall to wall', () => {
    expect(walkable({ x: 18, y: 99.5 }, { x: 82, y: 99.5 })).toBe(true);
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
      // The refined back edge — still half a percent inside the painted floor,
      // whose wall junction sits at y = 77.
      expect(clamped.y).toBeGreaterThanOrEqual(77.5);
      expect(clamped.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('the checkout', () => {
  it('stands the player on open floor in FRONT of the counter', () => {
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
    expect(CLOTHING_STORE_CHECKOUT.className).toContain('left-[35.2%]');
    expect(CLOTHING_STORE_CHECKOUT.className).toContain('w-[29.6%]');
    const counter = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-checkout',
    )!;
    expect(Math.abs(35.2 - counter.x)).toBeLessThan(1);
    expect(Math.abs(35.2 + 29.6 - (counter.x + counter.width))).toBeLessThan(1);
  });

  it('blocks only a shallow footprint, not the room behind it', () => {
    const counter = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-checkout',
    )!;
    // It used to reach the wall line at y = 77. A counter is furniture, and
    // furniture is a few percent of floor deep.
    expect(counter.height).toBeLessThan(4);
    expect(counter.y).toBeGreaterThan(78);
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
