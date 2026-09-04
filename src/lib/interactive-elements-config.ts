/**
 * Configuration for interactive elements with their positions and z-index values
 * Used for dynamic z-index calculations for the Blobbi character
 */

import {
  PLAZA_DEPTH,
  PLAZA_FOUNTAIN,
  PLAZA_INSIDE_BACKGROUND,
  PLAZA_OCCLUSION,
} from '@/lib/plaza-inside-config';

export interface InteractiveElementConfig {
  id: string;
  /** Y position as percentage of container height */
  yPosition: number;
  /** Z-index value for this element */
  zIndex: number;
  /** Background file this element appears in */
  backgroundFile: string;
  /** Type of interactive element (for specific behaviors) */
  type?: 'chair' | 'default';
  /** Chair-specific configuration */
  chairConfig?: {
    /** Whether to close eyes when seated */
    eyesClosedOnSeat?: boolean;
    /** Seat anchor position as percentage of chair image */
    seatAnchor?: {
      xPercent?: number;
      yPercent?: number;
    };
    /** Z-index offset when seated */
    sitZIndexOffset?: number;
  };
}

/**
 * Z-index threshold configuration for different backgrounds based on vertical position
 * Position is calculated from bottom to top (0% = bottom, 100% = top)
 */
export interface ZIndexThreshold {
  /** Minimum position percentage from bottom (0-100) */
  minPosition: number;
  /** Maximum position percentage from bottom (0-100) */
  maxPosition: number;
  /** Z-index value for this position range */
  zIndex: number;
  /**
   * Optionally limit the band to a horizontal span, `[minX, maxX]` in world
   * percent from the left (inclusive).
   *
   * Most occluders can be described by a y-line alone: below it the Blobbi is
   * in front, above it behind. A few cannot. On the Plaza's balcony the SAME y
   * is "on the stair landing, in front of the overlay" between the stair rails
   * and "on the corridor, behind the railing" outside them. A band with an
   * `xRange` says so; a band without one applies at any x, and is what the
   * lookup falls back to when no x-limited band claims the position (or when
   * the caller has no x to offer).
   */
  xRange?: [number, number];
}

export interface BackgroundZIndexConfig {
  backgroundFile: string;
  thresholds: ZIndexThreshold[];
}

/**
 * Z-index configurations for different backgrounds
 * Each background can define its own position-based z-index rules
 */
