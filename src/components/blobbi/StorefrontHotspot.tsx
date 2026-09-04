import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { LocationId } from '@/lib/location-types';
import {
  STOREFRONT_COMING_SOON_TEXT,
  storefrontAccessibleName,
  type StorefrontHotspotConfig,
} from '@/lib/storefront-hotspots';

/**
 * A pressable storefront over a shop painted into the background.
 *
 * ## A button, not a sprite
 *
 * The Care Store's checkout established the pattern: when the thing to press
 * is painted into the plate, the hotspot is a real `<button>` over it — keyboard
 * reachable, carrying its own accessible name, and already move-blocking via
 * `BLOCK_UI_SELECTOR` so a tap never also starts a raw world walk. It routes
 * through the SAME `requestInteraction` path every door uses: the Blobbi walks
 * to the shop's stand point, and only on arrival does anything happen.
 *
 * ## The feedback has to be legible
 *
 * The mall's facades warm and glow by a few percent on hover, which reads on a
 * bright sprite against a dim wall and does not read on a bay that is already
 * the brightest thing in the frame. So this hotspot says two things plainly:
 *
 * - **"You can press this."** Pointing at or focusing the bay outlines it in
 *   cream and raises the shop's name on a small sign at its threshold.
 * - **"You pressed it."** The press itself pops the sign, the outline goes solid
 *   and gains a soft glow, and both STAY that way for the whole walk — the
 *   pending interaction, not a timer, decides when they clear. On a touch
 *   screen, which never gets `:hover`, that held state is the whole affordance.
 *
 * Nothing moves or rescales the artwork: the ring and the sign are drawn over
 * it, and the only transform is a press-time nudge on the invisible button.
 * The plate stays the picture.
 *
 * ## Open or not
 *
 * `config.destination` decides what arrival does. A location takes the player
 * inside; `null` turns the sign into "Coming soon" for a moment and then lets
 * it fade. Same walk, same feedback, same component — a shop opens by filling
 * in one field.
 */

interface StorefrontHotspotProps {
  config: StorefrontHotspotConfig;
  /** Stacking order in the room. */
  zIndex: number;
  requestInteraction: (opts: RequestInteractionOptions) => void;
  /** Called on arrival at an OPEN shop, with its destination. */
  onEnter: (destination: LocationId) => void;
}

/** How long the "Coming soon" sign stays up after the Blobbi arrives. */
export const STOREFRONT_COMING_SOON_MS = 2600;

type Phase = 'idle' | 'walking' | 'coming-soon';

export function StorefrontHotspot({ config, zIndex, requestInteraction, onEnter }: StorefrontHotspotProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  /*
   * Whether the LAST press was a touch. `requestInteraction` uses it to pick
   * the more forgiving arrival threshold, exactly as `InteractiveElement` does
   * from its `onTouchStart` — here the click arrives after the pointer, so the
   * pointer type is remembered rather than branched on. Both `pointerdown`
   * (with its `pointerType`) and `touchstart` set it: a touch fires both, in
   * that order, and a mouse fires only the first.
   */
  const lastPointerWasTouch = useRef(false);
  const comingSoonTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (comingSoonTimer.current !== null) window.clearTimeout(comingSoonTimer.current);
    },
    [],
  );

  const clearComingSoonTimer = () => {
    if (comingSoonTimer.current !== null) {
      window.clearTimeout(comingSoonTimer.current);
      comingSoonTimer.current = null;
    }
  };

  const press = () => {
    clearComingSoonTimer();
    setPhase('walking');
    requestInteraction({
      target: config.standPoint,
      touch: lastPointerWasTouch.current,
      action: () => {
        if (config.destination) {
          setPhase('idle');
          onEnter(config.destination);
          return;
        }
        setPhase('coming-soon');
        comingSoonTimer.current = window.setTimeout(() => {
          comingSoonTimer.current = null;
          setPhase('idle');
        }, STOREFRONT_COMING_SOON_MS);
      },
      onCancel: () => setPhase('idle'),
    });
  };

  const selected = phase !== 'idle';
  const signText = phase === 'coming-soon' ? STOREFRONT_COMING_SOON_TEXT : config.name;

  return (
    <button
      type="button"
      data-storefront={config.id}
      data-storefront-phase={phase}
      aria-label={storefrontAccessibleName(config)}
      className={cn(
        'group absolute cursor-pointer rounded-2xl ring-2 ring-inset transition-[background-color,box-shadow,transform] duration-200 ease-cozy',
        'focus-visible:outline-none active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100',
        selected
          ? 'bg-island-cream/15 ring-island-cream/90 shadow-[0_0_0_3px_rgba(255,236,190,0.45),0_0_18px_rgba(255,236,190,0.6)]'
          : 'bg-island-cream/0 ring-island-cream/0 hover:bg-island-cream/10 hover:ring-island-cream/70 focus-visible:bg-island-cream/10 focus-visible:ring-island-cream/80',
      )}
      style={{
        left: `${config.box.x}%`,
        top: `${config.box.y}%`,
        width: `${config.box.width}%`,
        height: `${config.box.height}%`,
        zIndex,
      }}
      onPointerDown={(event) => {
        lastPointerWasTouch.current = event.pointerType === 'touch';
      }}
      onTouchStart={() => {
        lastPointerWasTouch.current = true;
      }}
      onClick={press}
    >
      {/*
        The sign. Hidden until the bay is pointed at, focused or pressed; once
        pressed it stays up for the walk. It is `aria-hidden` because the button
        already names the shop and what pressing it does — the sign is the
        visual half of that, not a second announcement.
      */}
      <span
        aria-hidden
        data-storefront-sign
        className={cn(
          'pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-island-wood/25 bg-island-cream/90 px-2.5 py-0.5 text-[0.6875rem] font-bold text-island-ink shadow-cozy-soft',
          'transition-opacity duration-150 motion-reduce:transition-none',
          selected
            ? 'animate-cozy-pop opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
        )}
      >
        {signText}
      </span>
    </button>
  );
}
