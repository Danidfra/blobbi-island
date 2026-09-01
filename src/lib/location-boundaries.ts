import { Boundary } from '@/lib/boundaries';

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
  'plaza-inside.png': {
    shape: 'composite',
    areas: [

      // Main area
      { type: 'rectangle', x: [0, 41], y: [77.7, 100] },

      { type: 'rectangle', x: [59, 100], y: [77.7, 100] },
      { type: 'triangle', points: [{ x: 59, y: 80.9 }, { x: 55, y: 80.9 }, { x: 59, y: 86.1 }] },

      { type: 'rectangle', x: [41, 59], y: [91.3, 100] },
      { type: 'triangle', points: [{ x: 41, y: 80.9 }, { x: 45, y: 80.9 }, { x: 41, y: 86.1 }] },

      { type: 'rectangle', x: [25, 75], y: [74.6, 80.9] },
      { type: 'triangle', points: [{ x: 0, y: 77.7 }, { x: 25, y: 67.3 }, { x: 25, y: 77.7 }] },
      { type: 'rectangle', x: [25, 35], y: [67.3, 74.6] },
      { type: 'triangle', points: [{ x: 100, y: 77.7 }, { x: 75, y: 67.3 }, { x: 75, y: 77.7 }] },
      { type: 'rectangle', x: [65, 75], y: [67.3, 74.6] },

      // Stairs
      { type: 'triangle', points: [{ x: 42, y: 74.6 }, { x: 46, y: 74.6 }, { x: 46, y: 47.5 }] },
      { type: 'triangle', points: [{ x: 58, y: 74.6 }, { x: 53, y: 74.6 }, { x: 53, y: 47.5 }] },
      { type: 'rectangle', x: [44, 55], y: [60, 74.6] },
      { type: 'rectangle', x: [46, 53], y: [47.5, 60] },

      // First floor
      { type: 'rectangle', x: [44.5, 54.5], y: [47.5, 49.6] },

      { type: 'rectangle', x: [53, 76], y: [47.5, 47.5] },
      { type: 'rectangle', x: [25, 46], y: [47.5, 47.5] },

      { type: 'triangle', points: [{ x: 25, y: 47.5 }, { x: 0, y: 37.1 }, { x: 25, y: 47.5 }] },
      { type: 'triangle', points: [{ x: 75, y: 47.5 }, { x: 100, y: 37.1 }, { x: 75, y: 47.5 }] },
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
   * Clothing Store.
   *
   * The back edge moved from 79.2 to 77.5 when the room was furnished. That is
   * a REFINEMENT, not an expansion: probed off the artwork, the back wall meets
   * the floor at y = 77, so 77.5 still leaves half a percent of margin and the
   * boundary stays strictly inside painted floor. The old 79.2 was fine while
   * the checkout was sealed against the wall; once the till became a piece of
   * furniture with walkable floor behind it, that last inch and a half was the
   * difference between a through-route and a 0.3 %-deep sliver.
   *
   * The flanking triangles follow it up, and remain conservative — the real
   * side-wall/floor junction runs from (0, ~89.7) to (16, ~76), so the triangle
   * edge from (0, 100) to (16, 77.5) sits well inside it at every x.
   */
  'clothing-store-inside.png': {
    shape: 'composite',
    areas: [
      { type: 'rectangle', x: [16, 84], y: [77.5, 100] },

      { type: 'triangle', points: [{ x: 16, y: 77.5 }, { x: 16, y: 100 }, { x: 0, y: 100 }] },
      { type: 'triangle', points: [{ x: 84, y: 77.5 }, { x: 84, y: 100 }, { x: 100, y: 100 }] },
    ]
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
   * Measured against `care-store-inside.webp` (1600×1067, the world's own 3:2),
   * so image percentages are world percentages. The wall/floor junction sits at
   * y ≈ 66.5–67.5 across the open room; the bands below step in with the
   * perspective as the side furniture closes in.
   */
  'care-store-inside.webp': {
    shape: 'composite',
    areas: [
      // Front floor: open from wall to wall, in front of every obstacle.
      { type: 'rectangle', x: [2, 98], y: [84, 99] },

      // Mid floor: past the toy box on the left and the pet bed on the right —
      // both of which stand INSIDE this band and are blocked, not excluded.
      { type: 'rectangle', x: [2, 93], y: [72, 84] },

      // Back aisle along the shelving. Thin by design: the left shelf unit's
      // drawer meets the floor at y ≈ 66.5 and the right display cabinet at
      // y ≈ 67.5, so this is the whole walkable depth behind the counter line.
      { type: 'rectangle', x: [19, 80], y: [68.5, 72] },
    ],
  },
};
