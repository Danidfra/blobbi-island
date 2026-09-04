/**
 * The Plaza interior: everything that has to agree about where things are.
 *
 * `plaza-inside.webp` is a finished scene. The six storefronts, the balcony,
 * the staircase, the door, the rug and the planters are all PAINTED into the
 * plate rather than composed from sprites, so what the room needs from code is
 * the part a picture cannot do: where the player may walk, what is in front of
 * them, and what happens when they press a storefront. This file holds every
 * number for that, in one place, for the reason `care-store-config.ts` gives,
 * a stand point that lives in a component and a boundary that lives in a table
 * drift apart the first time either is touched.
 *
 * ## Coordinates
 *
 * WORLD PERCENT of the fixed 1046×697 design box, the same units
 * `locationBoundaries`, `MovementBlocker`, the depth bands and every approach
 * target use. The plate is 1536×1024, the world's own 3:2 to within a
 * sub-pixel crop under `object-cover`: so image percentages ARE world
 * percentages, and every figure below was probed on the plate's own pixels.
 *
 * ## What was measured
 *
 * - The balcony railing: its base runs y = 46.2 at both frame edges and drops
 *   to y = 49.3 from x ≈ 27 to x ≈ 73, where the two wings meet the staircase.
 *   The railing itself grows from 8 % of the world tall beside the landing to
 *   14 % at the frame edges, its solid plate alone from 5.5 % to 9.5 %; its top
 *   edge is flat at y = 43.8 along the centre run and rises straight to
 *   y ≈ 37 at the frame edges. The corridor line (`PLAZA_CORRIDOR`) follows
 *   that edge.
 * - The staircase: top landing from y = 44.6 between the stair rails (x 43.4
 *   and 56.6 at the top), the rails diverging to newel posts at x 36.1–40.1 and
 *   59.9–63.9, bottom step at y = 72.9.
 * - The door: frame x 46.2–53.3, y 33.3–45.3, its base on the landing.
 * - The rug: an ellipse x 37.3–62.6, y 73.5–83.5, centred on x = 50.
 * - The planters: pots x 1.5–5.5 and 94.5–98.5, bases at y ≈ 76.
 */

import type { Position } from '@/lib/types';
import type { LocationId } from '@/lib/location-types';
import type { StorefrontHotspotConfig } from '@/lib/storefront-hotspots';

export const PLAZA_INSIDE_BACKGROUND = 'plaza-inside.webp';

/** A rectangle in world percent, matching `MovementBlocker`'s props. */
export interface PlazaInsideBlocker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

/**
 * The room's stacking order, stated once and consumed by both the room and the
 * Blobbi depth bands in `interactive-elements-config.ts`.
 *
 * The one occluder in the room is the balcony-and-staircase overlay: a copy of
 * the plate's railing and stairs with everything else cut away, drawn above the
 * Blobbi so that a Blobbi on the upper corridor passes BEHIND the railing. A
 * Blobbi in front of that overlay, on the landing, on the stairs, on the
 * ground floor: takes {@link PLAZA_DEPTH.blobbiInFront}; one behind it takes
 * {@link PLAZA_DEPTH.blobbiBehind}.
 */
export const PLAZA_DEPTH = {
  /** The closed door and its open-door overlay: deepest thing in the room. */
  door: 8,
  /** The Blobbi behind the railing: above the door, below the overlay. */
  blobbiBehind: 9,
  /** The balcony railing + staircase overlay. */
  overlay: 10,
  /** The storefront hotspots, over the overlay so a railing never eats a tap. */
  storefront: 11,
  /** The Blobbi on the landing, the stairs or the ground floor. */
  blobbiInFront: 20,
  /** The fountain, standing on the ground floor. */
  fountain: 24,
  /** The Blobbi in front of the fountain's plinth. */
  blobbiInFrontOfFountain: 25,
} as const;

// ---------------------------------------------------------------------------
// The staircase and the balcony corridor
// ---------------------------------------------------------------------------

