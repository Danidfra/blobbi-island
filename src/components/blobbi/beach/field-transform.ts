/**
 * Treasure Hunt — the ONE conversion boundary between pointer pixels and the
 * pure model's normalized field coordinates.
 *
 * Pure math, no DOM: callers hand in the playfield's `getBoundingClientRect()`
 * numbers and get field points back, so the whole mapping is unit-testable.
 * The shape mirrors `hockey-draw.ts`'s `fitTable`/`toTableUnits` pair — a
 * letterboxed, aspect-locked stage whose inverse mapping is exact — with one
 * extra layer: the model's field maps to the SAND sub-rectangle of the
 * artwork, not to the whole image. The water strip and the decorative shell
 * borders are scenery; a dig can only land on sand.
 *
 * Layers, outermost first:
 *
 *   container box (the measured element, any size)
 *     └─ image box (background art, letterboxed to IMAGE_ASPECT)
 *          └─ sand rect (SAND_RECT fractions of the image)
 *               └─ logical field (0..fieldWidth × 0..fieldHeight)
 *
 * Raster dimensions never leak into gameplay: the image aspect and the sand
 * fractions live in `treasure-hunt-config.ts`, and everything here works in
 * ratios of them.
 */

import type { Point } from '@/beach/treasure-hunt';

/** Fractions of the background image that are playable sand. */
export interface SandRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The fitted image box inside a measured container, in container-local px. */
export interface FieldLayout {
  readonly imageLeft: number;
  readonly imageTop: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/** Letterbox-fit the background image into a container (uniform scale, centered). */
export function fitFieldLayout(
  containerWidth: number,
  containerHeight: number,
  imageAspect: number
): FieldLayout {
  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return { imageLeft: 0, imageTop: 0, imageWidth: 0, imageHeight: 0 };
  }
  const containerAspect = containerWidth / containerHeight;
  if (containerAspect > imageAspect) {
    const imageHeight = containerHeight;
    const imageWidth = imageHeight * imageAspect;
    return {
      imageLeft: (containerWidth - imageWidth) / 2,
      imageTop: 0,
      imageWidth,
      imageHeight,
    };
  }
  const imageWidth = containerWidth;
  const imageHeight = imageWidth / imageAspect;
  return {
    imageLeft: 0,
    imageTop: (containerHeight - imageHeight) / 2,
    imageWidth,
    imageHeight,
  };
}

export interface FieldMapping {
  readonly layout: FieldLayout;
  readonly sandRect: SandRect;
  readonly fieldWidth: number;
  readonly fieldHeight: number;
}

/**
 * Container-local px → logical field point. Returns `null` for non-finite
 * input, a degenerate layout, or a point outside the sand rect — the strict
 * form the shovel uses: a dig aimed at the water is refused, never moved.
 */
export function containerPointToField(
  x: number,
  y: number,
  mapping: FieldMapping
): Point | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { layout, sandRect, fieldWidth, fieldHeight } = mapping;
  if (layout.imageWidth <= 0 || layout.imageHeight <= 0) return null;

  const imageFx = (x - layout.imageLeft) / layout.imageWidth;
  const imageFy = (y - layout.imageTop) / layout.imageHeight;
  if (
    imageFx < sandRect.x0 ||
    imageFx > sandRect.x1 ||
    imageFy < sandRect.y0 ||
    imageFy > sandRect.y1
  ) {
    return null;
  }
  return {
    x: ((imageFx - sandRect.x0) / (sandRect.x1 - sandRect.x0)) * fieldWidth,
    y: ((imageFy - sandRect.y0) / (sandRect.y1 - sandRect.y0)) * fieldHeight,
  };
}

/**
 * The clamped form the DETECTOR uses: a drag that leaves the sand keeps the
 * coil pinned to the nearest sand edge instead of dropping the gesture. This
 * is the documented controller rule — clamping is for the continuously
 * dragged coil only; digs use the strict form above. Still `null` on
 * non-finite input or a degenerate layout: garbage is rejected, not clamped.
 */
export function containerPointToFieldClamped(
  x: number,
  y: number,
  mapping: FieldMapping
): Point | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { layout, sandRect, fieldWidth, fieldHeight } = mapping;
  if (layout.imageWidth <= 0 || layout.imageHeight <= 0) return null;

  const imageFx = (x - layout.imageLeft) / layout.imageWidth;
  const imageFy = (y - layout.imageTop) / layout.imageHeight;
  const clampedFx = Math.min(sandRect.x1, Math.max(sandRect.x0, imageFx));
  const clampedFy = Math.min(sandRect.y1, Math.max(sandRect.y0, imageFy));
  return {
    x: ((clampedFx - sandRect.x0) / (sandRect.x1 - sandRect.x0)) * fieldWidth,
    y: ((clampedFy - sandRect.y0) / (sandRect.y1 - sandRect.y0)) * fieldHeight,
  };
}

/**
 * Logical field point → CSS percent offsets WITHIN the image box. The image
 * box is the positioned parent of every game object, so percentages keep the
 * markup resolution-independent — the exact inverse of the mappings above.
 */
export function fieldPointToImagePercent(
  point: Point,
  mapping: FieldMapping
): { leftPercent: number; topPercent: number } {
  const { sandRect, fieldWidth, fieldHeight } = mapping;
  const imageFx = sandRect.x0 + (point.x / fieldWidth) * (sandRect.x1 - sandRect.x0);
  const imageFy = sandRect.y0 + (point.y / fieldHeight) * (sandRect.y1 - sandRect.y0);
  return { leftPercent: imageFx * 100, topPercent: imageFy * 100 };
}
