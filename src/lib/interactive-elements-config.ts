/**
 * Configuration for interactive elements with their positions and z-index values
 * Used for dynamic z-index calculations for the Blobbi character
 */

export interface InteractiveElementConfig {
  id: string;
  /** Y position as percentage of container height */
  yPosition: number;
  /** Z-index value for this element */
  zIndex: number;
  /** Background file this element appears in */
  backgroundFile: string;
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
    backgroundFile: 'stage-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 25 },
      { minPosition: 15.01, maxPosition: 20, zIndex: 15 },
      { minPosition: 20.01, maxPosition: 100, zIndex: 9 }
    ]
  },
  // Add more background configurations as needed
  {
    backgroundFile: 'town-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 25 },  // Bottom area (behind bushes/streetlights)
      { minPosition: 10, maxPosition: 100, zIndex: 15 } // Upper area (in front of buildings)
    ]
  },
  {
    backgroundFile: 'home-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 20 },  // Floor level
      { minPosition: 15, maxPosition: 100, zIndex: 10 } // Upper area
    ]
  },
  {
    backgroundFile: 'beach-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 20, zIndex: 25 },  // Sand/shore area
      { minPosition: 20, maxPosition: 100, zIndex: 15 } // Water/background area
    ]
  },
  {
    backgroundFile: 'mine-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 20 },  // Ground level
      { minPosition: 15, maxPosition: 100, zIndex: 10 } // Cave entrance area
    ]
  },
  {
    backgroundFile: 'nostr-station-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 20 },  // Ground level
      { minPosition: 10, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    backgroundFile: 'plaza-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 15, zIndex: 25 },  // Ground level
      { minPosition: 15, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  },
  {
    backgroundFile: 'back-yard-open.png',
    thresholds: [
      { minPosition: 0, maxPosition: 10, zIndex: 20 },  // Ground level
      { minPosition: 10, maxPosition: 100, zIndex: 15 } // Upper area
    ]
  }
];

/**
 * Configuration for all interactive elements across different backgrounds
 * Y positions are calculated as percentages where 0% is top and 100% is bottom
 */
export const interactiveElementsConfig: InteractiveElementConfig[] = [
  // Town elements (town-open.png)
  {
    id: 'arcade',
    yPosition: 35, // top-[35%] on mobile, top-[30%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'stage',
    yPosition: 30, // top-[30%] on mobile, top-[26%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'shop',
    yPosition: 35, // top-[35%] on mobile, top-[30%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'bush-3',
    yPosition: 68, // top-[68%] on mobile, top-[63%] on desktop - using mobile value
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'bush-4',
    yPosition: 74, // top-[74%] on mobile, top-[69%] on desktop - using mobile value
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'bush-1',
    yPosition: 100, // bottom-0 = 100% from top
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'bush-2',
    yPosition: 100, // bottom-0 = 100% from top
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'streetlight-left',
    yPosition: 90, // bottom-[10%] = 90% from top
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },
  {
    id: 'streetlight-right',
    yPosition: 90, // bottom-[10%] = 90% from top
    zIndex: 25,
    backgroundFile: 'town-open.png'
  },

  // Mine elements (mine-open.png)
  {
    id: 'cave',
    yPosition: 40, // top-[40%] on mobile, top-[42%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'mine-open.png'
  },

  // Beach elements (beach-open.png and beach.png)
  {
    id: 'boat',
    yPosition: 34, // top-[34%] on mobile, top-[39%] on desktop - using mobile value
    zIndex: 15,
    backgroundFile: 'beach-open.png'
  },
  {
    id: 'boat-beach',
    yPosition: 34, // Same boat for beach.png
    zIndex: 15,
    backgroundFile: 'beach.png'
  },

  // Home elements (home-open.png)
  {
    id: 'bed',
    yPosition: 70, // Bed position in home
    zIndex: 15,
    backgroundFile: 'home-open.png'
  },
  {
    id: 'refrigerator',
    yPosition: 70, // Refrigerator position in home
    zIndex: 15,
    backgroundFile: 'home-open.png'
  }
];

/**
 * Calculate dynamic z-index for Blobbi based on its vertical position from bottom to top
 * @param blobbiYPosition - Blobbi's Y position as percentage from top (0-100, where 0 is top, 100 is bottom)
 * @param backgroundFile - Current background file name
 * @returns Calculated z-index value for the Blobbi
 */
export function calculateBlobbiZIndex(blobbiYPosition: number, backgroundFile: string): number {
  // Convert Y position from top-based to bottom-based percentage
  // blobbiYPosition: 0% = top, 100% = bottom
  // We want: 0% = bottom, 100% = top
  const positionFromBottom = 100 - blobbiYPosition;

  // Find the background configuration
  const backgroundConfig = backgroundZIndexConfigs.find(
    config => config.backgroundFile === backgroundFile
  );

  // If no specific configuration exists, fall back to the old system
  if (!backgroundConfig) {
    return calculateBlobbiZIndexLegacy(blobbiYPosition, backgroundFile);
  }

  // Find the appropriate threshold for the current position
  // Sort thresholds by minPosition to ensure we check in order
  const sortedThresholds = [...backgroundConfig.thresholds].sort((a, b) => a.minPosition - b.minPosition);

  // Check each threshold in order, with the first match winning
  for (let i = 0; i < sortedThresholds.length; i++) {
    const threshold = sortedThresholds[i];

    // Use inclusive bounds for all thresholds
    if (positionFromBottom >= threshold.minPosition && positionFromBottom <= threshold.maxPosition) {
      console.log(`Matched threshold ${i}: ${threshold.minPosition}-${threshold.maxPosition}, z-index: ${threshold.zIndex}`);
      return threshold.zIndex;
    }
  }

  // Return default if no threshold matched
  return 20;
}

/**
 * Legacy z-index calculation based on interactive elements (fallback)
 * @param blobbiYPosition - Blobbi's Y position as percentage (0-100)
 * @param backgroundFile - Current background file name
 * @returns Calculated z-index value for the Blobbi
 */
function calculateBlobbiZIndexLegacy(blobbiYPosition: number, backgroundFile: string): number {
  // Default z-index for Blobbi
  const baseZIndex = 20;

  // Get all interactive elements for the current background
  const elementsForBackground = interactiveElementsConfig.filter(
    element => element.backgroundFile === backgroundFile
  );

  if (elementsForBackground.length === 0) {
    return baseZIndex;
  }

  // Find elements that the Blobbi should be in front of (elements above the Blobbi)
  const elementsAbove = elementsForBackground.filter(element => element.yPosition < blobbiYPosition);

  // Find elements that the Blobbi should be behind (elements below or at same level as the Blobbi)
  const elementsBelow = elementsForBackground.filter(element => element.yPosition >= blobbiYPosition);

  // Start with base z-index
  let calculatedZIndex = baseZIndex;

  // If there are elements below/at same level, Blobbi should be behind the one with lowest z-index
  if (elementsBelow.length > 0) {
    const minZIndexBelow = Math.min(...elementsBelow.map(e => e.zIndex));
    calculatedZIndex = minZIndexBelow - 1;
  }
  // If there are only elements above, Blobbi should be in front of the one with highest z-index
  else if (elementsAbove.length > 0) {
    const maxZIndexAbove = Math.max(...elementsAbove.map(e => e.zIndex));
    calculatedZIndex = maxZIndexAbove + 1;
  }

  // Ensure we don't go below a minimum z-index
  return Math.max(calculatedZIndex, 1);
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
 * @returns The matching threshold or undefined
 */
export function getZIndexThresholdForPosition(positionFromBottom: number, backgroundFile: string): ZIndexThreshold | undefined {
  const config = getZIndexConfigForBackground(backgroundFile);
  if (!config) return undefined;

  const sortedThresholds = [...config.thresholds].sort((a, b) => a.minPosition - b.minPosition);

  const threshold = sortedThresholds.find(
    t => positionFromBottom >= t.minPosition && positionFromBottom < t.maxPosition
  );

  // If no threshold found, check if it's at the maximum boundary of the last threshold
  if (!threshold && sortedThresholds.length > 0) {
    const lastThreshold = sortedThresholds[sortedThresholds.length - 1];
    if (positionFromBottom >= lastThreshold.minPosition && positionFromBottom <= lastThreshold.maxPosition) {
      return lastThreshold;
    }
  }

  return threshold;
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