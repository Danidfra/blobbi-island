/**
 * Pool: the table's real geometry: cushions with gaps, jaws, and pocket mouths.
 *
 * **One table, described once.** The physics world builds its cushion bodies
 * from {@link POOL_CUSHIONS}, the renderer draws the same polygons, and the
 * capture test uses the same mouths. There is no second copy to drift, which is
 * the whole reason this module exists and is free of both React and Planck.
 *
 * ## The defect this replaces
 *
 * The first implementation modelled the cushions as one unbroken rectangle and
 * *drew* them cut back at the pockets. Every consequence of that was a reported
 * bug:
 *
 *  - a ball crossing a pocket mouth rebounded off a rail that was not drawn;
 *  - a ball whose centre sat inside the drawn hole but more than 4.2 units from
 *    the pocket centre was neither pocketed nor able to move; it looked like it
 *    had gone in and had not;
 *  - the "capture radius" was a circle around the corner point, so whether a
 *    ball dropped depended on a number with no visible counterpart.
 *
 * ## The model
 *
 * ```
 *        nose                                  nose
 *          ●━━━━━━━━━━ cushion ━━━━━━━━━━━━━━━━━●          ← y = 0, playfield above
 *         ╱                                      ╲
 *        ╱  facing splays away from the pocket    ╲        ← the JAW
 *       ●──────────── cushion back ────────────────●       ← y = −CUSHION_DEPTH
 *
 *   ◄── mouth ──►                                  ◄── mouth ──►
 *   (a real gap: no body, no fixture, nothing)
 * ```
 *
 * Six cushion polygons, two per long rail, one per short rail, leaving six
 * real openings. Each cushion end is cut on an angle so that the opening widens
 * with depth, which is what a real table's pocket facing does and what makes a
 * ball hitting the jaw deflect rather than stop dead.
 *
 * ## Capture: a mouth plane, not a circle
 *
 * A ball is pocketed when **its centre crosses the mouth plane**: the straight
 * line between the two cushion noses, by {@link POCKET_CAPTURE_DEPTH}, within
 * the mouth's own width. Not a circle around the pocket, because:
 *
 *  - the drawn pocket well starts at exactly that plane, so *the dark region on
 *    screen is the capture region*. A ball that looks in, is in;
 *  - a circle cannot cover the full width of the mouth at its edges without also
 *    reaching back onto the cloth. The old one did not, so a ball entering near
 *    a jaw fell through into nothing;
 *  - it gives the right answer for a ball running along a cushion. Past a
 *    **corner** it drops (the corner's mouth plane cuts across its path); past a
 *    **side pocket** it does not (the side mouth plane is parallel to its path
 *    and it never crosses it): which is exactly how a real table plays.
 *
 * This is the "equivalent non-solid detection region" the brief allows in place
 * of a sensor fixture, and it is preferred to one here: a half-space slab is not
 * expressible as a circle fixture, and Box2D sensor callbacks report *fixture
 * overlap* rather than *centre containment*, so a sensor would have needed this
 * same test afterwards anyway, with an extra frame of latency and an
 * order-dependent contact list in between.
 */

import { BALL_RADIUS, POCKETS, TABLE_LENGTH, TABLE_WIDTH } from './table';
import type { Vec2 } from './physics';

/** How far a cushion extends OUTSIDE the playfield, in table units. */
export const CUSHION_DEPTH = 5.5;

/**
 * How far back from a corner point each cushion nose sits, measured along its
 * own rail.
 *
 * The mouth between two corner noses is therefore `9 · √2 ≈ 12.7` units, or
 * about **2.3 ball diameters**. A real corner pocket is about 2.0; this is a
 * shade wider because a player aiming with a finger on a phone deserves it.
 */
export const CORNER_MOUTH = 9;

/** Half the side-pocket mouth: `13.2` units, about 2.4 ball diameters. */
export const SIDE_MOUTH = 6.6;

