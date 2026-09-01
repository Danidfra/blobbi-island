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
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreInteraction,
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

/** Where the player stands to use an object. */
const standPointOf = (id: string) => clothingStoreInteraction(id).standPoint;

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
      'clothing-store-poster-dress-up',
      'clothing-store-sign',
      'clothing-store-poster-mirror',
      'clothing-store-hat-shelf',
      'clothing-store-checkout',
      'clothing-store-fitting-room',
      'clothing-store-display-table',
      'clothing-store-display-table-2',
    ]);
  });

  it('a name and a behaviour arrive together, or neither does', () => {
    // An `alt` that CAN be wrong is how thirty arcade props ended up announcing
    // themselves as a ticket counter. So the two fields are tied: an object with
    // an interaction MUST be named, and one without MUST NOT be.
    for (const object of clothingStoreObjects) {
      if (object.interaction) {
        expect(object.alt, object.id).toBeTruthy();
      } else {
        expect(object.alt, object.id).toBeNull();
      }
    }
  });

  it('the objects that do nothing are still scenery', () => {
    const scenery = clothingStoreObjects
      .filter((o) => !o.interaction)
      .map((o) => o.id);
    expect(scenery).toEqual([
      'clothing-store-rug',
      'clothing-store-poster-dress-up',
      'clothing-store-sign',
      'clothing-store-poster-mirror',
      'clothing-store-hat-shelf',
    ]);
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
const ART: Record<
  string,
  { imgW: number; imgH: number; l: number; r: number; t: number; b: number }
> = {
  'clothing-store-rug': { imgW: 1536, imgH: 1024, l: 0.0182, r: 0.0195, t: 0.1543, b: 0.1816 },
  'clothing-store-sign': { imgW: 1448, imgH: 1086, l: 0.0124, r: 0.0124, t: 0.0083, b: 0.0783 },
  'clothing-store-poster-dress-up': { imgW: 1024, imgH: 1536, l: 0.0254, r: 0.0273, t: 0.0104, b: 0.071 },
  'clothing-store-poster-mirror': { imgW: 1024, imgH: 1536, l: 0.0557, r: 0.0547, t: 0.0195, b: 0.0924 },
  'clothing-store-checkout': { imgW: 1536, imgH: 1024, l: 0.0651, r: 0.0645, t: 0.1562, b: 0.1621 },
  'clothing-store-hat-shelf': { imgW: 1536, imgH: 1024, l: 0.1491, r: 0.1484, t: 0.0303, b: 0.0332 },
  'clothing-store-fitting-room': { imgW: 1536, imgH: 1024, l: 0.112, r: 0.1081, t: 0.0234, b: 0.0537 },
  'clothing-store-display-table': { imgW: 1448, imgH: 1086, l: 0, r: 0.0007, t: 0.0405, b: 0.0497 },
  'clothing-store-display-table-2': { imgW: 1536, imgH: 1024, l: 0.0645, r: 0.0645, t: 0.0771, b: 0.0645 },
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

  const inkHeight = boxHeight * (1 - art.b - (art.t ?? 0));
  return {
    left,
    right,
    width: inkWidth,
    height: inkHeight,
    base,
    top: base - inkHeight,
    centre: (left + right) / 2,
  };
}

describe('the room is still a valid location', () => {
  it('keeps its background, boundary and spawn', () => {
    expect(getBackgroundForLocation(LOCATION)).toBe(BACKGROUND);
    expect(boundary).toBeDefined();
    expect(standable(SPAWN)).toBe(true);
  });

  it('still returns to the mall on walkable floor', () => {
    expect(onFloor(EXIT_POSITIONS[`shop:${LOCATION}`], mallBoundary)).toBe(true);
  });
});

describe('the room reads as a boutique', () => {
  it('the fitting room is on the RIGHT and pushed back', () => {
    const fitting = painted('clothing-store-fitting-room');
    expect(fitting.centre).toBeGreaterThan(70);
    expect(fitting.right).toBeLessThanOrEqual(100);
    // Farther back than it was: its base moved from y = 91 up the room.
    expect(fitting.base).toBeLessThan(89);
    expect(fitting.base).toBeGreaterThan(84);
  });

  it('the fitting room is about twice the size it was', () => {
    // It painted 27.3 × 32.3 = 881 square percent. Doubling the AREA is what
    // reads as "twice as big"; doubling the WIDTH would have painted 54.6
    // across, reaching x ≈ 45 — through the checkout and most of the back wall.
    const fitting = painted('clothing-store-fitting-room');
    const area = fitting.width * fitting.height;
    expect(area / 881).toBeGreaterThan(1.7);
    // And it stops where the room does.
    expect(fitting.right).toBeLessThanOrEqual(100);
    expect(fitting.top).toBeGreaterThan(24);
  });

  it('the fitting room leaves the checkout readable', () => {
    const fitting = painted('clothing-store-fitting-room');
    const till = painted('clothing-store-checkout');
    // At most a sliver of the counter's right end is behind it — and that part
    // of the sprite is its potted plant, not the booth, whose own structure
    // starts 6.9 % further right (measured per row).
    const overlap = Math.max(0, till.right - fitting.left);
    expect(overlap).toBeLessThan(till.width * 0.1);
  });

  it('the hat shelf is in the BACK-LEFT corner', () => {
    const hats = painted('clothing-store-hat-shelf');
    expect(hats.centre).toBeLessThan(30);
    // Against the back wall, not down in the foreground: its base is behind
    // every other object's.
    for (const id of [
      'clothing-store-checkout',
      'clothing-store-fitting-room',
      'clothing-store-display-table',
      'clothing-store-display-table-2',
    ]) {
      expect(hats.base, id).toBeLessThan(painted(id).base);
    }
    // And it starts at the left pillar's inner face rather than off-frame.
    expect(hats.left).toBeGreaterThan(16);
  });

  it('the rug is centred', () => {
    expect(Math.abs(painted('clothing-store-rug').centre - 50)).toBeLessThan(1);
  });

  it('both display tables grew a little and moved outward', () => {
    const one = painted('clothing-store-display-table');
    const two = painted('clothing-store-display-table-2');

    // Modest, not another doubling: they painted 17.0 and 14.8 wide.
    expect(one.width).toBeGreaterThan(17.0);
    expect(one.width).toBeLessThan(17.0 * 1.35);
    expect(two.width).toBeGreaterThan(14.8);
    expect(two.width).toBeLessThan(14.8 * 1.35);

    // Farther from the centre than they were (21 and 76.8 painted edges).
    expect(one.left).toBeLessThan(21);
    expect(two.right).toBeGreaterThan(76.8);
  });

  it('the tables sit on opposite sides with the rug breathing between them', () => {
    const one = painted('clothing-store-display-table');
    const two = painted('clothing-store-display-table-2');
    const rug = painted('clothing-store-rug');

    expect(one.centre).toBeLessThan(50);
    expect(two.centre).toBeGreaterThan(50);
    // They used to crowd the rug at 1.4 % either side.
    expect(rug.left - one.right).toBeGreaterThan(4);
    expect(two.left - rug.right).toBeGreaterThan(4);
  });

  it('both tables use their own artwork', () => {
    const src = (id: string) => clothingStoreObjects.find((o) => o.id === id)!.src;
    expect(src('clothing-store-display-table')).toMatch(/display-table\.png$/);
    expect(src('clothing-store-display-table-2')).toMatch(/display-table-2\.png$/);
    expect(src('clothing-store-display-table')).not.toBe(
      src('clothing-store-display-table-2'),
    );
  });

  it('the wall art hangs lower than it did, at the same sizes', () => {
    const sign = painted('clothing-store-sign');
    const left = painted('clothing-store-poster-dress-up');
    const right = painted('clothing-store-poster-mirror');

    // They used to top out at y 33 / 34 / 34, up near the ceiling beam.
    expect(sign.top).toBeGreaterThan(36);
    expect(left.top).toBeGreaterThan(36);
    expect(right.top).toBeGreaterThan(36);

    // Lower, not bigger — the previous pass already shrank them.
    expect(sign.width).toBeCloseTo(13.65, 0);
    expect(left.width).toBeCloseTo(7.1, 0);
    expect(right.width).toBeCloseTo(6.67, 0);
  });

  it('the sign is still the centred main piece', () => {
    const sign = painted('clothing-store-sign');
    const left = painted('clothing-store-poster-dress-up');
    const right = painted('clothing-store-poster-mirror');

    expect(Math.abs(sign.centre - 50)).toBeLessThan(1);
    expect(sign.width).toBeGreaterThan(left.width * 1.5);
    expect(sign.width).toBeGreaterThan(right.width * 1.5);
    expect(left.right).toBeLessThan(sign.left);
    expect(right.left).toBeGreaterThan(sign.right);
  });

  it('the wall art clears the furniture under it', () => {
    for (const id of [
      'clothing-store-sign',
      'clothing-store-poster-dress-up',
      'clothing-store-poster-mirror',
    ]) {
      expect(painted(id).base, id).toBeLessThan(painted('clothing-store-checkout').top);
    }
    // The right poster fits beside the enlarged booth because that sprite's
    // upper half is empty on its left — its own ink starts at x ≈ 69.9.
    expect(painted('clothing-store-poster-mirror').right).toBeLessThan(69.9);
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
      { x: 70, y: 85 },
      { x: 80, y: 86 },
      { x: 94, y: 84 },
    ]) {
      expect(isBlocked(point)).toBe(true);
    }
  });

  it('the hat shelf blocks a SHALLOW footprint, not the floor under a wall unit', () => {
    const shelf = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-hat-shelf',
    )!;
    // Pushed back against the wall it is a shelf, not a wardrobe. A deep
    // rectangle under a wall fixture is an invisible wall.
    expect(shelf.height).toBeLessThan(3);
    expect(isBlocked({ x: 25, y: 79 })).toBe(true);
    // …and the floor in front of it is free.
    expect(standable({ x: 25, y: 84 })).toBe(true);
  });

  it('both display tables block the floor their legs stand on', () => {
    expect(isBlocked({ x: 20, y: 97 })).toBe(true);
    expect(isBlocked({ x: 30, y: 96.5 })).toBe(true);
    expect(isBlocked({ x: 70, y: 97 })).toBe(true);
    expect(isBlocked({ x: 80, y: 96.5 })).toBe(true);
  });

  it('a walk straight into the front of the checkout is stopped', () => {
    expect(walkable({ x: 50, y: 95 }, { x: 50, y: 79 })).toBe(false);
  });

  it('a walk straight into a table leg is stopped', () => {
    expect(walkable({ x: 24, y: 99.5 }, { x: 24, y: 94 })).toBe(false);
    expect(walkable({ x: 75, y: 99.5 }, { x: 75, y: 94 })).toBe(false);
  });

  it('a walk straight into the fitting room is stopped', () => {
    expect(walkable({ x: 80, y: 94 }, { x: 80, y: 80 })).toBe(false);
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
    expect(standable({ x: 50, y: 90 })).toBe(true);
  });
});

