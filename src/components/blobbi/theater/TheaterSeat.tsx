import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';
import {
  THEATER_BACKGROUND_FILE,
  type TheaterSeatConfig,
} from '@/lib/theater-seats-config';

/**
 * Compute the walk-to target for a seat from its rendered rect and configured
 * aim point, clamped into the theater's walk boundary.
 *
 * Reading the live rect (rather than trusting the config maths) keeps the target
 * correct no matter how the world is scaled or letterboxed, exactly as
 * `TownBush` does. The configuration's own `seatAnchorPosition()` is the
 * DOM-free equivalent used for rendering a seated Blobbi.
 */
function computeSeatTarget(
  el: Element,
  interactionTarget: { x: number; y: number },
): Position | null {
  const surface = el.closest('[data-world-surface]') as HTMLElement | null;
  if (!surface) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;

  const aimX = rect.left + rect.width * interactionTarget.x;
  const aimY = rect.top + rect.height * interactionTarget.y;

  const raw: Position = {
    x: ((aimX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((aimY - surfaceRect.top) / surfaceRect.height) * 100,
  };

  const boundary = locationBoundaries[THEATER_BACKGROUND_FILE];
  return boundary ? constrainPosition(raw, boundary) : raw;
}

interface TheaterSeatProps {
  config: TheaterSeatConfig;
  /** Shared walk-to-interact system. Unused by decorative chairs. */
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** The seat the LOCAL player currently occupies, or null. Owned by PlayingView. */
  sittingIn: string | null;
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
export function TheaterSeat({ config, requestInteraction, sittingIn, onSit }: TheaterSeatProps) {
  const isSittingHere = sittingIn === config.id;
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

      const target = computeSeatTarget(event.currentTarget, config.interactionTarget);
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
    [requestInteraction, onArrive, config.interactionTarget],
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
      data-seat-occupied={isSittingHere ? 'true' : undefined}
      className={cn(
        'absolute select-none cursor-pointer transition-transform duration-300 ease-out',
        !isSittingHere && 'hover:scale-105',
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
