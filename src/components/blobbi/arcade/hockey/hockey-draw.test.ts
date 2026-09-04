/**
 * The coordinate bridge between the pointer and the simulation.
 *
 * The one piece of presentation worth testing without a canvas, because it is
 * the only one that can be WRONG rather than merely ugly: if the pointer maps to
 * a different table unit than the one the drawing came from, the mallet appears
 * somewhere other than under the player's finger and no amount of tuning fixes
 * it.
 *
 * There are now TWO layouts, which doubles the ways that can happen, a rotation
 * applied in one direction and not the other, a mirror instead of a rotation, an
 * inverse that ignores which layout is in force. Every test below runs against
 * both.
 */

import { describe, it, expect } from 'vitest';

import {
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '@/arcade/hockey/table';

import {
  applyTableTransform,
  autoOrientation,
  fitTable,
  screenDownInSim,
  tableAspectRatio,
  tableDisplaySize,
  toTableUnits,
  type HockeyOrientation,
} from './hockey-draw';

const LAYOUTS: HockeyOrientation[] = ['landscape', 'portrait'];

/**
 * A minimal stand-in for the 2D context, recording only the transform.
 *
 * Enough to check the matrix without pulling a canvas implementation into the
 * test environment: and the matrix is the whole claim.
 */
function fakeContext() {
  let matrix = [1, 0, 0, 1, 0, 0];
  return {
    ctx: {
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        matrix = [a, b, c, d, e, f];
      },
    } as unknown as CanvasRenderingContext2D,
    /** Apply the recorded matrix to a simulation point, as canvas would. */
    project(x: number, y: number) {
      const [a, b, c, d, e, f] = matrix;
      return { x: a * x + c * y + e, y: b * x + d * y + f };
    },
    get matrix() {
      return matrix;
    },
  };
}

describe('the two layouts', () => {
  it('lay the simulation’s long axis along the box’s long side', () => {
    const wide = tableDisplaySize('landscape');
    expect(wide.width).toBe(TABLE_HEIGHT);
    expect(wide.height).toBe(TABLE_WIDTH);
    expect(wide.width).toBeGreaterThan(wide.height);

    const tall = tableDisplaySize('portrait');
    expect(tall.width).toBe(TABLE_WIDTH);
    expect(tall.height).toBe(TABLE_HEIGHT);
    expect(tall.height).toBeGreaterThan(tall.width);
  });

  it('describe themselves as the CSS ratio the layout box is given', () => {
    // The box's `aspect-ratio` and the transform are written in different files;
    // a mismatch would silently letterbox or squash the playfield.
    expect(tableAspectRatio('landscape')).toBe(`${TABLE_HEIGHT} / ${TABLE_WIDTH}`);
    expect(tableAspectRatio('portrait')).toBe(`${TABLE_WIDTH} / ${TABLE_HEIGHT}`);
  });
});

describe('choosing a layout from the box', () => {
  it('is measured, never guessed from a device', () => {
    // A desktop arcade window, a phone held upright, a phone held sideways.
    expect(autoOrientation(975, 460)).toBe('landscape');
    expect(autoOrientation(390, 700)).toBe('portrait');
    expect(autoOrientation(740, 350)).toBe('landscape');
  });

  it('gives a square box the wide layout, to match the scoreboard', () => {
    expect(autoOrientation(400, 400)).toBe('landscape');
  });

  it('answers safely before anything has been measured', () => {
    expect(autoOrientation(0, 0)).toBe('landscape');
    expect(autoOrientation(Number.NaN, 100)).toBe('landscape');
  });
});

describe('fitting the table into a box', () => {
  it.each(LAYOUTS)('scales uniformly in %s, so the table never stretches', (orientation) => {
    // A stretched table would mean a pointer position that maps to a unit the
    // simulation disagrees with, and rebounds that look wrong at every angle.
    const size = tableDisplaySize(orientation);

    const wide = fitTable(2000, 200, orientation);
    expect(wide.scale).toBe(200 / size.height);
    expect(wide.offsetY).toBe(0);
    expect(wide.offsetX).toBeGreaterThan(0);

    const tall = fitTable(200, 2000, orientation);
    expect(tall.scale).toBe(200 / size.width);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBeGreaterThan(0);
  });

  it.each(LAYOUTS)('centres the letterbox in %s', (orientation) => {
    const t = fitTable(400, 400, orientation);
    const size = tableDisplaySize(orientation);
    expect(t.offsetX * 2 + size.width * t.scale).toBeCloseTo(400, 6);
    expect(t.offsetY * 2 + size.height * t.scale).toBeCloseTo(400, 6);
  });

  it('carries the layout, so the inverse cannot disagree with the drawing', () => {
    expect(fitTable(400, 250, 'portrait').orientation).toBe('portrait');
    expect(fitTable(400, 250).orientation).toBe('landscape');
  });

  it('degrades to a zero scale rather than a negative one', () => {
    expect(fitTable(0, 0).scale).toBe(0);
  });

  it('uses more of a wide box wide than tall, and the reverse', () => {
    // The measured reason both layouts exist. A phone's game window is about
    // 452 × 143 of playfield; a portrait table there is a sliver.
    const area = (o: HockeyOrientation, w: number, h: number) => {
      const s = fitTable(w, h, o).scale;
      const size = tableDisplaySize(o);
      return size.width * s * (size.height * s);
    };
    expect(area('landscape', 452, 143)).toBeGreaterThan(area('portrait', 452, 143));
    expect(area('portrait', 390, 620)).toBeGreaterThan(area('landscape', 390, 620));
  });
});

