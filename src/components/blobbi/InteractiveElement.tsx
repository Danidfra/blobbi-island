import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import type { Boundary } from '@/lib/boundaries';
import {
  ELEMENT_BASE_FRACTION,
  resolveElementApproachTarget,
} from '@/lib/approach-target';

/**
 * The generic room sprite: an image with a click affordance, an optional hover
 * effect, and optional walk-to-interact.
 *
 * Extracted verbatim from `InteractiveElements.tsx` (apart from the slide-branch
 * fix noted below) so rooms can be split into their own files without importing
 * from the very component that dispatches to them.
 *
 * Walk-to targets resolve through the canonical
 * {@link resolveElementApproachTarget} with {@link ELEMENT_BASE_FRACTION}: the
 * element's horizontal center, slightly above its base line, so the feet stop
 * on the floor at the doorway/object base rather than inside its artwork.
 *
 * Why `walkBoundary` matters: `MovableBlobbi.goTo` does NOT clamp its target —
 * it clamps each animation STEP. A target above the walkable floor is never
 * reached (the walk slides along the floor's top edge forever), so
 * `usePendingInteraction` never fires and the element appears dead. The
 * arcade's wall-mounted counters are exactly this shape; rooms that know their
 * boundary pass it so the target is clamped up front.
 */

export interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  animated?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  effect?: 'scale' | 'opacity' | 'door' | 'slide';
  slideDirection?: 'right' | 'left' | 'up' | 'down';
  isHovered?: boolean;
  type?: 'chair' | 'default';
  /**
   * When provided, clicking/tapping this element does NOT fire `onClick`
   * immediately. Instead the element computes a floor target near its base and
   * requests a walk-to-interact; `onClick` only fires once the Blobbi is close
   * enough. Used for doors / navigation / modal-opening items. Chairs and
   * decorative items leave this undefined and keep their existing behavior.
   */
  requestInteraction?: (opts: RequestInteractionOptions) => void;
  /**
   * The room's walk boundary. When given, the computed walk-to target is clamped
   * into it, so an element mounted above walkable ground still resolves to a
   * point the Blobbi can actually reach. See {@link computeBaseCenterTarget}.
   */
  walkBoundary?: Boundary;
  /**
   * An explicit walk-to point (world percent), used instead of deriving one from
   * the element's rect.
   *
   * For an object mounted high on a wall, "the floor in front of its base" is
   * not on the floor at all, and clamping it only moves it onto the walkable
   * area's edge — where a walk can slide sideways forever without converging.
   * Naming the point removes the guesswork. See `arcade-room-config.ts`.
   */
  walkTarget?: Position;
  /**
   * Chair configuration for the Nostr Station / shop chairs: `seatAnchor`
   * names the fraction of the chair rect the FEET stop on (the accepted
   * `{50, 85}` pseudo-sit — the body rests on the cushion while any action
   * runs; these rooms have no real seated state).
   *
   * Chairs route through the SAME walk-to-interact path as doors — the click
   * starts a walk, `onClick` (if any) fires only on confirmed arrival — the
   * only differences being the aim fraction and that a chair walks even with
   * no action attached (walking to a chair IS the interaction).
   */
  chairConfig?: {
    seatAnchor?: {
      xPercent?: number;
      yPercent?: number;
    };
  };
}

/** Default chair pseudo-sit fraction (the accepted `{50, 85}` placement). */
const DEFAULT_CHAIR_SEAT_ANCHOR = { xPercent: 50, yPercent: 85 };

/**
 * How long a tap keeps a visibility-only overlay visible on touch devices.
 * `'door'` / `'opacity'` overlays are driven by `:hover` on desktop, which touch
 * devices never get, so a tap needs to hold the "open"/"on" art briefly instead.
 */
const TOUCH_FEEDBACK_MS = 900;