export const backgroundZIndexConfigs: BackgroundZIndexConfig[] = [
  {
    backgroundFile: 'stage-inside.png',
    thresholds: [
      { minPosition: 0, maxPosition: 5.8, zIndex: 25 },
      { minPosition: 5.81, maxPosition: 10.8, zIndex: 15 },
      { minPosition: 10.81, maxPosition: 100, zIndex: 9 }
    ]
  },
  {
    backgroundFile: 'shopping-mall-inside.png',
    thresholds: [
      { minPosition: 65.51, maxPosition: 100, zIndex: 9 },
      { minPosition: 35.91, maxPosition: 65.5, zIndex: 19 },
      { minPosition: 7.41, maxPosition: 35.9, zIndex: 25},
      { minPosition: 0, maxPosition: 7.4, zIndex: 30},
    ]
  },
  {
    backgroundFile: 'arcade-inside.png',
    thresholds: [
      { minPosition: 0, maxPosition: 42.8, zIndex: 10 },
      { minPosition: 42.81, maxPosition: 100, zIndex: 9 },
    ]
  },
  {
    backgroundFile: 'arcade-minus1.png',
    thresholds: [
      { minPosition: 0, maxPosition: 14.7, zIndex: 31 },
      { minPosition: 14.71, maxPosition: 23.2, zIndex: 27 },
      { minPosition: 23.21, maxPosition: 42.3, zIndex: 24 },
      { minPosition: 42.31, maxPosition: 100, zIndex: 9 },
    ]
  },
  {
    backgroundFile: 'arcade-1.png',
    thresholds: [
      { minPosition: 0, maxPosition: 7.7, zIndex: 31 },
      { minPosition: 7.71, maxPosition: 13.7, zIndex: 26 },
      { minPosition: 13.71, maxPosition: 19.7, zIndex: 21 },
      { minPosition: 19.71, maxPosition: 25.7, zIndex: 16 },
      { minPosition: 25.71, maxPosition: 37.7, zIndex: 11 },
      { minPosition: 37.71, maxPosition: 100, zIndex: 9 },
    ]
  },
  // Add more background configurations as needed
  {
    backgroundFile: 'town-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 1.7, zIndex: 25 },  // Bottom area
      { minPosition: 1.71, maxPosition: 6.69, zIndex: 19 },  // Lower middle area
      { minPosition: 6.7, maxPosition: 11.7, zIndex: 15 }, // Upper middle area
      { minPosition: 11.71, maxPosition: 100, zIndex: 9 } // Upper area (in front of buildings)
    ]
  },
  {
    backgroundFile: 'home-inside.png',
    thresholds: [
      { minPosition: 0, maxPosition: 0.8, zIndex: 20 },  // Floor level
      { minPosition: 5.8, maxPosition: 100, zIndex: 10 } // Upper area
    ]
  },
  {
    backgroundFile: 'beach-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 20, zIndex: 25 },  // Sand/shore area
      { minPosition: 20, maxPosition: 100, zIndex: 15 } // Water/background area
    ]
  },
  {
    /*
      Mine. The flip line is the CAVE ARCH'S PAINTED BASE, and it has to be:
      this is the one place in the game where a background structure is meant
      to occlude the Blobbi, so the line where that starts is a measurement,
      not a preference.

      `mine-cave-config.ts` anchors the arch wrapper at `bottom: 24%`: so the
      rock meets the path at y = 76, which is `positionFromBottom = 24`. Below
      that line the Blobbi is on the path, nearer the camera than every painted
      rock, and must be in FRONT of the arch (z-15). Above it the Blobbi is
      inside the mouth and belongs behind the arch but in front of the tunnel
      (z-9).

      The line used to sit at 15 (y = 85), nine percent of the world too far
      forward, which put the WHOLE walk corridor behind the arch. That was only
      ever invisible dead centre, where the arch is transparent: the corridor is
      `x 42–58` while the opening is barely `x 44–58` at body height and narrows
      to `47–55` near its base, so a Blobbi at either end of the corridor,
      standing on open path, its feet 9 % below the rock, had its head and half
      its body cut away by the posts and the rock pile. A y-only band cannot say
      "behind the rock only while inside the opening", so it must not try: it
      draws the line where the rock actually stands.

      The upper band is currently unreachable (the walk boundary tops out at
      y = 79, three percent short of the arch) and is kept because it states the
      true contract: if the corridor is ever pushed into the mouth, the reading
      is already right.
    */
    backgroundFile: 'mine-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 24, zIndex: 20 },   // On the path, in front of the cave
      { minPosition: 24, maxPosition: 100, zIndex: 10 }  // Inside the mouth, behind the arch
    ]
  },
  {
    backgroundFile: 'nostr-station-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 20 },  // Ground level
      { minPosition: 10, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    backgroundFile: 'plaza-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 25 },  // Ground level
      { minPosition: 15, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    /*
      Plaza interior. One occluder, the balcony railing + staircase overlay at
      `PLAZA_DEPTH.overlay`: and one prop, the fountain at `PLAZA_DEPTH.fountain`.
      The lines are measurements from `plaza-inside-config.ts`, not preferences:

      - Below the fountain plinth's bottom edge (y = 97) the Blobbi is in front
        of the fountain.
      - From there up to the railing's base (y = 49.3): the whole ground floor
        and the flight of stairs; it is in front of the overlay.
      - Between the railing's base and the landing's top edge (y = 44.6) the
        overlay is opaque on the corridor AND on the landing, and only x tells
        them apart: between the stair rails the Blobbi is on the landing, in
        front; either side it is on the corridor, behind the railing plate.
      - Above the landing's top edge only the corridor's wings remain, all of it
        behind the railing.

      A y-only band could not say "in front only between the rails", which is
      what used to put a Blobbi walking the corridor in front of the railing
      it was standing behind.
    */
    backgroundFile: PLAZA_INSIDE_BACKGROUND,
    thresholds: [
      {
        minPosition: 0,
        maxPosition: 100 - PLAZA_FOUNTAIN.frontLineY,
        zIndex: PLAZA_DEPTH.blobbiInFrontOfFountain,
      },
      {
        minPosition: 100 - PLAZA_FOUNTAIN.frontLineY + 0.01,
        maxPosition: 100 - PLAZA_OCCLUSION.railingBase,
        zIndex: PLAZA_DEPTH.blobbiInFront,
      },
      {
        minPosition: 100 - PLAZA_OCCLUSION.railingBase + 0.01,
        maxPosition: 100 - PLAZA_OCCLUSION.landingTop,
        xRange: [PLAZA_OCCLUSION.stairsX[0], PLAZA_OCCLUSION.stairsX[1]],
        zIndex: PLAZA_DEPTH.blobbiInFront,
      },
      {
        minPosition: 100 - PLAZA_OCCLUSION.railingBase + 0.01,
        maxPosition: 100 - PLAZA_OCCLUSION.landingTop,
        zIndex: PLAZA_DEPTH.blobbiBehind,
      },
      {
        minPosition: 100 - PLAZA_OCCLUSION.landingTop + 0.01,
        maxPosition: 100,
        zIndex: PLAZA_DEPTH.blobbiBehind,
      },
    ]
  },
  {
    backgroundFile: 'back-yard-open.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 20 },  // Ground level
      { minPosition: 10, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    backgroundFile: 'nostr-station-inside.png',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 20 },  // Floor level
      { minPosition: 15, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    // Clothing Store. Every object in the room is painted into
    // `clothing-store.webp` rather than being an overlaid sprite, so the Blobbi
    // is always in FRONT of the scene and the five depth bands the composed
    // version needed are gone with the sprites they were derived from.
    //
    // A background pixel cannot be brought in front of the Blobbi by a z-index,
    // so there is nothing left for the bands to order. These two only keep the
    // Blobbi above the room's three hotspots (z-12) and give the front of the
    // room a slightly higher band, as the other baked interiors do.
    backgroundFile: 'clothing-store.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 20, zIndex: 20 },  // Front floor
      { minPosition: 20, maxPosition: 100, zIndex: 15 } // Back of the room
    ]
  },
  {
    // Care Store. Every object in the room is painted into the artwork rather
    // than being an overlaid sprite, so the Blobbi is always in FRONT of the
    // scene; these two bands only keep it above the checkout hotspot (z-12) and
    // give the front of the room a slightly higher band, as the other interiors
    // do.
    backgroundFile: 'care-store-inside.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 20, zIndex: 20 },  // Front floor
      { minPosition: 20, maxPosition: 100, zIndex: 15 } // Back of the room
    ]
  },
  {
    // Furniture Store. Every fixture in the showroom is painted into
    // `furniture-store-inside.webp`: the platforms, their sets, the desk, so
    // the Blobbi is always in FRONT of the scene and no band can, or should,
    // put a background pixel over it. These two only keep the Blobbi above the
    // checkout hotspot (z-12) and give the front of the room a slightly higher
    // band, as the other baked interiors do.
    backgroundFile: 'furniture-store-inside.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 20, zIndex: 20 },  // Front floor
      { minPosition: 20, maxPosition: 100, zIndex: 15 } // Up the aisle
    ]
  },
  {
    // Badges Store. Two bands, because the room has exactly one depth line that
    // matters: both display units paint their base at y = 90 % (position 10),
    // and everything else in the room, shelving, checkout, rug, door, is
    // painted into the background behind the Blobbi.
    //
    // Standing in FRONT of that line the Blobbi must cover the units (z-26);
    // standing behind it, it must pass behind them AND behind the checkout
    // hotspot (z-16), which is what makes walking round the back read correctly.
    //
    // The line moved from 11 to 10 when the displays were scaled to 3×: the two
    // painted bases were re-aligned onto y = 90 so a single threshold still
    // serves both. Nothing else about the depth model needed changing, the
    // units grew upward and outward, not forward, so the floor line they stand
    // on is still the only place the ordering flips.
    backgroundFile: 'badges-store-inside.webp',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 30 },    // In front of both units
      { minPosition: 10.01, maxPosition: 100, zIndex: 14 } // Behind them
    ]
  }
];

