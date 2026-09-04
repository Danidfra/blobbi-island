import { Boundary, WalkableArea } from '@/lib/boundaries';
import {
  PLAZA_STAIRS,
  PLAZA_STAIRS_WALK_BOTTOM,
  PLAZA_STAIRS_WALK_TOP,
  plazaCorridorPaths,
} from '@/lib/plaza-inside-config';

/** A polyline as the chain of `segment` areas the walk follows. */
function segmentsAlong(points: readonly { x: number; y: number }[]): WalkableArea[] {
  return points.slice(1).map((to, i): WalkableArea => ({ type: 'segment', from: points[i], to }));
}

/**
 * Walkable-floor boundaries, in GROUND-ANCHOR semantics (Phase 2).
 *
 * Every y-value constrains the Blobbi's GROUND-CONTACT POINT (feet), not the
 * legacy body center. The values below are the center-era boundaries shifted
 * down by the depth-scaled half body height at each edge
 * (`size_px/2 × scale(y) / 697 × 100` — see scripts note in
 * docs/blobbi-ground-anchor-implementation.md), which preserves the previous
 * ON-SCREEN walkable floor exactly: the region where feet could visually land
 * is unchanged, only the stored coordinate now names it directly.
 *
 * Values > 100 clamp to 100 (feet cannot leave the room). The body may extend
 * ABOVE a boundary edge — only the ground point is constrained. Deliberately
 * thin strips (the cave corridor, the mall's mid-level walkway) stay thin: they
 * match the artwork's floor bands.
 */
