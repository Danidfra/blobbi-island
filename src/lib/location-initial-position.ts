import { LocationId } from '@/lib/location-types';

export interface InitialPosition {
  x: number;
  y: number;
}

/**
 * GROUND-ANCHOR semantics (Phase 2): every position is the point where the
 * Blobbi's FEET land on room entry. Values are the center-era spawns shifted
 * down by the depth-scaled half body height at that point, preserving each
 * room's previous on-screen entry spot exactly.
 */
export const LOCATION_INITIAL_POSITIONS: Record<LocationId, InitialPosition> = {
  'town': { x: 50, y: 83.3 },
  'home': { x: 50, y: 84.2 },
  'beach': { x: 50, y: 81.9 },
  'mine': { x: 50, y: 86.9 },
  'nostr-station': { x: 50, y: 82 },
  'nostr-station-inside': { x: 50, y: 94.5 },
  'plaza': { x: 50, y: 81.8 },
  'plaza-inside': { x: 50, y: 47.5 },
  'arcade': { x: 50, y: 84.2 },
  'arcade-1': { x: 50, y: 71.3 },
  'arcade-minus1': { x: 50, y: 60.9 },
  'stage': { x: 50, y: 84.2 },
  'shop': { x: 50, y: 96.7 },
  'back-yard': { x: 50, y: 84.2 },
  'cave-open': { x: 50, y: 84.2 },
  'clothing-store-inside': { x: 50, y: 90.1 },
  // Care Store: mid-front floor, on the open rug, clear of every blocker and a
  // comfortable walk from the checkout counter.
  'care-store-inside': { x: 50, y: 90 },
  // Badges Store: front-centre floor, on the open boards in front of the star
  // rug, clear of both display units and a straight walk to the checkout.
  'badges-store-inside': { x: 50, y: 92 },
};

/**
 * The arcade ground floor's walk boundary is the full-width rectangle
 * `y ∈ [57.2, 100]` **plus a narrow alcove** at `x ∈ [45, 55], y ∈ [45.2, 57.2]` — the
 * space in front of the elevator doors.
 *
 * These two constants exist because the elevator-exit spawn used to sit on the
 * alcove's own boundary line. From there the Blobbi could not reach the
 * ticket counter: the walk stalled far from its target and `usePendingInteraction`
 * correctly cancelled itself (`STALL_MAX_DISTANCE_FACTOR`), so clicking the
 * counter produced no movement and no modal at all. Reproduced in a browser
 * during the audit, and fixed by spawning on the open floor instead.
 *
 * `arcade-spawn.test.ts` pins both: the spawn is inside the walkable area, it is
 * clear of the alcove, and a straight line from it to each ground-floor
 * destination stays on walkable floor the whole way.
 */
export const ARCADE_ELEVATOR_ALCOVE = { x: [45, 55], y: [45.2, 57.2] } as const;

/**
 * Where someone stepping OFF the elevator arrives: on the open floor, just
 * below the alcove mouth.
 *
 * This used to be the pass holder's spawn, back when holding a pass was the
 * only way to be using the elevator at all. The elevator is open to everyone
 * now, so the spot belongs to the arrival it was always really about.
 */
export const ARCADE_ELEVATOR_EXIT_SPAWN: InitialPosition = { x: 50, y: 67.2 };

/** Where someone arriving from outside starts: mid-floor, near the counter. */
export const ARCADE_DEFAULT_SPAWN: InitialPosition = { x: 50, y: 84.2 };

/**
 * Maps a child location to the position near its door on the parent location.
 * Key format: "parentLocation:childLocation" → position near the child's door on the parent map.
 * Used when exiting a room so the blobbi appears near the door they just came out of,
 * instead of the default center position.
 */
