/**
 * The Plaza interior: everything that has to agree about where things are.
 *
 * `plaza-inside.webp` is a finished scene. The six storefronts, the balcony,
 * the staircase, the door, the rug and the planters are all PAINTED into the
 * plate rather than composed from sprites, so what the room needs from code is
 * the part a picture cannot do: where the player may walk, what is in front of
 * them, and what happens when they press a storefront. This file holds every
 * number for that, in one place, for the reason `care-store-config.ts` gives —
 * a stand point that lives in a component and a boundary that lives in a table
 * drift apart the first time either is touched.
 *
 * ## Coordinates
 *
 * WORLD PERCENT of the fixed 1046×697 design box, the same units
 * `locationBoundaries`, `MovementBlocker`, the depth bands and every approach
 * target use. The plate is 1536×1024 — the world's own 3:2 to within a
 * sub-pixel crop under `object-cover` — so image percentages ARE world
 * percentages, and every figure below was probed on the plate's own pixels.
 *
 * ## What was measured
 *
 * - The balcony railing: its base runs y = 46.2 at both frame edges and drops
 *   to y = 49.3 from x ≈ 27 to x ≈ 73, where the two wings meet the staircase.
 *   The railing itself grows from 8 % of the world tall beside the landing to
 *   nearly 13 % at the frame edges, which is why the walkable corridor stops
 *   at x = 19 / 81 (`location-boundaries.ts`).
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
 * Blobbi in front of that overlay — on the landing, on the stairs, on the
 * ground floor — takes {@link PLAZA_DEPTH.blobbiInFront}; one behind it takes
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

/**
 * Where the overlay's occlusion actually changes, in world y.
 *
 * `landingTop` is the top edge of the staircase's landing in the overlay — the
 * highest row at which the overlay paints anything between the stair rails.
 * `railingBase` is the bottom edge of the balcony railing's plate along its
 * centre run, the lowest row the overlay paints outside the stairs. Between
 * those two rows the overlay is opaque on the corridor AND on the landing, and
 * only the x-position says which one the Blobbi is standing on.
 */
export const PLAZA_OCCLUSION = {
  landingTop: 44.6,
  railingBase: 49.3,
  /**
   * The staircase's horizontal extent within that band: the inner faces of the
   * two stair rails at the landing, which is also where the walk boundary's
   * stair column begins and the corridor's centre run ends.
   */
  stairsX: [43, 57] as readonly [number, number],
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
 * The occluder. A 1536×1024 plate — the same size and grid as the background —
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
 * balcony corridor at the bay's inner post, inside the thin band behind the
 * railing — see the corridor wings in `location-boundaries.ts`. They stand at
 * the post rather than the bay's centre because the railing grows taller
 * toward the frame edges; at the post the head still clears the top rail. The
 * upper stand points sit at y ≈ 46.5, level with the landing, so the walk from
 * the door is one straight leg along the corridor.
 */
const GROUND_STAND_Y = 76;

/**
 * The six storefronts, left to right, upper floor first.
 *
 * `destination` is the whole navigation contract: a `LocationId` walks the
 * player to the shop and takes them inside on arrival; `null` walks them there
 * and shows a small "Coming soon" instead. Opening a shop later is one edit —
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
    standPoint: { x: 21.8, y: 46.5 },
    destination: null,
  },
  {
    id: 'plaza-books',
    name: 'Books',
    // Upper right, mirror of the Toy Shop.
    box: { x: 74.5, y: 17, width: 19, height: 23 },
    standPoint: { x: 78, y: 46.5 },
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
 * The fountain — the one prop still composed from sprites, because nothing
 * like it is painted into the plate.
 *
 * It used to stand at 19.8 % of the world wide with its plinth on y = 90,
 * which put its spire over the bottom steps and its plinth over the rug now
 * that the staircase reaches down to y ≈ 73 and the rug fills y 73.5–83.5. It
 * now stands in the open floor BELOW the rug: 15 % wide, plinth on y = 97, so
 * the plinth spans x 42.5–57.5, y ≈ 89–97 and the spire's tip (y ≈ 83) just
 * meets the rug's lower edge. The rug — the Plaza's own emblem — stays whole.
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
  placement: { centerX: 50, bottom: 3, width: 15 },
  basinClassName: 'absolute left-1/2 -translate-x-1/2 bottom-[30%] w-[70%]',
  spireClassName: 'absolute left-1/2 -translate-x-1/2 bottom-[80%] w-[25%]',
  blocker: { id: 'plaza-fountain', x: 42.5, y: 89, width: 15, height: 8 } as PlazaInsideBlocker,
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
 * plate paints on the floor — the rug, the shop thresholds — is walkable.
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