/**
 * Configuration for all interactive elements across different backgrounds
 * Y positions are calculated as percentages where 0% is top and 100% is bottom
 */
export const interactiveElementsConfig: InteractiveElementConfig[] = [
  // Town elements (town-open.webp)
  {
    id: 'arcade',
    yPosition: 35, // top-[35%] on mobile, top-[30%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'stage',
    yPosition: 30, // top-[30%] on mobile, top-[26%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'shop',
    yPosition: 35, // top-[35%] on mobile, top-[30%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'bush-3',
    yPosition: 68, // top-[68%] on mobile, top-[63%] on desktop - using mobile value
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'bush-4',
    yPosition: 74, // top-[74%] on mobile, top-[69%] on desktop - using mobile value
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'bush-1',
    yPosition: 100, // bottom-0 = 100% from top
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'bush-2',
    yPosition: 100, // bottom-0 = 100% from top
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'streetlight-left',
    yPosition: 90, // bottom-[10%] = 90% from top
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },
  {
    id: 'streetlight-right',
    yPosition: 90, // bottom-[10%] = 90% from top
    zIndex: 25,
    backgroundFile: 'town-open.webp'
  },

  // Mine elements (mine-open.webp)
  {
    id: 'cave',
    // Top edge of the composed cave structure: it is anchored by its BOTTOM
    // (24% up from the world's floor) and its height follows the artwork's
    // 1271×642 aspect at 70% world width, which puts its top at ≈23%. Placement
    // itself lives in `mine-cave-config.ts`; this entry only records the depth
    // contract.
    yPosition: 23,
    zIndex: 15,
    backgroundFile: 'mine-open.webp'
  },

  // Beach elements (beach-open.webp and beach.png)
  {
    id: 'boat',
    yPosition: 34, // top-[34%] on mobile, top-[39%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'beach-open.webp'
  },
  {
    // Treasure-hunt shack. Placement + stand point live in
    // `beach-shack-config.ts`; this entry records the depth contract only.
    // Base sits at y=79 (bottom-21%), square art 16% wide → top ≈ 55.
    id: 'treasure-shack',
    yPosition: 55,
    zIndex: 15,
    backgroundFile: 'beach-open.webp'
  },

  // Home elements (home-inside.png)
  {
    id: 'bed',
    yPosition: 70, // Bed position in home
    zIndex: 15,
    backgroundFile: 'home-inside.png'
  },
  {
    id: 'refrigerator',
    yPosition: 70, // Refrigerator position in home
    zIndex: 15,
    backgroundFile: 'home-inside.png'
  }
];

