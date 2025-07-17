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
  }
];

/**
 * Calculate dynamic z-index for Blobbi based on its position relative to interactive elements
 * @param blobbiYPosition - Blobbi's Y position as percentage (0-100)
 * @param backgroundFile - Current background file name
 * @returns Calculated z-index value for the Blobbi
 */
export function calculateBlobbiZIndex(blobbiYPosition: number, backgroundFile: string): number {
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