/**
 * The staircase, as the plate paints it and as the player may walk it.
 *
 * `railsTop` / `railsBottom` are the inner faces of the two stair rails, at the
 * landing and at the newel posts. The walkable column is those faces brought
 * in by {@link PLAZA_STAIRS.railMargin} on each side, the Blobbi's GROUND
 * POINT is what the boundary constrains, and a ground point on the rail's
 * inner face puts half a body over the rail. The `lg` rig is a 96 px box; on
 * the flight it is drawn at 0.7–0.85 depth scale, so its half-width is
 * 3.2–3.9 % of the world, of which the painted body takes about three quarters.
 * A 3 % margin keeps the body off both rails all the way up without narrowing
 * the flight by more than the rails' own thickness on each side.
 */
export const PLAZA_STAIRS = {
  /** Inner faces of the stair rails at the landing. */
  railsTop: [43, 57] as readonly [number, number],
  /** Inner faces of the newel posts at the foot of the flight. */
  railsBottom: [40.2, 59.8] as readonly [number, number],
  /** How far inside each rail the ground point must stay, in world x. */
  railMargin: 3,
  /** Top edge of the landing, the highest walkable row on the stairs. */
  landingTop: 44.6,
  /** Where the flight starts widening below the landing. */
  flightTop: 46.8,
  /** The bottom step meets the ground floor here. */
  foot: 73.6,
} as const;

/** The walkable stair column at the landing: rails inset by the margin. */
export const PLAZA_STAIRS_WALK_TOP: readonly [number, number] = [
  PLAZA_STAIRS.railsTop[0] + PLAZA_STAIRS.railMargin,
  PLAZA_STAIRS.railsTop[1] - PLAZA_STAIRS.railMargin,
];

/** The walkable stair column at the foot of the flight. */
export const PLAZA_STAIRS_WALK_BOTTOM: readonly [number, number] = [
  PLAZA_STAIRS.railsBottom[0] + PLAZA_STAIRS.railMargin,
  PLAZA_STAIRS.railsBottom[1] - PLAZA_STAIRS.railMargin,
];

/**
 * The balcony corridor: ONE LINE, drawn along the parapet.
 *
 * The balcony floor is hidden behind its own parapet, so there is no floor to
 * walk on: only a line to walk along, and the line has to be where the eye
 * expects a Blobbi behind that parapet to be. It is a centreline, and the
 * Blobbi's feet ride it: any target above or below is projected straight onto
 * it by the ordinary boundary clamp (the line is a chain of `segment` areas,
 * so nothing about the walk is special-cased), and a walk along it cannot
 * drift up or down.
 *
 * ## Its shape is the parapet's
 *
 * Probed on the overlay, the parapet's top edge is flat at y = 43.8 from
 * x = 27 to x = 73 and then rises in a straight line to y ≈ 37 at the frame
 * edges: 6.8 % of the world's height over 24 % of its width, the same on both
 * sides. The corridor keeps a constant immersion behind it: on the centre run
 * the feet are at y = 46 (the landing's own row, so the door target and the
 * spawn are on the line and the walk from the door to a shop is one leg),
 * 2.2 % below the parapet's edge, and along each wing they climb at the
 * parapet's own slope so that the same lower quarter of the Blobbi is behind
 * the plate all the way out. The kink at x = 27 / 73 is real in the artwork
 * but is not walked as a corner: a parabola {@link PLAZA_CORRIDOR.blend} either
 * side of it joins the run to the wing with matching slope, so the climb
 * begins gently.
 *
 * A line that stayed on y = 46 to the ends was tried first and put the Blobbi
 * behind a parapet that is 9.5 % of the world tall at the frame edges: from
 * x ≈ 15 outward nothing but the crown of the head showed. Following the
 * parapet instead keeps head and eyes above it everywhere, the parapet's
 * pickets are see-through, only its plate is solid.
 *
 * The line runs to within a body's width of both frame edges; the plate
 * paints the balcony edge to edge, with the two upper bays standing behind it.
 * {@link plazaCorridorPaths} samples the line into the segments the boundary
 * walks, and {@link plazaCorridorPointAt} puts a stand point exactly on it.
 */
export const PLAZA_CORRIDOR = {
  /** The centre run's row, shared with the landing. */
  y: 46,
  /** Where the parapet kinks: the centre run's ends, the wings' starts. */
  kinks: [27, 73] as readonly [number, number],
  /** The reachable ends, a body's width in from the frame. */
  left: 3.5,
  right: 96.5,
  /** The wings' rise per unit of x, from the parapet's top edge. */
  wingSlope: 6.8 / 24,
  /** Half-width, in x, of the parabolic blend either side of each kink. */
  blend: 4,
  /** Sample spacing, in x, through the blend. */
  blendStep: 2,
} as const;