/**
 * The band that claims a position, or undefined.
 *
 * Bands are tried in ascending order of `minPosition`. Among the bands whose
 * y-range contains the position, an x-limited band wins when the caller
 * supplied an x inside its span; otherwise the first band with no `xRange`
 * applies. An x-limited band never claims a position whose x is unknown, so a
 * caller that only knows y gets the same answer it always did.
 */
function findThreshold(
  thresholds: readonly ZIndexThreshold[],
  positionFromBottom: number,
  blobbiXPosition?: number,
): ZIndexThreshold | undefined {
  const inBand = [...thresholds]
    .sort((a, b) => a.minPosition - b.minPosition)
    .filter((t) => positionFromBottom >= t.minPosition && positionFromBottom <= t.maxPosition);

  if (blobbiXPosition !== undefined) {
    const limited = inBand.find(
      (t) => t.xRange !== undefined && blobbiXPosition >= t.xRange[0] && blobbiXPosition <= t.xRange[1],
    );
    if (limited) return limited;
  }
  return inBand.find((t) => t.xRange === undefined);
}

/**
 * Calculate dynamic z-index for Blobbi based on its vertical position from bottom to top
 * @param blobbiYPosition - Blobbi's Y position as percentage from top (0-100, where 0 is top, 100 is bottom)
 * @param backgroundFile - Current background file name
 * @param blobbiXPosition - Blobbi's X position as percentage from left (0-100). Optional; only
 *   bands with an `xRange` read it.
 * @returns Calculated z-index value for the Blobbi
 */
