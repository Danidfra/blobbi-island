/**
 * Canonical interaction approach-target resolution (Phase 3).
 *
 * Every "walk to a point on/near this object, then act" interaction — doors,
 * kiosks, bushes, theater seats, arcade machines, chairs — needs the same
 * mechanics: read the object's LIVE rendered rect, map a configured fractional
 * aim point through the world surface into world percent, optionally push the
 * point onto the floor, and clamp it into the room's walk boundary so the walk
 * can actually converge. Four components used to carry their own copy of this
 * (`computeBaseCenterTarget`, `computeBushTarget`, `computeSeatTarget`,
 * `computeMachineTarget`) plus an inline fifth in the legacy chair flow; this
 * module is the single implementation.
 *
 * What stays PER-OBJECT is only configuration: which fraction to aim at, which
 * boundary to clamp into, and any explicit ground offset. The conversion
 * mechanics are never duplicated.
 *
 * Reading the live rect (rather than trusting config maths) keeps targets
 * correct no matter how the world is scaled or letterboxed; the DOM-free
 * config helpers (`seatApproachPosition`, `machineAnchorPosition`, …) are the
 * test/diagnostic mirrors of the same points.
 *
 * Output semantics: a GROUND-position {@link ApproachTarget} for
 * `requestInteraction` — never a pose anchor.
 */

import type { Position } from '@/lib/types';
import type { ApproachTarget, ObjectFraction } from '@/lib/spatial-intent';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import { elementFractionToWorldPercent } from '@/lib/world-coordinates';

/**
 * The canonical world surface: the single `[data-world-surface]` container the
 * room renders into. All approach targets are expressed relative to it.
 */
export function findWorldSurface(el: Element): HTMLElement | null {
  return el.closest('[data-world-surface]') as HTMLElement | null;
}

/**
 * Default aim fraction for generic doors / kiosks / navigation items: the
 * element's horizontal center, slightly above its very bottom, so the feet
 * stop on the floor at the object's base rather than clipped by its lowest
 * pixels (the historical `rect.bottom - rect.height * 0.1`).
 */
export const ELEMENT_BASE_FRACTION: ObjectFraction = { x: 0.5, y: 0.9 };

export interface ResolveElementApproachTargetOptions {
  /** The interactive object whose rendered rect anchors the target. */
  element: Element;
  /**
   * Explicit world surface. Defaults to the element's closest
   * `[data-world-surface]` ancestor.
   */
  worldSurface?: HTMLElement | null;
  /** Fractional aim point inside the element's rect (0..1 per axis; may exceed). */
  fraction: ObjectFraction;
  /**
   * Room walk boundary to clamp into. Clamping is EXPLICIT: omit it only for
   * elements whose aim point is known-walkable (`MovableBlobbi` still clamps
   * each movement STEP, but an unreachable target never converges — see the
   * arcade counters incident).
   */
  boundary?: Boundary;
  /**
   * Explicit vertical ground offset in world percent, applied after the
   * fraction conversion and before clamping. A function receives the raw
   * converted y (for offsets that depend on depth, e.g. the arcade's
   * half-body ground correction) — applied exactly once, here.
   */
  yOffsetPercent?: number | ((rawYPercent: number) => number);
}

export interface ApproachTargetResult {
  /** The resolved ground-position approach target. */
  target: ApproachTarget;
  /** Diagnostic metadata (dev overlays, tests). */
  meta: {
    /** The converted point before clamping. */
    raw: Position;
    /** Whether the boundary clamp moved the point. */
    clamped: boolean;
    fraction: ObjectFraction;
  };
}

/**
 * Resolve the ground approach target for an interactive element, or null when
 * the element is not mounted inside a sized world surface.
 */
export function resolveElementApproachTarget(
  opts: ResolveElementApproachTargetOptions,
): ApproachTargetResult | null {
  const { element, fraction, boundary, yOffsetPercent } = opts;
  const surface = opts.worldSurface !== undefined ? opts.worldSurface : findWorldSurface(element);
  if (!surface) return null;

  const point = elementFractionToWorldPercent(
    element.getBoundingClientRect(),
    surface.getBoundingClientRect(),
    fraction,
  );
  if (!point) return null;

  const offset =
    typeof yOffsetPercent === 'function' ? yOffsetPercent(point.y) : (yOffsetPercent ?? 0);
  const raw: Position = { x: point.x, y: point.y + offset };

  const target = boundary ? constrainPosition(raw, boundary) : raw;
  const clamped = target.x !== raw.x || target.y !== raw.y;

  return { target, meta: { raw, clamped, fraction } };
}