export function InteractiveElement({
  src,
  alt,
  className,
  animated = true,
  onClick,
  effect = 'scale',
  slideDirection = 'right',
  isHovered,
  type,
  requestInteraction,
  walkBoundary,
  walkTarget,
  chairConfig,
}: InteractiveElementProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isSelfHovered, setIsSelfHovered] = useState(false);
  // Touch-driven "active" feedback so mobile gets a visual cue equivalent to
  // desktop hover while the Blobbi walks toward the target.
  const [isTouchActive, setIsTouchActive] = useState(false);
  const touchFeedbackTimer = useRef<number | null>(null);
  /**
   * The tap-pop timer.
   *
   * Held in a ref and cleared on unmount for the same reason
   * `touchFeedbackTimer` is: tapping a chair and immediately changing room
   * left a 300ms timer running against an unmounted component, which React
   * reports as a state update after teardown. It surfaced as an intermittent
   * post-teardown error in the chairs test, but the leak is real in the game
   * too — every tap on a scale element scheduled a timer nothing owned.
   */
  const popTimer = useRef<number | null>(null);

  /**
   * `'door'` and `'opacity'` are pure *visibility* effects: they cross-fade a
   * closed/off image to an open/on one with no transform and no layout impact,
   * so they are always safe to trigger from a tap.
   */
  const isVisibilityEffect = effect === 'door' || effect === 'opacity';

  useEffect(
    () => () => {
      if (touchFeedbackTimer.current !== null) {
        window.clearTimeout(touchFeedbackTimer.current);
      }
      if (popTimer.current !== null) {
        window.clearTimeout(popTimer.current);
      }
    },
    [],
  );

  const finalIsHovered = isHovered !== undefined ? isHovered : isSelfHovered || isTouchActive;

  const clearTouchFeedbackTimer = () => {
    if (touchFeedbackTimer.current !== null) {
      window.clearTimeout(touchFeedbackTimer.current);
      touchFeedbackTimer.current = null;
    }
  };

  /**
   * Reveal the "open"/"on" art from a tap and let it fade back on its own.
   *
   * Touch devices never get `:hover`, so the tap itself has to drive the
   * reveal. It is armed for *every* tap on a visibility effect — whether or not
   * an action is attached and whether or not a walk was requested — because the
   * feedback is about the tap, not about what the tap goes on to do. When a
   * walk-to-interact IS started below, that walk takes ownership of the reveal
   * (it must stay lit for however long the Blobbi takes) and disarms the timer.
   */
  const showTouchFeedback = () => {
    setIsTouchActive(true);
    clearTouchFeedbackTimer();
    touchFeedbackTimer.current = window.setTimeout(() => {
      touchFeedbackTimer.current = null;
      setIsTouchActive(false);
    }, TOUCH_FEEDBACK_MS);
  };

  const handleInteraction = (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
    event.stopPropagation();

    if (isTouch && isVisibilityEffect) {
      showTouchFeedback();
    }

    const isChair = type === 'chair';

    if (!onClick && !isChair) {
      // Visibility-only overlay (no action attached), e.g. the furniture-store
      // door. There is nothing to run — the tap feedback above is the whole
      // behaviour. Chairs are the exception: walking to a chair IS the
      // interaction, action or not (the shop's pseudo-sit).
      return;
    }

    // Tap-pop animation is only appropriate for small 'scale' items. Doors and
    // large overlay images ('door'/'opacity'/'slide') must not pop/jump.
    if (animated && effect === 'scale') {
      setIsAnimating(true);
      if (popTimer.current !== null) window.clearTimeout(popTimer.current);
      popTimer.current = window.setTimeout(() => {
        popTimer.current = null;
        setIsAnimating(false);
      }, 300);
    }

    // Walk-to-interact: defer the action until the Blobbi reaches the target.
    // Chairs aim at their configured seat-anchor fraction (the pseudo-sit
    // point); everything else aims at the element base.
    if (requestInteraction) {
      const seatAnchor = isChair
        ? { ...DEFAULT_CHAIR_SEAT_ANCHOR, ...chairConfig?.seatAnchor }
        : null;
      const fraction = seatAnchor
        ? { x: seatAnchor.xPercent / 100, y: seatAnchor.yPercent / 100 }
        : ELEMENT_BASE_FRACTION;
      const target =
        walkTarget ??
        resolveElementApproachTarget({
          element: event.currentTarget,
          fraction,
          boundary: walkBoundary,
        })?.target;
      if (target) {
        // Show active/touched feedback immediately (mobile parity with hover)
        // and hold it for the whole walk: the pending interaction, not a timer,
        // decides when the door closes again.
        clearTouchFeedbackTimer();
        setIsTouchActive(true);
        requestInteraction({
          target,
          touch: isTouch,
          action: () => {
            setIsTouchActive(false);
            onClick?.(event);
          },
          onCancel: () => setIsTouchActive(false),
        });
        return;
      }
    }

    onClick?.(event);
  };

  const getSlideTransform = () => {
    if (!finalIsHovered) return 'translate(0, 0)';
    switch (slideDirection) {
      case 'right':
        return 'translateX(100%)';
      case 'left':
        return 'translateX(-100%)';
      case 'up':
        return 'translateY(-100%)';
      case 'down':
        return 'translateY(100%)';
      default:
        return 'translate(0, 0)';
    }
  };

  if (effect === 'slide') {
    /*
     * The slide branch used to skip the room's interaction contract entirely:
     * no `data-block-move`, no `onTouchStart`, no `onPointerDown`
     * stop-propagation. `MovableBlobbi.shouldTriggerWorldMove` only skips
     * elements matching `[data-block-move]` et al., so clicking a sliding
     * element ALSO started a raw world walk to the raw click point, which then
     * raced the `requestInteraction` walk.
     *
     * The contract is applied here only when the element has an action, so
     * purely decorative sliding art (the theater's little stage door) keeps its
     * existing click-through-to-the-floor behaviour rather than becoming a dead
     * patch of world.
     */
    const isActionable = Boolean(onClick);
    return (
      <div
        className={cn('cursor-pointer select-none', className)}
        {...(isActionable ? { 'data-block-move': true } : {})}
        onMouseEnter={() => setIsSelfHovered(true)}
        onMouseLeave={() => setIsSelfHovered(false)}
        onClick={handleInteraction}
        {...(isActionable
          ? {
              onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => {
                e.preventDefault();
                handleInteraction(e as unknown as React.MouseEvent<HTMLDivElement>, true);
              },
              onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => e.stopPropagation(),
            }
          : {})}
      >
        <div
          className="transition-transform duration-300 ease-in-out"
          style={{ transform: getSlideTransform() }}
        >
          <img src={src} alt={alt} className="w-full h-full object-contain" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'cursor-pointer select-none',
        effect === 'scale' && animated && 'transition-all duration-300 ease-out hover:scale-110',
        /*
         * Mobile parity: a tap keeps the door visible while the Blobbi walks
         * over. Visibility only — no scale/transform, so large doors don't jump.
         *
         * The two states are composed as alternatives rather than stacked, so
         * `opacity-0` and `opacity-100` are never emitted together: which of two
         * conflicting utilities wins would otherwise be left to class ordering
         * (and to `twMerge` still recognising the pair).
         */
        effect === 'door' && (isTouchActive ? 'opacity-100' : 'opacity-0 hover:opacity-100'),
        isAnimating && effect === 'scale' && 'animate-tap',
        className,
      )}
      data-block-move
      onClick={handleInteraction}
      onMouseEnter={() => setIsSelfHovered(true)}
      onMouseLeave={() => setIsSelfHovered(false)}
      onTouchStart={(e) => {
        e.preventDefault(); // evita click extra depois do touch
        handleInteraction(e as unknown as React.MouseEvent<HTMLDivElement>, true);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      {...(type === 'chair' && {
        'data-chair-id': alt.replace(/\s+/g, '-').toLowerCase(),
        'data-chair-config': JSON.stringify(chairConfig || {}),
      })}
    >
      <img
        src={src}
        alt={alt}
        /*
         * Sizing contract: `h-full` is intentional and load-bearing — elements
         * sized by HEIGHT (town streetlights `h-[35%]`) or into a fixed square
         * box (mine cave / beach boat `size-*`) depend on it, and `object-contain`
         * keeps them undistorted.
         *
         * Consequence for OVERLAYS: if the wrapper is given a definite height
         * (`h-full`, `inset-0`, ...) while its sibling base image has a different
         * intrinsic aspect ratio, `object-contain` letterboxes this image and it
         * silently renders at the wrong scale/offset. Overlays must therefore be
         * positioned with offsets + a WIDTH only, leaving height automatic.
         */
        className={cn(
          'w-full h-full object-contain',
          // Same alternative-composition rule as the wrapper above: keep the
          // "on" overlay visible while walking after a tap, without ever
          // emitting both opacity utilities at once.
          effect === 'opacity' &&
            (isTouchActive ? 'opacity-100' : 'opacity-0 hover:opacity-100 active:opacity-100'),
        )}
      />
    </div>
  );
}