/**
 * The corridor centreline's y at `x`: flat along the centre run, a parabola
 * across each kink, the parapet's own slope along each wing.
 */
export function plazaCorridorY(x: number): number {
  const { y, kinks, wingSlope, blend } = PLAZA_CORRIDOR;
  // How far past the nearer kink `x` is; negative inside the centre run.
  const d = Math.max(kinks[0] - x, x - kinks[1]);
  if (d <= -blend) return y;
  if (d >= blend) return y - wingSlope * d;
  // Tangent to the run at d = -blend, to the wing at d = +blend.
  return y - (wingSlope * (d + blend) ** 2) / (4 * blend);
}

/**
 * The corridor as two polylines, left and right of the stair column, each
 * running from the frame edge in to the column: the sampled centreline, with a
 * vertex at every blend sample so the walked chain matches the curve.
 */
export function plazaCorridorPaths(): { left: Position[]; right: Position[] } {
  const { kinks, blend, blendStep, left, right } = PLAZA_CORRIDOR;
  const xsLeft: number[] = [left];
  for (let x = kinks[0] - blend; x <= kinks[0] + blend + 1e-9; x += blendStep) xsLeft.push(x);
  xsLeft.push(PLAZA_STAIRS_WALK_TOP[0]);
  const xsRight: number[] = [right];
  for (let x = kinks[1] + blend; x >= kinks[1] - blend - 1e-9; x -= blendStep) xsRight.push(x);
  xsRight.push(PLAZA_STAIRS_WALK_TOP[1]);
  const at = (x: number): Position => ({ x, y: plazaCorridorY(x) });
  return { left: xsLeft.map(at), right: xsRight.map(at) };
}

/**
 * The point ON the walked corridor at `x`: on the sampled chain, not the
 * curve it approximates, so a stand point placed with this is on the floor to
 * the last bit.
 */
export function plazaCorridorPointAt(x: number): Position {
  const { left, right } = plazaCorridorPaths();
  const chain = x < 50 ? left : right;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (x >= lo - 1e-9 && x <= hi + 1e-9) {
      const t = hi === lo ? 0 : (x - a.x) / (b.x - a.x);
      return { x, y: a.y + t * (b.y - a.y) };
    }
  }
  throw new Error(`x = ${x} is not on the Plaza corridor`);
}

/**
 * Where the overlay's occlusion actually changes, in world y.
 *
 * `landingTop` is the top edge of the staircase's landing in the overlay, the
 * highest row at which the overlay paints anything between the stair rails.
 * `railingBase` is the bottom edge of the balcony railing's plate along its
 * centre run, the lowest row the overlay paints outside the stairs. Between
 * those two rows the overlay is opaque on the corridor AND on the landing, and
 * only the x-position says which one the Blobbi is standing on.
 */
export const PLAZA_OCCLUSION = {
  landingTop: PLAZA_STAIRS.landingTop,
  railingBase: 49.3,
  /**
   * The staircase's horizontal extent within that band: the walkable stair
   * column at the landing ({@link PLAZA_STAIRS_WALK_TOP}). Inside it the
   * Blobbi can only be on the landing, in front of the overlay; outside it,
   * including the margin between the column and the rail's face; it can only
   * be on the corridor line, behind the railing.
   */
  stairsX: PLAZA_STAIRS_WALK_TOP,
} as const;

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * The entrance/exit door, on the landing at the top of the stairs.
 *
 * The door is painted into the plate (x 46.2–53.3, y 33.3–45.3), and the
 * sprite pair `inside-door.png` / `inside-door-open.png` is laid over it so the
 * open-door hover/tap affordance still works. The sprite's leaves are WIDER
 * than they are tall (its painted body is 325×290 px inside a 424×351 canvas)
 * while the painted door is taller than it is wide (74×84 world px), so a
 * uniform scale that covered the painted door's height would spill a full
 * percent over each lamp beside it. The group is therefore sized by WIDTH and
 * stretched vertically by {@link PLAZA_DOOR.scaleY}, which is what makes the
 * sprite's body land on x 45.8–53.7, y 33.0–45.4: every painted edge covered
 * with ≥ 0.3 % to spare, and nothing else touched.
 *
 * The base sits on the landing, where the overlay's top step (from y = 44.6)
 * hides the seam between sprite and plate.
 */
