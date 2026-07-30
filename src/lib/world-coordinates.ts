/**
 * Canonical world-coordinate conversions (Phase 3).
 *
 * Blobbi Island uses three coordinate systems:
 *
 *  1. WORLD PERCENT — `{ x, y }` in 0..100, relative to the world surface.
 *     All stored positions (ground points, approach targets, pose anchors,
 *     boundaries) live here. Percent deltas are ANISOTROPIC: 1% of x and 1%
 *     of y are different physical lengths.
 *  2. WORLD-DESIGN PIXELS — the fixed {@link WORLD_WIDTH}×{@link WORLD_HEIGHT}
 *     design space every asset was authored against. Movement speed and every
 *     distance/arrival decision are computed here so they are isotropic and
 *     viewport-independent.
 *  3. VIEWPORT (client) PIXELS — what pointer events report. The rendered
 *     world surface is the fixed design box under one uniform CSS scale, so
 *     `getBoundingClientRect()` fractions convert exactly to world percent.
 *
 * This module is the ONLY place these conversions are implemented. It is pure:
 * no clamping (boundary clamping is an explicit, separate operation — see
 * `constrainPosition` in `src/lib/boundaries.ts`), no viewport breakpoints,
 * and no room-specific constants.
 */

import type { Position } from '@/lib/types';

/**
 * The world's fixed virtual design resolution — the single source of truth.
 * All world art, object positions (percent) AND object sizes (px/rem) were
 * authored against this exact box. `VirtualWorld` renders the world at this
 * size and scales the whole layer uniformly.
 */
export const WORLD_WIDTH = 1046;
export const WORLD_HEIGHT = 697;
export const WORLD_ASPECT = WORLD_WIDTH / WORLD_HEIGHT; // ≈ 1.50

/** One world-percent step expressed in design px per axis. */
export const WORLD_PX_PER_PERCENT_X = WORLD_WIDTH / 100;
export const WORLD_PX_PER_PERCENT_Y = WORLD_HEIGHT / 100;

/**
 * The subset of `DOMRect` the conversions need. Taking a plain shape keeps the
 * helpers trivially testable without constructing real DOM rects.
 */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Viewport/client point → world percent, measured against the rendered world
 * surface's rect.
 *
 * `getBoundingClientRect()` returns POST-transform (visual) rects, so this is
 * invariant under the uniform world scale. Returns `null` when the surface has
 * no size (unmounted/hidden), which callers must treat as "no target".
 *
 * Output semantics: an UNCLAMPED world-percent point. Clamp explicitly with
 * `constrainPosition` when the point must be walkable.
 */
export function clientPointToWorldPercent(
  clientX: number,
  clientY: number,
  surfaceRect: RectLike,
): Position | null {
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;
  return {
    x: ((clientX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((clientY - surfaceRect.top) / surfaceRect.height) * 100,
  };
}

/** World percent → fixed world-design pixels. */
export function worldPercentToDesignPx(percent: Position): Position {
  return {
    x: (percent.x / 100) * WORLD_WIDTH,
    y: (percent.y / 100) * WORLD_HEIGHT,
  };
}

/** Fixed world-design pixels → world percent. Inverse of {@link worldPercentToDesignPx}. */
export function designPxToWorldPercent(designPx: Position): Position {
  return {
    x: (designPx.x / WORLD_WIDTH) * 100,
    y: (designPx.y / WORLD_HEIGHT) * 100,
  };
}

/**
 * A fractional point (0..1 per axis) inside an element's rendered rect →
 * world percent on the surface that contains it.
 *
 * This is the shared mechanics of every "walk to a point on/near this object"
 * interaction (doors, bushes, seats, machines, chairs). Fractions > 1 or < 0
 * deliberately resolve to points OUTSIDE the element (e.g. the floor just
 * below a seat sprite).
 *
 * Output semantics: an UNCLAMPED world-percent point; clamping into a walk
 * boundary is the caller's explicit decision.
 */
export function elementFractionToWorldPercent(
  elementRect: RectLike,
  surfaceRect: RectLike,
  fraction: { x: number; y: number },
): Position | null {
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;
  const pointX = elementRect.left + elementRect.width * fraction.x;
  const pointY = elementRect.top + elementRect.height * fraction.y;
  return {
    x: ((pointX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((pointY - surfaceRect.top) / surfaceRect.height) * 100,
  };
}

/**
 * Isotropic distance in world-design pixels between two world-percent points.
 *
 * Percent-space deltas are anisotropic (1% of x = 10.46 world px, 1% of y =
 * 6.97 world px); every arrival/threshold decision converts through the design
 * space first so the same physical distance behaves identically on both axes
 * and never depends on the viewport scale.
 */
export function worldDistancePx(a: Position, b: Position): number {
  const dx = ((b.x - a.x) / 100) * WORLD_WIDTH;
  const dy = ((b.y - a.y) / 100) * WORLD_HEIGHT;
  return Math.hypot(dx, dy);
}