/**
 * How far a cushion's back edge retreats from its nose, away from the adjacent
 * pocket: the angle of the jaw.
 *
 * Larger means a more open pocket that accepts a worse angle. These give a
 * corner facing of about 30° off square and a side facing of about 22°.
 */
export const CORNER_FACE = 3.2;
export const SIDE_FACE = 2.2;

/**
 * How far past the mouth plane a ball's centre must travel to be pocketed.
 *
 * Small on purpose. The mouth plane is the boundary of the drawn well, so this
 * is the whole distance between "on the cloth" and "in the hole"; anything
 * larger would put a visible band of dark table where a ball is not yet
 * captured.
 */
export const POCKET_CAPTURE_DEPTH = 0.5;

/**
 * How far outside the mouth's own width a ball may still be captured.
 *
 * A ball can only get past the mouth plane by going through the mouth, so this
 * is not a licence to pocket from the cloth; it is slack for a ball that
 * clipped a jaw on the way in and is drifting sideways as it drops.
 */
export const POCKET_CAPTURE_MARGIN = 2;

/**
 * How far beyond the cushions a ball must be before it counts as LOST rather
 * than pocketed.
 *
 * The backstop under the capture test. Nothing should ever reach it, a ball
 * past the mouth plane is captured on the same step, but a physics engine that
 * has been handed an impossible impulse must not be able to lose a ball.
 */
export const TABLE_ESCAPE_MARGIN = CUSHION_DEPTH + CORNER_MOUTH + 6;

// ── Small local vector helpers ──────────────────────────────────────────────
//
// Local rather than imported from `physics.ts`, so this module stays a leaf: the
// renderer and the physics world both depend on it, and it depends on nothing
// but the table's dimensions.