export const PLAZA_DOOR = {
  closedSrc: '/assets/locations/plaza/inside-door.png',
  openSrc: '/assets/locations/plaza/inside-door-open.png',
  closedAlt: 'Plaza inside door',
  openAlt: 'Plaza inside door open',
  /** The closed sprite's canvas, and where its painted body sits inside it. */
  sprite: {
    width: 424,
    height: 351,
    /** The door's leaves and frame, excluding the arch above and the film around. */
    body: { left: 53, top: 45, right: 378, bottom: 335 },
  },
  /** The door as painted into the plate, in world percent. */
  painted: { left: 46.2, top: 33.3, right: 53.3, bottom: 45.3 },
  /**
   * The sprite group's box, in world percent. Sized by width; the height
   * follows the sprite's own aspect and is then stretched by `scaleY`.
   */
  placement: { left: 44.55, top: 31.05, width: 10.2 },
  /** Vertical stretch that fits the wide sprite to the tall painted door. */
  scaleY: 1.184,
  /**
   * The open-door PNG has a wider canvas than the closed one (432×351 vs
   * 424×351) because its leaves swing past the frame. Both are drawn on the
   * same grid, so rendering the overlay at 432/424 of the group width, height
   * automatic, keeps the shared frame aligned.
   */
  openOverlayClassName: 'absolute top-0 left-0 w-[101.887%]',
  /** Where the player stands to leave: centre of the landing, at the door. */
  walkTarget: { x: 50, y: 46 } as Position,
  leadsTo: 'plaza' as LocationId,
} as const;

// ---------------------------------------------------------------------------
// The balcony-and-staircase overlay
// ---------------------------------------------------------------------------

/**
 * The occluder. A 1536×1024 plate, the same size and grid as the background,
 * carrying only the balcony railing and the staircase, drawn with the same
 * `inset-0 object-cover` mapping as the background so the two are pixel-aligned.
 * Decorative: `pointer-events-none`, or it would swallow the door's hover and
 * every storefront tap beneath it.
 */
export const PLAZA_OVERLAY = {
  src: '/assets/locations/plaza/glass-barrier.webp',
  alt: 'Balcony railing and staircase',
  className: 'absolute inset-0 w-full h-full object-cover pointer-events-none',
} as const;

// ---------------------------------------------------------------------------
// The storefronts
// ---------------------------------------------------------------------------

/**
 * Where the player stands in front of each storefront.
 *
 * Ground floor: on the open floor just below the shops' threshold line
 * (y = 73.6), clear of every planter and sign board. Upper floor: on the
 * balcony corridor line ({@link PLAZA_CORRIDOR}) at the bay's inner post,
 * placed with {@link plazaCorridorPointAt} so the point is on the walked chain
 * exactly.
 */
const GROUND_STAND_Y = 76;

/**
 * The six storefronts, left to right, upper floor first.
 *
 * `destination` is the whole navigation contract: a `LocationId` walks the
 * player to the shop and takes them inside on arrival; `null` walks them there
 * and shows a small "Coming soon" instead. Opening a shop later is one edit,
 * fill in the id once its room exists.
 *
 * Each `box` is the storefront's painted bay: from its sign's top edge to its
 * threshold, between its frame's outer posts. Measured on the plate.
 */
export const plazaStorefronts: readonly StorefrontHotspotConfig[] = [
  {
    id: 'plaza-toy-shop',
    name: 'Toy Shop',
    // Upper left. The bay's lower part is behind the balcony railing, so the
    // box stops at the railing's top rail rather than at the shop's floor.
    box: { x: 6.3, y: 17, width: 15.7, height: 22 },
    standPoint: plazaCorridorPointAt(21.8),
    destination: null,
  },
  {
    id: 'plaza-books',
    name: 'Books',
    // Upper right, mirror of the Toy Shop.
    box: { x: 74.5, y: 17, width: 19, height: 23 },
    standPoint: plazaCorridorPointAt(78),
    destination: null,
  },
  {
    id: 'plaza-garden-shop',
    name: 'Garden Shop',
    box: { x: 5.5, y: 47, width: 16, height: 26 },
    standPoint: { x: 13.5, y: GROUND_STAND_Y },
    destination: null,
  },
  {
    id: 'plaza-creative-studio',
    name: 'Creative Studio',
    // Its right-hand post runs into the staircase's newel; the box stops at the
    // shop's own frame.
    box: { x: 26.5, y: 49, width: 12.5, height: 22 },
    standPoint: { x: 33, y: GROUND_STAND_Y },
    destination: null,
  },
  {
    id: 'plaza-music-store',
    name: 'Music Store',
    box: { x: 61, y: 49, width: 12.5, height: 22 },
    standPoint: { x: 67.3, y: GROUND_STAND_Y },
    destination: null,
  },
  {
    id: 'plaza-chill-lounge',
    name: 'Chill Lounge',
    box: { x: 79, y: 47.5, width: 15.5, height: 25.5 },
    standPoint: { x: 86.7, y: GROUND_STAND_Y },
    destination: null,
  },
];