describe('pointer input round-trips', () => {
  const BOXES: [number, number][] = [
    [452, 143], // a phone's game window, sideways
    [390, 620], // a phone held upright, expanded
    [975, 460], // a desktop arcade window
    [320, 200], // very small
    [200, 1000], // height-limited
  ];

  for (const orientation of LAYOUTS) {
    it.each(BOXES)(
      `is the exact inverse of the ${orientation} draw transform at %i × %i`,
      (w, h) => {
        const transform = fitTable(w, h, orientation);
        const { ctx, project } = fakeContext();
        // devicePixelRatio 1 keeps the projection in CSS pixels, which is the
        // space pointer events are reported in.
        applyTableTransform(ctx, transform, 1);

        for (const point of [
          { x: 0, y: 0 },
          { x: TABLE_WIDTH, y: TABLE_HEIGHT },
          { x: TABLE_CENTER_X, y: TABLE_CENTER_Y },
          { x: 12, y: 143 },
          { x: 88, y: 7 },
        ]) {
          const onScreen = project(point.x, point.y);
          const back = toTableUnits(onScreen, transform);
          expect(back.x).toBeCloseTo(point.x, 6);
          expect(back.y).toBeCloseTo(point.y, 6);
        }
      },
    );
  }

  it('puts the player’s end on the LEFT when the table is wide', () => {
    // Matching the scoreboard above it, which reads "You … Rival".
    const transform = fitTable(452, 143, 'landscape');
    const { ctx, project } = fakeContext();
    applyTableTransform(ctx, transform, 1);

    const playerGoal = project(TABLE_CENTER_X, TABLE_HEIGHT);
    const opponentGoal = project(TABLE_CENTER_X, 0);
    expect(playerGoal.x).toBeLessThan(opponentGoal.x);
    // And both on the same horizontal line, so the table is not skewed.
    expect(playerGoal.y).toBeCloseTo(opponentGoal.y, 6);
  });

  it('puts the player’s end at the BOTTOM when the table is tall', () => {
    // Nearest the hands holding the phone, which is the whole point of the
    // portrait layout.
    const transform = fitTable(390, 620, 'portrait');
    const { ctx, project } = fakeContext();
    applyTableTransform(ctx, transform, 1);

    const playerGoal = project(TABLE_CENTER_X, TABLE_HEIGHT);
    const opponentGoal = project(TABLE_CENTER_X, 0);
    expect(playerGoal.y).toBeGreaterThan(opponentGoal.y);
    expect(playerGoal.x).toBeCloseTo(opponentGoal.x, 6);
  });

  it.each(LAYOUTS)('%s is a rotation, never a mirror', (orientation) => {
    // A mirrored matrix would draw every rebound as its opposite while the
    // simulation computed the correct one, the hardest possible bug to see.
    const { ctx, matrix } = fakeContext();
    applyTableTransform(ctx, fitTable(400, 250, orientation), 1);
    const [a, b, c, d] = matrix;
    expect(a * d - b * c).toBeGreaterThan(0);
  });

  it.each(LAYOUTS)('accounts for the device pixel ratio in %s', (orientation) => {
    const transform = fitTable(400, 250, orientation);
    const one = fakeContext();
    const two = fakeContext();
    applyTableTransform(one.ctx, transform, 1);
    applyTableTransform(two.ctx, transform, 2);

    const at1 = one.project(TABLE_CENTER_X, TABLE_CENTER_Y);
    const at2 = two.project(TABLE_CENTER_X, TABLE_CENTER_Y);
    expect(at2.x).toBeCloseTo(at1.x * 2, 6);
    expect(at2.y).toBeCloseTo(at1.y * 2, 6);
  });

  it('maps the SAME screen point to different table units in each layout', () => {
    // The bug this guards against is an inverse that ignores the layout: it
    // would round-trip perfectly against its own matrix and be wrong the moment
    // the player switched.
    const point = { x: 300, y: 90 };
    const wide = toTableUnits(point, fitTable(452, 143, 'landscape'));
    const tall = toTableUnits(point, fitTable(452, 143, 'portrait'));
    expect(wide).not.toEqual(tall);
  });

  it('answers with the centre spot rather than a NaN when nothing is measured yet', () => {
    // The first frame after mount, before the box has been measured.
    const centre = toTableUnits(
      { x: 10, y: 10 },
      { scale: 0, offsetX: 0, offsetY: 0, orientation: 'landscape' },
    );
    expect(centre).toEqual({ x: TABLE_CENTER_X, y: TABLE_CENTER_Y });
  });
});

describe('screen-down, for drop shadows', () => {
  it('is the simulation axis that points down the screen in each layout', () => {
    // Getting this wrong throws every shadow out to one side, which reads as a
    // rendering bug rather than as a shadow.
    for (const orientation of LAYOUTS) {
      const down = screenDownInSim(orientation);
      const { ctx, project } = fakeContext();
      applyTableTransform(ctx, fitTable(400, 400, orientation), 1);

      const origin = project(TABLE_CENTER_X, TABLE_CENTER_Y);
      const shifted = project(TABLE_CENTER_X + down.x, TABLE_CENTER_Y + down.y);
      expect(shifted.y).toBeGreaterThan(origin.y);
      expect(shifted.x).toBeCloseTo(origin.x, 6);
    }
  });
});