export function calculateBlobbiZIndex(
  blobbiYPosition: number,
  backgroundFile: string,
  blobbiXPosition?: number,
): number {
  const positionFromBottom = 100 - blobbiYPosition;

  const backgroundConfig = backgroundZIndexConfigs.find(
    config => config.backgroundFile === backgroundFile
  );

  if (!backgroundConfig) {
    return 20; // Default z-index
  }

  return findThreshold(backgroundConfig.thresholds, positionFromBottom, blobbiXPosition)?.zIndex ?? 20;
}



/**
 * Get all interactive elements for a specific background
 * @param backgroundFile - Background file name
 * @returns Array of interactive elements for that background
 */
export function getInteractiveElementsForBackground(backgroundFile: string): InteractiveElementConfig[] {
  return interactiveElementsConfig.filter(element => element.backgroundFile === backgroundFile);
}

/**
 * Get z-index configuration for a specific background
 * @param backgroundFile - Background file name
 * @returns Background z-index configuration or undefined if not found
 */
export function getZIndexConfigForBackground(backgroundFile: string): BackgroundZIndexConfig | undefined {
  return backgroundZIndexConfigs.find(config => config.backgroundFile === backgroundFile);
}

/**
 * Add or update z-index configuration for a background
 * @param backgroundFile - Background file name
 * @param thresholds - Array of z-index thresholds
 */
export function setZIndexConfigForBackground(backgroundFile: string, thresholds: ZIndexThreshold[]): void {
  const existingIndex = backgroundZIndexConfigs.findIndex(config => config.backgroundFile === backgroundFile);

  if (existingIndex >= 0) {
    backgroundZIndexConfigs[existingIndex].thresholds = thresholds;
  } else {
    backgroundZIndexConfigs.push({ backgroundFile, thresholds });
  }
}

/**
 * Get the current z-index threshold for a specific position and background
 * @param positionFromBottom - Position percentage from bottom (0-100)
 * @param backgroundFile - Background file name
 * @param blobbiXPosition - X position from the left (0-100), for bands with an `xRange`
 * @returns The matching threshold or undefined
 */
export function getZIndexThresholdForPosition(
  positionFromBottom: number,
  backgroundFile: string,
  blobbiXPosition?: number,
): ZIndexThreshold | undefined {
  const config = getZIndexConfigForBackground(backgroundFile);
  if (!config) return undefined;
  return findThreshold(config.thresholds, positionFromBottom, blobbiXPosition);
}

/**
 * Convert Y position from top-based to bottom-based percentage
 * @param yPositionFromTop - Y position as percentage from top (0-100)
 * @returns Y position as percentage from bottom (0-100)
 */
export function convertToBottomBasedPosition(yPositionFromTop: number): number {
  return 100 - yPositionFromTop;
}

/**
 * Debug function to log current z-index calculation details
 * @param blobbiYPosition - Blobbi's Y position from top (0-100)
 * @param backgroundFile - Current background file name
 */
export function debugZIndexCalculation(blobbiYPosition: number, backgroundFile: string): void {
  const positionFromBottom = convertToBottomBasedPosition(blobbiYPosition);
  const config = getZIndexConfigForBackground(backgroundFile);
  const threshold = getZIndexThresholdForPosition(positionFromBottom, backgroundFile);
  const calculatedZIndex = calculateBlobbiZIndex(blobbiYPosition, backgroundFile);

  console.log('Z-Index Debug:', {
    backgroundFile,
    yPositionFromTop: blobbiYPosition,
    positionFromBottom,
    hasConfig: !!config,
    matchingThreshold: threshold,
    calculatedZIndex
  });
}