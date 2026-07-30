import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { constrainPosition } from '@/lib/boundaries';
import {
  ARCADE_FLOORS,
  arcadeMachineGroundOffsetPercent,
  machineHeightPercent,
  machineLeftPercent,
  type ArcadeMachineConfig,
} from '@/lib/arcade-machines-config';
import { locationBoundaries } from '@/lib/location-boundaries';

/**
 * ArcadeMachine — one machine in the arcade, and the walk-to-interact contract
 * every one of them now shares.
 *
 * Sibling of `TheaterSeat` and `TownBush`, following the pattern those two
 * established:
 *
 * ```
 *   click / tap
 *     → compute the target from the LIVE rect of the real world surface
 *     → requestInteraction(...)          (shared movement system)
 *     → …the Blobbi walks…
 *     → onActivate(machineId)            ON CONFIRMED ARRIVAL, never on click
 * ```
 *
 * ## Why the target comes from the rect and not from the config
 *
 * `machineAnchorPosition()` computes the same point from configuration alone,
 * and the config test uses it to prove every anchor lands on walkable floor. At
 * runtime the rect is authoritative instead, because it is correct no matter how
 * the world is scaled or letterboxed — the same reasoning `TownBush` uses.
 *
 * ## Why nothing opens on click
 *
 * Because "clicking a pool table opens a dance game" was the audit's headline
 * finding, and the shape of that bug was a click handler with a modal on the end
 * of it. Here the click starts a walk and returns; the only path to opening
 * anything runs through the movement system's arrival callback.
 *
 * ## Movement contract
 *
 * `data-block-move` plus `onPointerDown`/`onTouchStart` stop-propagation, so a
 * tap on a machine never ALSO starts a raw world walk to the raw click point
 * (which would then race the pending interaction). This is the contract the
 * elevator's slide branch was missing.
 */

/**
 * Resolve the walk-to point for a machine from its rendered rect, clamped into
 * the floor's walk boundary.
 *
 * The clamp matters: a cabinet's base can sit above walkable ground on floors
 * whose boundary is a composite of rectangles and triangles, and an unreachable
 * target means a machine that never opens.
 */
function computeMachineTarget(el: Element, config: ArcadeMachineConfig): Position | null {
  const surface = el.closest('[data-world-surface]') as HTMLElement | null;
  if (!surface) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;

  const aimX = rect.left + rect.width * config.interactionAnchor.x;
  const aimY = rect.top + rect.height * config.interactionAnchor.y;

  const fractionY = ((aimY - surfaceRect.top) / surfaceRect.height) * 100;
  const raw: Position = {
    x: ((aimX - surfaceRect.left) / surfaceRect.width) * 100,
    // GROUND semantics (Phase 2 hardening): the anchor fraction was authored
    // for the body CENTER; the feet stop half a depth-scaled body lower — on
    // the open floor in FRONT of the machine, not inside its artwork. Shared
    // with the DOM-free machineAnchorPosition, applied exactly once, here.
    y: fractionY + arcadeMachineGroundOffsetPercent(config.floor, fractionY),
  };

  const boundary = locationBoundaries[ARCADE_FLOORS[config.floor]];
  return boundary ? constrainPosition(raw, boundary) : raw;
}

interface ArcadeMachineProps {
  config: ArcadeMachineConfig;
  /** Shared walk-to-interact system. */
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /**
   * Fired on CONFIRMED ARRIVAL with the machine's stable id.
   *
   * The id — not a component, not a modal, not a piece of copy — is the whole
   * payload, so what a machine DOES can change without touching where it sits.
   */
  onActivate: (machineId: string) => void;
}

export function ArcadeMachine({ config, requestInteraction, onActivate }: ArcadeMachineProps) {
  const onArrive = useCallback(() => {
    onActivate(config.id);
  }, [onActivate, config.id]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
      event.stopPropagation();

      const target = computeMachineTarget(event.currentTarget, config);
      if (!target) return;

      requestInteraction({
        target,
        touch: isTouch,
        action: onArrive,
        // Walk abandoned — the player tapped elsewhere or chose another machine.
        // Nothing opened, so there is nothing to undo.
        onCancel: () => {},
      });
    },
    [requestInteraction, onArrive, config],
  );

  const style: React.CSSProperties = {
    left: `${machineLeftPercent(config)}%`,
    bottom: `${config.bottomPercent}%`,
    width: `${config.widthPercent}%`,
    // Height is stated rather than left to `object-contain`, so the rect the
    // interaction anchor is measured against is the artwork's real box.
    height: `${machineHeightPercent(config)}%`,
    zIndex: config.zIndex,
  };

  return (
    <div
      data-block-move
      data-arcade-machine-id={config.id}
      role="button"
      tabIndex={0}
      aria-label={config.alt}
      className={cn(
        'absolute select-none cursor-pointer',
        'transition-transform duration-300 ease-out hover:scale-105',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
      )}
      style={style}
      onClick={handleClick}
      onKeyDown={(event) => {
        // Keyboard activation walks the Blobbi over exactly as a click does; the
        // arrival contract is identical, so a keyboard user cannot skip the walk.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick(event as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
      onTouchStart={(event) => {
        event.preventDefault();
        handleClick(event as unknown as React.MouseEvent<HTMLDivElement>, true);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <img
        src={config.src}
        alt=""
        aria-hidden
        draggable={false}
        className="w-full h-full object-contain pointer-events-none"
      />
    </div>
  );
}
