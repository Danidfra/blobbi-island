/**
 * DEV FIXTURE: one procedural (V3) Blobbi, for the `/dev/*` harnesses.
 *
 * It is the kit's own `crowded-crown` reference identity (blobbi-kit
 * `packages/blobbi-renderer/src/artwork/v3/reference/cases.ts`, commit
 * f3acbf4), for `/dev/rooms`: everything on one head, a spotted body with a heart on its hip,
 * belly and freckles, an accent colour; one of the twelve Blobbis
 * `visual_algorithm = 1` is pinned with, so what is seen here can be compared
 * with the kit's own reference drawings. Copied literally, as fixture data:
 * nothing is derived, and the kit decides everything about how it looks.
 */
import type { BlobbiVisual } from '@blobbi-kit/renderer';

export const DEV_V3_IDENTITY = {
  seed: 'e7ddbe425cbd343679da4e24d40628213cb88815b9c1bc96956191501e827aea',
  algorithm: 1,
  colors: { base: '#42a6ce', secondary: '#005c69', eye: '#341000', accent: '#e98956' },
  traits: { antenna: 'double', horns: 'top', ears: 'pointed', tail: 'curl', pattern: 'spotted', specialMark: 'heart', belly: true, freckles: true },
} as const;

/** The fixture as a renderer visual, at a stage. */
export function devV3Visual(stage: 'baby' | 'adult'): BlobbiVisual {
  return {
    stage,
    visualGeneration: 'v3',
    v3: DEV_V3_IDENTITY,
    baseColor: DEV_V3_IDENTITY.colors.base,
    secondaryColor: DEV_V3_IDENTITY.colors.secondary,
    eyeColor: DEV_V3_IDENTITY.colors.eye,
    pattern: DEV_V3_IDENTITY.traits.pattern,
    specialMark: DEV_V3_IDENTITY.traits.specialMark,
    name: 'Dev V3',
  };
}
