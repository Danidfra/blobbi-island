/**
 * Where the Blobbi is drawn relative to the Plaza's balcony-and-staircase
 * overlay — the regression that motivated x-limited depth bands.
 *
 * The overlay is one image carrying the railing AND the stairs. A Blobbi on
 * the upper corridor must pass behind the railing; a Blobbi on the landing or
 * the stairs — at the very same y — must be in front of the steps. A y-only
 * band cannot say both, and it used to say "in front" for the whole balcony,
 * so a Blobbi walking behind the railing was drawn over it.
 *
 * Like `mine-cave-depth.test.ts`, the questions are asked of the real walk
 * boundary and the real `calculateBlobbiZIndex`, not of copied numbers.
 */
import { describe, it, expect } from 'vitest';

import { calculateBlobbiZIndex } from './interactive-elements-config';
import { locationBoundaries } from './location-boundaries';
import { isOnFloor } from './blobbi-route';
import {
  PLAZA_DEPTH,
  PLAZA_FOUNTAIN,
  PLAZA_INSIDE_BACKGROUND,
  PLAZA_INSIDE_SPAWN,
  PLAZA_OCCLUSION,
  plazaStorefronts,
} from './plaza-inside-config';
import type { Position } from './types';

const PLAZA = locationBoundaries[PLAZA_INSIDE_BACKGROUND];
const z = (p: Position) => calculateBlobbiZIndex(p.y, PLAZA_INSIDE_BACKGROUND, p.x);
const OVERLAY = PLAZA_DEPTH.overlay;

const onFloor = (p: Position) => {
  expect(isOnFloor(p, PLAZA), `${p.x},${p.y} is not walkable`).toBe(true);
  return p;
};

describe('behind the railing', () => {
  it('a Blobbi anywhere on the upper corridor is drawn behind the overlay', () => {
    const corridor: Position[] = [
      { x: 20, y: 46 }, // far end of the left wing
      { x: 21.8, y: 46.5 }, // in front of the Toy Shop
      { x: 27, y: 47 }, // where the wing meets the centre run
      { x: 35, y: 46 }, // centre run, left of the stairs
      { x: 42, y: 47.5 }, // hard against the stair rail
      { x: 58, y: 47.5 }, // hard against the other stair rail
      { x: 65, y: 46 }, // centre run, right of the stairs
      { x: 78, y: 46.5 }, // in front of Books
      { x: 80, y: 46 }, // far end of the right wing
    ];
    for (const p of corridor) {
      expect(z(onFloor(p)), `${p.x},${p.y}`).toBeLessThan(OVERLAY);
      expect(z(p)).toBeGreaterThan(PLAZA_DEPTH.door);
    }
  });

  it('holds at the upper storefronts\' stand points', () => {
    for (const store of plazaStorefronts) {
      if (store.standPoint.y >= PLAZA_OCCLUSION.railingBase) continue;
      expect(z(store.standPoint), store.id).toBeLessThan(OVERLAY);
    }
  });
});

describe('on the landing and the stairs', () => {
  it('the arrival point at the door is in front of the overlay', () => {
    expect(z(onFloor(PLAZA_INSIDE_SPAWN))).toBeGreaterThan(OVERLAY);
  });

  it('the whole descent is in front of the overlay, top step to ground floor', () => {
    for (let y = PLAZA_OCCLUSION.landingTop; y <= 74; y += 0.5) {
      const p = onFloor({ x: 50, y });
      expect(z(p), `y=${y}`).toBeGreaterThan(OVERLAY);
    }
  });

  it('at the same height, the rail is the line: corridor behind, landing in front', () => {
    const y = 46.5;
    const [railLeft, railRight] = PLAZA_OCCLUSION.stairsX;
    expect(z(onFloor({ x: railLeft - 1, y }))).toBeLessThan(OVERLAY);
    expect(z(onFloor({ x: railLeft + 1, y }))).toBeGreaterThan(OVERLAY);
    expect(z(onFloor({ x: railRight - 1, y }))).toBeGreaterThan(OVERLAY);
    expect(z(onFloor({ x: railRight + 1, y }))).toBeLessThan(OVERLAY);
  });

  it('falls back to "behind" when only y is known — a y-only caller is never put in front of the railing', () => {
    const y = 46.5;
    expect(calculateBlobbiZIndex(y, PLAZA_INSIDE_BACKGROUND)).toBeLessThan(OVERLAY);
  });
});

describe('the ground floor', () => {
  it('is in front of the overlay everywhere', () => {
    for (const p of [
      { x: 2, y: 78 },
      { x: 13.5, y: 76 },
      { x: 50, y: 80 },
      { x: 86.7, y: 76 },
      { x: 98, y: 99 },
    ]) {
      expect(z(onFloor(p)), `${p.x},${p.y}`).toBeGreaterThan(OVERLAY);
    }
  });

  it('is behind the fountain until the feet pass its plinth, then in front of it', () => {
    const { frontLineY } = PLAZA_FOUNTAIN;
    expect(z(onFloor({ x: 30, y: frontLineY - 0.5 }))).toBeLessThan(PLAZA_DEPTH.fountain);
    expect(z(onFloor({ x: 50, y: frontLineY + 0.5 }))).toBeGreaterThan(PLAZA_DEPTH.fountain);
  });
});
