/**
 * Local obstacle avoidance for the Blobbi's walk.
 *
 * ## What this replaces
 *
 * The movement loop used to give up the moment a step landed inside a
 * `MovementBlocker`: it stopped where it stood and reported arrival. So a click
 * on perfectly good floor BEHIND a shelf walked the Blobbi into the shelf and
 * left it there, even though a metre of open floor ran round either side. Every
 * room with furniture had that failure; it just became impossible to ignore once
 * shops filled up with display cases.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a corner-detour planner for axis-aligned rectangles, and nothing more.
 * Given a straight line that hits a blocker, it walks out to that blocker's
 * corners (plus a clearance margin), keeps the candidates that are on real floor
 * and outside every other blocker, and recurses — bounded — on the two halves.
 * The result is a short list of waypoints ending at the ORIGINAL target.
 *
 * It is NOT A*, a navmesh or a graph search, because the rooms do not need one:
 * they hold two to five convex rectangles on an open floor, where the shortest
 * route around an axis-aligned box always turns at one of its corners. A
 * general planner would be more code, more tuning and more ways to be wrong, for
 * paths a player would not be able to tell apart.
 *
 * ## Pure by design
 *
 * Nothing here touches React, rAF or the DOM: it is geometry in, waypoints out.
 * The controller consumes the list and animates it. That is what makes the
 * behaviour deterministic and testable without driving animation frames — the
 * tests assert routes, not frames.
 *
 * All coordinates are WORLD PERCENT, and both axes are treated in their own
 * units: 1 % of x is 10.46 design px and 1 % of y is 6.97, so a clearance
 * expressed in percent would be lopsided. Clearance is given in design px and
 * converted per axis.
 */

import type { Position } from '@/lib/types';
import type { Boundary } from '@/lib/boundaries';
import { constrainPosition } from '@/lib/boundaries';
import { WORLD_HEIGHT, WORLD_WIDTH, worldDistancePx } from '@/lib/world-coordinates';

/** An axis-aligned obstacle, in world percent. Matches `MovementBlocker`. */
export interface RouteBlocker {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlanRouteOptions {
  /**
   * How far outside a blocker a detour corner sits, in world-DESIGN pixels.
   *
   * Without it the route grazes the blocker's exact corner, which reads as the
   * Blobbi scraping along the furniture — and any rounding in the animation
   * puts the next step inside the rectangle, stopping the walk for a pixel. The
   * fix belongs here rather than in the blocker data: widening a blocker to buy
   * clearance would also push the player further away from the thing they are
   * walking up to.
   */
  readonly clearancePx?: number;
  /**
   * How many times the planner may split a segment before giving up.
   *
   * Three is what the rooms actually need. Going round ONE rectangle costs two
   * turns whenever the obstacle spans the direct line (out past a corner, along,
   * and in again), and meeting a second obstacle on the way costs a third. Two
   * was one short: a walk between two display units — the Badges Store's exact
   * layout — found no route and refused to start.
   *
   * The cap is what makes "unreachable" terminate rather than recurse forever,
   * and it is why a sealed-in Blobbi stops instead of hanging. Four candidates
   * per level bounds the search at 4³ legs, which is microseconds.
   */
  readonly maxDepth?: number;
}

const DEFAULT_CLEARANCE_PX = 14;
const DEFAULT_MAX_DEPTH = 3;

/** How finely a segment is checked against the walk boundary, in design px. */
const BOUNDARY_SAMPLE_PX = 6;

/** Is this point inside the rectangle? Edges count, exactly as the blocker context counts them. */
export function pointInBlocker(point: Position, blocker: RouteBlocker): boolean {
  return (
    point.x >= blocker.x &&
    point.x <= blocker.x + blocker.width &&
    point.y >= blocker.y &&
    point.y <= blocker.y + blocker.height
  );
}

/** Is this point inside ANY of them? The movement loop's own test. */
export function isBlocked(
  point: Position,
  blockers: readonly RouteBlocker[],
): boolean {
  return blockers.some((blocker) => pointInBlocker(point, blocker));
}

/** A point the walk boundary does not have to move — i.e. real floor. */
export function isOnFloor(point: Position, boundary: Boundary): boolean {
  const clamped = constrainPosition(point, boundary);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

/**
 * Does the segment `a → b` cross this rectangle?
 *
 * Liang–Barsky slab clipping. Chosen over sampling because a fast step can hop
 * over a thin blocker between two frames — the display tables' footprints are
 * barely two percent deep — and a sampled test would call that route clear.
 */
export function segmentHitsBlocker(
  a: Position,
  b: Position,
  blocker: RouteBlocker,
): boolean {
  // A segment that starts or ends inside is a hit however it is clipped.
  if (pointInBlocker(a, blocker) || pointInBlocker(b, blocker)) return true;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minX = blocker.x;
  const maxX = blocker.x + blocker.width;
  const minY = blocker.y;
  const maxY = blocker.y + blocker.height;

  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel: inside the slab, or missing entirely
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, a.x - minX) &&
    clip(dx, maxX - a.x) &&
    clip(-dy, a.y - minY) &&
    clip(dy, maxY - a.y)
  );
}

