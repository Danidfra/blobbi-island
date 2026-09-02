/**
 * Care Store geometry — tested as BEHAVIOUR, not as a snapshot of numbers.
 *
 * Nothing here asserts "the toy box blocker is at x = 0". A coordinate table
 * that matches itself proves nothing: the numbers could all be wrong together
 * and still pass. What the room actually promises is a set of movement
 * outcomes — the open floor is reachable, the furniture is not, and the gaps
 * between them still are — so every case below runs the REAL clamp
 * (`constrainPosition`) and the REAL blocker rule (the point-in-rect test
 * `MovementBlockerContext` performs) against the REAL config.
 *
 * All coordinates are GROUND-ANCHOR (feet), like every boundary in the game.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { constrainPosition, type Boundary } from './boundaries';
import { locationBoundaries } from './location-boundaries';
import { getBackgroundForLocation, LOCATION_BACKGROUNDS } from './location-backgrounds';
import { LOCATION_INITIAL_POSITIONS, EXIT_POSITIONS } from './location-initial-position';
import { locationScalingConfig } from './location-scaling-config';
import { getBlobbiSizeForLocation } from './location-blobbi-sizes';
import {
  CARE_STORE_CHECKOUT,
  CARE_STORE_FACADE,
  careStoreBlockers,
} from './care-store-config';
import type { Position } from './types';

const CARE_STORE = 'care-store-inside';
const BACKGROUND = 'care-store-inside.webp';

const boundary = locationBoundaries[BACKGROUND];
const mallBoundary = locationBoundaries['shopping-mall-inside.png'];

/**
 * The exact rule `MovementBlockerContext.isPositionBlocked` applies: a point is
 * blocked when it lies inside any blocker rectangle, edges included.
 */
