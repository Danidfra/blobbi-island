/**
 * Shared configuration for the decorative Town streetlights AND the movement
 * blockers that stop the Blobbi walking through their bases.
 *
 * Why this file exists: the streetlight art and its `MovementBlocker` used to be
 * two independent sets of hard-coded numbers. When the artwork was repositioned
 * (`left-[6%]` → `left-[15%]`, `right-[12%]` → `right-[18%]`) the blockers stayed
 * behind at the OLD coordinates and ended up sitting next to the bottom Town
 * bushes, cutting the walk-in path to their hiding targets.
 *
 * Both the rendered placement and the blocker rect are now derived from ONE
 * source: the placement numbers below plus the sprite's measured alpha footprint.
 * Move a streetlight and its blocker follows automatically.
 *
 * All values are percentages of the fixed virtual world (see VirtualWorld:
 * 1046×697, uniformly scaled and centered). Because the whole world scales as a
 * single layer, percentage geometry is viewport-independent — one set of numbers
 * stays aligned with the artwork on desktop and mobile alike.
 */

import { WORLD_WIDTH, WORLD_HEIGHT } from '@/components/shell/VirtualWorld';

/** Streetlight sprite path. */
export const STREETLIGHT_SRC = '/assets/world/props/streetlight.png';

/**
 * Measured geometry of `streetlight.png` in SPRITE pixels.
 *
 * `foot` is the opaque footprint of the base, read from the sprite's alpha
 * channel: the pole shaft occupies x 33–62, then the base flares out to x 28–70
 * over rows 248–268 (row 269+ is fully transparent, so 269 is the visible bottom
 * edge). `plateTopRow` marks where that flare has widened into the flat plate the
 * streetlight visually stands on.
 */
export const STREETLIGHT_ART = {
  width: 86,
  height: 272,
  foot: {
    /** First opaque column of the flared base. */
    leftColumn: 28,
    /** One past the last opaque column of the flared base. */
    rightColumnExclusive: 71,
    /** First row of the ground-contact plate. */
    plateTopRow: 258,
    /** One past the last opaque row (the visible bottom edge of the sprite). */
    bottomRowExclusive: 269,
  },
} as const;

/** A rectangle in world-percent units, matching MovementBlocker's props. */
export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TownStreetlightConfig {
  /** Stable id, also used for the blocker id. */
  id: string;
  /** Which edge the sprite is anchored to, and how far in (percent). */
  anchor: { edge: 'left' | 'right'; percent: number };
  /** Sprite height as a percentage of the world height (width follows the aspect). */
  heightPercent: number;
  /** Distance from the world's bottom edge to the sprite's bottom, in percent. */
  bottomPercent: number;
}

export const townStreetlights: TownStreetlightConfig[] = [
  {
    id: 'town-streetlight-left',
    anchor: { edge: 'left', percent: 15 },
    heightPercent: 35,
    bottomPercent: 10,
  },
  {
    id: 'town-streetlight-right',
    anchor: { edge: 'right', percent: 18 },
    heightPercent: 35,
    bottomPercent: 10,
  },
];

/** The sprite's rendered box in world percent. */
export function streetlightArtBox(config: TownStreetlightConfig): WorldRect {
  const heightPx = (config.heightPercent / 100) * WORLD_HEIGHT;
  const widthPx = heightPx * (STREETLIGHT_ART.width / STREETLIGHT_ART.height);
  const bottomPx = WORLD_HEIGHT - (config.bottomPercent / 100) * WORLD_HEIGHT;
  const leftPx =
    config.anchor.edge === 'left'
      ? (config.anchor.percent / 100) * WORLD_WIDTH
      : WORLD_WIDTH - (config.anchor.percent / 100) * WORLD_WIDTH - widthPx;

  return {
    x: (leftPx / WORLD_WIDTH) * 100,
    y: ((bottomPx - heightPx) / WORLD_HEIGHT) * 100,
    width: (widthPx / WORLD_WIDTH) * 100,
    height: (heightPx / WORLD_HEIGHT) * 100,
  };
}

/**
 * The movement blocker for one streetlight: the ground-contact plate at the foot
 * of the pole, and nothing more.
 *
 * Deliberately limited to the plate rather than the whole flared base. The Blobbi
 * walks in a straight line (there is no pathfinding), so every extra percent of
 * blocker height eats approach angles: extending it up to the top of the flare
 * (y 86.9 instead of 88.2) blocks the direct walk from the Town spawn point to
 * BOTH bottom bushes. The plate is what visually rests on the ground, so blocking
 * exactly that keeps the streetlights solid without stealing walkable ground.
 */
export function streetlightBaseBlocker(config: TownStreetlightConfig): WorldRect {
  const art = streetlightArtBox(config);
  const { width: artW, height: artH, foot } = STREETLIGHT_ART;

  const rowToPercentY = (row: number) => art.y + (row / artH) * art.height;

  return {
    x: art.x + (foot.leftColumn / artW) * art.width,
    y: rowToPercentY(foot.plateTopRow),
    width: ((foot.rightColumnExclusive - foot.leftColumn) / artW) * art.width,
    height: rowToPercentY(foot.bottomRowExclusive) - rowToPercentY(foot.plateTopRow),
  };
}
