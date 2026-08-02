/**
 * The treasure-hunting shack on the Beach's right sand shelf.
 *
 * Placement, flip and the explicit stand point come from
 * `src/lib/beach-shack-config.ts`. Since Phase 1B.1 the shack is a real
 * `<button>` rather than an `InteractiveElement`, for two reasons:
 *
 *  1. **Keyboard.** The generic element is a div with a click handler —
 *     unreachable by keyboard. A button gives focus, Enter/Space activation
 *     and a visible focus ring for free, and keyboard activation routes
 *     through the SAME canonical walk-to-interact call the pointer path uses.
 *  2. **Composable feedback.** The affordance transforms (hover/focus grow,
 *     press compression, arrival hop) live on a dedicated animation layer,
 *     and the horizontal flip on a separate inner layer — two elements, two
 *     transforms, nothing overwrites anything (the trap the generic
 *     element's `hover:scale-110`-on-the-same-node pattern would create).
 *
 * The walk contract is unchanged: a distant click/keypress starts a walk to
 * the authored stand point and the hunt opens only on CONFIRMED ARRIVAL. The
 * hop plays at that arrival moment; with reduced motion the hop is skipped
 * and the hunt opens immediately.
 *
 * The wrapper carries no transform (stacking-context rule), and the hitbox
 * is the wrapper box — mirroring the art changes no geometry.
 */

import { useEffect, useRef, useState } from 'react';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { TREASURE_HUNT_ASSETS } from './treasure-hunt-config';
import {
  treasureShackPlacement,
  treasureShackStandPoint,
} from '@/lib/beach-shack-config';

/** How long the arrival hop plays before the hunt opens. */
const ACTIVATION_HOP_MS = 240;

interface TreasureHuntShackProps {
  requestInteraction: (options: RequestInteractionOptions) => void;
  /** Fired on confirmed arrival at the stand point (after the hop settles). */
  onArrive: () => void;
}

export function TreasureHuntShack({ requestInteraction, onArrive }: TreasureHuntShackProps) {
  const reducedMotion = useReducedMotion();
  const [activated, setActivated] = useState(false);
  const hopTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (hopTimer.current !== null) window.clearTimeout(hopTimer.current);
    },
    []
  );

  const handleActivate = () => {
    requestInteraction({
      target: treasureShackStandPoint,
      action: () => {
        if (reducedMotion) {
          onArrive();
          return;
        }
        // Confirmed arrival: play the short hop, then open the hunt.
        setActivated(true);
        if (hopTimer.current !== null) window.clearTimeout(hopTimer.current);
        hopTimer.current = window.setTimeout(() => {
          hopTimer.current = null;
          setActivated(false);
          onArrive();
        }, ACTIVATION_HOP_MS);
      },
    });
  };

  return (
    <button
      type="button"
      data-treasure-shack
      data-activated={activated || undefined}
      data-block-move
      onClick={handleActivate}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute z-15 block cursor-pointer select-none appearance-none border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-island-ink"
      style={{
        right: `${treasureShackPlacement.rightPercent}%`,
        bottom: `${treasureShackPlacement.bottomPercent}%`,
        width: `${treasureShackPlacement.widthPercent}%`,
      }}
    >
      <span data-treasure-shack-anim>
        <span
          data-shack-flip={treasureShackPlacement.flipX || undefined}
          className="block"
          style={
            treasureShackPlacement.flipX ? { transform: 'scaleX(-1)' } : undefined
          }
        >
          <img
            src={TREASURE_HUNT_ASSETS.shack}
            alt="Treasure Hunt Shack"
            draggable={false}
            className="h-auto w-full object-contain"
          />
        </span>
      </span>
    </button>
  );
}
