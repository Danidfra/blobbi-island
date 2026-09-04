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
 * and outside every other blocker, and recurses, bounded, on the two halves.
 * The result is a short list of waypoints ending at the ORIGINAL target.
 *
 * ## Furniture is an obstruction; the room's own shape is not
 *
 * This distinction is the whole architecture, and getting it wrong broke the
 * shopping mall. A `MovementBlocker` is impassable: no walk may cross one, so a
 * blocker in the way MUST be planned around or the route does not exist. A
 * BOUNDARY is a different kind of thing entirely; it is the room's contour, and
 * the movement loop has always followed it by clamping every step back onto the
 * floor. That clamp is what walks a Blobbi along a wall, round a corner, and up
 * the mall's staircase.
 *
 * So a leg is walkable when no BLOCKER crosses it. Leaving the walkable polygon
 * on the way is not an error here; it is the contour-following the movement
 * loop does, and it is how a straight line between two valid points on different
 * mall levels resolves into a climb.
 *
 * The boundary still decides things, just not that one. Every detour waypoint
 * must be somewhere the Blobbi can actually stand, and a detour whose legs stay
 * on the floor is preferred over a shorter one that does not; see
 * {@link OFF_FLOOR_PENALTY_PX}. Preference, not prohibition.
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
 * behaviour deterministic and testable without driving animation frames, the
 * tests assert routes, not frames.
 *
 * All coordinates are WORLD PERCENT, and both axes are treated in their own
 * units: 1 % of x is 10.46 design px and 1 % of y is 6.97, so a clearance
 * expressed in percent would be lopsided. Clearance is given in design px and
 * converted per axis.
 */

import type { Position } from '@/lib/types';
import type { Boundary } from '@/lib/boundaries';
import { areaContains, constrainPosition, constrainToArea } from '@/lib/boundaries';
import type { WalkableArea } from '@/lib/boundaries';
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
   * Blobbi scraping along the furniture, and any rounding in the animation
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
   * was one short: a walk between two display units, the Badges Store's exact
   * layout: found no route and refused to start.
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

/**
 * What a leg costs, in design px, for straying off the walkable polygon.
 *
 * Large enough that any on-floor detour beats any off-floor one, the world is
 * 1257 px corner to corner, so a single penalty outweighs several room lengths,
 * and finite so that "off the floor" ranks a route DOWN rather than deleting it.
 *
 * That finiteness is the fix for the mall. Rejecting off-floor legs outright
 * made the planner declare every ground-to-upper-level walk impossible: the
 * mall's floors are joined by a narrow stair column, no straight line between
 * levels stays inside the polygon, and, with no furniture anywhere in the mall,
 * there was no blocker to detour around, so the planner returned `null` and
 * `goTo` refused to move at all.
 */
const OFF_FLOOR_PENALTY_PX = 100_000;

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

/** A point the walk boundary does not have to move; i.e. real floor. */
export function isOnFloor(point: Position, boundary: Boundary): boolean {
  const clamped = constrainPosition(point, boundary);
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.y - point.y) < 1e-6;
}

/**
 * Does the segment `a → b` cross this rectangle?
 *
 * Liang–Barsky slab clipping. Chosen over sampling because a fast step can hop
 * over a thin blocker between two frames, the display tables' footprints are
 * barely two percent deep, and a sampled test would call that route clear.
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

/**
 * Is `a → b` walkable as one straight leg?
 *
 * Blockers only. Whether the line stays inside the room is a question of cost
 * (see {@link legCostPx}), not of possibility, the movement loop clamps each
 * step back onto the floor, which is how a walk follows a wall or climbs the
 * mall's stairs.
 */
