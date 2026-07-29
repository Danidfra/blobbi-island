/**
 * The coordinate bridge — the one place a pointer becomes a table unit.
 *
 * Everything here is arithmetic, and it is the arithmetic the whole game rests
 * on: if `toTableUnits` is not the exact inverse of `applyTableTransform`, the
 * cue aims somewhere other than where the player pointed, and no amount of
 * tuning fixes it.
 */
import { describe, it, expect } from 'vitest';

import {
  BALL_RADIUS,
  POCKETS,
  TABLE_CENTER_Y,
  TABLE_LENGTH,
  TABLE_WIDTH,
} from '@/arcade/pool/table';
import {
  RAIL_WIDTH,
  autoOrientation,
  fitTable,
  screenDownInSim,
  tableDisplaySize,
  tableOuterSize,
  textRotationFor,
  toCanvasPixels,
  toTableUnits,
  type PoolOrientation,
} from './pool-draw';

const LAYOUTS: readonly PoolOrientation[] = ['landscape', 'portrait'];

describe('choosing a layout', () => {
  it('lays the long axis across a wide box and down a tall one', () => {
    expect(autoOrientation(956, 382)).toBe('landscape'); // the arcade window
    expect(autoOrientation(740, 350)).toBe('landscape'); // a phone on its side
    expect(autoOrientation(390, 700)).toBe('portrait'); // a phone upright
    expect(autoOrientation(354, 743)).toBe('portrait');
  });

  it('breaks a tie towards landscape, and refuses to answer a zero box', () => {
    expect(autoOrientation(400, 400)).toBe('landscape');
    expect(autoOrientation(0, 400)).toBe('landscape');
    expect(autoOrientation(400, 0)).toBe('landscape');
    expect(autoOrientation(Number.NaN, 400)).toBe('landscape');
  });

  it('turns the table a quarter, never stretches it', () => {
    expect(tableDisplaySize('landscape')).toEqual({ width: TABLE_LENGTH, height: TABLE_WIDTH });
    expect(tableDisplaySize('portrait')).toEqual({ width: TABLE_WIDTH, height: TABLE_LENGTH });
    // Same area either way round, which is what "a rotation" means.
    const a = tableOuterSize('landscape');
    const b = tableOuterSize('portrait');
    expect(a.width * a.height).toBe(b.width * b.height);
  });

  it('reserves room for the rails outside the cloth', () => {
    const outer = tableOuterSize('landscape');
    expect(outer.width).toBe(TABLE_LENGTH + RAIL_WIDTH * 2);
    expect(outer.height).toBe(TABLE_WIDTH + RAIL_WIDTH * 2);
  });
});

