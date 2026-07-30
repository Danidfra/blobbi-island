import type { Position } from '@/lib/types';

/**
 * Placement and sizing for the Mine exterior's cave structure.
 *
 * ## Why this file exists
 *
 * The cave used to be painted into `mine-open.webp`. The background-asset
 * migration replaced that plate with a plain forest path, and the cave now ships
 * as two separate sprites that are composed on top of it:
 *
 *   - `mine-open-cave.webp`          the exterior rock arch (1271×642)
 *   - `mine-open-cave-entrance.webp` the lit tunnel seen through the arch (959×526)
 *
 * Everything positional lives here rather than in JSX so the structure can be
 * nudged without touching the interaction code. **These are hand-picked starting
 * values — they are meant to be tuned.** Each one says what it is measured
 * against, because the two coordinate spaces are easy to confuse: the wrapper is
 * a percentage of the virtual world (1046×697), while the mouth is a percentage
 * of the WRAPPER, so the opening stays aligned when the cave is resized.
 */

/** The exterior rock arch. Frontmost cave artwork. */
export const MINE_CAVE_SRC = '/assets/world/buildings/mine-open-cave.webp';

/** The lit tunnel revealed inside the arch on hover / focus / activation. */
export const MINE_CAVE_ENTRANCE_SRC = '/assets/world/buildings/mine-open-cave-entrance.webp';

export const mineCaveStructure = {
  /**
   * The cave structure wrapper, in percent of the virtual world box.
   *
   * World-relative on purpose: `VirtualWorld` scales the whole layer uniformly,
   * so percentages keep the cave locked to the path's vanishing point at every
   * viewport size. Nothing here may become a viewport unit.
   */
  wrapper: {
    /**
     * Horizontal centre. Resolved to a plain `left` by arithmetic
     * (`centre − width / 2`), NOT by `translateX(-50%)`: a transform would give
     * the wrapper a stacking context and break the depth model below.
     */
    centerXPercent: 50,
    /** Gap between the world's bottom edge and the wrapper's bottom edge. */
    bottomPercent: 24,
    /**
     * Width; the height follows the artwork's own 1271×642 aspect ratio, so at
     * 70% of a 1046×697 world the cave is ≈732×370px — it spans y ≈ 23%–76%,
     * which is where the `cave` entry in `interactive-elements-config.ts` gets
     * its recorded top edge.
     */
    widthPercent: 70,
  },

  /**
   * The arch opening, in percent of the WRAPPER box.
   *
   * `mine-open-cave.webp` has its transparent arch at roughly x 40.5%–61%,
   * starting at y ≈ 49% and running to the artwork's bottom edge. The box below
   * is deliberately a little wider and taller than that hole (x 41%–65%, from
   * y 44% down to 5% off the bottom): the surplus falls behind the arch's own
   * opaque rock, so the black backing cannot leak out around the sprite at any
   * scale. It was widened by hand against the artwork at world scale — treat
   * these as tuned values, not as measurements.
   *
   * The same box positions the black backing, the entrance preview and the
   * semantic hotspot, so all three stay registered to one another.
   */
  mouth: {
    leftPercent: 41,
    widthPercent: 24,
    topPercent: 44,
    /** Stops just short of the wrapper's bottom, where the arch meets the path. */
    bottomPercent: 5,
    /** Rounded arch, rather than a mask or an SVG clip path. */
    borderRadius: '48% 48% 8% 8% / 34% 34% 4% 4%',
  },

  /**
   * How `mine-open-cave-entrance.webp` is framed inside the opening.
   *
   * The tunnel sprite is far wider than the arch (1.82 vs ≈0.4 aspect), so it is
   * drawn with `object-fit: cover` and cropped to its centre — which is exactly
   * the lit passage. Pushing the vertical anchor past 50% keeps the tunnel floor
   * and its nearest lantern in the slot instead of the pale ceiling rock;
   * checked against the real artwork at world scale.
   */
  entranceObjectPosition: '50% 62%',

  /**
   * Where the Blobbi stops before the entry fires, in world percent.
   *
   * The Mine's walk boundary is a narrow corridor (`x 42–58, y 68–75`) leading
   * up to the cave, so this sits just inside its top end. The previous cave
   * derived its target from the sprite's rect and landed at ≈ y 67.7 — outside
   * the corridor, which the movement system can only approach and never reach,
   * leaving the entry to be rescued by stall detection.
   */
  approach: { x: 50, y: 82.4 } as Position,

  /**
   * Depth, in the world surface's own stacking context.
   *
   * The wrapper deliberately creates NO stacking context — no `z-index`, and
   * equally no `transform`, `filter`, `opacity`, `isolation`, `contain` or
   * `will-change`. Any one of them would trap these three values inside the cave
   * and leave the whole structure to be sorted against the Blobbi as a single
   * block. Keeping the wrapper transparent to stacking lets them interleave with
   * the Blobbi's Y-derived z-index, which is what produces the reading below.
   *
   * `mine-open.webp` gives a Blobbi standing at the entrance z-10 (see
   * `interactive-elements-config.ts`), so:
   *
   *   9  opening  — behind the Blobbi, so it appears to stand IN the mouth
   *   15 arch     — in front of it, so the rock and posts occlude it exactly
   *                 where they are opaque. Same depth as Town's buildings.
   *   16 hotspot  — above the art it covers, and invisible.
   *
   * A Blobbi further down the path resolves to z-20 and passes in front of the
   * whole cave, which is correct: it is nearer the camera.
   */
  depth: {
    mouth: 9,
    front: 15,
    hotspot: 16,
  },
} as const;
