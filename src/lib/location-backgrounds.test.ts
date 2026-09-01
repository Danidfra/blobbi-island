/**
 * Canonical location→background resolution (Phase 3).
 *
 * `LOCATION_BACKGROUNDS` is the ONLY location→background table in the app.
 * Production rendering (PlayingView), multiplayer depth/z math
 * (MultiplayerLayer), the presence adapter (presence-ground), the walkable API
 * (multiplayer.ts) and the dev room harness must all resolve through it — two
 * of them used to carry byte-identical handwritten copies, and a room added to
 * one but not the others rendered remotes with the wrong boundary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOCATION_BACKGROUNDS, getBackgroundForLocation } from './location-backgrounds';
import { locationBoundaries } from './location-boundaries';
import type { LocationId } from './location-types';

const ALL_LOCATIONS = Object.keys(LOCATION_BACKGROUNDS) as LocationId[];

describe('LOCATION_BACKGROUNDS', () => {
  it('resolves every canonical location to a background file', () => {
    // Eighteen since the Badges Store became a real room.
    expect(ALL_LOCATIONS.length).toBe(18);
    for (const location of ALL_LOCATIONS) {
      const background = getBackgroundForLocation(location);
      expect(background, location).toBeTruthy();
      expect(background, location).toBe(LOCATION_BACKGROUNDS[location]);
    }
  });

  it('falls back to the town background for unknown ids', () => {
    expect(getBackgroundForLocation('nowhere' as LocationId)).toBe('town-open.webp');
  });

  it('every resolved background has a walk boundary', () => {
    for (const location of ALL_LOCATIONS) {
      expect(
        locationBoundaries[getBackgroundForLocation(location)],
        `${location} → ${getBackgroundForLocation(location)}`,
      ).toBeDefined();
    }
  });
});

describe('no duplicate production mapping remains', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('multiplayer.ts resolves through the canonical resolver', () => {
    const source = read('src/lib/multiplayer.ts');
    expect(source).not.toContain('locationToFile');
    expect(source).toContain("from '@/lib/location-backgrounds'");
  });

  it('MultiplayerLayer resolves through the canonical resolver', () => {
    const source = read('src/components/blobbi/MultiplayerLayer.tsx');
    expect(source).not.toContain('locationToFile');
    expect(source).toContain('getBackgroundForLocation(');
  });
});
