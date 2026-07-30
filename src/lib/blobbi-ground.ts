/**
 * Ground-anchor geometry for the Blobbi actor (Phase 2).
 *
 * THE CONTRACT — final semantics (see docs/blobbi-actor-position-migration-notes.md):
 *
 *  - A stored actor `Position` is the Blobbi's GROUND-CONTACT POINT: the
 *    world-percent x/y of the point where the Blobbi touches the floor.
 *  - The visual rig grows UPWARD from that point (anchor transform
 *    `translate(-50%, -100%)`, depth scaling around `bottom center`).
 *  - The ground shadow is centered on that point.
 *  - World boundaries constrain that point (documented pose snaps — theater
 *    seats, the bed sleeping pose — may bypass them via `goTo(..., true)`).
 *  - Interaction targets are desired ground points.
 *  - Local and remote actor wrappers consume identical semantics via
 *    `BlobbiActor`.
 *  - The kind 31950 presence WIRE still carries legacy CENTER points;
 *    conversion happens only at the publish/ingest boundary
 *    (`groundToWireCenter` / `wireCenterToGround`).
 *
 * `GroundPosition` is a documentation alias of `Position` rather than a
 * branded type: position values flow through dozens of existing signatures
 * (movement, boundaries, presence, gaze) and a brand would force churn without
 * preventing the real hazard — the wire boundary — which is instead confined
 * to the two conversion helpers in `useIslandPresence`.
 */

import type { Position } from '@/lib/types';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/components/shell/VirtualWorld';
import {
  BLOBBI_RENDER_SIZE_PX,
  type BlobbiRenderSize,
} from '@/components/blobbi/lib/blobbi-render-size';

/** World-percent position of a Blobbi's ground-contact point. */
export type GroundPosition = Position;

/**
 * Half the rendered body height, as a percentage of world height.
 *
 * This is the single source of the center↔ground offset: the renderer box is
 * `BLOBBI_RENDER_SIZE_PX[size]` world px tall, the visual rig is scaled by the
 * actor's current depth/seat scale, and the world is 697 design px tall. No
 * component may re-derive `height / 2` on its own.
 */
export function blobbiHalfHeightPercent(size: BlobbiRenderSize, scale: number): number {
  return ((BLOBBI_RENDER_SIZE_PX[size] / 2) * scale * 100) / WORLD_HEIGHT;
}

/**
 * Convert a legacy CENTER point (the pre-migration stored position, still the
 * presence wire format) to a ground point: the visible feet sit half a scaled
 * body below the center.
 */
export function centerToGround(center: Position, size: BlobbiRenderSize, scale: number): GroundPosition {
  return { x: center.x, y: center.y + blobbiHalfHeightPercent(size, scale) };
}

/** Inverse of {@link centerToGround}. */
export function groundToCenter(ground: GroundPosition, size: BlobbiRenderSize, scale: number): Position {
  return { x: ground.x, y: ground.y - blobbiHalfHeightPercent(size, scale) };
}

/**
 * The point another Blobbi's EYES should aim at: the visual body center,
 * derived explicitly from the ground anchor + renderer geometry. Gaze vectors
 * must use this (for both endpoints) instead of raw ground points, so eyes
 * meet bodies rather than feet.
 */
export function actorVisualFocusPoint(
  ground: GroundPosition,
  size: BlobbiRenderSize,
  scale: number,
): Position {
  return groundToCenter(ground, size, scale);
}

// ---------------------------------------------------------------------------
// Isotropic world-design-pixel distance model
// ---------------------------------------------------------------------------
//
// World-percent deltas are anisotropic (1% of x = 10.46 world px, 1% of y =
// 6.97 world px). Every arrival/threshold decision converts percent deltas
// into fixed 1046×697 design pixels first, so the same physical distance
// behaves identically on both axes and never depends on the viewport scale.

/** Percent-space positions → distance in world-design pixels (isotropic). */
export function worldDistancePx(a: Position, b: Position): number {
  const dx = ((b.x - a.x) / 100) * WORLD_WIDTH;
  const dy = ((b.y - a.y) / 100) * WORLD_HEIGHT;
  return Math.hypot(dx, dy);
}

/** One world-percent step expressed in design px per axis. */
export const WORLD_PX_PER_PERCENT_X = WORLD_WIDTH / 100;
export const WORLD_PX_PER_PERCENT_Y = WORLD_HEIGHT / 100;

/**
 * Shared arrival thresholds, in world-design pixels.
 *
 * Chosen to match the previous behavior's magnitude (5 world-percent ≈ 52 px
 * on x / 35 px on y under the old anisotropic metric) while staying below the
 * theater seat half-pitch (48 px), so clicking an adjacent seat walks instead
 * of teleport-snapping.
 */
export const ARRIVAL_THRESHOLD_PX = 40;
export const ARRIVAL_THRESHOLD_TOUCH_PX = 64;

/** Movement-loop snap distance (was 2 *rendered* px; now viewport-independent). */
export const MOVEMENT_SNAP_PX = 2;
