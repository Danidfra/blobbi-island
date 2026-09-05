/**
 * Movement heading → renderer facing, for artwork generations that have a
 * profile to show.
 *
 * The movement controller already exposes a normalized heading
 * (`direction: { x, y }`, screen axes: +y is DOWN, toward the viewer). This
 * module turns it into the renderer's `BlobbiFacing` and decides whether the
 * body may turn at all. Pure; no movement, collision or pose logic changes.
 *
 * Mapping (dominant axis; an exact tie is vertical so the rule is total and
 * deterministic):
 *
 *   down  (+y) → front       up   (−y) → back
 *   right (+x) → right       left (−x) → left
 *   diagonals  → whichever axis has the larger magnitude
 *   no heading → the fallback (front)
 *
 * Which body turns: V1 has no profile artwork and its rear view is a pose
 * consequence (seats), never a walking one; so V1 IGNORES the movement facing
 * entirely and keeps the pose facing it always had. V2 turns while standing.
 * A pose facing of `'back'` (a rear-facing seat) always wins.
 */
import type { BlobbiFacing, BlobbiVisual } from '@blobbi-kit/renderer';

export interface MovementHeading {
  x: number;
  y: number;
}

/** Below this magnitude a heading is "not moving anywhere". */
const HEADING_EPSILON = 1e-3;

export function facingFromHeading(heading: MovementHeading, fallback: BlobbiFacing = 'front'): BlobbiFacing {
  const ax = Math.abs(heading.x);
  const ay = Math.abs(heading.y);
  if (ax < HEADING_EPSILON && ay < HEADING_EPSILON) return fallback;
  if (ay >= ax) return heading.y > 0 ? 'front' : 'back';
  return heading.x > 0 ? 'right' : 'left';
}

export interface BodyFacingInput {
  /** The visual as it will be drawn (generation already resolved). */
  visual: BlobbiVisual;
  /** The pose's facing, from `resolveActorRender` (seats can face back). */
  poseFacing: 'front' | 'back';
  /** The movement facing while STANDING; undefined for any other pose. */
  movementFacing?: BlobbiFacing;
}

/** The facing the body renderer receives. */
export function resolveBodyFacing({ visual, poseFacing, movementFacing }: BodyFacingInput): BlobbiFacing {
  if (poseFacing === 'back') return 'back';
  if (visual.visualGeneration !== 'v2') return poseFacing;
  return movementFacing ?? poseFacing;
}