function unit(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function add(a: Vec2, b: Vec2, scale = 1): Vec2 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

// ── Cushions ────────────────────────────────────────────────────────────────

export interface PoolCushion {
  /** For debugging and tests. `bottom-left`, `right`, and so on. */
  readonly id: string;
  /**
   * The polygon, counter-clockwise-agnostic: Planck computes the convex hull, so
   * the order here is chosen for readability (nose, nose, back, back).
   */
  readonly vertices: readonly Vec2[];
  /** The two points on the playfield boundary. The face a ball actually hits. */
  readonly noseA: Vec2;
  readonly noseB: Vec2;
  /**
   * Unit vector out of the playfield, perpendicular to the nose.
   *
   * Stored rather than derived. Deriving it from the polygon means measuring
   * from a nose to a BACK vertex, and the back edge is deliberately splayed by
   * the jaw: so the answer comes out tilted by the facing angle instead of
   * square to the rail.
   */
  readonly outward: Vec2;
}

/**
 * Build one cushion from its two nose points.
 *
 * `faceA`/`faceB` are how far the back edge retreats from each nose ALONG the
 * rail. The retreat is always *away from the adjacent pocket*, which is what
 * makes the opening widen with depth rather than narrow.
 */
function cushion(
  id: string,
  noseA: Vec2,
  noseB: Vec2,
  outward: Vec2,
  faceA: number,
  faceB: number,
): PoolCushion {
  const along = unit(noseB.x - noseA.x, noseB.y - noseA.y);
  const back = { x: outward.x * CUSHION_DEPTH, y: outward.y * CUSHION_DEPTH };
  return {
    id,
    noseA,
    noseB,
    outward,
    vertices: [
      noseA,
      noseB,
      add(add(noseB, along, -faceB), back),
      add(add(noseA, along, faceA), back),
    ],
  };
}

const DOWN: Vec2 = { x: 0, y: -1 };
const UP: Vec2 = { x: 0, y: 1 };
const LEFT: Vec2 = { x: -1, y: 0 };
const RIGHT: Vec2 = { x: 1, y: 0 };

const MID = TABLE_LENGTH / 2;

/**
 * The six cushions, with six real gaps between them.
 *
 * Long rails are split by their side pocket; short rails are one piece. Nothing
 * spans a pocket mouth; that is the entire point.
 */
export const POOL_CUSHIONS: readonly PoolCushion[] = Object.freeze([
  cushion(
    'bottom-left',
    { x: CORNER_MOUTH, y: 0 },
    { x: MID - SIDE_MOUTH, y: 0 },
    DOWN,
    CORNER_FACE,
    SIDE_FACE,
  ),
  cushion(
    'bottom-right',
    { x: MID + SIDE_MOUTH, y: 0 },
    { x: TABLE_LENGTH - CORNER_MOUTH, y: 0 },
    DOWN,
    SIDE_FACE,
    CORNER_FACE,
  ),
  cushion(
    'top-left',
    { x: CORNER_MOUTH, y: TABLE_WIDTH },
    { x: MID - SIDE_MOUTH, y: TABLE_WIDTH },
    UP,
    CORNER_FACE,
    SIDE_FACE,
  ),
  cushion(
    'top-right',
    { x: MID + SIDE_MOUTH, y: TABLE_WIDTH },
    { x: TABLE_LENGTH - CORNER_MOUTH, y: TABLE_WIDTH },
    UP,
    SIDE_FACE,
    CORNER_FACE,
  ),
  cushion(
    'left',
    { x: 0, y: CORNER_MOUTH },
    { x: 0, y: TABLE_WIDTH - CORNER_MOUTH },
    LEFT,
    CORNER_FACE,
    CORNER_FACE,
  ),
  cushion(
    'right',
    { x: TABLE_LENGTH, y: CORNER_MOUTH },
    { x: TABLE_LENGTH, y: TABLE_WIDTH - CORNER_MOUTH },
    RIGHT,
    CORNER_FACE,
    CORNER_FACE,
  ),
]);

// ── Pockets ─────────────────────────────────────────────────────────────────

export type PoolPocketKind = 'corner' | 'side';

export interface PoolPocket {
  /** Index into {@link POCKETS}, the id every event and test uses. */
  readonly index: number;
  readonly kind: PoolPocketKind;
  /** The nominal hole position: a table corner, or the middle of a long rail. */
  readonly centre: Vec2;
  /** The two cushion noses this mouth runs between. */
  readonly mouthA: Vec2;
  readonly mouthB: Vec2;
  /** Midpoint of the mouth. The origin of the capture test. */
  readonly mouthMid: Vec2;
  /** Unit vector out of the playfield, perpendicular to the mouth. */
  readonly outward: Vec2;
  /** Unit vector along the mouth, from A to B. */
  readonly tangent: Vec2;
  /** Half the mouth's width. */
  readonly halfWidth: number;
  /**
   * The radius of the pocket's well, in table units.
   *
   * The distance from the pocket centre to each mouth end, so a circle of this
   * radius passes exactly through both cushion noses, and the part of it beyond
   * the mouth chord is the hole. That makes the drawn opening reach the noses
   * without spilling a single pixel onto playable cloth, which is the property
   * the whole rewrite turns on.
   */
  readonly wellRadius: number;
}

function pocket(
  index: number,
  kind: PoolPocketKind,
  centre: Vec2,
  mouthA: Vec2,
  mouthB: Vec2,
  outward: Vec2,
): PoolPocket {
  const tangent = unit(mouthB.x - mouthA.x, mouthB.y - mouthA.y);
  return {
    index,
    kind,
    centre,
    mouthA,
    mouthB,
    mouthMid: { x: (mouthA.x + mouthB.x) / 2, y: (mouthA.y + mouthB.y) / 2 },
    outward,
    tangent,
    halfWidth: Math.hypot(mouthB.x - mouthA.x, mouthB.y - mouthA.y) / 2,
    wellRadius: Math.hypot(mouthA.x - centre.x, mouthA.y - centre.y),
  };
}

const DIAG = Math.SQRT1_2;

/**
 * The six pockets, in {@link POCKETS} order, each defined by the mouth its two
 * neighbouring cushions leave.
 *
 * The mouth points are written from the same constants the cushions are built
 * from, and `pool-physics-geometry.test.ts` asserts every mouth point really is
 * a cushion nose, so the pockets cannot drift away from the gaps.
 */
export const POOL_POCKETS: readonly PoolPocket[] = Object.freeze([
  pocket(
    0,
    'corner',
    POCKETS[0],
    { x: CORNER_MOUTH, y: 0 },
    { x: 0, y: CORNER_MOUTH },
    { x: -DIAG, y: -DIAG },
  ),
  pocket(
    1,
    'side',
    POCKETS[1],
    { x: MID - SIDE_MOUTH, y: 0 },
    { x: MID + SIDE_MOUTH, y: 0 },
    DOWN,
  ),
  pocket(
    2,
    'corner',
    POCKETS[2],
    { x: TABLE_LENGTH, y: CORNER_MOUTH },
    { x: TABLE_LENGTH - CORNER_MOUTH, y: 0 },
    { x: DIAG, y: -DIAG },
  ),
  pocket(
    3,
    'corner',
    POCKETS[3],
    { x: 0, y: TABLE_WIDTH - CORNER_MOUTH },
    { x: CORNER_MOUTH, y: TABLE_WIDTH },
    { x: -DIAG, y: DIAG },
  ),
  pocket(
    4,
    'side',
    POCKETS[4],
    { x: MID + SIDE_MOUTH, y: TABLE_WIDTH },
    { x: MID - SIDE_MOUTH, y: TABLE_WIDTH },
    UP,
  ),
  pocket(
    5,
    'corner',
    POCKETS[5],
    { x: TABLE_LENGTH - CORNER_MOUTH, y: TABLE_WIDTH },
    { x: TABLE_LENGTH, y: TABLE_WIDTH - CORNER_MOUTH },
    { x: DIAG, y: DIAG },
  ),
]);

/**
 * How far past the mouth plane this point is, in table units.
 *
 * Negative on the cloth, positive inside the pocket. This single number is what
 * the capture test, the renderer's well and the debug overlay all read.
 */
export function pocketDepth(target: PoolPocket, point: Vec2): number {
  return (
    (point.x - target.mouthMid.x) * target.outward.x +
    (point.y - target.mouthMid.y) * target.outward.y
  );
}

/** How far along the mouth this point is from its midpoint, in table units. */
export function pocketOffset(target: PoolPocket, point: Vec2): number {
  return Math.abs(
    (point.x - target.mouthMid.x) * target.tangent.x +
      (point.y - target.mouthMid.y) * target.tangent.y,
  );
}

/** Whether a ball CENTRE at this point has been pocketed here. */
export function isCapturedBy(target: PoolPocket, point: Vec2): boolean {
  if (pocketDepth(target, point) < POCKET_CAPTURE_DEPTH) return false;
  return pocketOffset(target, point) <= target.halfWidth + POCKET_CAPTURE_MARGIN;
}

/** Which pocket has swallowed a ball centred here, or `null`. */
export function capturingPocket(point: Vec2): PoolPocket | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  for (const target of POOL_POCKETS) {
    if (isCapturedBy(target, point)) return target;
  }
  return null;
}

