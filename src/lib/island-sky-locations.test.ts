import { describe, it, expect } from 'vitest';

import { LOCATION_BACKGROUNDS } from './location-backgrounds';
import type { LocationId } from './location-types';
import {
  LOCATION_SKY_CONFIG,
  getLocationSkyConfig,
  isSkyEnabledLocation,
  skyEnabledLocations,
  skyReadyLocations,
} from './island-sky-locations';

describe('sky location coverage', () => {
  it('has a decision recorded for every location in the world', () => {
    // A Record rather than a Partial, so a new LocationId is a type error until
    // somebody decides whether it has a sky. This asserts the runtime half.
    const worldLocations = Object.keys(LOCATION_BACKGROUNDS).sort();
    expect(Object.keys(LOCATION_SKY_CONFIG).sort()).toEqual(worldLocations);
  });

  it('explains every entry', () => {
    for (const [id, config] of Object.entries(LOCATION_SKY_CONFIG)) {
      expect(config.note.length, id).toBeGreaterThan(10);
    }
  });
});

/**
 * Interiors whose artwork has real windows cut out of it. An interior earns a
 * sky only by being on this list — see the guard below.
 */
const INTERIORS_WITH_WINDOWS: LocationId[] = ['plaza-inside'];

describe('the locations enabled in this phase', () => {
  it('is exactly the six confirmed outdoor scenes plus the Plaza interior', () => {
    expect(skyEnabledLocations().sort()).toEqual([
      'back-yard',
      'beach',
      'mine',
      'nostr-station',
      'plaza',
      'plaza-inside',
      'town',
    ]);
  });

  it('only enables "-open" exterior plates, or an interior whose windows are cut out', () => {
    // Not a rule that the filename *grants* a sky — the interiors below prove the
    // suffix is not sufficient. It is a guard that an interior plate never
    // silently ends up enabled: an interior gets in by being NAMED here, which
    // is a claim that its plate has transparent windows (`plaza-inside.webp`'s
    // three arches are the only transparent pixels in it).
    for (const id of skyEnabledLocations()) {
      if (INTERIORS_WITH_WINDOWS.includes(id)) continue;
      expect(LOCATION_BACKGROUNDS[id], id).toMatch(/-open\.(png|webp)$/);
    }
  });

  it('grades the Plaza interior at half strength — lit by its own lamps', () => {
    const config = getLocationSkyConfig('plaza-inside');
    expect(config.worldLightStrength).toBeGreaterThan(0);
    expect(config.worldLightStrength).toBeLessThan(getLocationSkyConfig('plaza').worldLightStrength);
  });

  it('is keyed by LocationId, so a .png → .webp rename cannot switch a sky off', () => {
    // The Plaza migration renamed one asset and had to touch six filename-keyed
    // modules. This table is deliberately not one of them.
    expect(LOCATION_BACKGROUNDS.plaza).toMatch(/^plaza-open\./);
    expect(isSkyEnabledLocation('plaza')).toBe(true);
    expect(isSkyEnabledLocation('town')).toBe(true);
  });

  it('grades, lights and clouds every enabled scene', () => {
    for (const id of skyEnabledLocations()) {
      const config = getLocationSkyConfig(id);
      expect(config.worldLightStrength, id).toBeGreaterThan(0);
      expect(config.worldLightStrength, id).toBeLessThanOrEqual(1);
      expect(config.showStars, id).toBe(true);
      // Now that every plate has a real sky region, every scene gets clouds.
      expect(config.showClouds, id).toBe(true);
    }
  });
});

describe('the locations deliberately left disabled', () => {
  const DISABLED_IDS: LocationId[] = [
    'home',
    'nostr-station-inside',
    'arcade',
    'arcade-1',
    'arcade-minus1',
    'stage',
    'shop',
    'clothing-store-inside',
    'cave-open',
  ];

  it('covers every interior', () => {
    for (const id of DISABLED_IDS) {
      expect(isSkyEnabledLocation(id), id).toBe(false);
    }
  });

  it('leaves an unsupported scene completely untouched', () => {
    // Not merely "no sky drawn": strength 0 means the artwork filter and the veil
    // are both absent, so these scenes render exactly as they did before.
    for (const id of DISABLED_IDS) {
      const config = getLocationSkyConfig(id);
      expect(config.worldLightStrength, id).toBe(0);
      expect(config.showClouds, id).toBe(false);
      expect(config.showStars, id).toBe(false);
    }
  });

  it('does not enable `cave-open` despite the id, because the artwork is an interior', () => {
    // Matched on the filename STEM, not the extension. The asset migration is
    // converting these plates to `.webp` one at a time, and a test that pins the
    // extension would contradict the very property this table exists to provide:
    // that a rename cannot change a location's sky. The stem is what carries the
    // meaning — `-inside` is an interior plate, `-open` is an exterior one.
    expect(LOCATION_BACKGROUNDS['cave-open']).toMatch(/^cave-inside\./);
    expect(isSkyEnabledLocation('cave-open')).toBe(false);
    // …while `mine` — the exterior entrance to that same cave — is enabled.
    expect(LOCATION_BACKGROUNDS.mine).toMatch(/^mine-open\./);
    expect(isSkyEnabledLocation('mine')).toBe(true);
  });
});

describe('artwork readiness', () => {
  it('records every enabled scene as sky-ready — the migration is complete', () => {
    // All six outdoor plates and the Plaza interior's windows expose a
    // transparent sky region. Verified against the actual files, not inferred
    // from the config.
    expect(skyReadyLocations().sort()).toEqual(skyEnabledLocations().sort());
    expect(skyReadyLocations()).toHaveLength(7);
  });

  it('keeps readiness a record rather than a gate', () => {
    // The flag still gates nothing: it is where to record the state honestly if a
    // future scene is enabled before its art is cut out. A `false` scene would still
    // get the world-lighting grade and would start working with no code change.
    for (const id of skyEnabledLocations()) {
      expect(getLocationSkyConfig(id).enabled, id).toBe(true);
    }
    // Every disabled scene reports false, so the flag never implies "ready" for a
    // scene the system does not touch.
    for (const id of Object.keys(LOCATION_SKY_CONFIG) as LocationId[]) {
      if (!isSkyEnabledLocation(id)) {
        expect(getLocationSkyConfig(id).artworkSkyReady, id).toBe(false);
      }
    }
  });
});

describe('getLocationSkyConfig', () => {
  it('falls back to disabled for an id outside the union', () => {
    const config = getLocationSkyConfig('not-a-place' as LocationId);
    expect(config.enabled).toBe(false);
    expect(config.worldLightStrength).toBe(0);
  });
});
