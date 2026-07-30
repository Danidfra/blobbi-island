/**
 * Shared world-rendering maths for Blobbi sprites.
 *
 * `MovableBlobbi` (the local player) and `MultiplayerLayer` (remote players)
 * each used to carry their own private copy of the dynamic-scale and
 * dynamic-z-index calculations — ~50 identical lines, twice. Any change made in
 * one and forgotten in the other shows up as the local player rendering
 * differently from how everyone else sees them, which is the one class of bug a
 * shared watch room cannot tolerate. This module is the single implementation
 * both call.
 *
 * It also owns {@link resolveSeatedRender}: the complete visual consequence of
 * "this Blobbi is sitting in this seat", so local and remote seated rendering
 * cannot drift apart when multiplayer seating lands.
 */

import type { Boundary } from '@/lib/boundaries';
import type { Position } from '@/lib/types';
import { calculateBlobbiZIndex } from '@/lib/interactive-elements-config';
import { locationScalingConfig } from '@/lib/location-scaling-config';
import {
  getTheaterSeat,
  seatAnchorPosition,
  type TheaterSeatConfig,
} from '@/lib/theater-seats-config';

/**
 * Vertical extent of a boundary, used to map a y-position onto a room's
 * perspective-scaling ramp.
 */
function boundaryYRange(boundary: Boundary | undefined): { minY: number; maxY: number } {
  if (boundary?.shape === 'rectangle') {
    return { minY: boundary.y[0], maxY: boundary.y[1] };
  }
  if (boundary?.shape === 'semicircle' || boundary?.shape === 'arch') {
    return { minY: boundary.top, maxY: boundary.bottom };
  }
  if (boundary?.shape === 'composite') {
    const minY = Math.min(
      ...boundary.areas.map((area) => {
        if (area.type === 'rectangle') return area.y[0];
        if (area.type === 'circle') return area.cy - area.r;
        if (area.type === 'triangle') return Math.min(...area.points.map((p) => p.y));
        return 100;
      }),
    );
    const maxY = Math.max(
      ...boundary.areas.map((area) => {
        if (area.type === 'rectangle') return area.y[1];
        if (area.type === 'circle') return area.cy + area.r;
        if (area.type === 'triangle') return Math.max(...area.points.map((p) => p.y));
        return 0;
      }),
    );
    return { minY, maxY };
  }
  return { minY: 0, maxY: 100 };
}

/**
 * Perspective scale for a Blobbi standing at `position`.
 *
 * Returns 1 for rooms without a `locationScalingConfig` entry — including the
 * theater, deliberately: the three seat rows are discrete, and a continuous
 * y-ramp would make a Blobbi grow and shrink as it walked the centre aisle.
 * Seated depth comes from the per-seat {@link resolveSeatedRender} scale instead.
 */
export function resolveBlobbiScale(
  position: Position,
  backgroundFile: string | undefined,
  boundary: Boundary | undefined,
): number {
  const scalingConfig = backgroundFile ? locationScalingConfig[backgroundFile] : undefined;
  if (!scalingConfig) return 1;

  const { initialScale, finalScale } = scalingConfig;
  const { minY, maxY } = boundaryYRange(boundary);

  const clampedY = Math.max(minY, Math.min(maxY, position.y));
  const factor = maxY - minY > 0 ? (clampedY - minY) / (maxY - minY) : 0;

  return finalScale + (initialScale - finalScale) * factor;
}

/**
 * Stacking order for a Blobbi at `position`, plus an optional offset applied
 * when it is attached to furniture (a chair raises it above the seat back).
 */
export function resolveBlobbiZIndex(
  position: Position,
  backgroundFile: string | undefined,
  offset = 0,
): number {
  if (!backgroundFile) return 20;
  return calculateBlobbiZIndex(position.y, backgroundFile) + offset;
}

/** Everything that changes visually about a Blobbi because it is seated. */
export interface SeatedRender {
  seat: TheaterSeatConfig;
  /** World-percent POSE anchor the Blobbi is pinned to (body bottom = cushion). */
  position: Position;
  /** Which way it is turned — theater seats all face the screen. */
  facing: 'front' | 'back';
  /** Multiplier for the sprite wrapper ONLY (never the anchor). */
  scale: number;
  /**
   * Stacking order while seated: just behind the OWN chair's backrest and in
   * front of every farther row. Derived from the seat row rather than the
   * standing y-bands — the bands map GROUND y for standing actors, and a
   * seated pose y would land in the wrong band (the sitter's head would hide
   * behind the next row's chairs).
   */
  zIndex: number;
  /** A Blobbi in a chair is not standing on the floor. */
  hideShadow: true;
  /** A bobbing seated Blobbi fights the chair it is sitting in. */
  disableFloat: true;
}

/**
 * Resolve the seated presentation for a seat id, or null when not seated.
 *
 * Unknown and decorative-chair ids resolve to null so a stale or hostile id can
 * never pin a Blobbi to an off-world chair.
 *
 * Callers must multiply {@link SeatedRender.scale} into the sprite's INNER
 * wrapper transform only. The outer positioned element is the chat-bubble portal
 * anchor and the logical world position — scaling it would move every bubble.
 */
export function resolveSeatedRender(seatId: string | null | undefined): SeatedRender | null {
  const seat = getTheaterSeat(seatId);
  if (!seat || !seat.occupiable) return null;

  return {
    seat,
    position: seatAnchorPosition(seat),
    facing: seat.facing,
    scale: seat.seatedScale,
    // Behind the own chair's backrest (chair z − 5), in front of farther rows;
    // floor of 9 keeps every sitter within the Blobbi z range.
    zIndex: Math.max(seat.zIndex - 5, 9),
    hideShadow: true,
    disableFloat: true,
  };
}