function legIsClear(
  a: Position,
  b: Position,
  blockers: readonly RouteBlocker[],
): boolean {
  return firstBlockerOnSegment(a, b, blockers) === null;
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
 * The convex pieces a boundary is built from.
 *
 * Convexity is the whole point: two points inside ONE area are always joined by
 * a straight line that stays inside it, so a route expressed as a chain of areas
 * needs no sampling to be proved on-floor. A plain rectangle boundary is its own
 * single area; the shapes with curved edges have no pieces to reason about and
 * get an empty list, which falls back to walking straight at the target exactly
 * as they always have.
 */
function walkableAreas(boundary: Boundary): WalkableArea[] {
  if (boundary.shape === 'composite') return boundary.areas;
  if (boundary.shape === 'rectangle') {
    return [{ type: 'rectangle', x: boundary.x, y: boundary.y }];
  }
  return [];
}

/**
 * A point lying in BOTH areas, or `null` when they do not touch.
 *
 * Alternating projection: clamp into one, clamp the result into the other, and
 * repeat. For convex sets that converges on the closest pair, so if the two
 * meet, it lands in the intersection, including the common case here, where
 * two rectangles share nothing but an edge and the intersection has no area at
 * all.
 *
 * Seeded from `toward` so the crossing it finds is the one on the way, rather
 * than an arbitrary corner of a shared edge: the mall's ground floor and its
 * stair column meet along a whole 7 %-wide line, and which end of that line the
 * walk uses is the difference between climbing the stairs and walking away from
 * them.
 */
function areaConnection(
  a: WalkableArea,
  b: WalkableArea,
  toward: Position,
): Position | null {
  let point = toward;
  for (let i = 0; i < 24; i++) {
    const onA = constrainToArea(point, a);
    const onB = constrainToArea(onA, b);
    if (worldDistancePx(onA, onB) < 1e-4) {
      return areaContains(onB, a) ? onB : onA;
    }
    if (worldDistancePx(point, onB) < 1e-9) break;
    point = onB;
  }
  return null;
}

/**
 * Waypoints that walk the room's own topology from `start` to `target`.
 *
 * A breadth-first search over the boundary's convex pieces, returning one
 * crossing point per area boundary traversed. This is what climbs the mall's
 * stairs, and it is derived entirely from `locationBoundaries`: there is no
 * staircase in this file, no mall-specific branch, and nothing to keep in sync
 * with the artwork.
 *
 * Fewest AREAS wins rather than shortest distance: the pieces are the room's
 * own description of itself, so crossing as few as possible is the route a
 * player would call obvious, and the graph is far too small for the difference
 * to be worth a priority queue.
 *
 * Returns `[]` when the two points already share an area, the straight line is
 * then provably on-floor, and `null` when the floor is genuinely disconnected.
 */
function boundaryCorridor(
  start: Position,
  target: Position,
  boundary: Boundary,
): Position[] | null {
  const areas = walkableAreas(boundary);
  if (areas.length === 0) return [];

  const startAreas = areas.flatMap((area, i) => (areaContains(start, area, 0.05) ? [i] : []));
  const targetAreas = new Set(
    areas.flatMap((area, i) => (areaContains(target, area, 0.05) ? [i] : [])),
  );
  // A point the boundary does not actually contain: nothing to plan through.
  if (startAreas.length === 0 || targetAreas.size === 0) return [];
  if (startAreas.some((i) => targetAreas.has(i))) return [];

  const cameFrom = new Map<number, number | null>();
  const queue: number[] = [];
  for (const i of startAreas) {
    cameFrom.set(i, null);
    queue.push(i);
  }

  let goal: number | null = null;
  for (let head = 0; head < queue.length && goal === null; head++) {
    const current = queue[head];
    for (let next = 0; next < areas.length; next++) {
      if (cameFrom.has(next)) continue;
      if (!areaConnection(areas[current], areas[next], target)) continue;
      cameFrom.set(next, current);
      queue.push(next);
      if (targetAreas.has(next)) {
        goal = next;
        break;
      }
    }
  }
  if (goal === null) return null;

  const chain: number[] = [];
  for (let node: number | null = goal; node !== null; node = cameFrom.get(node) ?? null) {
    chain.unshift(node);
  }

  const waypoints: Position[] = [];
  let from = start;
  for (let i = 0; i < chain.length - 1; i++) {
    // Aim each crossing at the next one's area rather than at the final target,
    // so a long chain does not bunch every waypoint at the same corner.
    const crossing = areaConnection(areas[chain[i]], areas[chain[i + 1]], target);
    if (!crossing) return null;
    if (worldDistancePx(from, crossing) > 1e-6) {
      waypoints.push(crossing);
      from = crossing;
    }
  }
  return waypoints;
}

/**
 * A walkable route from `start` to `target`, as the waypoints to walk in order.
 *
 * The last entry is always the ORIGINAL target, the caller's destination is
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

  // ENDPOINT validity is the hard requirement, and it is only about the
  // endpoint. Walking INTO furniture is never a route, and neither is walking
  // to somewhere outside the room, in both cases there is nowhere to arrive.
  // The caller decides what to do instead; the movement controller simply
  // refuses the walk, which is what `goTo` has always done for a blocked
  // destination. Real world clicks are already clamped onto the floor by
  // `MovableBlobbi`, so this rejects programmatic targets, not player taps.
  if (isBlocked(target, blockers)) return null;
  if (!isOnFloor(target, boundary)) return null;

  /** A leg's length, plus a heavy surcharge if it strays off the floor. */
  const legCostPx = (a: Position, b: Position): number =>
    worldDistancePx(a, b) +
    (segmentStaysOnFloor(a, b, boundary) ? 0 : OFF_FLOOR_PENALTY_PX);

  /**
   * Plan `a → b`, returning the waypoints and what they cost.
   *
   * Cost rather than a boolean is what lets the boundary rank routes without
   * vetoing them: an off-floor leg is expensive, so a detour that keeps to the
   * floor always wins when one exists, and a route that has no such option is
   * still a route.
   */
  const plan = (
    a: Position,
    b: Position,
    depth: number,
  ): { route: Position[]; cost: number } | null => {
    const obstacle = firstBlockerOnSegment(a, b, blockers);
    // Nothing solid in the way: walk it. If the line leaves the room on the way,
    // the movement loop follows the contour, exactly as it did before this
    // planner existed.
    if (!obstacle) return { route: [b], cost: legCostPx(a, b) };
    if (depth >= maxDepth) return null;

    let best: { route: Position[]; cost: number } | null = null;

    for (const candidate of detourCandidates(obstacle, clearancePx)) {
      // A corner the walk is already standing on, or that IS the destination,
      // adds a zero-length leg, and a zero-length leg is how a walk stands
      // still and re-plans itself forever.
      if (samePoint(candidate, a) || samePoint(candidate, b)) continue;
      if (isBlocked(candidate, blockers)) continue;
      // A waypoint must be somewhere the Blobbi can stand. This one IS a
      // prohibition: the clamp would silently move the waypoint elsewhere, and
      // the walk would aim at a point it can never reach.
      if (!isOnFloor(candidate, boundary)) continue;

      // The first leg must be clear of furniture outright: letting it detour
      // again is what would send the planner wandering away from the target.
      if (!legIsClear(a, candidate, blockers)) continue;

      const rest = plan(candidate, b, depth + 1);
      if (!rest) continue;

      const cost = legCostPx(a, candidate) + rest.cost;
      if (!best || cost < best.cost) {
        best = { route: [candidate, ...rest.route], cost };
      }
    }

    return best;
  };

  /*
    Two questions, answered by two different things.

    ROOM TOPOLOGY first: if no straight line from here to there stays on the
    floor, the room's own shape is what has to be navigated, and
    `boundaryCorridor` returns the crossings that do it. Rooms where the direct
    line is already fine; every shop interior, and most walks inside the mall's
    own levels: skip this entirely and behave exactly as they did before.

    FURNITURE second: each leg of that corridor is then planned around blockers
    in the usual way. A corridor leg lies inside one convex area, so detouring
    round a shelf on it cannot wander off the floor.
  */
  const corridor = segmentStaysOnFloor(start, target, boundary)
    ? []
    : boundaryCorridor(start, target, boundary);
  if (corridor === null) return null;

  const route: Position[] = [];
  let from = start;
  for (const waypoint of [...corridor, target]) {
    const leg = plan(from, waypoint, 0);
    if (!leg) return null;
    route.push(...leg.route);
    from = waypoint;
  }
  return route;
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
