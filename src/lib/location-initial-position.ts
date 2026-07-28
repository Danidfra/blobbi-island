import { LocationId } from '@/lib/location-types';
import { hasArcadePass } from '@/lib/arcade-pass';

export interface InitialPosition {
  x: number;
  y: number;
}

export const LOCATION_INITIAL_POSITIONS: Record<LocationId, InitialPosition> = {
  'town': { x: 50, y: 75 },
  'home': { x: 50, y: 75 },
  'beach': { x: 50, y: 75 },
  'mine': { x: 50, y: 75 },
  'nostr-station': { x: 50, y: 75 },
  'nostr-station-inside': { x: 50, y: 85 },
  'plaza': { x: 50, y: 75 },
  'plaza-inside': { x: 50, y: 43 },
  'arcade': { x: 50, y: 75 },
  'arcade-1': { x: 50, y: 63 },
  'arcade-minus1': { x: 50, y: 55 },
  'stage': { x: 50, y: 75 },
  'shop': { x: 50, y: 90 },
  'back-yard': { x: 50, y: 75 },
  'cave-open': { x: 50, y: 75 },
  'clothing-store-inside': { x: 50, y: 80 },
};

/**
 * The arcade ground floor's walk boundary is the full-width rectangle
 * `y ∈ [48, 100]` **plus a narrow alcove** at `x ∈ [45, 55], y ∈ [36, 48]` — the
 * space in front of the elevator doors.
 *
 * These two constants exist because the pass-holder spawn used to be `{50, 48}`,
 * on the alcove's own boundary line. From there the Blobbi could not reach the
 * ticket counter: the walk stalled far from its target and `usePendingInteraction`
 * correctly cancelled itself (`STALL_MAX_DISTANCE_FACTOR`), so clicking the
 * counter produced no movement and no modal at all. Reproduced in a browser
 * during the audit, and fixed by spawning on the open floor instead.
 *
 * `arcade-spawn.test.ts` pins both: the spawn is inside the walkable area, it is
 * clear of the alcove, and a straight line from it to each ground-floor
 * destination stays on walkable floor the whole way.
 */
export const ARCADE_ELEVATOR_ALCOVE = { x: [45, 55], y: [36, 48] } as const;

/** Where a pass holder arrives: on the open floor, below the alcove mouth. */
export const ARCADE_PASS_HOLDER_SPAWN: InitialPosition = { x: 50, y: 58 };

/** Where everyone else arrives: mid-floor, within easy reach of the counter. */
export const ARCADE_DEFAULT_SPAWN: InitialPosition = { x: 50, y: 75 };

/**
 * Maps a child location to the position near its door on the parent location.
 * Key format: "parentLocation:childLocation" → position near the child's door on the parent map.
 * Used when exiting a room so the blobbi appears near the door they just came out of,
 * instead of the default center position.
 */
const EXIT_POSITIONS: Record<string, InitialPosition> = {
  // Exiting to town from various rooms
  'town:arcade': { x: 32, y: 68 },
  'town:stage': { x: 58, y: 65 },
  'town:shop': { x: 68, y: 68 },

  // Exiting to nostr-station area from nostr-station-inside
  'nostr-station:nostr-station-inside': { x: 80, y: 40 },

  // Exiting to plaza from plaza-inside
  'plaza:plaza-inside': { x: 50, y: 60 },

  // Exiting to shop (mall) from clothing-store-inside
  'shop:clothing-store-inside': { x: 55, y: 40 },

  // Exiting to mine from cave-open
  'mine:cave-open': { x: 50, y: 70 },

  // Exiting to home from back-yard
  'home:back-yard': { x: 78, y: 75 },
};

export function getBlobbiInitialPosition(location: string, previousLocation?: string | null): InitialPosition {
  // If we have a previous location, try to find an exit position near the door
  if (previousLocation) {
    const exitKey = `${location}:${previousLocation}`;
    const exitPosition = EXIT_POSITIONS[exitKey];
    if (exitPosition) {
      return exitPosition;
    }
  }

  const defaultPosition = LOCATION_INITIAL_POSITIONS[location as LocationId] || { x: 50, y: 75 };

  if (location === 'arcade') {
    return hasArcadePass() ? ARCADE_PASS_HOLDER_SPAWN : ARCADE_DEFAULT_SPAWN;
  }

  // Handle modal backgrounds (like photo-booth-inside.png)
  if (location === 'photo-booth-inside.png') {
    // Place Blobbi at bottom-center of the booth walkable area
    return { x: 45, y: 60 };
  }

  return defaultPosition;
}
