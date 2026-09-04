/**
 * Which Blobbi Island locations take part in the shared day/night sky.
 *
 * One record per `LocationId`, in one file, for the same reason
 * `arcade-machines-config.ts` and `theater-seats-config.ts` exist: the
 * alternative is `currentLocation === 'town' || currentLocation === 'plaza'`
 * scattered across components, which drifts the moment somebody adds a location
 * and only remembers three of the five places to update.
 *
 * ## Keyed by `LocationId`, never by filename
 *
 * Much of the world (boundaries, interactive elements, Blobbi sizing) is keyed by
 * background *filename*, which is why renaming one Plaza asset from `.png` to
 * `.webp` touched six source files. This table is keyed by the stable
 * `LocationId` instead, so the in-flight `.png` → `.webp` conversions cannot
 * silently switch a location's sky off.
 *
 * ## `enabled` is about the scene, `artworkSkyReady` is about the asset
 *
 * A location is `enabled` when it is a scene that *should* share the island's
 * sky — every outdoor scene, and the one interior whose windows look out on it.
 * `artworkSkyReady` records whether its artwork has actually had the sky region
 * cut out yet.
 *
 * **As of this pass, all seven are ready.** The asset migration landed cut-out plates
 * scene by scene while this feature was being built, so the flag spent most of that
 * time partly false; it is kept because it gates nothing and it is the honest place
 * to record the state if a future scene is enabled before its art is done. A scene
 * marked `false` still gets the world-lighting grade — its sky is simply hidden
 * behind opaque pixels, and it starts working with no code change when the art
 * lands. Nothing forces the sky through opaque pixels.
 *
 * See `docs/audits/day-night-sky-audit.md` §10 for the per-image findings behind these
 * entries, including why `mine` and `nostr-station` qualify and `cave-open` does
 * not despite its id.
 */

import type { LocationId } from '@/lib/location-types';

export interface LocationSkyConfig {
  /** Render the dynamic sky and the world-lighting grade for this location. */
  enabled: boolean;
  /** Draw drifting cloud bands. Off for scenes with only a thin strip of sky. */
  showClouds: boolean;
  /** Draw the night star field. */
  showStars: boolean;
  /**
   * Scales the time-of-day grade — both the artwork filter and the scene veil —
   * for this location, `0..1`. Lower it for a scene whose art is already dark or
   * whose readability is tight; `1` means "grade exactly as authored".
   */
  worldLightStrength: number;
  /**
   * Has this location's artwork had its sky region made transparent yet?
   *
   * Documentation and QA signal only — it deliberately does not gate anything.
   * `false` means "the sky is correct but invisible here until the art lands".
   */
  artworkSkyReady: boolean;
  /** Why this location is configured the way it is. */
  note: string;
}

/**
 * The grade for an INTERIOR whose windows look out on the sky.
 *
 * The time-of-day grade exists to make an outdoor scene follow the sun. A room
 * lit by its own lamps does not: at night the sky in its windows goes dark and
 * the room stays lit, which is exactly what the split between the sky layer
 * (behind the plate, showing through its transparent panes) and the grade (a
 * filter on the plate and a veil over the scene) allows. So an interior keeps
 * `enabled: true` for the sky and takes THIS strength for the grade — a whisper
 * rather than nothing, so the room shares the island's warmth at dusk without
 * ever reading as a darkened room. At deep night it comes to a brightness of
 * 0.97 on the artwork and a veil of 1.4 % over the scene.
 *
 * The Plaza is the first such room; any later interior with cut-out windows
 * should use this rather than choose its own number.
 */
export const INTERIOR_WINDOW_LIGHT_STRENGTH = 0.1;

const DISABLED: LocationSkyConfig = {
  enabled: false,
  showClouds: false,
  showStars: false,
  worldLightStrength: 0,
  artworkSkyReady: false,
  note: 'Interior or otherwise not a sky scene.',
};

/**
 * Explicit for every `LocationId` — a `Record`, not a `Partial`, so adding a
 * location to the union is a type error here until somebody decides whether it
 * has a sky.
 */
