/**
 * Beach — treasure-hunt shack placement, in the same shape as
 * `mine-cave-config.ts` / `arcade-room-config.ts`: breakpoint-free percent
 * placement plus an EXPLICIT stand point, all in world-percent coordinates
 * over the fixed 1046 × 697 design box.
 *
 * ## Why the walk target is explicit
 *
 * The generic aim fraction (`ELEMENT_BASE_FRACTION`, 50%/90% of the rendered
 * box) applied to this sprite lands ABOVE the beach's walkable arch (top edge
 * ≈ 74.9 at mid-field) and would be boundary-clamped — the documented
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
 * boat at x ≈ 18–32); the shack sits at x ≈ 70–86 with its base on the sand
 * at y ≈ 79. The art (1024² with transparent margins) is square, so the
 * rendered box is `width` wide and `width × (697-px aspect)` tall — the top
 * of the box reaches the horizon, which is the same deliberate overlap the
 * Town buildings use against their tree line.
 */

import type { Position } from '@/lib/types';

export const treasureShackPlacement = {
  /** Tailwind-free absolute placement, percent of the world box. */
  rightPercent: 14,
  bottomPercent: 21,
  widthPercent: 16,
  zIndex: 15,
  /**
   * Mirror the art horizontally so the shack's open counter faces the beach's
   * center (toward the spawn and the stand point) instead of the water edge.
   * Presentation only: one CSS transform on a dedicated flip layer — the
   * source file is untouched, and the hitbox/walk target are unchanged
   * because both are authored against the wrapper box, not the pixels.
   */
  flipX: true,
} as const;

/**
 * Where the Blobbi stands to use the shack. Ground-anchor (feet) semantics,
 * world percent. Covered by the spawn-validation suite's walkability rules.
 */
export const treasureShackStandPoint: Position = { x: 74, y: 84 };