/**
 * The pocket nearest this point, by mouth midpoint. Never `null`.
 *
 * Used only by the escape backstop, to decide which pocket a ball that somehow
 * left the table must have gone down.
 */
export function nearestPocket(point: Vec2): PoolPocket {
  let best = POOL_POCKETS[0];
  let bestDistance = Infinity;
  for (const target of POOL_POCKETS) {
    const distance = Math.hypot(point.x - target.mouthMid.x, point.y - target.mouthMid.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** True when a point is so far outside the table that it can only be an error. */
export function hasEscapedTable(point: Vec2): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
  return (
    point.x < -TABLE_ESCAPE_MARGIN ||
    point.x > TABLE_LENGTH + TABLE_ESCAPE_MARGIN ||
    point.y < -TABLE_ESCAPE_MARGIN ||
    point.y > TABLE_WIDTH + TABLE_ESCAPE_MARGIN
  );
}

export interface MouthCrossing {
  readonly pocket: PoolPocket;
  /** How far along the ray the mouth is crossed, in table units. */
  readonly travel: number;
}

/** Ray-versus-segment. Returns how far along the ray, or `null`. */
function rayHitsSegment(from: Vec2, direction: Vec2, a: Vec2, b: Vec2): number | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = direction.x * sy - direction.y * sx;
  if (Math.abs(denominator) < 1e-9) return null; // parallel

  // With `A` the segment's start, `P` the ray's origin, `d` its direction and
  // `s = B − A`:
  //     travel = cross(A − P, s) / cross(d, s)
  //     along  = cross(A − P, d) / cross(d, s)
  // Both denominators are the SAME cross product; an earlier pass negated the
  // second one, which mirrored `along` about the segment's midpoint and made
  // every crossing look like a miss.
  const ax = a.x - from.x;
  const ay = a.y - from.y;
  const travel = (ax * sy - ay * sx) / denominator;
  const along = (ax * direction.y - ay * direction.x) / denominator;

  if (travel <= 1e-6) return null; // behind the ray
  if (along < 0 || along > 1) return null; // past the end of the segment
  return travel;
}

/**
 * How far a ball's CENTRE can travel along a ray before it meets a cushion.
 *
 * Cast against the cushion noses offset inward by a ball's radius, the line a
 * centre can actually reach, rather than against the playfield rectangle. The
 * difference is the whole point: a rectangle has no pocket mouths in it, so the
 * aim guide used to draw a cushion across a hole and refuse to warn about a
 * scratch straight down a side pocket.
 *
 * `Infinity` when the ray leaves through a mouth without touching a cushion,
 * which is the caller's cue to look at {@link nearestMouthCrossing} instead.
 */
export function nearestCushionContact(from: Vec2, direction: Vec2): number {
  let best = Infinity;
  for (const shape of POOL_CUSHIONS) {
    // The nose, pulled onto the cloth by one radius. `outward` is the direction
    // out of the playfield, so the inward offset is its negation.
    const outward = shape.outward;
    const a = {
      x: shape.noseA.x - outward.x * BALL_RADIUS,
      y: shape.noseA.y - outward.y * BALL_RADIUS,
    };
    const b = {
      x: shape.noseB.x - outward.x * BALL_RADIUS,
      y: shape.noseB.y - outward.y * BALL_RADIUS,
    };
    const travel = rayHitsSegment(from, direction, a, b);
    if (travel !== null && travel < best) best = travel;
  }
  return best;
}

/**
 * Where a ray first crosses a pocket mouth, or `null`.
 *
 * The one query behind two things that must agree: the aim guide's "you are
 * about to scratch" warning, and the AI's estimate of whether its own cue ball
 * will follow the object ball in. Both used to test against a circle around the
 * pocket centre: a different shape from the one the physics used, so the guide
 * could warn about a scratch that would not happen and the planner could walk
 * into one that would.
 *
 * A plain ray-versus-segment intersection against the mouth itself: the same
 * two nose points the cushions leave and the renderer draws.
 */
export function nearestMouthCrossing(from: Vec2, direction: Vec2): MouthCrossing | null {
  let best: MouthCrossing | null = null;

  for (const target of POOL_POCKETS) {
    const travel = rayHitsSegment(from, direction, target.mouthA, target.mouthB);
    if (travel === null) continue;
    if (best === null || travel < best.travel) best = { pocket: target, travel };
  }

  return best;
}

/**
 * Whether a ball resting here would be over a pocket mouth.
 *
 * Used to refuse a ball-in-hand placement. Deliberately stricter than
 * {@link isCapturedBy}: a ball placed a hair short of the mouth plane would be
 * legal by capture and absurd in play, so this rejects the whole mouth region
 * plus a ball's radius of approach.
 */
export function isOverPocketMouth(point: Vec2): boolean {
  for (const target of POOL_POCKETS) {
    if (pocketDepth(target, point) < -BALL_RADIUS) continue;
    if (pocketOffset(target, point) <= target.halfWidth + POCKET_CAPTURE_MARGIN) return true;
  }
  return false;
}