export const LOCATION_SKY_CONFIG: Record<LocationId, LocationSkyConfig> = {
  town: {
    enabled: true,
    showClouds: true,
    showStars: true,
    worldLightStrength: 1,
    artworkSkyReady: true,
    note: 'Open town square. Artwork is transparent above the tree line (~55%).',
  },
  plaza: {
    enabled: true,
    showClouds: true,
    showStars: true,
    worldLightStrength: 1,
    artworkSkyReady: true,
    note: 'Open plaza. Artwork is transparent above the ground plate (~38%).',
  },
  beach: {
    enabled: true,
    showClouds: true,
    showStars: true,
    worldLightStrength: 1,
    artworkSkyReady: true,
    note: 'Open coastline. Artwork is transparent above the ocean horizon (~48%).',
  },
  'back-yard': {
    enabled: true,
    // The strip above the fence is ~28% of the frame — about 195 world pixels, and
    // every cloud's ink stays above 26%, so a passage fits with room to spare.
    // Clouds were off here while the sky was still painted into the artwork.
    showClouds: true,
    showStars: true,
    worldLightStrength: 0.9,
    artworkSkyReady: true,
    note: 'Enclosed yard. Artwork is transparent above the fence line (~28%).',
  },
  mine: {
    enabled: true,
    showClouds: true,
    showStars: true,
    worldLightStrength: 1,
    artworkSkyReady: true,
    note: 'Mine EXTERIOR — transparent sky above the conifer line. The interior is `cave-open`.',
  },
  'nostr-station': {
    enabled: true,
    showClouds: true,
    showStars: true,
    worldLightStrength: 1,
    artworkSkyReady: true,
    note: 'Outdoor hillside approach. Artwork is transparent above the hill and tree line.',
  },

  'plaza-inside': {
    enabled: true,
    // The three arched windows sit at y 9–24 %, and every cloud's ink stays
    // above 26 %, so passages drift past the glass exactly as they should.
    showClouds: true,
    showStars: true,
    // An interior lit by its own lamps: the night is in the windows, not in
    // the room — see `INTERIOR_WINDOW_LIGHT_STRENGTH`.
    worldLightStrength: INTERIOR_WINDOW_LIGHT_STRENGTH,
    artworkSkyReady: true,
    note: 'Plaza INTERIOR — the only interior with a sky. Its three arched windows are cut out of `plaza-inside.webp`; every other pixel of the plate is opaque.',
  },

  home: DISABLED,
  'nostr-station-inside': DISABLED,
  arcade: DISABLED,
  'arcade-1': DISABLED,
  'arcade-minus1': DISABLED,
  shop: DISABLED,
  'clothing-store-inside': DISABLED,
  'badges-store-inside': DISABLED,
  'care-store-inside': DISABLED,
  'furniture-store-inside': DISABLED,
  stage: {
    ...DISABLED,
    note: 'Theater interior, deliberately black-backed. Owned by the theater feature.',
  },
  'cave-open': {
    ...DISABLED,
    note: 'Cave INTERIOR despite the id — the artwork is `cave-inside.png`.',
  },
};

/** Config for a location. Unknown ids fall back to disabled. */
export function getLocationSkyConfig(location: LocationId): LocationSkyConfig {
  return LOCATION_SKY_CONFIG[location] ?? DISABLED;
}

/** Does this location take part in the day/night system at all? */
export function isSkyEnabledLocation(location: LocationId): boolean {
  return getLocationSkyConfig(location).enabled;
}

/** Every sky location, for the DEV harness and for documentation checks. */
export function skyEnabledLocations(): LocationId[] {
  return (Object.keys(LOCATION_SKY_CONFIG) as LocationId[]).filter((id) =>
    LOCATION_SKY_CONFIG[id].enabled,
  );
}

/** Sky locations whose artwork already exposes a transparent sky region. */
export function skyReadyLocations(): LocationId[] {
  return skyEnabledLocations().filter((id) => LOCATION_SKY_CONFIG[id].artworkSkyReady);
}