/** The first blocker on the way from `a` to `b`, or null when the line is clear. */
export function firstBlockerOnSegment(
  a: Position,
  b: Position,
  blockers: readonly RouteBlocker[],
): RouteBlocker | null {
  let nearest: RouteBlocker | null = null;
  let nearestDistance = Infinity;

  for (const blocker of blockers) {
    if (!segmentHitsBlocker(a, b, blocker)) continue;
    // Order by the blocker's centre, so a detour is planned around the one the
    // Blobbi meets first rather than whichever happens to be listed first.
    const centre = {
      x: blocker.x + blocker.width / 2,
      y: blocker.y + blocker.height / 2,
    };
    const distance = worldDistancePx(a, centre);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = blocker;
    }
  }
  return nearest;
}

/**
 * Does the whole segment stay on walkable floor?
 *
 * Sampled rather than solved, because a boundary is a composite of rectangles
 * and triangles with no closed form worth writing. The step is fine enough that
 * nothing the rooms contain slips between two samples.
 */
export function segmentStaysOnFloor(
  a: Position,
  b: Position,
  boundary: Boundary,
): boolean {
  const steps = Math.max(2, Math.ceil(worldDistancePx(a, b) / BOUNDARY_SAMPLE_PX));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isOnFloor({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, boundary)) {
      return false;
    }
  }
  return true;
}

/** Is `a → b` walkable as one straight leg? */
function legIsClear(
  a: Position,
  b: Position,
  boundary: Boundary,
  blockers: readonly RouteBlocker[],
): boolean {
  return (
    firstBlockerOnSegment(a, b, blockers) === null &&
    segmentStaysOnFloor(a, b, boundary)
  );
}

/** Two points the walk could not tell apart, in world percent. */
function samePoint(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/**
 * The corners of `blocker`, pushed out by the clearance margin.
 *
 * Four candidates, because for an axis-aligned rectangle the shortest way past
 * it always turns at a corner. Anything cleverer would be guessing.
 */
function detourCandidates(blocker: RouteBlocker, clearancePx: number): Position[] {
  const mx = (clearancePx / WORLD_WIDTH) * 100;
  const my = (clearancePx / WORLD_HEIGHT) * 100;
  const left = blocker.x - mx;
  const right = blocker.x + blocker.width + mx;
  const top = blocker.y - my;
  const bottom = blocker.y + blocker.height + my;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ];
}

/**
 * A walkable route from `start` to `target`, as the waypoints to walk in order.
 *
 * The last entry is always the ORIGINAL target — the caller's destination is
 * never quietly replaced by somewhere easier to reach. `null` means no route
 * was found within {@link PlanRouteOptions.maxDepth}, and the caller should not
 * move at all.
 *
 * A clear line returns `[target]`, so an unobstructed walk is exactly what it
 * always was: one leg, same speed, same arrival.
 */
export function planRoute(
  start: Position,
  target: Position,
  boundary: Boundary,
  blockers: readonly RouteBlocker[],
  options: PlanRouteOptions = {},
): Position[] | null {
  const clearancePx = options.clearancePx ?? DEFAULT_CLEARANCE_PX;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  // Walking INTO furniture is never a route. The caller decides what to do
  // instead; the movement controller simply refuses the walk, which is the
  // behaviour `goTo` has always had for a blocked destination.
  if (isBlocked(target, blockers)) return null;

  const plan = (a: Position, b: Position, depth: number): Position[] | null => {
    if (legIsClear(a, b, boundary, blockers)) return [b];
    if (depth >= maxDepth) return null;

    const obstacle = firstBlockerOnSegment(a, b, blockers);
    // Not a blocker in the way, then — the leg leaves the floor, and no corner
    // of any rectangle would fix that.
    if (!obstacle) return null;

    let best: Position[] | null = null;
    let bestCost = Infinity;

    for (const candidate of detourCandidates(obstacle, clearancePx)) {
      // A corner the walk is already standing on, or that IS the destination,
      // adds a zero-length leg — and a zero-length leg is how a walk stands
      // still and re-plans itself forever.
      if (samePoint(candidate, a) || samePoint(candidate, b)) continue;
      if (isBlocked(candidate, blockers)) continue;
      if (!isOnFloor(candidate, boundary)) continue;

      // The first leg must be walkable outright: allowing it to detour again
      // is what would let the planner wander away from the target.
      if (!legIsClear(a, candidate, boundary, blockers)) continue;

      const rest = plan(candidate, b, depth + 1);
      if (!rest) continue;

      const route = [candidate, ...rest];
      const cost = routeLengthPx(a, route);
      if (cost < bestCost) {
        bestCost = cost;
        best = route;
      }
    }

    return best;
  };

  return plan(start, target, 0);
}

/** Total walking distance of a route, in design px. */
export function routeLengthPx(start: Position, route: readonly Position[]): number {
  let total = 0;
  let from = start;
  for (const point of route) {
    total += worldDistancePx(from, point);
    from = point;
  }
  return total;
}
