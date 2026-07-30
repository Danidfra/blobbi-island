/**
 * Phase 2 coverage: the ground-anchor conversion helpers and the isotropic
 * world-px distance model (docs/blobbi-actor-position-migration-notes.md).
 */
import { describe, it, expect } from 'vitest';

import {
  blobbiHalfHeightPercent,
  centerToGround,
  groundToCenter,
  actorVisualFocusPoint,
  worldDistancePx,
} from './blobbi-ground';
import { BLOBBI_RENDER_SIZE_PX } from '@/components/blobbi/lib/blobbi-render-size';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/lib/world-coordinates';

const SIZES = ['sm', 'lg', 'xl'] as const;
const SCALES = [0.6, 1, 1.6] as const;

describe('center↔ground conversion', () => {
  it('half-height follows the canonical renderer box, the scale, and world height', () => {
    for (const size of SIZES) {
      for (const scale of SCALES) {
        const expected = ((BLOBBI_RENDER_SIZE_PX[size] / 2) * scale * 100) / WORLD_HEIGHT;
        expect(blobbiHalfHeightPercent(size, scale)).toBeCloseTo(expected, 10);
      }
    }
    // Anchor values (world is 697 design px tall).
    expect(blobbiHalfHeightPercent('xl', 1)).toBeCloseTo((64 * 100) / 697, 5);
    expect(blobbiHalfHeightPercent('lg', 1)).toBeCloseTo((48 * 100) / 697, 5);
  });

  it('centerToGround and groundToCenter are exact inverses for every size × scale', () => {
    const point = { x: 42.5, y: 61.2 };
    for (const size of SIZES) {
      for (const scale of SCALES) {
        const ground = centerToGround(point, size, scale);
        expect(ground.x).toBe(point.x); // x is unaffected
        expect(ground.y).toBeGreaterThan(point.y); // feet are BELOW the center
        const back = groundToCenter(ground, size, scale);
        expect(back.x).toBeCloseTo(point.x, 10);
        expect(back.y).toBeCloseTo(point.y, 10);
      }
    }
  });

  it('scale changes the offset proportionally (depth-scaled bodies have nearer feet)', () => {
    const at06 = blobbiHalfHeightPercent('xl', 0.6);
    const at10 = blobbiHalfHeightPercent('xl', 1);
    const at16 = blobbiHalfHeightPercent('xl', 1.6);
    expect(at06).toBeCloseTo(at10 * 0.6, 10);
    expect(at16).toBeCloseTo(at10 * 1.6, 10);
  });

  it('the visual focus point (gaze target) is the body center above the ground point', () => {
    const ground = { x: 30, y: 80 };
    const focus = actorVisualFocusPoint(ground, 'lg', 1.2);
    expect(focus.x).toBe(30);
    expect(focus.y).toBeCloseTo(80 - blobbiHalfHeightPercent('lg', 1.2), 10);
  });
});

describe('isotropic world-px distance', () => {
  it('the same physical distance measures identically on x and y axes', () => {
    const origin = { x: 50, y: 50 };
    // 100 design px along each axis, expressed in percent units.
    const alongX = { x: 50 + (100 / WORLD_WIDTH) * 100, y: 50 };
    const alongY = { x: 50, y: 50 + (100 / WORLD_HEIGHT) * 100 };
    expect(worldDistancePx(origin, alongX)).toBeCloseTo(100, 6);
    expect(worldDistancePx(origin, alongY)).toBeCloseTo(100, 6);
  });

  it('is viewport-independent by construction (uses only the 1046×697 design space)', () => {
    // Same percent delta always yields the same px distance — nothing about
    // the browser window is consulted.
    expect(worldDistancePx({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(WORLD_WIDTH, 6);
    expect(worldDistancePx({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(WORLD_HEIGHT, 6);
  });
});