export const EXIT_POSITIONS: Record<string, InitialPosition> = {
  // Exiting to town from various rooms
  'town:arcade': { x: 32, y: 75.8 },
  'town:stage': { x: 58, y: 72.1 },
  'town:shop': { x: 68, y: 75.8 },

  // Exiting to nostr-station area from nostr-station-inside
  'nostr-station:nostr-station-inside': { x: 80, y: 44.8 },

  // Exiting to plaza from plaza-inside
  'plaza:plaza-inside': { x: 50, y: 65.8 },

  // Exiting to shop (mall) from clothing-store-inside.
  //
  // The clothing store sits on the mall's MIDDLE level: its sprite group spans
  // x ≈ 50–74.5% and its door x ≈ 51–64% (InteractiveElements, shopping-mall
  // branch). The walkable floor on that level is the strip y ∈ [62.1, 63.1] of
  // `shopping-mall-inside.png` (locationBoundaries) — the same strip players
  // stand on when they walk INTO the store. The pre-Phase-0 value {55, 40} was
  // outside every walkable area (mid-air between floors), so the Blobbi
  // spawned off-floor and snapped away on the first movement frame.
  // GROUND-anchor semantics (Phase 2): the feet land on the walkway strip.
  'shop:clothing-store-inside': { x: 58, y: 62.6 },

  // Exiting to shop (mall) from care-store-inside.
  //
  // The Care Store facade stands on the mall's MIDDLE level, in the bay it
  // traded with the Photo Booth, spanning x ≈ 25.4–49.9 % (`care-store-config.ts`).
  // The walkable floor on that level is the strip `y ∈ [62.1, 63.1]` of
  // `shopping-mall-inside.png` — the same one the Clothing Store returns onto —
  // so the return point is the storefront's horizontal centre on that strip.
  // The player comes back out where they went in.
  'shop:care-store-inside': { x: 37.6, y: 62.6 },

  // Exiting to shop (mall) from badges-store-inside.
  //
  // The Badges Store facade holds the middle level's far-left bay, painting
  // x ≈ −2.2–21.7 % (`badges-store-config.ts`). Same walkway strip as its two
  // neighbours, at the storefront's painted centre — which is also its
  // `walkTarget`, so going in and coming out use one point.
  'shop:badges-store-inside': { x: 9.75, y: 62.6 },

  // Exiting to mine from cave-open
  'mine:cave-open': { x: 50, y: 81.3 },

  // Exiting to home from back-yard
  'home:back-yard': { x: 78, y: 84.2 },
};

/**
 * Where the actor stands when a scene mounts.
 *
 * One rule, one place: a resumed session opens at the position kind:31950
 * presence recorded; everything else — every ordinary arrival, and every
 * navigation after the bootstrap — uses the scene's canonical entry point.
 *
 * `bootstrapPosition` comes from `LocationContext` and is non-null ONLY between
 * the resume adoption and the first navigation, so this cannot shadow the spawn
 * rules mid-session. It is already validated against the destination scene by
 * the resume policy (`src/lib/location-resume.ts`), which is why it is taken as
 * given here rather than re-clamped.
 *
 * `PlayingView` calls this to build `MovableBlobbi`'s `initialPosition`, and
 * `MovableBlobbi` is keyed on the location — so the value lands at the actor's
 * FIRST mount in a scene. Nothing moves it afterwards; there is no correcting
 * effect and therefore no visible teleport.
 */
export function resolveActorSpawn(
  bootstrapPosition: InitialPosition | null | undefined,
  location: string,
  previousLocation?: string | null,
): InitialPosition {
  return bootstrapPosition ?? getBlobbiInitialPosition(location, previousLocation);
}

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
    // Arriving by elevator puts you at its doors; arriving from outside puts
    // you by the counter. The split used to be pass / no pass, which happened
    // to mean the same thing back when only a pass holder could ride.
    return previousLocation && previousLocation.startsWith('arcade-')
      ? ARCADE_ELEVATOR_EXIT_SPAWN
      : ARCADE_DEFAULT_SPAWN;
  }

  // Handle modal backgrounds (like photo-booth-inside.png)
  if (location === 'photo-booth-inside.png') {
    // Place Blobbi at bottom-center of the booth walkable area (ground point)
    return { x: 45, y: 73.8 };
  }

  return defaultPosition;
}