describe('the room is open, not maze-like', () => {
  const openFloor: [string, Position][] = [
    ['spawn', SPAWN],
    ['the checkout stand point', standPointOf('clothing-store-checkout')],
    ['the fitting-room stand point', standPointOf('clothing-store-fitting-room')],
    ['display table 1 stand point', standPointOf('clothing-store-display-table')],
    ['display table 2 stand point', standPointOf('clothing-store-display-table-2')],
    ['front centre, on the rug', { x: 50, y: 93 }],
    ['behind the checkout', { x: 50, y: 79 }],
    ['left of the checkout', { x: 30, y: 82 }],
    ['right of the checkout', { x: 66.5, y: 79 }],
    ['behind display table 1', { x: 24, y: 92 }],
    ['behind display table 2', { x: 75, y: 93 }],
    ['front left corner', { x: 20, y: 99 }],
    ['front right corner', { x: 80, y: 99 }],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  it('every configured stand point is somewhere the player can actually stand', () => {
    for (const object of clothingStoreObjects) {
      if (!object.interaction) continue;
      expect(standable(object.interaction.standPoint), object.id).toBe(true);
    }
  });

  it('the spawn can reach every interactive object in a straight line', () => {
    for (const object of clothingStoreObjects) {
      if (!object.interaction) continue;
      expect(walkable(SPAWN, object.interaction.standPoint), object.id).toBe(true);
    }
  });

  describe('behind the checkout', () => {
    it('the back of the room is a through-route', () => {
      expect(walkable({ x: 40, y: 79 }, { x: 64, y: 79 })).toBe(true);
    });

    it('can be reached from the front around EITHER end of the counter', () => {
      // Left: up the open floor beside the counter, past the wall shelf's
      // shallow footprint, then in behind the till.
      expect(walkable({ x: 30, y: 95 }, { x: 30, y: 79.8 })).toBe(true);
      expect(walkable({ x: 30, y: 79.8 }, { x: 50, y: 79.8 })).toBe(true);
      // Right: up the lane between the till's end and the fitting room.
      expect(walkable({ x: 66.5, y: 95 }, { x: 66.5, y: 79 })).toBe(true);
      expect(walkable({ x: 66.5, y: 79 }, { x: 50, y: 79 })).toBe(true);
    });

    it('is where the SHOPKEEPER stands, not the customer', () => {
      const counter = clothingStoreBlockers.find(
        (b) => b.id === 'clothing-store-checkout',
      )!;
      expect(standPointOf('clothing-store-checkout').y).toBeGreaterThan(
        counter.y + counter.height,
      );
    });
  });

  describe('around the display tables', () => {
    it('there is floor BEHIND each table, not just in front of it', () => {
      expect(standable({ x: 24, y: 93 })).toBe(true);
      expect(standable({ x: 75, y: 93 })).toBe(true);
    });

    it('each table can be walked past on both sides', () => {
      // Table 1 paints x 14–33.5.
      expect(walkable({ x: 36, y: 99 }, { x: 36, y: 93 })).toBe(true);
      // Table 2 paints x 66.5–83.5.
      expect(walkable({ x: 64, y: 99 }, { x: 64, y: 93 })).toBe(true);
      expect(walkable({ x: 86, y: 99 }, { x: 86, y: 94 })).toBe(true);
    });

    it('the strip behind the tables joins the two sides of the room', () => {
      expect(walkable({ x: 20, y: 94 }, { x: 80, y: 94 })).toBe(true);
    });

    it('neither table stands on the checkout path', () => {
      expect(
        walkable({ x: 50, y: 99 }, standPointOf('clothing-store-checkout')),
      ).toBe(true);
    });
  });

  it('the fitting-room entrance is reachable from the front of the room', () => {
    // Round display table 2's right-hand end — which is why the stand point is
    // there rather than straight in front of the curtain.
    expect(walkable({ x: 88, y: 99 }, standPointOf('clothing-store-fitting-room'))).toBe(
      true,
    );
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
      expect(clamped.y).toBeGreaterThanOrEqual(77.5);
      expect(clamped.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('what each object opens', () => {
  it('four controls open the shop and exactly one opens the fitting room', () => {
    const opens = (target: string) =>
      clothingStoreObjects
        .filter((o) => o.interaction?.opens === target)
        .map((o) => o.id);

    expect(opens('shop')).toEqual([
      'clothing-store-checkout',
      'clothing-store-display-table',
      'clothing-store-display-table-2',
    ]);
    expect(opens('fitting-room')).toEqual(['clothing-store-fitting-room']);
  });

  it('the checkout stand point is in FRONT of the till', () => {
    const counter = clothingStoreBlockers.find(
      (b) => b.id === 'clothing-store-checkout',
    )!;
    const stand = standPointOf('clothing-store-checkout');
    expect(stand.y).toBeGreaterThan(counter.y + counter.height);
    expect(stand.x).toBeGreaterThan(counter.x);
    expect(stand.x).toBeLessThan(counter.x + counter.width);
  });

  it('each stand point is beside the thing it belongs to', () => {
    for (const object of clothingStoreObjects) {
      if (!object.interaction) continue;
      const art = painted(object.id);
      const stand = object.interaction.standPoint;
      // Horizontally within arm's reach of the object's own artwork…
      expect(stand.x, object.id).toBeGreaterThan(art.left - 6);
      expect(stand.x, object.id).toBeLessThan(art.right + 6);
      // …and not inside its footprint.
      expect(isBlocked(stand), object.id).toBe(false);
    }
  });

  it('`clothingStoreInteraction` refuses to invent one', () => {
    expect(() => clothingStoreInteraction('clothing-store-rug')).toThrow(
      /No interaction configured/,
    );
    expect(clothingStoreInteraction('clothing-store-checkout').opens).toBe('shop');
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
