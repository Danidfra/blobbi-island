/**
 * Canonical world-coordinate conversions (Phase 3).
 *
 * These are the mechanics every pointer→world and object→target calculation
 * routes through, so the tests pin the geometry: anisotropic percent space,
 * uniform-scale invariance (transformed viewport rects), exact round-trips,
 * and the explicit absence of clamping.
 */
import { describe, it, expect } from 'vitest';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WORLD_PX_PER_PERCENT_X,
  WORLD_PX_PER_PERCENT_Y,
  clientPointToWorldPercent,
  worldPercentToDesignPx,
  designPxToWorldPercent,
  elementFractionToWorldPercent,
  worldDistancePx,
} from './world-coordinates';

describe('world dimensions', () => {
  it('is the fixed non-square 1046×697 design space', () => {
    expect(WORLD_WIDTH).toBe(1046);
    expect(WORLD_HEIGHT).toBe(697);
    expect(WORLD_WIDTH).not.toBe(WORLD_HEIGHT);
    expect(WORLD_PX_PER_PERCENT_X).toBeCloseTo(10.46);
    expect(WORLD_PX_PER_PERCENT_Y).toBeCloseTo(6.97);
  });
});

describe('clientPointToWorldPercent', () => {
  it('converts a client point against the surface rect', () => {
    const rect = { left: 0, top: 0, width: 1046, height: 697 };
    expect(clientPointToWorldPercent(523, 348.5, rect)).toEqual({ x: 50, y: 50 });
    expect(clientPointToWorldPercent(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(clientPointToWorldPercent(1046, 697, rect)).toEqual({ x: 100, y: 100 });
  });

  it('is invariant under the uniform world scale (transformed rects)', () => {
    // The same world point, viewed through a 0.5×-scaled, offset surface.
    const rect = { left: 120, top: 40, width: 523, height: 348.5 };
    const p = clientPointToWorldPercent(120 + 523 * 0.25, 40 + 348.5 * 0.75, rect);
    expect(p?.x).toBeCloseTo(25);
    expect(p?.y).toBeCloseTo(75);
  });

  it('does NOT clamp: points outside the surface map outside 0..100', () => {
    const rect = { left: 100, top: 100, width: 200, height: 100 };
    const p = clientPointToWorldPercent(50, 250, rect);
    expect(p?.x).toBeCloseTo(-25);
    expect(p?.y).toBeCloseTo(150);
  });

  it('returns null for a zero-size surface', () => {
    expect(clientPointToWorldPercent(10, 10, { left: 0, top: 0, width: 0, height: 100 })).toBeNull();
    expect(clientPointToWorldPercent(10, 10, { left: 0, top: 0, width: 100, height: 0 })).toBeNull();
  });
});

describe('worldPercentToDesignPx / designPxToWorldPercent', () => {
  it('converts anisotropically per axis', () => {
    const px = worldPercentToDesignPx({ x: 10, y: 10 });
    expect(px.x).toBeCloseTo(104.6);
    expect(px.y).toBeCloseTo(69.7);
    // The SAME percent delta is a different physical length per axis.
    expect(px.x).not.toBeCloseTo(px.y);
  });

  it('round-trips exactly', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 50, y: 75 },
      { x: 33.333, y: 66.667 },
      { x: 100, y: 100 },
      { x: -5, y: 120 }, // out-of-range values survive too (no hidden clamp)
    ];
    for (const p of samples) {
      const back = designPxToWorldPercent(worldPercentToDesignPx(p));
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBeCloseTo(p.y, 10);
    }
  });
});

describe('elementFractionToWorldPercent', () => {
  const surface = { left: 0, top: 0, width: 1046, height: 697 };

  it('maps an element-relative fraction onto the surface', () => {
    // A 104.6×69.7 element at (104.6, 69.7): 10% in from each surface edge.
    const el = { left: 104.6, top: 69.7, width: 104.6, height: 69.7 };
    const center = elementFractionToWorldPercent(el, surface, { x: 0.5, y: 0.5 });
    expect(center?.x).toBeCloseTo(15);
    expect(center?.y).toBeCloseTo(15);
  });

  it('supports fractions outside 0..1 (floor below a sprite)', () => {
    const el = { left: 0, top: 0, width: 104.6, height: 69.7 };
    const below = elementFractionToWorldPercent(el, surface, { x: 0.5, y: 1.05 });
    expect(below?.x).toBeCloseTo(5);
    expect(below?.y).toBeCloseTo(10.5);
  });

  it('is invariant under a uniform scale of both rects', () => {
    const el = { left: 200, top: 100, width: 100, height: 50 };
    const raw = elementFractionToWorldPercent(el, surface, { x: 0.25, y: 0.9 });
    const s = 0.37;
    const scaled = elementFractionToWorldPercent(
      { left: 10 + el.left * s, top: 20 + el.top * s, width: el.width * s, height: el.height * s },
      { left: 10 + surface.left * s, top: 20 + surface.top * s, width: surface.width * s, height: surface.height * s },
      { x: 0.25, y: 0.9 },
    );
    expect(scaled?.x).toBeCloseTo(raw!.x);
    expect(scaled?.y).toBeCloseTo(raw!.y);
  });

  it('returns null for a zero-size surface', () => {
    const el = { left: 0, top: 0, width: 10, height: 10 };
    expect(
      elementFractionToWorldPercent(el, { left: 0, top: 0, width: 0, height: 0 }, { x: 0.5, y: 0.5 }),
    ).toBeNull();
  });
});

describe('worldDistancePx', () => {
  it('is isotropic in design px, not in percent', () => {
    // 10% along x is 104.6 px; 10% along y is only 69.7 px.
    expect(worldDistancePx({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(104.6);
    expect(worldDistancePx({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(69.7);
  });

  it('matches the design-px hypotenuse for mixed deltas', () => {
    const d = worldDistancePx({ x: 10, y: 20 }, { x: 13, y: 24 });
    const dx = 3 * WORLD_PX_PER_PERCENT_X;
    const dy = 4 * WORLD_PX_PER_PERCENT_Y;
    expect(d).toBeCloseTo(Math.hypot(dx, dy));
  });
});
