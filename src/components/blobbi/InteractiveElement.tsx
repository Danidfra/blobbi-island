import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Position } from '@/lib/types';
import type { RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { constrainPosition, type Boundary } from '@/lib/boundaries';

/**
 * The generic room sprite: an image with a click affordance, an optional hover
 * effect, and optional walk-to-interact.
 *
 * Extracted verbatim from `InteractiveElements.tsx` (apart from the slide-branch
 * fix noted below) so rooms can be split into their own files without importing
 * from the very component that dispatches to them.
 */

/**
 * Compute a walk-to target (world-surface percent) from an interactive
 * element's rect. Uses the element's horizontal center and a point near its
 * base (feet/doorway level) so the Blobbi walks to the floor in front of the
 * object rather than into its visual center. The result is relative to the
 * `[data-world-surface]` container; MovableBlobbi.goTo will clamp it into the
 * movement boundary.
 */
export function computeBaseCenterTarget(el: Element, walkBoundary?: Boundary): Position | null {
  const surface = el.closest('[data-world-surface]') as HTMLElement | null;
  if (!surface) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;

  const centerX = rect.left + rect.width / 2;
  // Aim slightly above the very bottom so the point sits on the floor in front
  // of the object rather than clipped by its lowest pixels.
  const baseY = rect.bottom - rect.height * 0.1;

  const raw: Position = {
    x: ((centerX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((baseY - surfaceRect.top) / surfaceRect.height) * 100,
  };

  /*
   * Clamp into the room's walk boundary when the caller knows it.
   *
   * `MovableBlobbi.goTo` does NOT clamp its target — it clamps each animation
   * STEP instead. So a target above the walkable floor is never reached: every
   * step aims at it, gets pushed back onto the floor's top edge, and the Blobbi
   * slides sideways along that edge until it runs into a wall. The distance to
   * the target never closes, so `usePendingInteraction` never fires and the
   * element appears dead.
   *
   * The arcade's ticket and prize counters are exactly this shape — they are
   * mounted high on the back wall, well above `y = 48`. `TheaterSeat`,
   * `TownBush` and `ArcadeMachine` all clamp for the same reason; this makes the
   * generic element able to as well, without changing any room that does not
   * pass a boundary.
   */
  return walkBoundary ? constrainPosition(raw, walkBoundary) : raw;
}

export interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  animated?: boolean;
  onClick?: (
    event: React.MouseEvent<HTMLDivElement>,
    chairId?: string,
    chairConfig?: InteractiveElementProps['chairConfig'],
  ) => void;
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
   * Legacy chair support for the Nostr Station / shop chairs, which still use
   * the "click walks the Blobbi to a computed seat point" model.
   *
   * Neither the theater nor the arcade uses this: the theater's seats are
   * data-driven `<TheaterSeat>` components with stable ids and a real arrival
   * callback, and the arcade's chairs walk through the shared
   * `requestInteraction` path. Only `seatAnchor` remains here — `sleepOnSeat`
   * and `sitZIndexOffset` were read exclusively by a chair-arrival handler that
   * was never called, so they configured nothing.
   */
  chairConfig?: {
    seatAnchor?: {
      xPercent?: number;
      yPercent?: number;
    };
  };
}

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
    },
    [],
  );

  const finalIsHovered = isHovered !== undefined ? isHovered : isSelfHovered || isTouchActive;

  const handleInteraction = (event: React.MouseEvent<HTMLDivElement>, isTouch = false) => {
    event.stopPropagation();

    if (!onClick) {
      // Visibility-only overlay (no action attached), e.g. the Plaza inside
      // door or the furniture-store door. There is nothing to run, but a tap
      // must still reveal the "open" art so touch devices get feedback
      // equivalent to the desktop hover. Auto-clears so the overlay doesn't
      // stay stuck open.
      if (isTouch && isVisibilityEffect) {
        setIsTouchActive(true);
        if (touchFeedbackTimer.current !== null) {
          window.clearTimeout(touchFeedbackTimer.current);
        }
        touchFeedbackTimer.current = window.setTimeout(() => {
          touchFeedbackTimer.current = null;
          setIsTouchActive(false);
        }, TOUCH_FEEDBACK_MS);
      }
      return;
    }

    // Tap-pop animation is only appropriate for small 'scale' items. Doors and
    // large overlay images ('door'/'opacity'/'slide') must not pop/jump.
    if (animated && effect === 'scale') {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }

    // Chairs keep their existing immediate walk-to-sit behavior.
    if (type === 'chair') {
      const chairId = alt.replace(/\s+/g, '-').toLowerCase();
      onClick(event, chairId, chairConfig);
      return;
    }

    // Walk-to-interact: defer the action until the Blobbi reaches the target.
    if (requestInteraction) {
      const target = walkTarget ?? computeBaseCenterTarget(event.currentTarget, walkBoundary);
      if (target) {
        // Show active/touched feedback immediately (mobile parity with hover).
        setIsTouchActive(true);
        requestInteraction({
          target,
          touch: isTouch,
          action: () => {
            setIsTouchActive(false);
            onClick(event);
          },
          onCancel: () => setIsTouchActive(false),
        });
        return;
      }
    }

    onClick(event);
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
        effect === 'door' && 'opacity-0 hover:opacity-100',
        // Mobile parity: a tap keeps doors visible while the Blobbi walks over.
        // Visibility only — no scale/transform, so large doors don't jump.
        effect === 'door' && isTouchActive && 'opacity-100',
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
          effect === 'opacity' && 'opacity-0 hover:opacity-100 active:opacity-100',
          // Mobile parity: keep "on" overlay visible while walking after a tap.
          effect === 'opacity' && isTouchActive && 'opacity-100',
        )}
      />
    </div>
  );
}
