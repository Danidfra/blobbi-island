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
  PLAZA_CORRIDOR,
  PLAZA_DEPTH,
  PLAZA_FOUNTAIN,
  PLAZA_INSIDE_BACKGROUND,
  PLAZA_INSIDE_SPAWN,
  PLAZA_OCCLUSION,
  PLAZA_STAIRS,
  plazaCorridorPointAt,
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
      PLAZA_CORRIDOR.left, // far left end of the parapet, high on the wing
      10,
      21.8, // in front of the Toy Shop
      27, // the kink
      35, // centre run, left of the stairs
      PLAZA_STAIRS.railsTop[0] + 1, // in the margin beside the stair rail
      PLAZA_OCCLUSION.stairsX[0] - 0.01, // a hair outside the walkable column
      PLAZA_OCCLUSION.stairsX[1] + 0.01,
      PLAZA_STAIRS.railsTop[1] - 1,
      65, // centre run, right of the stairs
      78, // in front of Books
      90,
      PLAZA_CORRIDOR.right, // far right end of the parapet
    ].map(plazaCorridorPointAt);
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

  it('at the same height, the walkable column is the line: corridor behind, landing in front', () => {
    const y = PLAZA_CORRIDOR.y;
    const [columnLeft, columnRight] = PLAZA_OCCLUSION.stairsX;
    expect(z(onFloor({ x: columnLeft - 1, y }))).toBeLessThan(OVERLAY);
    expect(z(onFloor({ x: columnLeft + 1, y }))).toBeGreaterThan(OVERLAY);
    expect(z(onFloor({ x: columnRight - 1, y }))).toBeGreaterThan(OVERLAY);
    expect(z(onFloor({ x: columnRight + 1, y }))).toBeLessThan(OVERLAY);
  });

  it('falls back to "behind" when only y is known — a y-only caller is never put in front of the railing', () => {
    const y = PLAZA_CORRIDOR.y;
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
