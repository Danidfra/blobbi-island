/**
 * Canonical interaction approach-target resolution (Phase 3).
 *
 * Every "walk to a point on/near this object, then act" interaction, doors,
 * kiosks, bushes, theater seats, arcade machines, chairs, needs the same
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
 * `requestInteraction`: never a pose anchor.
 */

import type { Position } from '@/lib/types';
import type { ApproachTarget, ObjectFraction } from '@/lib/spatial-intent';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  elementFractionToWorldPercent,
  worldDistancePx,
} from '@/lib/world-coordinates';

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
   * each movement STEP, but an unreachable target never converges; see the
   * arcade counters incident).
   */
  boundary?: Boundary;
  /**
   * Explicit vertical ground offset in world percent, applied after the
   * fraction conversion and before clamping. A function receives the raw
   * converted y (for offsets that depend on depth, e.g. the arcade's
   * half-body ground correction): applied exactly once, here.
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

/** `isPositionBlocked(x, y)` from the movement-blocker context, in world percent. */
export type BlockedPredicate = (x: number, y: number) => boolean;

/**
 * Search radii (world-design px) tried, nearest first, when the clamped aim
 * point sits inside a movement blocker. Bounded: a target that has no free
 * floor within the largest ring is handed back clamped and the route planner
 * refuses it honestly, which is still better than walking into furniture.
 */
const PROJECTION_RADII_PX = [24, 48, 72, 96, 128, 160] as const;
const PROJECTION_DIRECTIONS = 16;

/**
 * Put an approach point somewhere the Blobbi can actually stand.
 *
 * Two facts the route planner enforces as hard requirements (`planRoute`
 * returns `null` and `goTo` refuses to move): the destination must be ON the
 * room's walk boundary, and it must not be INSIDE a blocker. A door on a
 * building's wall resolves to a point above the floor; a kiosk's base may sit
 * on the very rectangle registered to keep the Blobbi out of it. Either way
 * the walk never started and the door looked dead, the Town Stage, the Plaza
 * building and the Nostr Station exterior all shipped that way.
 *
 * This is the ONE generic answer:
 *
 * 1. clamp into the boundary (the nearest floor point the boundary offers);
 * 2. if that point is blocked, walk outward in rings and pick the nearest
 *    candidate that is on the floor and free, preferring the side the raw
 *    point was on;
 * 3. if nothing within the rings is free, return the clamped point, the
 *    planner will still refuse, and that refusal is the honest outcome.
 *
 * Nothing here is per-room or per-door: the boundary and the blockers are
 * whatever the room registered.
 */
export function projectIntoWalkableFloor(
  raw: Position,
  boundary: Boundary,
  isBlocked?: BlockedPredicate,
): Position {
  const clamped = constrainPosition(raw, boundary);
  if (!isBlocked || !isBlocked(clamped.x, clamped.y)) return clamped;

  let best: { point: Position; distance: number } | null = null;
  for (const radiusPx of PROJECTION_RADII_PX) {
    for (let i = 0; i < PROJECTION_DIRECTIONS; i += 1) {
      const angle = (i / PROJECTION_DIRECTIONS) * Math.PI * 2;
      const candidate = constrainPosition(
        {
          x: clamped.x + ((Math.cos(angle) * radiusPx) / WORLD_WIDTH) * 100,
          y: clamped.y + ((Math.sin(angle) * radiusPx) / WORLD_HEIGHT) * 100,
        },
        boundary,
      );
      if (isBlocked(candidate.x, candidate.y)) continue;
      const distance = worldDistancePx(raw, candidate);
      if (!best || distance < best.distance) best = { point: candidate, distance };
    }
    // The first ring with any free candidate wins: nearer is better, and a
    // farther ring cannot beat a point already found on a nearer one.
    if (best) return best.point;
  }
  return clamped;
}
