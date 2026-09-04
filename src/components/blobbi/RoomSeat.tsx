import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { useMovementBlocker } from '@/contexts/MovementBlockerContext';
import { locationBoundaries } from '@/lib/location-boundaries';
import { projectIntoWalkableFloor, resolveElementApproachTarget } from '@/lib/approach-target';
import type { RoomSeatConfig, RoomTableConfig } from '@/lib/room-seats-config';
import { MovementBlocker } from './MovementBlocker';

interface RoomSeatProps {
  config: RoomSeatConfig;
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** The seat the LOCAL player occupies, or null. */
  sittingIn?: string | null;
  /** Fired on CONFIRMED ARRIVAL, never on click. Receives the seat id. */
  onSit?: (seatId: string) => void;
  /** Also fired on confirmed arrival, after `onSit` (a chair that opens something). */
  onArrive?: () => void;
}

/**
 * A chair in an ordinary room (the mall terrace, the arcade basement, the
 * Nostr Station lounge). Mirrors `TheaterSeat`, with the geometry coming from
 * `room-seats-config.ts`:
 *
 *  - the click computes the chair's APPROACH point (its live rect, the
 *    configured fraction, clamped into the room's floor and pushed out of any
 *    footprint) and hands it to the shared walk-to-interact system;
 *  - `onSit(seatId)` fires only on confirmed arrival; the pose controller
 *    then snaps the body to the SEAT anchor;
 *  - the chair's FOOTPRINT is a movement blocker, so a walk elsewhere routes
 *    round the chair instead of through it, while the approach and the seat
 *    anchor both stay reachable.
 *
 * A click while already seated here does nothing: no second walk, no re-fired
 * arrival.
 *
 * A deep bucket seat (`foregroundFrom`) is painted twice while occupied: the
 * whole chair behind the sitter, and the part below the cushion's front seam
 * again in front of it (one z above the seated Blobbi), so the body sinks
 * into the seat. The slice is only mounted while THIS seat is occupied; a
 * standing Blobbi at the chair's front edge stays in front of the pedestal.
 */
export function RoomSeat({ config, requestInteraction, sittingIn, onSit, onArrive }: RoomSeatProps) {
  const blockers = useMovementBlocker({ optional: true });
  const isSittingHere = sittingIn === config.id;
  const boundary = locationBoundaries[config.room];

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
      event.stopPropagation();
      if (isSittingHere) return;

      const resolved = resolveElementApproachTarget({
        element: event.currentTarget,
        fraction: config.approach,
        boundary,
      })?.target;
      if (!resolved) return;
      const target = boundary
        ? projectIntoWalkableFloor(resolved, boundary, blockers?.isPositionBlocked)
        : resolved;

      requestInteraction({
        target,
        touch: isTouch,
        action: () => {
          onSit?.(config.id);
          onArrive?.();
        },
      });
    },
    [isSittingHere, config, boundary, blockers, requestInteraction, onSit, onArrive],
  );

  return (
    <>
      <div
        data-block-move
        data-seat-id={config.id}
        data-seat-occupied={isSittingHere ? 'true' : undefined}
        className={cn(
          'absolute select-none cursor-pointer transition-transform duration-300 ease-out',
          !isSittingHere && 'hover:scale-105',
        )}
        style={{
          left: `${config.leftPercent}%`,
          bottom: `${config.bottomPercent}%`,
          width: `${config.widthPercent}%`,
          zIndex: config.zIndex,
        }}
        onClick={handleClick}
        onTouchStart={(e) => {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent<HTMLDivElement>, true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <img src={config.src} alt={config.alt} draggable={false} className="w-full h-full object-contain" />
      </div>
      {isSittingHere && config.foregroundFrom !== undefined && (
        <img
          src={config.src}
          alt=""
          aria-hidden
          draggable={false}
          data-seat-foreground={config.id}
          className="absolute pointer-events-none select-none"
          style={{
            left: `${config.leftPercent}%`,
            bottom: `${config.bottomPercent}%`,
            width: `${config.widthPercent}%`,
            zIndex: config.seatedZIndex + 1,
            clipPath: `inset(${(config.foregroundFrom * 100).toFixed(2)}% 0 0 0)`,
          }}
        />
      )}
      {config.footprint && (
        <MovementBlocker id={`seat-footprint-${config.id}`} {...config.footprint} />
      )}
    </>
  );
}

/** A table: scenery with a floor footprint the Blobbi walks round. */
export function RoomTable({ config }: { config: RoomTableConfig }) {
  return (
    <>
      <img
        src={config.src}
        alt=""
        aria-hidden
        draggable={false}
        data-table-id={config.id}
        className="absolute pointer-events-none select-none"
        style={{
          left: `${config.leftPercent}%`,
          bottom: `${config.bottomPercent}%`,
          width: `${config.widthPercent}%`,
          zIndex: config.zIndex,
        }}
      />
      <MovementBlocker id={`table-footprint-${config.id}`} {...config.footprint} />
    </>
  );
}
