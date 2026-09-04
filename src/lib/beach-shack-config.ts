/**
 * Beach: treasure-hunt shack placement, in the same shape as
 * `mine-cave-config.ts` / `arcade-room-config.ts`: breakpoint-free percent
 * placement plus an EXPLICIT stand point, all in world-percent coordinates
 * over the fixed 1046 × 697 design box.
 *
 * ## Why the walk target is explicit
 *
 * The generic aim fraction (`ELEMENT_BASE_FRACTION`, 50%/90% of the rendered
 * box) applied to this sprite lands ABOVE the beach's walkable arch (top edge
 * ≈ 74.9 at mid-field) and would be boundary-clamped, the documented
 * unreachable-target pitfall (`InteractiveElement.tsx` header). So, exactly
 * like `ARCADE_COUNTER_STAND_Y` and `mineCaveStructure.approach`, the stand
 * point is authored here: `{ x: 74, y: 84 }` is inside the boundary (arch top
 * at x=74 is ≈74.93), a real walk from the spawn at (50, 81.9), and resolves
 * to the beach's front z-band (y ≥ 80 → z25), so the player stands in front
 * of the z-15 shack.
 *
 * ## Placement
 *
 * The right-side sand shelf is empty (the only other beach element is the
 * boat, out on the water); the shack sits at x ≈ 64–86 with its base on the
 * sand at y ≈ 79. The art (1024² with transparent margins) is square, so the
 * rendered box is `width` wide and `width × (697-px aspect)` tall, the top
 * of the box reaches the horizon, which is the same deliberate overlap the
 * Town buildings use against their tree line.
 *
 * Sized as a destination: at 16 % of the world the hut was a Blobbi and a
 * half wide and read as a prop; at 22 % it is the thing you cross the beach
 * for. The aspect is the art's own (the box is width-driven), the base stays
 * on the same sand line, and the visible hut body (the art has a transparent
 * margin on each side) is what the footprint below covers.
 */

import type { Position } from '@/lib/types';

export const treasureShackPlacement = {
  /** Tailwind-free absolute placement, percent of the world box. */
  rightPercent: 14,
  bottomPercent: 21,
  widthPercent: 22,
  zIndex: 15,
  /**
   * Mirror the art horizontally so the shack's open counter faces the beach's
   * center (toward the spawn and the stand point) instead of the water edge.
   * Presentation only: one CSS transform on a dedicated flip layer, the
   * source file is untouched, and the hitbox/walk target are unchanged
   * because both are authored against the wrapper box, not the pixels.
   */
  flipX: true,
} as const;

/**
 * Where the Blobbi stands to use the shack: centred on the counter, on the
 * sand just in front of it. Ground-anchor (feet) semantics, world percent.
 * Covered by the spawn-validation suite's walkability rules.
 */
export const treasureShackStandPoint: Position = { x: 76, y: 81.5 };

/**
 * The band of sand the hut stands on, as a movement blocker: the visible
 * body of the art (x ≈ 69.5–84.5 once the transparent margins are taken
 * off) from the walkable arch's top edge down to just below the hut's base.
 * The stand point sits below it, so the walk still arrives.
 */
export const treasureShackFootprint = {
  id: 'beach-treasure-shack',
  x: 69.5,
  y: 74.5,
  width: 15,
  height: 3.5,
} as const;
