/**
 * Beach Treasure Hunt, tiny shared geometry helpers.
 *
 * Kept separate so `generator`, `detector` and `digging` measure distance the
 * same way, and so "is this point even a point" has exactly one definition.
 * Invalid points are detected, never repaired: the model rejects rather than
 * clamps, because a silently-moved dig is a lie to the player.
 */

import type { Point } from './types';

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Both coordinates present and finite. `NaN`/`Infinity` fail. */
export function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Finite AND inside `0..width` × `0..height` (edges inclusive). */
export function isWithinField(point: Point, width: number, height: number): boolean {
  return (
    isFinitePoint(point) &&
    point.x >= 0 &&
    point.x <= width &&
    point.y >= 0 &&
    point.y <= height
  );
}
