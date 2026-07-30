import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { locationBoundaries } from '@/lib/location-boundaries';
import { resolveElementApproachTarget } from '@/lib/approach-target';
import {
  THEATER_BACKGROUND_FILE,
  SEAT_APPROACH_TARGET,
  type TheaterSeatConfig,
} from '@/lib/theater-seats-config';

interface TheaterSeatProps {
  config: TheaterSeatConfig;
  /** Shared walk-to-interact system. Unused by decorative chairs. */
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** The seat the LOCAL player currently occupies, or null. Owned by PlayingView. */
  sittingIn: string | null;
  /**
   * A REMOTE player is currently drawn in this seat (their presence claims it
   * and they won it — see `src/lib/theater-occupancy.ts`).
   *
   * Visual only. The seat stays clickable: presence is advisory and
   * self-expiring, so refusing the click would let a player who closed their
   * laptop lock a chair for up to 40 seconds. If two people do end up claiming
   * one seat, the occupancy policy decides who is drawn in it.
   */
  occupiedRemotely?: boolean;
  /** Called on CONFIRMED ARRIVAL, never on click. */
  onSit: (seatId: string) => void;
}

/**
 * TheaterSeat — one armchair in the theater.
 *
 * Behaviour mirrors `TownBush`, the established pattern for "walk somewhere and
 * then something happens":
 *
 *  - Click/tap computes the seat's configured cushion point and hands it to the
 *    shared `requestInteraction`. Nothing else happens yet.
 *  - `onSit(seatId)` fires only on CONFIRMED ARRIVAL. The dead
 *    `_handleChairArrival` path it replaces never fired at all, which is why
 *    `isSeated` was permanently false everywhere in the app.
 *  - Standing up is not this component's job: PlayingView clears the seat the
 *    instant movement starts, so there is no polling, no timer and no distance
 *    guessing here.
 *  - The z-index is fixed forever. Sitting must never reorder the room.
 *
 * A **decorative chair** (`occupiable: false` — the two row-B chairs that hang
 * off the edges of the world) renders as scenery and nothing else: no
 * `data-seat-id`, no cursor, no click or touch handler, and `pointer-events-none`
 * so it cannot even swallow the click that would walk the Blobbi past it. There
 * is no code path by which it can start a walk or become `sittingIn`.
 */
export function TheaterSeat({
  config,
  requestInteraction,
  sittingIn,
  occupiedRemotely = false,
  onSit,
}: TheaterSeatProps) {
  const isSittingHere = sittingIn === config.id;
  // Someone is drawn in this chair — me, or a remote player. Both read the same
  // canonical seat id, so "occupied" means exactly one thing in this room.
  const isOccupied = isSittingHere || occupiedRemotely;
  // Read inside the click handler without making it depend on renders.
  const isSittingHereRef = useRef(isSittingHere);
  isSittingHereRef.current = isSittingHere;

  const onArrive = useCallback(() => {
    onSit(config.id);
  }, [onSit, config.id]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
      event.stopPropagation();

      // Already sitting HERE: no second walk, no re-fired arrival.
      if (isSittingHereRef.current) return;

      // APPROACH target: the floor at the seat's front base — never the
      // cushion (that fraction belongs to the seated POSE, seatAnchorPosition).
      // Reading the live rect keeps the target correct no matter how the world
      // is scaled or letterboxed; `seatApproachPosition()` is the DOM-free
      // config mirror of the same point (tests prove parity).
      const target = resolveElementApproachTarget({
        element: event.currentTarget,
        fraction: SEAT_APPROACH_TARGET,
        boundary: locationBoundaries[THEATER_BACKGROUND_FILE],
      })?.target;
      if (!target) return;

      requestInteraction({
        target,
        touch: isTouch,
        action: onArrive,
        onCancel: () => {
          // Walk abandoned before arrival — nothing fired, nothing to undo.
        },
      });
    },
    [requestInteraction, onArrive],
  );

  const positionStyle: React.CSSProperties = {
    left: `${config.leftPercent}%`,
    bottom: `${config.bottomPercent}%`,
    width: `${config.widthPercent}%`,
    zIndex: config.zIndex,
  };

  if (!config.occupiable) {
    return (
      <div className="absolute select-none pointer-events-none" style={positionStyle} aria-hidden>
        <img src={config.src} alt="" draggable={false} className="w-full h-full object-contain" />
      </div>
    );
  }

  return (
    <div
      data-block-move
      data-seat-id={config.id}
      data-seat-occupied={isOccupied ? 'true' : undefined}
      data-seat-occupied-by={isSittingHere ? 'local' : occupiedRemotely ? 'remote' : undefined}
      className={cn(
        'absolute select-none cursor-pointer transition-transform duration-300 ease-out',
        !isOccupied && 'hover:scale-105',
      )}
      style={positionStyle}
      onClick={handleClick}
      onTouchStart={(e) => {
        e.preventDefault();
        handleClick(e as unknown as React.MouseEvent<HTMLDivElement>, true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <img
        src={config.src}
        alt={config.alt}
        draggable={false}
        className="w-full h-full object-contain"
      />
    </div>
  );
}