// ---------------------------------------------------------------------------
// The fountain
// ---------------------------------------------------------------------------

/**
 * The fountain: the one prop still composed from sprites, because nothing
 * like it is painted into the plate.
 *
 * It stands in the open floor below the rug, centred on the room, with its
 * plinth on y = 97 so that the strip of floor in front of it (y 97–99.5) is
 * still walkable. It was 15 % wide, which read as a garden ornament on a
 * floor this size; at 20 % it is the room's centrepiece without crowding the
 * flanks: 40 % of open floor remains on either side. The plinth then spans
 * x 40–60, y ≈ 86–97 (the sprite is 207×75, so 20 % of the world's width is
 * 10.9 % of its height), the basin rises to y ≈ 82 and the spire's tip to
 * y ≈ 78, overlapping the lower edge of the rug (y 73.5–83.5): which is
 * right for a thing standing in front of it.
 *
 * `blocker` is the plinth's floor footprint, which is what the Blobbi's feet
 * are tested against; the basin and spire rise above the floor and block
 * nothing.
 */
export const PLAZA_FOUNTAIN = {
  plinthSrc: '/assets/locations/plaza/floor.png',
  basinSrc: '/assets/locations/plaza/fountain-bottom.png',
  spireSrc: '/assets/locations/plaza/fountain-top.png',
  /** The plinth sprite's canvas (`floor.png`), which sets the group's height. */
  plinthSprite: { width: 207, height: 75 },
  /**
   * The group's box, in world percent: centred on `centerX`, its bottom edge
   * `bottom` up from the floor, `width` wide. The basin and spire are placed
   * inside it as fractions of the plinth, exactly as they always were.
   */
  placement: { centerX: 50, bottom: 3, width: 20 },
  basinClassName: 'absolute left-1/2 -translate-x-1/2 bottom-[30%] w-[70%]',
  spireClassName: 'absolute left-1/2 -translate-x-1/2 bottom-[80%] w-[25%]',
  blocker: { id: 'plaza-fountain', x: 40, y: 86.1, width: 20, height: 10.9 } as PlazaInsideBlocker,
  /**
   * The y below which the Blobbi's feet are in FRONT of the plinth's lowest
   * painted row: the plinth's bottom edge.
   */
  frontLineY: 97,
} as const;

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/**
 * What stands on the ground floor, as floor footprints. Everything else the
 * plate paints on the floor, the rug, the shop thresholds, is walkable.
 */
export const plazaInsideBlockers: readonly PlazaInsideBlocker[] = [
  PLAZA_FOUNTAIN.blocker,
  // The two big planters flanking the ground floor: pots x 1.5–5.5 and
  // 94.5–98.5, bases at y ≈ 76. Only the part inside the floor band matters.
  { id: 'plaza-planter-left', x: 1.5, y: 73.6, width: 4, height: 2.6 },
  { id: 'plaza-planter-right', x: 94.5, y: 73.6, width: 4, height: 2.6 },
  // The Garden Shop's sandwich board (feet at y ≈ 75) and the Chill Lounge's
  // palm sign (down to y ≈ 77): the two sign boards that stand out past the
  // threshold line.
  { id: 'plaza-garden-sign', x: 18.7, y: 73.6, width: 3.3, height: 1.6 },
  { id: 'plaza-lounge-sign', x: 90, y: 73.6, width: 3.3, height: 3.6 },
];

/** Where the player arrives from outside: on the landing, at the door. */
export const PLAZA_INSIDE_SPAWN: Position = PLAZA_DOOR.walkTarget;