function isBlocked(point: Position): boolean {
  return careStoreBlockers.some(
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

/** Somewhere the Blobbi may actually stand: on the floor and out of the furniture. */
function standable(point: Position): boolean {
  return onFloor(point) && !isBlocked(point);
}

/**
 * Can the Blobbi walk from `from` to `to` without being stopped?
 *
 * This mirrors what the movement loop does: there is NO pathfinding — it steps
 * along the straight line, clamping each step into the boundary and halting the
 * moment a step lands inside a blocker. So a reachable destination means the
 * whole straight line is standable.
 */
function walkable(from: Position, to: Position, steps = 240): boolean {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const stepped = constrainPosition(point, boundary);
    if (isBlocked(stepped)) return false;
  }
  return true;
}

const SPAWN = LOCATION_INITIAL_POSITIONS[CARE_STORE];

describe('the Care Store is a registered location', () => {
  it('resolves to its own artwork', () => {
    expect(LOCATION_BACKGROUNDS[CARE_STORE]).toBe(BACKGROUND);
    expect(getBackgroundForLocation(CARE_STORE)).toBe(BACKGROUND);
  });

  it('carries a walk boundary, a depth ramp and an actor size', () => {
    expect(boundary).toBeDefined();
    expect(locationScalingConfig[BACKGROUND]).toBeDefined();
    expect(getBlobbiSizeForLocation(CARE_STORE)).toBe('xl');
  });

  it('spawns the Blobbi somewhere it can actually stand', () => {
    expect(standable(SPAWN)).toBe(true);
  });

  it('returns to the mall beside the storefront, on the mall floor', () => {
    const back = EXIT_POSITIONS[`shop:${CARE_STORE}`];
    expect(back).toBeDefined();
    expect(onFloor(back, mallBoundary)).toBe(true);
    // Horizontally under the facade it came out of, wherever that is: the
    // return point is derived from the storefront, so a facade that moves
    // without its exit moving is the failure this catches.
    expect(back.x).toBeCloseTo(CARE_STORE_FACADE.walkTarget.x, 1);
    // And on the MIDDLE level's walkway, not the ground floor.
    expect(back.y).toBeCloseTo(CARE_STORE_FACADE.walkTarget.y, 1);
  });

  it('puts the storefront approach point on the mall floor too', () => {
    expect(onFloor(CARE_STORE_FACADE.walkTarget, mallBoundary)).toBe(true);
  });
});

describe('the open floor is walkable', () => {
  const openFloor: [string, Position][] = [
    ['front centre, on the rug', { x: 50, y: 92 }],
    ['front left', { x: 8, y: 95 }],
    ['front right', { x: 95, y: 95 }],
    ['mid floor, left of the counter', { x: 28, y: 78 }],
    ['mid floor, right of the counter', { x: 70, y: 78 }],
    ['back aisle, left', { x: 25, y: 70 }],
    ['back aisle, right', { x: 72, y: 70 }],
    ['directly in front of the checkout', CARE_STORE_CHECKOUT.standPoint],
  ];

  it.each(openFloor)('%s is standable', (_label, point) => {
    expect(standable(point)).toBe(true);
  });

  it('the whole front of the room is one continuous walk', () => {
    expect(walkable({ x: 4, y: 95 }, { x: 96, y: 95 })).toBe(true);
  });
});

describe('the furniture cannot be walked through', () => {
  it('the back shelving stops the Blobbi — the wall is not floor', () => {
    // Deep inside the left shelf unit and the right display cabinet.
    expect(onFloor({ x: 28, y: 50 })).toBe(false);
    expect(onFloor({ x: 72, y: 55 })).toBe(false);
    // And a walk aimed at them is clamped short, onto the aisle, not through.
    expect(constrainPosition({ x: 28, y: 50 }, boundary).y).toBeGreaterThanOrEqual(68);
  });

  it('the checkout counter is solid across its whole width', () => {
    for (const x of [38, 45, 49, 55, 61]) {
      expect(isBlocked({ x, y: 70 })).toBe(true);
    }
  });

  it('there is no floor behind the counter to slip onto', () => {
    // The aisle band (y ∈ [68, 72]) is sealed everywhere the counter stands,
    // from the wall line down to the counter's own base at y = 70.5.
    for (const y of [68, 69, 70, 70.4]) {
      expect(standable({ x: 49, y }), `y=${y}`).toBe(false);
    }
    // The sliver below that base is the CUSTOMER side, and is open on purpose.
    expect(standable({ x: 49, y: 71.5 })).toBe(true);
  });

  it('the lower-centre-left toy box is solid', () => {
    // Its body, at its widest and at its narrow front corner alike.
    for (const point of [
      { x: 4, y: 72 },
      { x: 9, y: 77 },
      { x: 16, y: 74 },
      { x: 12, y: 82 },
    ]) {
      expect(isBlocked(point)).toBe(true);
      expect(standable(point)).toBe(false);
    }
  });

  it('a walk that crosses the toy box is stopped', () => {
    // Straight from the front-left floor toward the back-left shelving runs
    // through the box; there is no pathfinding, so it must not get through.
    expect(walkable({ x: 9, y: 95 }, { x: 9, y: 70 })).toBe(false);
  });

  it('the pet bed and the potted plant are solid', () => {
    expect(isBlocked({ x: 85, y: 74 })).toBe(true);
    expect(isBlocked({ x: 95, y: 77 })).toBe(true);
  });

  it('the Blobbi cannot leave the visible floor', () => {
    for (const point of [
      { x: 50, y: 120 }, // below the frame
      { x: -10, y: 90 }, // past the left wall
      { x: 130, y: 90 }, // past the right wall
      { x: 50, y: 10 }, // up in the ceiling lights
    ]) {
      const clamped = constrainPosition(point, boundary);
      expect(clamped.x).toBeGreaterThanOrEqual(1);
      expect(clamped.x).toBeLessThanOrEqual(99);
      expect(clamped.y).toBeGreaterThanOrEqual(68);
      expect(clamped.y).toBeLessThanOrEqual(99);
    }
  });
});

describe('the passages around the furniture stay open', () => {
  it('the spawn can reach the checkout in a straight line', () => {
    expect(walkable(SPAWN, CARE_STORE_CHECKOUT.standPoint)).toBe(true);
  });

  it('the Blobbi can walk around the toy box rather than through it', () => {
    // Front-left floor → below the box → up its right-hand side → back aisle.
    expect(walkable({ x: 9, y: 95 }, { x: 22, y: 88 })).toBe(true);
    expect(walkable({ x: 22, y: 88 }, { x: 25, y: 70 })).toBe(true);
  });

  it('the back aisle is a through-route on both sides of the counter', () => {
    // Left of the till: from the aisle's left end to the counter's near corner.
    expect(walkable({ x: 24, y: 70 }, { x: 37, y: 70 })).toBe(true);
    // Right of it: from the counter's far corner to the aisle's right end.
    expect(walkable({ x: 65, y: 70 }, { x: 75, y: 70 })).toBe(true);
  });

  it('the right-hand corner is reachable past the pet bed', () => {
    expect(walkable({ x: 70, y: 92 }, { x: 96, y: 92 })).toBe(true);
  });
});

describe('the checkout hotspot', () => {
  it('stands the player on open floor in front of the counter, never inside it', () => {
    expect(standable(CARE_STORE_CHECKOUT.standPoint)).toBe(true);
    expect(isBlocked(CARE_STORE_CHECKOUT.standPoint)).toBe(false);
  });

  it('is close enough to the counter to read as being served', () => {
    const counter = careStoreBlockers.find((b) => b.id === 'care-store-counter')!;
    const gap = CARE_STORE_CHECKOUT.standPoint.y - (counter.y + counter.height);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(3);
    // Horizontally centred under the counter.
    expect(CARE_STORE_CHECKOUT.standPoint.x).toBeGreaterThan(counter.x);
    expect(CARE_STORE_CHECKOUT.standPoint.x).toBeLessThan(counter.x + counter.width);
  });
});

describe('the room still matches its revised artwork', () => {
  /** A hotspot's placement, read back out of its Tailwind class string. */
  const placement = (className: string) => {
    const pct = (prop: string) => {
      const found = className.match(new RegExp(`${prop}-\\[([\\d.]+)%\\]`));
      if (!found) throw new Error(`no ${prop} in "${className}"`);
      return Number(found[1]);
    };
    const left = pct('left'), top = pct('top'), width = pct('w'), height = pct('h');
    return { left, top, width, height, right: left + width, bottom: top + height };
  };

  it('renders the artwork the geometry was measured against', () => {
    expect(getBackgroundForLocation(CARE_STORE)).toBe(BACKGROUND);
    expect(existsSync(join('public/assets/world/backgrounds', BACKGROUND))).toBe(true);
  });

  it('the checkout hotspot sits over the counter the artwork paints', () => {
    const box = placement(CARE_STORE_CHECKOUT.className);
    // Probed on the current plate: teal top x 38.0–64.1, starting at y = 51.7;
    // plinth base at y = 70.3.
    expect(box.left).toBeCloseTo(38, 1);
    expect(box.right).toBeCloseTo(64.1, 1);
    expect(box.top).toBeCloseTo(51.7, 1);
    expect(box.bottom).toBeCloseTo(70.3, 1);
  });

  it('the hotspot and the counter blocker describe the same counter', () => {
    const box = placement(CARE_STORE_CHECKOUT.className);
    const counter = careStoreBlockers.find((b) => b.id === 'care-store-counter')!;
    // Same span left to right: a hotspot wider or narrower than the thing it
    // blocks is a hotspot that has drifted off its artwork.
    expect(box.left).toBeCloseTo(counter.x, 1);
    expect(box.right).toBeCloseTo(counter.x + counter.width, 1);
    // The hotspot covers the painted body; the blocker is only its floor band,
    // so the hotspot must start above the blocker and end at its base.
    expect(box.top).toBeLessThan(counter.y);
    expect(box.bottom).toBeCloseTo(counter.y + counter.height, 0);
  });

  it('the fixtures the revision did NOT move were left alone', () => {
    // Re-probed on the new plate: toy box blue body x 1–18.3 y 67–83.5, pet bed
    // teal x 78.2–91.6 y 68–81.5, plant pot x 91.9–98.5 y 70–84.5. Each blocker
    // still covers the ink it was drawn for, so none of them was churned.
    const by = (id: string) => careStoreBlockers.find((b) => b.id === id)!;
    const covers = (id: string, x0: number, y0: number, x1: number, y1: number) => {
      const b = by(id);
      expect(b.x, id).toBeLessThanOrEqual(x0);
      expect(b.x + b.width, id).toBeGreaterThanOrEqual(x1);
      expect(b.y, id).toBeLessThanOrEqual(y0);
      expect(b.y + b.height, id).toBeGreaterThanOrEqual(y1);
    };
    covers('care-store-toy-box', 2, 71, 18, 83);
    covers('care-store-pet-bed', 79, 69, 91, 81);
    covers('care-store-plant', 92, 71, 98, 84);
  });

  it('the deeper floor is walkable all the way to the new shelving line', () => {
    // The revision moved the shelving base up to y ≈ 64.9–66.5, so the aisle
    // reaches y = 68 now rather than 68.5.
    expect(standable({ x: 30, y: 68 })).toBe(true);
    expect(standable({ x: 70, y: 68 })).toBe(true);
    // And no further: the shelving itself is not floor.
    expect(onFloor({ x: 30, y: 66 })).toBe(false);
    expect(onFloor({ x: 70, y: 66 })).toBe(false);
  });

  it('the checkout is still reachable from the spawn', () => {
    expect(walkable(SPAWN, CARE_STORE_CHECKOUT.standPoint)).toBe(true);
    expect(standable(CARE_STORE_CHECKOUT.standPoint)).toBe(true);
  });
});

describe('the blocker set itself', () => {
  it('has a stable, unique id per obstacle', () => {
    const ids = careStoreBlockers.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'care-store-toy-box',
      'care-store-counter',
      'care-store-pet-bed',
      'care-store-plant',
    ]);
  });

  it('is expressed in world percent, so it scales with the world', () => {
    for (const b of careStoreBlockers) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(100);
      expect(b.y + b.height).toBeLessThanOrEqual(100);
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('leaves the spawn point clear', () => {
    expect(isBlocked(SPAWN)).toBe(false);
  });
});
