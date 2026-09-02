/**
 * The Mine's depth ordering, against the cave the artwork actually paints.
 *
 * ## The bug this file exists for
 *
 * The Blobbi rendered BEHIND the cave arch across the whole walk corridor, so a
 * player standing on open path — feet nine percent of the world below the rock —
 * had their head and half their body sliced away by the arch's posts. It only
 * ever looked right dead centre, because that is where the arch is transparent.
 *
 * The cause is that occlusion here depends on X as well as Y and a `z-index`
 * band can only speak about Y. The corridor is `x 42–58`; the arch's opening is
 * barely `x 44–58` at body height and narrows to `47–55` near its base. Any band
 * that puts the corridor "behind" therefore breaks at both ends of it.
 *
 * So the band is drawn where the ROCK STANDS instead: `mine-cave-config.ts`
 * anchors the arch at `bottom: 24%`, so its base meets the path at y = 76.
 * Everything below that is in front of it.
 *
 * The assertions below are geometric, not snapshots: they sample the real walk
 * boundary and ask the real `calculateBlobbiZIndex` whether each reachable point
 * ends up in front of the real arch depth from `mineCaveStructure`.
 */

import { describe, it, expect } from 'vitest';

import { calculateBlobbiZIndex } from './interactive-elements-config';
import { locationBoundaries } from './location-boundaries';
import { constrainPosition } from './boundaries';
import { mineCaveStructure } from './mine-cave-config';
import type { Position } from './types';

const MINE = 'mine-open.webp';
const boundary = locationBoundaries[MINE];

/** Where the arch's rock meets the path, from the cave's own placement. */
const ARCH_BASE_Y = 100 - mineCaveStructure.wrapper.bottomPercent;

const ARCH_Z = mineCaveStructure.depth.front;
const MOUTH_Z = mineCaveStructure.depth.mouth;

/** A point the walk boundary does not have to move — i.e. somewhere reachable. */
function reachable(point: Position): boolean {
  const clamped = constrainPosition(point, boundary);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

/** Every walkable point on a 1 % lattice, which is finer than the Blobbi moves. */
function walkableLattice(): Position[] {
  const points: Position[] = [];
  for (let x = 0; x <= 100; x += 1) {
    for (let y = 40; y <= 100; y += 0.5) {
      const p = { x, y };
      if (reachable(p)) points.push(p);
    }
  }
  return points;
}

describe('the arch stands where the config says it does', () => {
  it('meets the path at y = 76, and that is the depth line', () => {
    expect(ARCH_BASE_Y).toBe(76);
    // The arch is in front of its own opening, so the two are orderable at all.
    expect(ARCH_Z).toBeGreaterThan(MOUTH_Z);
  });

  it('the walk corridor is entirely in front of it', () => {
    // The boundary's deepest point is y = 79 — three percent of the world short
    // of the rock. This is the fact the depth bands have to respect.
    const deepest = Math.min(...walkableLattice().map((p) => p.y));
    expect(deepest).toBeGreaterThan(ARCH_BASE_Y);
  });
});

describe('every place the Blobbi can stand renders in front of the cave', () => {
  const lattice = walkableLattice();

  it('has somewhere to stand at all', () => {
    expect(lattice.length).toBeGreaterThan(500);
  });

  it('never sorts the Blobbi behind the arch', () => {
    const behind = lattice.filter(
      (p) => calculateBlobbiZIndex(p.y, MINE) < ARCH_Z,
    );
    expect(behind).toEqual([]);
  });

  it('keeps it above the hotspot as well, so the cave is never clicked through it', () => {
    for (const p of lattice) {
      expect(calculateBlobbiZIndex(p.y, MINE)).toBeGreaterThan(
        mineCaveStructure.depth.hotspot,
      );
    }
  });
});

describe('the positions the bug was visible at', () => {
  /**
   * Reproduced from the running game: at each of these the arch's post or its
   * rock pile cut the Blobbi in half, because the old band flipped at y = 85.
   */
  const WAS_BROKEN: Position[] = [
    { x: 43, y: 84 },   // corridor's left edge, behind the left post
    { x: 57, y: 84 },   // corridor's right edge, behind the right post
    { x: 43, y: 80 },
    { x: 57, y: 80 },
    { x: 50, y: 84 },
    { x: 50, y: 80 },   // dead centre — the one place it used to look right
  ];

  it.each(WAS_BROKEN)('(%s) is reachable and now renders in front', (...args) => {
    const point = args[0] as unknown as Position;
    expect(reachable(point), `${point.x},${point.y} unreachable`).toBe(true);
    expect(calculateBlobbiZIndex(point.y, MINE)).toBeGreaterThan(ARCH_Z);
  });

  it('the front of the path was never broken and still is not', () => {
    for (const y of [88, 92, 96, 99]) {
      expect(calculateBlobbiZIndex(y, MINE)).toBeGreaterThan(ARCH_Z);
    }
  });
});

describe('the depth model still has two bands, not one flat answer', () => {
  it('states the in-the-mouth reading for feet above the rock line', () => {
    // Unreachable today — the corridor stops at y = 79 — but true, and the
    // reason this is a band table rather than a constant. A Blobbi whose feet
    // were inside the mouth belongs behind the arch and in front of the tunnel.
    const inside = calculateBlobbiZIndex(ARCH_BASE_Y - 4, MINE);
    expect(inside).toBeLessThan(ARCH_Z);
    expect(inside).toBeGreaterThan(MOUTH_Z);
  });

  it('flips exactly at the rock line, not before it', () => {
    // Feet a hair in front of the rock: in front. A hair behind: occluded.
    expect(calculateBlobbiZIndex(ARCH_BASE_Y + 0.5, MINE)).toBeGreaterThan(ARCH_Z);
    expect(calculateBlobbiZIndex(ARCH_BASE_Y - 0.5, MINE)).toBeLessThan(ARCH_Z);
  });
});

describe('nothing else about the Mine moved', () => {
  it('keeps the corridor and the forecourt exactly as they were', () => {
    expect(boundary).toEqual({
      shape: 'composite',
      areas: [
        { type: 'rectangle', x: [42, 58], y: [79, 86.9] },
        { type: 'rectangle', x: [10, 90], y: [86.9, 100] },
      ],
    });
  });

  it('leaves the cave structure placement untouched', () => {
    expect(mineCaveStructure.wrapper).toEqual({
      centerXPercent: 50,
      bottomPercent: 24,
      widthPercent: 70,
    });
    expect(mineCaveStructure.approach).toEqual({ x: 50, y: 82.4 });
  });
});