export const locationBoundaries: Record<string, Boundary> = {
  'home-inside.png': {
    shape: 'arch',
    top: 77.2,
    bottom: 89.2,
    curvature: 2,
  },
  'town-open.webp': {
    shape: 'arch',
    top: 63.5,
    bottom: 78.3,
    curvature: 4,
  },
  'beach-open.webp': {
    shape: 'arch',
    top: 74.9,
    bottom: 76.9,
    curvature: 6,
  },
  'mine-open.webp': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [42, 58], y: [79, 86.9] },
      { type: 'rectangle', x: [10, 90], y: [86.9, 100] },
    ]
  },
  'nostr-station-open.webp': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [5, 70], y: [71.4, 100] }, // Main area
      { type: 'triangle', points: [{ x: 44, y: 76.7 }, { x: 51, y: 76.7 }, { x: 51, y: 70.3 }] },

      { type: 'rectangle', x: [51, 61], y: [70.3, 76.7] },
      { type: 'triangle', points: [{ x: 51, y: 70.3 }, { x: 56, y: 70.3 }, { x: 56, y: 66 }] },

      { type: 'rectangle', x: [56, 61], y: [66, 70.3] },
      { type: 'triangle', points: [{ x: 56, y: 66 }, { x: 61, y: 59.7 }, { x: 61, y: 66 }] },

      { type: 'rectangle', x: [61, 70], y: [59.7, 76.7] },
      { type: 'triangle', points: [{ x: 61, y: 59.7 }, { x: 64, y: 59.7 }, { x: 64, y: 55.4 }] },

      { type: 'rectangle', x: [64, 70], y: [55.4, 59.7] },
      { type: 'triangle', points: [{ x: 70, y: 44.8 }, { x: 70, y: 55.4 }, { x: 64, y: 55.4 }] },

      { type: 'rectangle', x: [70, 96], y: [44.8, 100] },
      { type: 'triangle', points: [{ x: 70, y: 44.8 }, { x: 75, y: 36.3 }, { x: 75, y: 44.8 }] },

      { type: 'rectangle', x: [75, 90], y: [34.1, 50.1] },
    ],
  },
  'nostr-station-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'triangle', points: [{ x: 2, y: 83.3 }, { x: 20, y: 71.1 }, { x: 20, y: 83.3 }] },
      { type: 'triangle', points: [{ x: 98, y: 83.3 }, { x: 80, y: 71.1 }, { x: 80, y: 83.3 }] },

      { type: 'rectangle', x: [20, 26], y: [59, 71.1] },

      { type: 'rectangle', x: [33, 39], y: [59, 71.1] },

      { type: 'rectangle', x: [61, 67], y: [59, 71.1] },

      { type: 'rectangle', x: [74, 80], y: [59, 71.1] },

      { type: 'rectangle', x: [20, 80], y: [71.1, 83.3] },
      { type: 'rectangle', x: [2, 98], y: [83.3, 100] },
    ]
  },
  'plaza-open.webp': {
    shape: 'rectangle',
    x: [5, 95],
    y: [61.5, 100],
  },
  /**
   * Plaza interior — two floors joined by the staircase.
   *
   * Rebuilt from scratch against `plaza-inside.webp` (1536×1024, the world's
   * own 3:2, so image percentages are world percentages). Every band follows a
   * line probed on the plate or on the balcony/staircase overlay that is cut
   * from it — the figures are in `plaza-inside-config.ts`.
   *
   * ## Ground floor
   *
   * Open from frame edge to frame edge below the shops' threshold line
   * (y = 73.6, just under the bottom step at 72.9). The fountain, the two big
   * planters and the two sign boards that stand out past the threshold are
   * `MovementBlocker` rectangles (`plazaInsideBlockers`), not holes punched
   * here — a composite clamps to its NEAREST area, so a hole makes the Blobbi
   * slide round its rim while a blocker stops the walk and lets the route
   * planner take it round.
   *
   * ## Staircase
   *
   * The treads: a column between the stair rails, widening down the flight to
   * the newel posts and touching the ground floor at y = 73.6. The landing is
   * its top, from y = 44.6 — the door's walk target and the room's spawn are on
   * it. The column is the rails' inner faces brought in by `PLAZA_STAIRS.railMargin`
   * on each side: the boundary constrains the Blobbi's ground point, and a
   * ground point on a rail's face is half a body over the rail.
   *
   * ## Upper corridor
   *
   * The balcony floor is hidden behind its own parapet, so the corridor is a
   * LINE, not a band: a chain of `segment` areas along the centreline that
   * `plazaCorridorPaths` samples from `PLAZA_CORRIDOR` — flat along the centre
   * run at the landing's row, then climbing at the parapet's own slope along
   * each wing, with a short blend across the kink. The ordinary nearest-point
   * clamp projects any target above or below the line straight onto it, and
   * every walking step lands on it, so a Blobbi crossing the balcony cannot
   * drift off the parapet. The chain meets the landing at the stair column's
   * edges. The stairs keep their full two-dimensional column, so climbing and
   * descending still interpolate as they always have.
   */
  'plaza-inside.webp': {
    shape: 'composite',
    areas: [
      // Ground floor.
      { type: 'rectangle', x: [0.5, 99.5], y: [73.6, 99.5] },

      // Staircase: the landing and the treads between the rails…
      {
        type: 'rectangle',
        x: [PLAZA_STAIRS_WALK_TOP[0], PLAZA_STAIRS_WALK_TOP[1]],
        y: [PLAZA_STAIRS.landingTop, PLAZA_STAIRS.foot],
      },
      // …and the flight's widening sides, down to the newel posts.
      {
        type: 'triangle',
        points: [
          { x: PLAZA_STAIRS_WALK_TOP[0], y: PLAZA_STAIRS.flightTop },
          { x: PLAZA_STAIRS_WALK_TOP[0], y: PLAZA_STAIRS.foot },
          { x: PLAZA_STAIRS_WALK_BOTTOM[0], y: PLAZA_STAIRS.foot },
        ],
      },
      {
        type: 'triangle',
        points: [
          { x: PLAZA_STAIRS_WALK_TOP[1], y: PLAZA_STAIRS.flightTop },
          { x: PLAZA_STAIRS_WALK_TOP[1], y: PLAZA_STAIRS.foot },
          { x: PLAZA_STAIRS_WALK_BOTTOM[1], y: PLAZA_STAIRS.foot },
        ],
      },

      // Upper corridor: the centreline either side of the stair column, from
      // the frame edge in to the landing.
      ...segmentsAlong(plazaCorridorPaths().left),
      ...segmentsAlong(plazaCorridorPaths().right),
    ],
  },
  'arcade-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [0, 100], y: [57.2, 100] },
      { type: 'rectangle', x: [45, 55], y: [45.2, 57.2] },
    ],
  },
  'arcade-1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [59.3, 67.3] },

      { type: 'rectangle', x: [23.5, 76.5], y: [67.3, 92.3] },
      { type: 'triangle', points: [{ x: 100, y: 92.3 }, { x: 76.5, y: 67.3 }, { x: 76.5, y: 92.3 }] },
      { type: 'triangle', points: [{ x: 0, y: 92.3 }, { x: 23.5, y: 67.3 }, { x: 23.5, y: 92.3 }] },

      { type: 'rectangle', x: [0, 100], y: [92.3, 100] },
    ],
  },
  'arcade-minus1.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [48, 52], y: [54.5, 60.9] },

      { type: 'triangle', points: [{ x: 0, y: 81 }, { x: 26.5, y: 60.9 }, { x: 26.5, y: 81 }] },
      { type: 'rectangle', x: [26.5, 73.5], y: [60.9, 75.7] },
      { type: 'triangle', points: [{ x: 100, y: 81 }, { x: 73.5, y: 60.9 }, { x: 73.5, y: 81 }] },
      { type: 'rectangle', x: [0, 26.5], y: [81, 95.9] },
      { type: 'rectangle', x: [26.5, 42], y: [75.7, 89.5] },
      { type: 'rectangle', x: [58, 73.5], y: [75.7, 89.5] },
      { type: 'rectangle', x: [73.5, 100], y: [81, 95.9] },

      { type: 'rectangle', x: [48, 52], y: [78.9, 95.9] },
      { type: 'rectangle', x: [26.5, 73.5], y: [91.7, 95.9] },

      { type: 'rectangle', x: [0, 22], y: [95.9, 100] },
      { type: 'triangle', points: [{ x: 22, y: 95.9 }, { x: 22, y: 100 }, { x: 28, y: 95.9 }] },

      { type: 'rectangle', x: [78, 100], y: [95.9, 100] },
      { type: 'triangle', points: [{ x: 78, y: 95.9 }, { x: 78, y: 100 }, { x: 72, y: 95.9 }] },

    ],
  },
  'back-yard-open.webp': {
    shape: 'rectangle',
    x: [10, 90],
    y: [84.2, 100],
  },
  'stage-inside.png': {
    shape: 'rectangle',
    x: [0, 100],
    y: [84.2, 100],
  },
  'cave-inside.png': {
    // Deliberately thin: the corridor floor band in the art. Ground-anchor
    // semantics make this workable — only the feet must stay in the band.
    shape: 'rectangle',
    x: [16, 84],
    y: [80.2, 84.7],
  },
  'shopping-mall-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [0, 100], y: [90.6, 100] },

      { type: 'rectangle', x: [0, 7], y: [62.1, 90.6] },
      { type: 'triangle', points: [{ x: 7, y: 70.2 }, { x: 7, y: 90.6 }, { x: 10, y: 90.6 }] },

      // The middle-level walkway strip (thin by design — matches the artwork).
      { type: 'rectangle', x: [7, 100], y: [62.1, 63.1] },

      { type: 'rectangle', x: [93, 100], y: [32.5, 62.1] },
      { type: 'triangle', points: [{ x: 93, y: 32.5 }, { x: 93, y: 62.1 }, { x: 90, y: 62.1 }] },

      { type: 'rectangle', x: [0, 93], y: [32.5, 33.5] },
    ],
  },
  'photo-booth-inside.png': {
    shape: 'rectangle',
    x: [20, 68], // Center area of booth
    y: [72.8, 76.8], // Bottom area of booth (floor)
  },
  /**
   * Clothing Store — the floor's OUTER PERIMETER only.
   *
   * Rebuilt from scratch against `clothing-store.webp`, the furnished artwork
   * that replaced the empty shell the room used to be composed onto. The old
   * boundary (`y ≥ 77.5` plus two corner triangles) described the shell's much
   * shallower floor and is not carried forward.
   *
   * The image is 1600×1103, aspect 1.4506 against the world's 1.5007, so
   * `object-cover` matches its WIDTH and crops it top and bottom: image x IS
   * world x, image y is not. Every band below was measured on the surviving
   * crop (rows 18…1085) by finding, for each column, the highest row from which
   * the wooden floorboards run unbroken to the bottom of the frame.
   *
   * That probe gives the floor's back edge directly:
   *
   * ```
   *   x       0    5   10   15   20   25   30   37 | 61   70   80   90   99
   *   y  →   79   73   71   68   67   66   65   63 | 63   63   66   73   83
   *                └── booth fronts ──┘  └ shelving ┘ └ rack ┘ └ bookcase ┘
   * ```
   *
   * (x 38–60 is the checkout island, which has no floor behind it and is a
   * blocker in `clothing-store-config.ts`.)
   *
   * The five bands step back with that line and stay strictly INSIDE it. The
   * room's free-standing obstacles — both booths, the leaning mirror and the
   * checkout — are `MovementBlocker` rectangles rather than holes punched here,
   * for the reason the Care Store records: a composite clamps to its NEAREST
   * area, so a hole makes the Blobbi slide around the rim, while a blocker stops
   * the walk and lets the route planner take it round.
   */
  'clothing-store.webp': {
    shape: 'composite',
    areas: [
      // Front floor: open frame edge to frame edge, in front of everything.
      { type: 'rectangle', x: [0.5, 99.5], y: [85, 99.5] },

      // Mid floor, as the side walls begin to close in.
      { type: 'rectangle', x: [2, 96], y: [78, 85] },
      { type: 'rectangle', x: [4, 91], y: [74, 78] },

      // The band that crosses in FRONT of the checkout, past both booths.
      { type: 'rectangle', x: [7, 86], y: [71.5, 74] },

      // Back aisle. Bounded by the booths' thresholds on the left and the
      // bookcase's base on the right; both booths stand inside it and are
      // blocked, not excluded.
      { type: 'rectangle', x: [15, 81], y: [67.5, 71.5] },

      // The two deep pockets either side of the till: in front of the wall
      // shelving, and in front of the clothing rack's bench.
      { type: 'rectangle', x: [26.5, 37.5], y: [65.5, 67.5] },
      { type: 'rectangle', x: [61, 78], y: [64.5, 67.5] },
    ],
  },
  /**
   * Care Store — the floor's OUTER PERIMETER only.
   *
   * The room's obstacles (toy box, checkout counter, pet bed, potted plant) are
   * `MovementBlocker` rectangles in `care-store-config.ts`, not holes punched in
   * this boundary. That split is deliberate: a composite boundary clamps to its
   * NEAREST area, so a hole makes the Blobbi slide around its rim, while a
   * blocker stops the walk where the object is and lets the player choose a way
   * round — which is what the artwork's free-standing furniture should feel like.
   * The boundary therefore describes only where the FLOOR ends.
   *
   * Re-measured against the REVISED `care-store-inside.webp` (1600×1067, the
   * world's own 3:2, so image percentages are world percentages). The artwork
   * was redrawn rather than edited — 94 % of its pixels changed — and the room
   * came out closer to the camera: the floor is about four percent deeper than
   * it was and reaches the frame edges lower down.
   *
   * Probed on the new plate: the shelving's base runs y ≈ 64.9 (left, x 23–38)
   * to y ≈ 66.5 (right, x 67–79); the counter's plinth meets the floor at
   * y ≈ 70.3; and the boards run unbroken from wall to wall below y ≈ 87. The
   * bands step back along that line.
   *
   * The furniture that DID NOT move is just as load-bearing a finding: the toy
   * box (blue body x 1–18.3, y 67–83.5), the pet bed (teal x 78.2–91.6,
   * y 68–81.5) and the corner plant (pot x 91.9–98.5, y 70–84.5) all measure
   * within a whisker of their previous blockers, so those were left alone.
   */
  /**
   * Badges Store — the floor's OUTER PERIMETER only.
   *
   * Like the Care Store, the room's obstacles are `MovementBlocker` rectangles
   * (`badges-store-config.ts`) rather than holes punched in this boundary: a
   * composite clamps to its NEAREST area, so a hole makes the Blobbi slide
   * around its rim, while a blocker stops the walk and now — with route
   * planning — lets it go round.
   *
   * `badges-store-inside.webp` is 1600×1103, aspect 1.4506 against the world's
   * 1.5007, so `object-cover` crops it top and bottom and image percentages are
   * NOT world percentages. Every number here was measured on the surviving crop
   * (rows 19…1084), which is what the player actually sees.
   *
   * The three bands follow the artwork's own perspective. Probed: floor begins
   * at y = 62.8 % hard against the left wall and rises to 56.5 % by x = 26 %;
   * the checkout's base is y ≈ 58.7 %; the right-hand units run 55.1 → 57.7 %;
   * the right wall's floor line falls back to y ≈ 63 % by x = 96 %. From y = 65 %
   * down the floor is open wall to wall.
   */
  'badges-store-inside.webp': {
    shape: 'composite',
    areas: [
      // Front floor: open from frame edge to frame edge, in front of everything.
      { type: 'rectangle', x: [1, 99], y: [80, 99] },

      // Mid floor: the band both display units stand in — they are blocked
      // within it, not excluded from it, so their aisles stay walkable.
      { type: 'rectangle', x: [4, 95], y: [64, 80] },

      // Back aisle, in front of the checkout and under the shelving. Narrow by
      // design and inset at both ends: the left shelving closes in below x = 20
      // and the door wall below x = 86.
      { type: 'rectangle', x: [20, 86], y: [59.5, 64] },
    ],
  },
  /**
   * Furniture Store — the floor's OUTER PERIMETER, which here is a funnel.
   *
   * The showroom is two RAISED display platforms either side of an aisle. They
   * are roped off, signed "do not touch" and set on their own carpets, so they
   * are not floor at all — which makes them the boundary's business rather than
   * a pile of `MovementBlocker` rectangles. Excluding them by shape also gives
   * the walk the right feel: the composite clamps to its nearest band, so a
   * Blobbi aimed at a sofa slides along the platform's edge instead of stopping
   * dead in front of an invisible wall.
   *
   * `furniture-store-inside.webp` is 1600×1067 (the world's own 3:2 to within a
   * sub-pixel crop), so image percentages are world percentages. Every band was
   * measured by finding, for each column, the highest row from which the
   * floorboards run unbroken to the bottom of the frame:
   *
   * ```
   *   x     0    13   25   30   35   41 | 42–61 | 65   70   75   80   100
   *   y    89    88   83   74   64   51 |  55   | 65   77   88   88.5  88
   *        └ left platform's front ┘ └ its edge ┘   └ right platform's edge ┘
   * ```
   *
   * (x 42–61 is the checkout desk, whose plinth meets the floor at y ≈ 55.3.)
   *
   * The bands step back along those two diagonals, each one strictly inside the
   * measured line, and nest so the aisle stays connected to the front floor.
   */
  'furniture-store-inside.webp': {
    shape: 'composite',
    areas: [
      // Front floor: open frame edge to frame edge, in front of both platforms.
      { type: 'rectangle', x: [0.5, 99.5], y: [90, 99] },

      // The funnel, narrowing between the two platforms toward the checkout.
      { type: 'rectangle', x: [27, 73], y: [84, 90] },
      { type: 'rectangle', x: [30, 70], y: [78, 84] },
      { type: 'rectangle', x: [33, 67], y: [72, 78] },
      { type: 'rectangle', x: [36, 64], y: [66, 72] },
      { type: 'rectangle', x: [39, 62], y: [60, 66] },

      // The service aisle, at the desk's own base.
      { type: 'rectangle', x: [41, 61], y: [56, 60] },
    ],
  },
  'care-store-inside.webp': {
    shape: 'composite',
    areas: [
      // Front floor: open frame edge to frame edge, in front of every obstacle.
      { type: 'rectangle', x: [1, 99], y: [86, 99] },

      // Lower-mid floor. The right wall's skirting runs down to y ≈ 84.5, so
      // this band stops just short of it.
      { type: 'rectangle', x: [1.5, 97], y: [80, 86] },

      // Upper-mid floor: past the toy box on the left and the pet bed on the
      // right — both of which stand INSIDE this band and are blocked, not
      // excluded.
      { type: 'rectangle', x: [2, 94], y: [72, 80] },

      // Back aisle along the shelving. The left shelf unit's drawer meets the
      // floor at y ≈ 64.9 and the right display cabinet at y ≈ 66.5, so this is
      // the whole walkable depth behind the counter line; the counter itself
      // seals the middle of it.
      { type: 'rectangle', x: [23, 76], y: [68, 72] },
    ],
  },
};