describe('fitting the table into a box', () => {
  it('scales uniformly and centres what is left over', () => {
    const t = fitTable(1000, 400, 'landscape');
    const outer = tableOuterSize('landscape');
    expect(t.scale).toBe(Math.min(1000 / outer.width, 400 / outer.height));
    // The rail inset is part of the offset, so table unit (0,0) is the cloth's
    // corner rather than the frame's.
    expect(t.offsetX).toBeCloseTo((1000 - outer.width * t.scale) / 2 + RAIL_WIDTH * t.scale, 9);
    expect(t.offsetY).toBeCloseTo((400 - outer.height * t.scale) / 2 + RAIL_WIDTH * t.scale, 9);
  });

  it('never lets the table spill out of its box, whatever shape it is', () => {
    for (const orientation of LAYOUTS) {
      for (const [w, h] of [
        [1000, 400],
        [320, 568],
        [390, 844],
        [740, 350],
        [100, 2000],
        [2000, 100],
      ]) {
        const t = fitTable(w, h, orientation);
        const outer = tableOuterSize(orientation);
        expect(outer.width * t.scale, `${orientation} ${w}x${h}`).toBeLessThanOrEqual(w + 1e-9);
        expect(outer.height * t.scale, `${orientation} ${w}x${h}`).toBeLessThanOrEqual(h + 1e-9);
        expect(t.scale).toBeGreaterThan(0);
      }
    }
  });

  it('survives a zero box rather than producing NaN', () => {
    const t = fitTable(0, 0, 'landscape');
    expect(Number.isFinite(t.scale)).toBe(true);
    // And the inverse still answers, rather than poisoning the aim.
    const point = toTableUnits({ x: 10, y: 10 }, t);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('pixels to table units and back', () => {
  it('round-trips exactly, in both layouts', () => {
    for (const orientation of LAYOUTS) {
      const transform = fitTable(900, 500, orientation);
      for (const point of [
        { x: 0, y: 0 },
        { x: TABLE_LENGTH, y: TABLE_WIDTH },
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 1.5, y: 98.5 },
        ...POCKETS,
      ]) {
        const back = toTableUnits(toCanvasPixels(point, transform), transform);
        expect(back.x, `${orientation} ${point.x},${point.y}`).toBeCloseTo(point.x, 6);
        expect(back.y, `${orientation} ${point.x},${point.y}`).toBeCloseTo(point.y, 6);
      }
    }
  });

  it('is a rotation, not a mirror — so a rebound on screen is the real one', () => {
    // Checked by construction: two perpendicular table vectors must stay
    // perpendicular AND keep their handedness on screen.
    for (const orientation of LAYOUTS) {
      const t = fitTable(900, 500, orientation);
      const origin = toCanvasPixels({ x: 100, y: 50 }, t);
      const alongX = toCanvasPixels({ x: 110, y: 50 }, t);
      const alongY = toCanvasPixels({ x: 100, y: 60 }, t);

      const ux = { x: alongX.x - origin.x, y: alongX.y - origin.y };
      const uy = { x: alongY.x - origin.x, y: alongY.y - origin.y };
      expect(ux.x * uy.x + ux.y * uy.y).toBeCloseTo(0, 6); // perpendicular
      // Positive cross product in screen space (y down) for both layouts: the
      // determinant is +1, so no layout flips the table.
      expect(ux.x * uy.y - ux.y * uy.x).toBeGreaterThan(0);
    }
  });

  it('puts the break end where the player’s hands are', () => {
    // Landscape: on the LEFT, matching the "You … Rival" scoreboard.
    const landscape = fitTable(900, 500, 'landscape');
    const breakEndL = toCanvasPixels({ x: 0, y: TABLE_CENTER_Y }, landscape);
    const rackEndL = toCanvasPixels({ x: TABLE_LENGTH, y: TABLE_CENTER_Y }, landscape);
    expect(breakEndL.x).toBeLessThan(rackEndL.x);
    expect(breakEndL.y).toBeCloseTo(rackEndL.y, 6);

    // Portrait: at the BOTTOM, nearest the hands holding the phone.
    const portrait = fitTable(390, 800, 'portrait');
    const breakEndP = toCanvasPixels({ x: 0, y: TABLE_CENTER_Y }, portrait);
    const rackEndP = toCanvasPixels({ x: TABLE_LENGTH, y: TABLE_CENTER_Y }, portrait);
    expect(breakEndP.y).toBeGreaterThan(rackEndP.y);
    expect(breakEndP.x).toBeCloseTo(rackEndP.x, 6);
  });

  it('maps a pointer in the rail margin to a point just off the cloth', () => {
    // Which is exactly what should happen: the aim is clamped by the simulation,
    // not by refusing the coordinate.
    const t = fitTable(900, 500, 'landscape');
    const cloth = toCanvasPixels({ x: 0, y: 0 }, t);
    const inRail = toTableUnits({ x: cloth.x - RAIL_WIDTH * t.scale * 0.5, y: cloth.y }, t);
    expect(inRail.x).toBeLessThan(0);
    expect(inRail.x).toBeGreaterThan(-RAIL_WIDTH);
  });

  it('scales distances by exactly the transform’s scale', () => {
    for (const orientation of LAYOUTS) {
      const t = fitTable(900, 500, orientation);
      const a = toCanvasPixels({ x: 40, y: 40 }, t);
      const b = toCanvasPixels({ x: 40 + BALL_RADIUS, y: 40 }, t);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(BALL_RADIUS * t.scale, 6);
    }
  });
});

describe('which way is down', () => {
  it('points shadows at the bottom of the SCREEN, not at +y', () => {
    for (const orientation of LAYOUTS) {
      const t = fitTable(900, 500, orientation);
      const down = screenDownInSim(orientation);
      const from = toCanvasPixels({ x: 100, y: 50 }, t);
      const to = toCanvasPixels({ x: 100 + down.x, y: 50 + down.y }, t);
      expect(to.y - from.y, orientation).toBeGreaterThan(0);
      expect(Math.abs(to.x - from.x), orientation).toBeLessThan(1e-6);
    }
  });
});

describe('ball numbers stay upright', () => {
  it('counter-rotates the text by whatever the layout turned it', () => {
    expect(textRotationFor('landscape')).toBe(0);
    expect(textRotationFor('portrait')).toBeCloseTo(Math.PI / 2, 9);
  });

  it('sends the text’s own +x axis along the SCREEN’s +x, in both layouts', () => {
    for (const orientation of LAYOUTS) {
      const t = fitTable(900, 500, orientation);
      const rotation = textRotationFor(orientation);
      // A unit step along the rotated local x axis, expressed in table units…
      const step = { x: Math.cos(rotation), y: Math.sin(rotation) };
      const from = toCanvasPixels({ x: 100, y: 50 }, t);
      const to = toCanvasPixels({ x: 100 + step.x, y: 50 + step.y }, t);
      // …must run left-to-right on screen, which is what "upright" means.
      expect(to.x - from.x, orientation).toBeGreaterThan(0);
      expect(Math.abs(to.y - from.y), orientation).toBeLessThan(1e-6);
    }
  });
});
