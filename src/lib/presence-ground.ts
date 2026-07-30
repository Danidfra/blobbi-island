/**
 * Presence wire-format compatibility boundary (Phase 2).
 *
 * INTERNAL Island semantics: positions are GROUND points (blobbi-ground.ts).
 * WIRE semantics (kind 31950 `anchor`/`goal` in content): unchanged legacy
 * CENTER points, for compatibility with clients that predate the migration.
 * No new protocol field is published.
 *
 * Conversion happens at EXACTLY two boundaries — every publish helper input
 * (useIslandPresence) and presence ingest (`processPresenceEvent`) — never in
 * UI components.
 *
 * The offset needs the actor's renderer size and depth scale. Both are fully
 * determined by the LOCATION (room size token + per-background depth ramp), so
 * the conversion is exact for standing actors. The depth scale is authoritative
 * at the GROUND point; publishing samples it there directly, and ingest
 * recovers the same ground point by fixed-point iteration
 * (ĝ = wire + halfH(scale(ĝ)) — the ramp is a gentle contraction, so a few
 * steps converge far below a world pixel even in the steepest room).
 */

import type { Position } from '@/lib/types';
import type { LocationId } from '@/lib/location-types';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { getBlobbiSizeForLocation } from '@/lib/location-blobbi-sizes';
import { locationBoundaries } from '@/lib/location-boundaries';
import { resolveBlobbiScale } from '@/lib/blobbi-world-render';
import { centerToGround, groundToCenter, type GroundPosition } from '@/lib/blobbi-ground';

function depthScaleAt(location: string, pos: Position): number {
  const background = getBackgroundForLocation(location as LocationId);
  return resolveBlobbiScale(pos, background, locationBoundaries[background]);
}

/** Internal ground point → legacy wire center point, for publishing. */
export function groundToWireCenter(ground: GroundPosition, location: string): Position {
  const size = getBlobbiSizeForLocation(location as LocationId);
  return groundToCenter(ground, size, depthScaleAt(location, ground));
}

/** Legacy wire center point → internal ground point, for ingest. */
export function wireCenterToGround(center: Position, location: string): GroundPosition {
  const size = getBlobbiSizeForLocation(location as LocationId);
  // Fixed-point iteration: the true ground point g satisfies
  // g = center + halfH(scale(g)), with scale sampled at the GROUND point (the
  // same sampling `groundToWireCenter` uses) — so the pair is exactly inverse.
  let ground: GroundPosition = center;
  for (let i = 0; i < 4; i++) {
    ground = centerToGround(center, size, depthScaleAt(location, ground));
  }
  return ground;
}
