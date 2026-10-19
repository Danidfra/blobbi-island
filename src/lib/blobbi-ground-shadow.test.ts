/**
 * The ground shadow's geometry comes from the drawing: a V1 adult's feet are
 * well above the box's bottom, an egg rests near it, a V2 body stands on it,
 * and a V3 individual brings its own footprint. Nothing is guessed from the
 * frame, and nothing measured can throw the shadow off the box.
 */
import { describe, expect, it } from 'vitest';
import { describeBlobbiArtwork } from '@blobbi-kit/renderer';

import { devV3Visual } from './dev-v3-fixture';
import { DEFAULT_GROUND_SHADOW, GROUND_SHADOW_ASPECT, resolveGroundShadow, sameGroundShadow } from './blobbi-ground-shadow';

const V1_ADULT = { stage: 'adult' as const, visualGeneration: 'v1' as const, adultType: 'bloomi' };
const V1_BABY = { stage: 'baby' as const, visualGeneration: 'v1' as const };
const EGG = { stage: 'egg' as const, visualGeneration: 'v1' as const };
const V2_ADULT = { stage: 'adult' as const, visualGeneration: 'v2' as const };

describe('where the ground shadow goes', () => {
  it('sits on the ground line the renderer measures for each generation and stage', () => {
    for (const visual of [V1_ADULT, V1_BABY, EGG, V2_ADULT, devV3Visual('adult'), devV3Visual('baby')]) {
      const expected = describeBlobbiArtwork({ ...visual, facing: 'front' }).boxAnchors.groundY;
      expect(resolveGroundShadow(visual, 'front').groundY).toBeCloseTo(expected, 6);
    }
    // The V1 feet are a sixth of the box above its bottom edge; V2 stands nearly on it; an egg rests near it
    expect(resolveGroundShadow(V1_ADULT).groundY).toBeLessThan(0.85);
    expect(resolveGroundShadow(V2_ADULT).groundY).toBeGreaterThan(0.9);
    expect(resolveGroundShadow(EGG).groundY).toBeGreaterThan(0.88);
  });

  it('a V3 individual stands on its own measured footprint; V1 and V2 use the stage widths', () => {
    const v3 = resolveGroundShadow(devV3Visual('adult'));
    const measured = describeBlobbiArtwork({ ...devV3Visual('adult'), facing: 'front' }).boxAnchors.footprint!;
    expect(v3.width).toBeCloseTo(measured.width, 6);
    expect(v3.centerX).toBeCloseTo(measured.centerX, 6);
    // Without a footprint: an adult stands wider than a baby, an egg between
    const adult = resolveGroundShadow(V1_ADULT).width;
    const baby = resolveGroundShadow(V1_BABY).width;
    const egg = resolveGroundShadow(EGG).width;
    expect(adult).toBeGreaterThan(egg);
    expect(egg).toBeGreaterThan(baby);
    expect(resolveGroundShadow(V1_ADULT).centerX).toBe(0.5);
  });

  it('follows the facing: a V3 profile is measured as a profile, and a flipped one mirrors its centre', () => {
    const front = resolveGroundShadow(devV3Visual('adult'), 'front');
    const right = resolveGroundShadow(devV3Visual('adult'), 'right');
    const left = resolveGroundShadow(devV3Visual('adult'), 'left');
    expect(right.groundY).toBeCloseTo(describeBlobbiArtwork({ ...devV3Visual('adult'), facing: 'right' }).boxAnchors.groundY, 6);
    expect(left.centerX + right.centerX).toBeCloseTo(1, 2);
    expect(front).toBeDefined();
  });

  it('with no visual, the historical placement: the box bottom, centred', () => {
    expect(resolveGroundShadow(null)).toEqual(DEFAULT_GROUND_SHADOW);
    expect(resolveGroundShadow(undefined)).toEqual(DEFAULT_GROUND_SHADOW);
    expect(DEFAULT_GROUND_SHADOW.groundY).toBe(1);
  });

  it('every value stays inside the box, and the pool is flat', () => {
    for (const visual of [V1_ADULT, V1_BABY, EGG, V2_ADULT, devV3Visual('adult')]) {
      for (const facing of ['front', 'back', 'left', 'right'] as const) {
        const g = resolveGroundShadow(visual, facing);
        expect(g.groundY).toBeGreaterThan(0);
        expect(g.groundY).toBeLessThanOrEqual(1);
        expect(g.centerX).toBeGreaterThan(0);
        expect(g.centerX).toBeLessThan(1);
        expect(g.width).toBeGreaterThan(0.2);
        expect(g.width).toBeLessThanOrEqual(1);
      }
    }
    expect(GROUND_SHADOW_ASPECT).toBeLessThan(0.5);
  });

  it('sameGroundShadow tells apart only geometries that would draw differently', () => {
    const a = resolveGroundShadow(V1_ADULT);
    expect(sameGroundShadow(a, { ...a })).toBe(true);
    expect(sameGroundShadow(a, resolveGroundShadow(V2_ADULT))).toBe(false);
    expect(sameGroundShadow(a, null)).toBe(false);
    expect(sameGroundShadow(null, null)).toBe(true);
  });
});
