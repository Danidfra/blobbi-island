/**
 * Field transform — the pointer→field conversion boundary, pinned as pure math.
 */

import { describe, it, expect } from 'vitest';

import {
  containerPointToField,
  containerPointToFieldClamped,
  fieldPointToImagePercent,
  fitFieldLayout,
  type FieldMapping,
} from './field-transform';

const ASPECT = 1.5;
const SAND = { x0: 0.1, y0: 0.2, x1: 0.9, y1: 1 };
const FIELD_W = 2;
const FIELD_H = 1;

function mappingFor(width: number, height: number): FieldMapping {
  return {
    layout: fitFieldLayout(width, height, ASPECT),
    sandRect: SAND,
    fieldWidth: FIELD_W,
    fieldHeight: FIELD_H,
  };
}

describe('fitFieldLayout', () => {
  it('letterboxes left/right in a wide container', () => {
    const layout = fitFieldLayout(1000, 400, ASPECT);
    expect(layout.imageHeight).toBe(400);
    expect(layout.imageWidth).toBe(600);
    expect(layout.imageLeft).toBe(200);
    expect(layout.imageTop).toBe(0);
  });

  it('letterboxes top/bottom in a tall container', () => {
    const layout = fitFieldLayout(300, 400, ASPECT);
    expect(layout.imageWidth).toBe(300);
    expect(layout.imageHeight).toBe(200);
    expect(layout.imageLeft).toBe(0);
    expect(layout.imageTop).toBe(100);
  });

  it('fills exactly at the native aspect', () => {
    const layout = fitFieldLayout(600, 400, ASPECT);
    expect(layout).toEqual({ imageLeft: 0, imageTop: 0, imageWidth: 600, imageHeight: 400 });
  });

  it('degenerates safely for invalid sizes', () => {
    expect(fitFieldLayout(0, 400, ASPECT).imageWidth).toBe(0);
    expect(fitFieldLayout(Number.NaN, 400, ASPECT).imageWidth).toBe(0);
  });
});

describe('containerPointToField (strict — the shovel rule)', () => {
  const mapping = mappingFor(600, 400); // image fills the container exactly

  it('maps the sand center to the field center', () => {
    // Sand center in image fractions: (0.5, 0.6) → px (300, 240).
    const point = containerPointToField(300, 240, mapping);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(FIELD_W / 2, 10);
    expect(point?.y).toBeCloseTo(FIELD_H / 2, 10);
  });

  it('maps the sand corners to the field corners', () => {
    const topLeft = containerPointToField(0.1 * 600, 0.2 * 400, mapping);
    expect(topLeft?.x).toBeCloseTo(0, 10);
    expect(topLeft?.y).toBeCloseTo(0, 10);
    const bottomRight = containerPointToField(0.9 * 600, 1.0 * 400, mapping);
    expect(bottomRight?.x).toBeCloseTo(FIELD_W, 10);
    expect(bottomRight?.y).toBeCloseTo(FIELD_H, 10);
  });

  it('is scale-invariant: the same fraction in a larger container maps identically', () => {
    const small = containerPointToField(300, 240, mappingFor(600, 400));
    const big = containerPointToField(600, 480, mappingFor(1200, 800));
    expect(big?.x).toBeCloseTo(small?.x ?? -1, 10);
    expect(big?.y).toBeCloseTo(small?.y ?? -1, 10);
  });

  it('accounts for letterboxing offsets', () => {
    const mapping = mappingFor(1000, 400); // image box: left 200, width 600
    const point = containerPointToField(200 + 300, 240, mapping);
    expect(point?.x).toBeCloseTo(FIELD_W / 2, 10);
  });

  it('rejects the water strip, the margins and the letterbox', () => {
    expect(containerPointToField(300, 0.1 * 400, mapping)).toBeNull(); // water
    expect(containerPointToField(0.05 * 600, 240, mapping)).toBeNull(); // left margin
    const wide = mappingFor(1000, 400);
    expect(containerPointToField(10, 240, wide)).toBeNull(); // letterbox
  });

  it('rejects non-finite input and degenerate layouts', () => {
    expect(containerPointToField(Number.NaN, 240, mapping)).toBeNull();
    expect(containerPointToField(300, Number.POSITIVE_INFINITY, mapping)).toBeNull();
    expect(containerPointToField(300, 240, mappingFor(0, 0))).toBeNull();
  });
});

describe('containerPointToFieldClamped (the detector rule)', () => {
  const mapping = mappingFor(600, 400);

  it('matches the strict mapping inside the sand', () => {
    const strict = containerPointToField(300, 240, mapping);
    const clamped = containerPointToFieldClamped(300, 240, mapping);
    expect(clamped).toEqual(strict);
  });

  it('pins out-of-sand points to the nearest sand edge', () => {
    const above = containerPointToFieldClamped(300, 0, mapping); // in the water
    expect(above?.y).toBeCloseTo(0, 10);
    expect(above?.x).toBeCloseTo(FIELD_W / 2, 10);
    const beyondRight = containerPointToFieldClamped(9999, 240, mapping);
    expect(beyondRight?.x).toBeCloseTo(FIELD_W, 10);
  });

  it('still rejects non-finite input — garbage is not clamped', () => {
    expect(containerPointToFieldClamped(Number.NaN, 240, mapping)).toBeNull();
    expect(containerPointToFieldClamped(300, 240, mappingFor(0, 0))).toBeNull();
  });
});

describe('fieldPointToImagePercent (the render inverse)', () => {
  it('round-trips with the strict mapping', () => {
    const mapping = mappingFor(1000, 400);
    const original = { x: 1.234, y: 0.567 };
    const percent = fieldPointToImagePercent(original, mapping);
    const px = mapping.layout.imageLeft + (percent.leftPercent / 100) * mapping.layout.imageWidth;
    const py = mapping.layout.imageTop + (percent.topPercent / 100) * mapping.layout.imageHeight;
    const back = containerPointToField(px, py, mapping);
    expect(back?.x).toBeCloseTo(original.x, 8);
    expect(back?.y).toBeCloseTo(original.y, 8);
  });
});
