/**
 * Where a Blobbi's ground shadow goes, and how wide it is: measured from the
 * drawing itself, never guessed from the frame.
 *
 * The renderer fits every drawing into a square box and knows, for each
 * generation, stage and view, where its ground line is and what it stands on
 * (`describeBlobbiArtwork`: `boxAnchors.groundY` and, for V3, the individual's
 * own `footprint`). A V1 adult's feet are at 82% of the box; an egg rests at
 * 91%; a V2 body at 93%. The Island used to put the shadow at the box's
 * bottom edge for all of them, so a V1 Blobbi floated a sixth of its box
 * above its own shadow while a V2 one stood on it. The shadow now sits on
 * the measured ground line, under the measured contact, so every form and
 * stage looks planted.
 *
 * Fractions of the square box the renderer draws in (0..1), which is also the
 * actor's unscaled layout box: the actor turns them into percentages inside
 * its scale rig, so depth scaling carries the shadow along for free.
 *
 * Pure: identity, stage and facing in; geometry out.
 */
import { describeBlobbiArtwork, type BlobbiFacing, type BlobbiVisual } from '@blobbi-kit/renderer';

export interface GroundShadowGeometry {
  /** The ground line, as a fraction of the box from its top. */
  groundY: number;
  /** The horizontal centre of the contact with the ground (0..1). */
  centerX: number;
  /** How wide the contact is, as a fraction of the box width. */
  width: number;
}

/**
 * Before the drawing has said where it stands (the first render of a wrapper
 * whose body is still resolving, or a test that mocks the body): the box's
 * bottom edge, the historical placement.
 */
export const DEFAULT_GROUND_SHADOW: GroundShadowGeometry = Object.freeze({ groundY: 1, centerX: 0.5, width: 0.42 });

/** The ellipse's height as a fraction of its width: a flat, soft pool. */
export const GROUND_SHADOW_ASPECT = 0.3;

/**
 * Contact widths for the generations whose artwork carries no footprint
 * (V1, V2), as fractions of the box: an adult stands on two feet, a baby is a
 * small thing, an egg rests on its base.
 */
const CONTACT_WIDTH_BY_STAGE: Record<'egg' | 'baby' | 'adult', number> = {
  egg: 0.46,
  baby: 0.42,
  adult: 0.54,
};

/** Keep a measured value inside the box; a drawing that misreports itself never throws the shadow off screen. */
const unit = (n: number, fallback: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);

export function resolveGroundShadow(
  visual: Pick<BlobbiVisual, 'stage' | 'visualGeneration' | 'adultType' | 'v3'> | null | undefined,
  facing: BlobbiFacing = 'front',
): GroundShadowGeometry {
  if (!visual) return DEFAULT_GROUND_SHADOW;
  let described: ReturnType<typeof describeBlobbiArtwork>;
  try {
    described = describeBlobbiArtwork({
      stage: visual.stage,
      visualGeneration: visual.visualGeneration,
      adultType: visual.adultType,
      facing,
      v3: visual.v3,
    });
  } catch {
    return DEFAULT_GROUND_SHADOW;
  }
  const anchors = described.boxAnchors;
  const footprint = anchors.footprint;
  return {
    groundY: unit(anchors.groundY, DEFAULT_GROUND_SHADOW.groundY),
    centerX: unit(footprint?.centerX ?? anchors.centerX, DEFAULT_GROUND_SHADOW.centerX),
    width: unit(footprint?.width ?? CONTACT_WIDTH_BY_STAGE[described.stage], DEFAULT_GROUND_SHADOW.width),
  };
}

/** Two geometries that would draw the same shadow (so a report of the same answer never re-renders the actor). */
export function sameGroundShadow(a: GroundShadowGeometry | null, b: GroundShadowGeometry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.groundY === b.groundY && a.centerX === b.centerX && a.width === b.width;
}
