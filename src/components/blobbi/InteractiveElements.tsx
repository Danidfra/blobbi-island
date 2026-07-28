import { FoodShopModal } from './FoodShopModal';
import { PhotoBoothModal } from './PhotoBoothModal';
import { ShareModal } from './ShareModal';
import { NostrHubModal } from '@/components/NostrHubModal';
import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { MovableBlobbiRef } from './MovableBlobbi';
import { MovementBlocker } from './MovementBlocker';
import type { Blobbi } from '@/hooks/useBlobbis';
import { ArcadePassModal } from './ArcadePassModal';
import { ElevatorModal } from './ElevatorModal';
import { NoPassModal } from './NoPassModal';
import { GameModal } from './GameModal';
import { Button } from '@/components/ui/button';
import { Position } from '@/lib/types';
import { usePendingInteraction, type RequestInteractionOptions } from '@/hooks/usePendingInteraction';
import { TownBush } from './TownBush';
import { townBushes } from '@/lib/town-bushes-config';
import { TheaterSeat } from './theater/TheaterSeat';
import { TheaterStage } from './theater/TheaterStage';
import { theaterSeats } from '@/lib/theater-seats-config';
import {
  STREETLIGHT_SRC,
  streetlightBaseBlocker,
  townStreetlights,
} from '@/lib/town-streetlights-config';

/**
 * Compute a walk-to target (world-surface percent) from an interactive
 * element's rect. Uses the element's horizontal center and a point near its
 * base (feet/doorway level) so the Blobbi walks to the floor in front of the
 * object rather than into its visual center. The result is relative to the
 * `[data-world-surface]` container; MovableBlobbi.goTo will clamp it into the
 * movement boundary.
 */
function computeBaseCenterTarget(el: Element): Position | null {
  const surface = el.closest('[data-world-surface]') as HTMLElement | null;
  if (!surface) return null;
  const surfaceRect = surface.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (surfaceRect.width === 0 || surfaceRect.height === 0) return null;

  const centerX = rect.left + rect.width / 2;
  // Aim slightly above the very bottom so the point sits on the floor in front
  // of the object rather than clipped by its lowest pixels.
  const baseY = rect.bottom - rect.height * 0.1;

  return {
    x: ((centerX - surfaceRect.left) / surfaceRect.width) * 100,
    y: ((baseY - surfaceRect.top) / surfaceRect.height) * 100,
  };
}

// BackArrow component using SVG
function BackArrow({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <div
      className={cn(
        'cursor-pointer select-none transition-all duration-300 ease-out hover:scale-110 active:scale-95',
        className
      )}
      data-block-move
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <path
          d="M19 12H5M5 12L12 19M5 12L12 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

interface InteractiveElementProps {
  src: string;
  alt: string;
  className?: string;
  animated?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>, chairId?: string, chairConfig?: InteractiveElementProps['chairConfig']) => void;
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
   * Legacy chair support for the arcade / Nostr Station / shop chairs, which
   * still use the "click walks the Blobbi to a computed seat point" model.
   *
   * The theater does NOT use this: its seats are data-driven `<TheaterSeat>`
   * components with stable ids and a real arrival callback. Only `seatAnchor`
   * remains here — `sleepOnSeat` and `sitZIndexOffset` were read exclusively by
   * a chair-arrival handler that was never called, so they configured nothing.
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

function InteractiveElement({
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
  chairConfig
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

  const finalIsHovered = isHovered !== undefined ? isHovered : (isSelfHovered || isTouchActive);

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
      const target = computeBaseCenterTarget(event.currentTarget);
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
    return (
      <div
        className={cn('cursor-pointer select-none', className)}
        onMouseEnter={() => setIsSelfHovered(true)}
        onMouseLeave={() => setIsSelfHovered(false)}
        onClick={handleInteraction}
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
        className
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
        'data-chair-config': JSON.stringify(chairConfig || {})
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
          effect === 'opacity' && isTouchActive && 'opacity-100'
        )}
      />
    </div>
  );
}

interface InteractiveElementsProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  selectedBlobbi: Blobbi | null;
  /**
   * Id of the theater seat the local player currently occupies, or null. Owned
   * by PlayingView, exactly like {@link hiddenIn}, so the movement, rendering
   * and (later) presence layers all read one source of truth.
   */
  sittingIn?: string | null;
  /**
   * Theater seats that currently LOOK occupied — remote players' winning
   * presence claims plus {@link sittingIn}. Visual only: a seat listed here is
   * still clickable, because presence reserves nothing (see
   * `src/lib/theater-occupancy.ts`).
   */
  occupiedSeats?: ReadonlySet<string>;
  /** Called when the local player ARRIVES at and sits in a theater seat. */
  onSitInSeat?: (seatId: string) => void;
  /**
   * Reports the address of the shared watch session the local player is in, or
   * null. Threaded straight through to `PlayingView`, which owns it and hands it
   * to presence — this component never interprets it.
   */
  onActivityChange?: (sessionAddress: string | null) => void;
  /** Visible players presence says are in that session, including this one. */
  sessionParticipants?: number;
  /**
   * Id of the hiding spot the local player currently occupies (e.g. a Town bush
   * id), or null when not hidden. Owned by PlayingView so the movement,
   * rendering and presence layers all read one source of truth.
   */
  hiddenIn?: string | null;
  /** Called when the local player arrives at and hides inside a hiding spot. */
  onHideInSpot?: (hidingSpotId: string) => void;
}

const noopHide = () => {};
const noopSit = () => {};
const NO_OCCUPIED_SEATS: ReadonlySet<string> = new Set();

export function InteractiveElements({ blobbiRef, selectedBlobbi, sittingIn = null, occupiedSeats = NO_OCCUPIED_SEATS, onSitInSeat, onActivityChange, sessionParticipants = 1, hiddenIn = null, onHideInSpot }: InteractiveElementsProps) {
  const { currentLocation, setIsMapModalOpen, setCurrentLocation } = useLocation();
  const backgroundFile = getBackgroundForLocation(currentLocation);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isArcadePassModalOpen, setIsArcadePassModalOpen] = useState(false);
  const [isElevatorModalOpen, setIsElevatorModalOpen] = useState(false);
  const [isNoPassModalOpen, setIsNoPassModalOpen] = useState(false);
  const [isGameModalOpen, setIsGameModalOpen] = useState(false);
  const [gameModalContent, setGameModalContent] = useState<{ title: string; content: React.ReactNode } | null>(null);
  const [isFoodShopModalOpen, setIsFoodShopModalOpen] = useState(false);
  const [isPhotoBoothModalOpen, setIsPhotoBoothModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalData, setShareModalData] = useState<{ capturedPhoto: string; capturedPolaroidSrc: string | null }>({ capturedPhoto: '', capturedPolaroidSrc: null });
  const [isNostrHubModalOpen, setIsNostrHubModalOpen] = useState(false);

  // Walk-to-interact model for doors / navigation / modal-opening items.
  // Reuses the existing movement system (blobbiRef.goTo) and fires the action
  // only once the Blobbi reaches the target. Cancelled when the location or the
  // selected Blobbi changes (cancelDeps), on unmount, and when the user clicks
  // a different world point (handled by the world-surface listener below).
  const { requestInteraction, cancel: cancelPendingInteraction, hasPending } =
    usePendingInteraction({
      blobbiRef,
      cancelKey: `${currentLocation}:${selectedBlobbi?.id ?? ''}`,
    });

  // Cancel a pending interaction when the user clicks/taps a *different* world
  // point. Interactive elements carry data-block-move and stopPropagation, so a
  // world-surface pointerdown that reaches here means the player tapped empty
  // ground (or chose another destination) — abandon the pending interaction.
  //
  // We resolve the single [data-world-surface] element directly (the local
  // containerRef is only attached in some location branches, so relying on it
  // would silently disable cancellation in most rooms). The listener is bound
  // in the capture phase so it runs even though MovableBlobbi also listens on
  // the same surface, and regardless of interactive elements' stopPropagation.
  useEffect(() => {
    const surface = document.querySelector('[data-world-surface]') as HTMLElement | null;
    if (!surface) return;

    const onWorldPointerDown = (ev: Event) => {
      if (!hasPending()) return;
      const targetEl = ev.target as Element | null;
      // Ignore clicks that originate on UI / interactive elements; those manage
      // their own pending lifecycle (and remote Blobbi clicks must not cancel).
      if (targetEl?.closest('[data-block-move]')) return;
      cancelPendingInteraction();
    };

    surface.addEventListener('pointerdown', onWorldPointerDown, { capture: true });
    surface.addEventListener('touchstart', onWorldPointerDown, { capture: true });
    return () => {
      surface.removeEventListener('pointerdown', onWorldPointerDown, { capture: true });
      surface.removeEventListener('touchstart', onWorldPointerDown, { capture: true });
    };
  }, [cancelPendingInteraction, hasPending, currentLocation]);


  /**
   * Legacy chair behaviour for the arcade / Nostr Station / shop: walk the
   * Blobbi to a point derived from the chair's rect. There is no arrival
   * callback and no seated state — those rooms have never had one. The theater
   * uses <TheaterSeat> instead.
   */
  const handleChairClick = (event: React.MouseEvent<HTMLDivElement>, _chairId: string, chairConfig?: InteractiveElementProps['chairConfig']) => {

    if (!blobbiRef.current) return;

    const chairElement = event.currentTarget;
    const container = chairElement.closest('.w-full.h-full.relative');

    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const chairRect = chairElement.getBoundingClientRect();

    // Get seat anchor configuration with defaults
    const seatAnchor = chairConfig?.seatAnchor || { xPercent: 50, yPercent: 20 };

    // Calculate seat position from chair rect and anchor percentages
    const seatX = chairRect.left + (chairRect.width * seatAnchor.xPercent!) / 100;
    const seatY = chairRect.top + (chairRect.height * seatAnchor.yPercent!) / 100;

    // Convert to percentage relative to container
    const targetX = ((seatX - containerRect.left) / containerRect.width) * 100;
    const targetY = ((seatY - containerRect.top) / containerRect.height) * 100;

    // Move Blobbi to the seat position
    blobbiRef.current.goTo({ x: targetX, y: targetY });

        // Special handling for Nostr Station chairs - open Nostr Hub modal
    if (backgroundFile === 'nostr-station-inside.png') {
      setIsNostrHubModalOpen(true);
      return;
    }
  };

  const handleElementClick = (elementName: string) => {
    console.log(`Interactive element clicked: ${elementName} (location: ${currentLocation})`);
    // TODO: Add navigation or action logic here
    // This could trigger navigation to specific sub-locations,
    // open mini-games, or show specific UI components
    if (elementName === 'dance-machine') {
      setGameModalContent({
        title: 'Dance Dance Blobbi',
        content: (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-lg mb-4">Get ready to dance!</p>
            <Button>Start Game</Button>
          </div>
        ),
      });
      setIsGameModalOpen(true);
    }
  };

  const handleTicketPurchase = () => {
    setIsArcadePassModalOpen(true);
  };

  const handleElevatorClick = () => {
    const hasPass = sessionStorage.getItem('has-arcade-pass') === 'true';
    if (hasPass) {
      setIsElevatorModalOpen(true);
    } else {
      setIsNoPassModalOpen(true);
    }
  };

  // Town elements (when background is town-open.webp)
  if (backgroundFile === 'home-inside.png') {
    return (
      <>
      <InteractiveElement
            src="/assets/locations/home/door-front.png"
            alt="Arcade Door"
            animated={false}
            onClick={() => setIsMapModalOpen(true)}
            requestInteraction={requestInteraction}
            effect="door"
            className="absolute bottom-[22.5%] left-[16.3%]  w-[18.8%] z-15"
      />
      <InteractiveElement
            src="/assets/locations/home/door-back.png"
            alt="back-yard-door"
            animated={false}
            onClick={() => setCurrentLocation('back-yard')}
            requestInteraction={requestInteraction}
            effect="door"
            className="absolute bottom-[22.8%] right-[16.5%]  w-[18%] z-15"
      />
      </>)
  }

  if (backgroundFile === 'back-yard-open.png') {
    return (
      <InteractiveElement
        src="/assets/locations/back-yard/door.png"
        alt="Go back to home"
        animated={false}
        onClick={() => setCurrentLocation('home')}
        requestInteraction={requestInteraction}
        effect="door"
        className="absolute bottom-[22.8%] right-[16.5%] w-[18%] z-15"
      />
    );
  }

  if (backgroundFile === 'arcade-inside.png' || backgroundFile === 'arcade-1.png' || backgroundFile === 'arcade-minus1.png') {
    return (
      <>
        <div ref={containerRef} className="w-full h-full relative">
          {/* Elevator */}
          <div
            className={cn(
              'absolute flex left-1/2 -translate-x-1/2 overflow-hidden z-10',
              backgroundFile === 'arcade-inside.png' && 'top-[16%] w-[17.5%] ',
              backgroundFile === 'arcade-1.png' && 'top-[40.5%] w-[10%] ',
              backgroundFile === 'arcade-minus1.png' && 'top-[41.4%] w-[7.8%] ',
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <InteractiveElement
              src="/assets/locations/arcade/level-b1/elevator-door.png"
              alt="Elevator Door Left"
              effect="slide"
              slideDirection="right"
              className="scale-x-[-1]"
              onClick={handleElevatorClick}
              requestInteraction={requestInteraction}
              isHovered={isHovered}
            />
            <InteractiveElement
              src="/assets/locations/arcade/level-b1/elevator-door.png"
              alt="Elevator Door Right"
              effect="slide"
              slideDirection="right"
              onClick={handleElevatorClick}
              requestInteraction={requestInteraction}
              isHovered={isHovered}
            />
          </div>

          {/* Floor -1 */}
          {backgroundFile === 'arcade-minus1.png' && (
            <>
                <InteractiveElement
                  src="/assets/locations/arcade/level-b1/dance-machine.png"
                  alt="Dance Machine"
                  effect='scale'
                  className='absolute right-[18%] bottom-[36%]'
                  onClick={() => handleElementClick('dance-machine')}
                />

            {/* Wall decorations */}
             <>
              {/* Left */}
                <img src='/assets/locations/arcade/level-b1/yellow-guitar-neon.png' alt="ticket counter" className="absolute top-[34%] left-[15%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/pink-headset-neon.png' alt="ticket counter" className="absolute top-[27%] left-[10%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/yellow-mic-neon.png' alt="ticket counter" className="absolute top-[27%] left-[2%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/blue-mic-neon.png' alt="ticket counter" className="absolute top-[40%] left-[10%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/song-neon.png' alt="ticket counter" className="absolute top-[48%] left-[2%] w-[4%]" />

              {/* Middle */}
                <img src='/assets/locations/arcade/level-b1/blue-notes-neon.png' alt="ticket counter" className="absolute top-[32%] left-[28%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/cd-neon.png' alt="ticket counter" className="absolute top-[27%] left-[40%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/blue-wire-mic-neon.png' alt="ticket counter" className="absolute top-[27%] right-[30%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/yellow-note-up-neon.png' alt="ticket counter" className="absolute top-[27%] right-[40%] w-[4%]" />

              {/* Right */}
                <img src='/assets/locations/arcade/level-b1/notes-neon.png' alt="ticket counter" className="absolute top-[34%] right-[17%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/pink-note-neon.png' alt="ticket counter" className="absolute top-[27%] right-[10%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/yellow-headset-neon.png' alt="ticket counter" className="absolute top-[27%] right-[2%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/purple-note-neon.png' alt="ticket counter" className="absolute top-[40%] right-[10%] w-[4%]" />
                <img src='/assets/locations/arcade/level-b1/blue-note-neon.png' alt="ticket counter" className="absolute top-[48%] right-[2%] w-[4%]" />

              <img src='/assets/locations/arcade/level-b1/wall-art-pac-blobbi.png' alt="ticket counter" className="absolute top-[42%] left-[34%] w-[5%]" />
              <img src='/assets/locations/arcade/level-b1/wall-art-blobbi-kong.png' alt="ticket counter" className="absolute top-[42%] right-[34%] w-[5%]" />
             </>

            <div className='flex absolute bottom-[25%] left-[24%] w-[16.5%] gap-[40%]'>
              <InteractiveElement
                src="/assets/locations/arcade/level-b1/left-chair.png"
                alt="Left Chair"
                type="chair"
                chairConfig={{
                  seatAnchor: { xPercent: 50, yPercent: 20 }
                }}
                onClick={handleChairClick}
                effect='scale'
                className='left-[18%] bottom-[36%] w-[40%] z-[25]'
              />
              <InteractiveElement
                src="/assets/locations/arcade/level-b1/right-chair.png"
                alt="Right Chair"
                type="chair"
                chairConfig={{
                  seatAnchor: { xPercent: 50, yPercent: 20 }
                }}
                onClick={handleChairClick}
                effect='scale'
                className='left-[30%] bottom-[36%] w-[40%] z-[25]'
              />
              <img src='/assets/locations/arcade/level-b1/table.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[44%] z-[27]" />
            </div>
            <div className='flex absolute bottom-[25%] right-[24%] w-[16.5%] gap-[40%]'>
              <InteractiveElement
                src="/assets/locations/arcade/level-b1/left-chair.png"
                alt="Left Chair"
                type="chair"
                chairConfig={{
                  seatAnchor: { xPercent: 50, yPercent: 20 }
                }}
                onClick={handleChairClick}
                effect='scale'
                className='left-[18%] bottom-[36%] w-[40%] z-[25]'
              />
              <InteractiveElement
                src="/assets/locations/arcade/level-b1/right-chair.png"
                alt="Right Chair"
                type="chair"
                chairConfig={{
                  seatAnchor: { xPercent: 50, yPercent: 20 }
                }}
                onClick={handleChairClick}
                effect='scale'
                className='left-[30%] bottom-[36%] w-[40%] z-[25]'
              />
              <img src='/assets/locations/arcade/level-b1/table.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[44%] z-[27]" />
            </div>

            <div>
            <img src='/assets/locations/arcade/level-b1/arcade-tundra-stage.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 bottom-0 w-[50%]" />
              <InteractiveElement
                src="/assets/locations/arcade/level-b1/mic.png"
                alt="Right Chair"
                effect='scale'
                className='absolute left-1/2 transform -translate-x-1/2 bottom-[18%] w-[3%] z-[30]'
                // onClick={() => handleElementClick('dance-machine')}
              />
            </div>

            </>
          )}

          {/* Floor 1 */}
          {backgroundFile === 'arcade-1.png' && (
            <>
              <img src='/assets/locations/arcade/level-1/trophy-neon.png' alt="ticket counter" className="absolute top-[32%] left-[14%] w-[6%]" />
              <img src='/assets/locations/arcade/level-1/sword-neon.png' alt="ticket counter" className="absolute top-[26%] left-[6%] w-[5%] -rotate-12" />
              <img src='/assets/locations/arcade/level-1/play-neon.png' alt="ticket counter" className="absolute top-[44%] left-[6%] w-[6%] -rotate-12" />

              <img src='/assets/locations/arcade/level-1/wall-art-blobbizard.png' alt="ticket counter" className="absolute top-[42%] left-[34%] w-[5%]" />
              <img src='/assets/locations/arcade/level-1/wall-art-blobbi-adventure.png' alt="ticket counter" className="absolute top-[42%] right-[34%] w-[6%]" />

              <img src='/assets/locations/arcade/level-1/controller-neon.png' alt="ticket counter" className="absolute top-[32%] left-[26%] w-[7%] -rotate-12" />
              <img src='/assets/locations/arcade/level-1/star-neon.png' alt="ticket counter" className="absolute left-1/2 transform -translate-x-1/2 top-[27%] w-[5%]" />
              <img src='/assets/locations/arcade/level-1/dice-neon.png' alt="ticket counter" className="absolute top-[31%] right-[26%] w-[6%]" />

              <img src='/assets/locations/arcade/level-1/pac-man-neon.png' alt="ticket counter" className="absolute top-[32%] right-[15%] w-[4.5%] rotate-12" />
              <img src='/assets/locations/arcade/level-1/game-boy-neon.png' alt="ticket counter" className="absolute top-[28%] right-[4%] w-[4%] rotate-12" />
              <img src='/assets/locations/arcade/level-1/retro-controller-neon.png' alt="ticket counter" className="absolute top-[44%] right-[6%] w-[6%] rotate-12" />

                {/* Left Arcade Machine */}
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-pink.png"
                    alt="Arcade Machine Pink"
                    effect='scale'
                    className='absolute left-[18%] w-[12%] bottom-[28%] z-[15]'
                    onClick={() => handleElementClick('dance-machine')}
                    />
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-black.png"
                    alt="Arcade Machine classic"
                    effect='scale'
                    className='absolute left-[11%] w-[12.5%] bottom-[22%] z-20'
                    onClick={() => handleElementClick('dance-machine')}
                    />
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-classic.png"
                    alt="Arcade Machine classic"
                    effect='scale'
                    className='absolute left-[4%] w-[12.5%] bottom-[16%] z-[25]'
                    onClick={() => handleElementClick('dance-machine')}
                    />

                  {/* Middle */}
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/snooker.png"
                    alt="Arcade Machine Green"
                    effect='scale'
                    className='absolute left-[30%] w-[17.5%] bottom-[10%] z-30'
                    onClick={() => handleElementClick('dance-machine')}
                  />

                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/air-hockey.png"
                    alt="Arcade Air Hockey"
                    effect='scale'
                    className='absolute right-[30%] w-[17.5%] bottom-[10%] z-30'
                    onClick={() => handleElementClick('dance-machine')}
                  />

                  {/* Right Arcade Machine */}
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-green.png"
                    alt="Arcade Machine Green"
                    effect='scale'
                    className='absolute right-[18%] w-[12.5%] bottom-[28%] z-[15]'
                    onClick={() => handleElementClick('dance-machine')}
                  />
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-purple.png"
                    alt="Arcade Machine Purple"
                    effect='scale'
                    className='absolute right-[11%] w-[12.5%] bottom-[22%] z-20'
                    onClick={() => handleElementClick('dance-machine')}
                  />
                  <InteractiveElement
                    src="/assets/locations/arcade/level-1/arcade-machine-red.png"
                    alt="Arcade Machine Red"
                    effect='scale'
                    className='absolute right-[4%] w-[12.5%] bottom-[16%] z-[25]'
                    onClick={() => handleElementClick('dance-machine')}
                  />
            </>
          )}

          {/* Ticket Counter - Only on main floor */}
          {backgroundFile === 'arcade-inside.png' && (
           <>
            <div className='relative left-[20%] top-[26%]'>
              <img src='/assets/locations/arcade/ground/ticket.png' alt="ticket counter"
                className="absolute" />
              <InteractiveElement
                src="/assets/locations/arcade/ground/ticket-out.png"
                alt="Purchase Arcade Pass"
                effect='opacity'
                className='absolute'
                onClick={handleTicketPurchase}
                requestInteraction={requestInteraction}
              />
            </div>

            <img src='/assets/locations/arcade/ground/wall-art-super-blobbi.png' alt="ticket counter" className="absolute top-[6%] right-[10%] w-[20%]" />
            <img src='/assets/locations/arcade/ground/wall-art-game-boy.png' alt="ticket counter" className="absolute top-[12%] left-[2%] w-[10%]" />
            <img src='/assets/locations/arcade/ground/play-up-neon.png' alt="ticket counter" className="absolute top-[18%] left-[28%] w-[8%]" />
            <img src='/assets/locations/arcade/ground/trophy-money-neon.png' alt="ticket counter" className="absolute top-[18%] right-[31%] w-[6%]" />

          {/* Prizes */}
          <div className='absolute right-[7%] top-[33%]'>
            <InteractiveElement
              src="/assets/locations/arcade/ground/prizes.png"
              alt="prizes"
              animated={false}
              effect='scale'
              onClick={() => handleElementClick('prizes')}
            />
          </div>
           </>
          )}

        </div>

        {/* Modals */}
        <ArcadePassModal
          isOpen={isArcadePassModalOpen}
          onClose={() => setIsArcadePassModalOpen(false)}
        />
        <ElevatorModal
          isOpen={isElevatorModalOpen}
          onClose={() => setIsElevatorModalOpen(false)}
        />
        <NoPassModal
          isOpen={isNoPassModalOpen}
          onClose={() => setIsNoPassModalOpen(false)}
        />
        {gameModalContent && (
          <GameModal
            isOpen={isGameModalOpen}
            onClose={() => setIsGameModalOpen(false)}
            title={gameModalContent.title}
          >
            {gameModalContent.content}
          </GameModal>
        )}
        <BackArrow
          onClick={() => setCurrentLocation('town')}
          className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
        />
      </>
    );
  }

  if (backgroundFile === 'stage-inside.png') {
    return (
      <div ref={containerRef} className="w-full h-full relative">
        {/*
          Screen, curtain and controls, all driven by one local state machine
          (`src/lib/theater-state.ts`). The only input is which seat the local
          Blobbi has ARRIVED at: with nobody sitting down there is no card, no
          player and no error — just an idle theater with its curtain closed.

          `stage-inside.png` has a genuine transparent rectangle in its
          proscenium, so the player mounts INSIDE the artwork rather than on top
          of it (see `theater-layout.ts`). It sits below the curtain and below
          every seat row, so nothing about the room's stacking order changes.
        */}
        <TheaterStage
          seatId={sittingIn}
          onActivityChange={onActivityChange}
          participants={sessionParticipants}
        />

        {/* Little stage door: decoration. It has no behaviour by design — it
            slides on hover and leads nowhere. */}
        <InteractiveElement
          src="/assets/locations/stage/open-little-door.png"
          alt="Stage little door"
          effect="slide"
          slideDirection="right"
          className="w-[46px] absolute bottom-[22.8%] left-[45.4%]"
        />

        {/*
          Seating. 28 chair sprites — 26 OCCUPIABLE seats plus 2 DECORATIVE
          chairs — driven by `theaterSeats`, replacing six flex rows of identical
          clones that all collapsed to one `data-chair-id`. Each occupiable seat
          carries a stable id, a fixed z-index and a real arrival callback; the
          two decorative chairs hang off the edges of the world and render as
          scenery with no interaction at all.
        */}
        {theaterSeats.map((seat) => (
          <TheaterSeat
            key={seat.id}
            config={seat}
            requestInteraction={requestInteraction}
            sittingIn={sittingIn}
            occupiedRemotely={occupiedSeats.has(seat.id) && sittingIn !== seat.id}
            onSit={onSitInSeat ?? noopSit}
          />
        ))}

        <BackArrow
          onClick={() => setCurrentLocation('town')}
          className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
        />
      </div>
    );
  }


  if (backgroundFile === 'shopping-mall-inside.png') {
    return (
      <>
        <div className="absolute inset-0 pointer-events-none">
          <img
            src="/assets/locations/shop/glass-barrier-bottom.png"
            alt="Glass Barrier"
            className="absolute w-full bottom-[35.3%] object-cover z-[20]"
          />
          <img
            src="/assets/locations/shop/glass-barrier-top.png"
            alt="Glass Barrier"
            className="absolute w-full top-[28.4%] object-cover z-[10]"
          />
          <img
            src="/assets/locations/shop/stairs.png"
            alt="Glass Barrier"
            className="absolute w-[11.8%] bottom-[9.5%] left-0 z-[25]"
          />
          <img
            src="/assets/locations/shop/stairs.png"
            alt="Glass Barrier"
            className="absolute w-[11.5%] bottom-[38.7%] right-0 scale-x-[-1] z-[15]"
          />
        </div>
        <BackArrow
          onClick={() => setCurrentLocation('town')}
          className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
        />

       <div>
         <img
          src="/assets/locations/shop/belt-barrier.png"
          alt="Belt barrier"
          className='absolute bottom-[7%] right-[18%] w-[6%] z-[26]'
        />
        <img
          src="/assets/locations/shop/belt-barrier.png"
          alt="Belt barrier"
          className='absolute bottom-[7%] right-[2%] w-[6%] z-[26]'
        />
       </div>

          {/* Coffee Shop */}
          <div className='absolute bottom-[12%] left-[28%] z-20 w-[22.5%]'>
            <img
              />
            <InteractiveElement
              src="/assets/locations/shop/coffee-shop.png"
              alt="Shopping coffe shop"
              effect="scale"
              animated={false}
            />
          </div>

          {/* Badges Store */}
          <div className='absolute bottom-[38.5%] -left-[2.5%] z-15 w-[24.5%]'>
            <img
              src="/assets/locations/shop/badges-store.png"
              alt="Shopping badges store"
              />
            <InteractiveElement
              src="/assets/locations/shop/doors/badges-store-door.png"
              alt="Badges store"
              effect="opacity"
              className="absolute -bottom-[5%] right-0 w-[29.4%]"
            />
          </div>

        {/* Plants */}
          <img
            className='absolute bottom-[38.5%] left-[26%] z-[15] w-[3%]'
            src="/assets/locations/shop/plant-1.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[38.5%] right-[26%] z-[15] w-[3%]'
            src="/assets/locations/shop/plant-1.png"
            alt="Photo booth open"
          />
          <img
            className='absolute bottom-[10.5%] left-[20.4%] z-[15] w-[7%]'
            src="/assets/locations/shop/plant-2.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[10.5%] right-[20.4%] z-[15] w-[7%]'
            src="/assets/locations/shop/plant-2.png"
            alt="Photo booth open"
          />
          <img
            className='absolute bottom-[66.5%] left-[16%] z-[9] w-[6%]'
            src="/assets/locations/shop/plant-3.png"
            alt="Photo booth open"
          />

          <img
            className='absolute bottom-[66.5%] right-[16%] z-[9] w-[6%]'
            src="/assets/locations/shop/plant-3.png"
            alt="Photo booth open"
          />


          {/* Photo Booth */}
          <div className='absolute bottom-[38.5%] left-[33.5%] z-[15] w-[8.5%]'>
            <img
              src="/assets/locations/shop/photo-booth.png"
              alt="Photo booth open"
              />
            <InteractiveElement
              src="/assets/locations/shop/doors/photo-booth-door.png"
              alt="Photo booth open"
              effect="opacity"
              className="absolute bottom-[5.8%] right-[12.8%] w-[42.2%]"
              onClick={() => setIsPhotoBoothModalOpen(true)}
              requestInteraction={requestInteraction}
            />
          </div>

          {/* Clothing Store */}
          <div className='absolute bottom-[38.5%] right-[25.5%] z-15 w-[24.5%]'>
            <img
              src="/assets/locations/shop/clothing-store.png"
              alt="Shopping clothing store"
              />
            <InteractiveElement
              src="/assets/locations/shop/doors/clothing-store-door.png"
              alt="Clothing store door"
              effect="opacity"
              className="absolute -bottom-[5%] left-[5%] w-[52.8%]"
              onClick={() => setCurrentLocation('clothing-store-inside')}
              requestInteraction={requestInteraction}
            />
          </div>

          {/* Furniture Store */}
          <div className='absolute top-[7.4%] left-1/2 transform -translate-x-1/2 z-15 w-[30%]'>
            <img
              src="/assets/locations/shop/furniture-store.png"
              alt="Shopping furniture store"
              />
            <InteractiveElement
              src="/assets/locations/shop/doors/furniture-store-door.png"
              alt="Furniture store door"
              effect="opacity"
              className="absolute bottom-0 left-[10%] w-[35.3%]"
            />
          </div>

        <div className='absolute flex bottom-[12%] right-[4%] z-10 gap-6'>
          <div>
            <img
              src="/assets/locations/shop/self-service-kiosk.png"
              alt="Self service kiosk"
              />
            <InteractiveElement
              src="/assets/locations/shop/self-service-kiosk-on.png"
              alt="Self service kiosk on"
              effect="opacity"
              className="absolute bottom-0"
              onClick={() => setIsFoodShopModalOpen(true)}
              requestInteraction={requestInteraction}
            />
          </div>
          <div>
            <img
              src="/assets/locations/shop/self-service-kiosk.png"
              alt="Self service kiosk"
              />
            <InteractiveElement
              src="/assets/locations/shop/self-service-kiosk-on.png"
              alt="Self service kiosk on"
              effect="opacity"
              className="absolute bottom-0"
              onClick={() => setIsFoodShopModalOpen(true)}
              requestInteraction={requestInteraction}
            />
          </div>
        </div>

        <FoodShopModal isOpen={isFoodShopModalOpen} onClose={() => setIsFoodShopModalOpen(false)} />
        <PhotoBoothModal
          isOpen={isPhotoBoothModalOpen}
          onClose={() => setIsPhotoBoothModalOpen(false)}
          selectedBlobbi={selectedBlobbi}
          onOpenShareModal={(capturedPhoto, capturedPolaroidSrc) => {
            setShareModalData({ capturedPhoto, capturedPolaroidSrc });
            setIsShareModalOpen(true);
          }}
        />
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          capturedPhoto={shareModalData.capturedPhoto}
          capturedPolaroidSrc={shareModalData.capturedPolaroidSrc}
        />

        <div>
          <div className='flex absolute bottom-[3%] right-[42%] w-[16.5%] gap-[30%]'>
            <img
              src="/assets/locations/shop/table.png"
              alt="Shop table" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[50%] z-[28]" />
            <InteractiveElement
                src="/assets/locations/shop/left-chair.png"
              alt="Shop left chair"
              type="chair"
              chairConfig={{
                seatAnchor: { xPercent: 50, yPercent: 25 }
              }}
              onClick={handleChairClick}
              effect='scale'
              className='left-[18%] bottom-[36%] w-[40%] z-[27]'
            />
            <InteractiveElement
                src="/assets/locations/shop/right-chair.png"
              alt="Shop right chair"
              type="chair"
              chairConfig={{
                seatAnchor: { xPercent: 50, yPercent: 25 }
              }}
              onClick={handleChairClick}
              effect='scale'
              className='left-[30%] bottom-[36%] w-[40%] z-[27]'
            />
          </div>
          <div className='flex absolute bottom-[3%] right-[24%] w-[16.5%] gap-[30%]'>
            <img
              src="/assets/locations/shop/table.png"
              alt="Shop table" className="absolute left-1/2 transform -translate-x-1/2 top-[20%] w-[50%] z-[28]" />
            <InteractiveElement
                src="/assets/locations/shop/left-chair.png"
              alt="Shop left chair"
              type="chair"
              chairConfig={{
                seatAnchor: { xPercent: 50, yPercent: 25 }
              }}
              onClick={handleChairClick}
              effect='scale'
              className='left-[18%] bottom-[36%] w-[40%] z-[27]'
            />
            <InteractiveElement
                src="/assets/locations/shop/right-chair.png"
              alt="Shop right chair"
              type="chair"
              chairConfig={{
                seatAnchor: { xPercent: 50, yPercent: 25 }
              }}
              onClick={handleChairClick}
              effect='scale'
              className='left-[30%] bottom-[36%] w-[40%] z-[27]'
            />
          </div>
        </div>
      </>
    );
  }

  // Town elements (when background is town-open.webp)
  if (backgroundFile === 'town-open.webp') {

    return (
      <div className='relative w-full h-full'>
        {/* Arcade - Left side */}
          <div className="absolute left-[18%] top-[25%] w-[21.1%] z-15">
            <img
              src="/assets/world/buildings/arcade.png"
              alt="Arcade"
              className="w-full"
            />
            <InteractiveElement
              src="/assets/world/buildings/arcade-door.png"
              alt="Arcade Door"
              animated={false}
              onClick={() => setCurrentLocation('arcade')}
              requestInteraction={requestInteraction}
              effect="door"
              className="absolute bottom-0 right-0  w-[40%] z-15"
            />
          </div>

          {/* Stage - Center */}
          <div className="absolute left-1/2 top-[22%] w-[27.6%] transform -translate-x-1/2 z-15">
            <img
              src="/assets/world/buildings/stage.png"
              alt="Stage"
              className="w-full"
            />
            <InteractiveElement
              src="/assets/world/buildings/stage-door.png"
              alt="Stage Door"
              animated={false}
              onClick={() => setCurrentLocation('stage')}
              requestInteraction={requestInteraction}
              effect="opacity"
              className="absolute bottom-0 -right-[1%]  w-[47%] z-15"
            />
          </div>

          {/* Shop - Right side */}
          <div className="absolute right-[18%] top-[25%] w-[20.5%] z-15">
            <img
              src="/assets/world/buildings/shop.png"
              alt="Shop"
              className="w-full"
            />
            <InteractiveElement
              src="/assets/world/buildings/shop-door.png"
              alt="Shop Door"
              animated={false}
              onClick={() => setCurrentLocation('shop')}
              requestInteraction={requestInteraction}
              effect="door"
              className="absolute bottom-0 left-0  w-[60%] z-15"
            />

          </div>

        {/* Interactive bushes — driven by shared config (art, placement, fixed
            z-index and the per-bush walk-to target). Each TownBush reuses the
            existing movement system to walk the Blobbi to the bush's configured
            center, then reports an explicit hide on arrival (the Blobbi visual
            stops being rendered; no z-index is touched), shakes, plays the
            rustle SFX and emits a light leaf burst. */}
          {townBushes.map((bush) => (
            <TownBush
              key={bush.id}
              config={bush}
              requestInteraction={requestInteraction}
              hiddenIn={hiddenIn}
              onHide={onHideInSpot ?? noopHide}
            />
          ))}

        {/* Streetlights — decorative art plus the movement blocker at each foot.
            Both come from the SAME config entry (placement + measured sprite
            footprint), so the blocker can no longer drift away from the artwork
            the way it did when these were two independent sets of numbers. */}
          {townStreetlights.map((streetlight) => {
            const base = streetlightBaseBlocker(streetlight);
            return (
              <React.Fragment key={streetlight.id}>
                <img
                  src={STREETLIGHT_SRC}
                  alt="streetlight"
                  draggable={false}
                  className="absolute z-[15] select-none pointer-events-none"
                  style={{
                    [streetlight.anchor.edge]: `${streetlight.anchor.percent}%`,
                    bottom: `${streetlight.bottomPercent}%`,
                    height: `${streetlight.heightPercent}%`,
                  }}
                  data-streetlight-id={streetlight.id}
                />
                <MovementBlocker
                  id={streetlight.id}
                  x={base.x}
                  y={base.y}
                  width={base.width}
                  height={base.height}
                />
              </React.Fragment>
            );
          })}
      </div>
    );
  }

  // Town elements (when background is town-open.webp)
if (backgroundFile === 'nostr-station-open.png') {
  return (
    <>
      {/* Nostr Station */}
      <div className="absolute w-full h-full z-15">
        <div className="absolute top-[6%] right-[5%] w-[20%] h-auto">
          {/* Build container - relative */}
          <img
            src="/assets/world/buildings/nostr-station.png"
            alt="Nostr Station"
            className="w-full h-auto"
          />
          {/* Door inside the build */}
          <InteractiveElement
            src="/assets/world/buildings/nostr-station-door.png"
            alt="Nostr Station Door"
            animated={false}
            onClick={() => setCurrentLocation('nostr-station-inside')}
            requestInteraction={requestInteraction}
            effect="door"
            className="absolute bottom-0 left-[10%] w-[31%] z-15"
          />
        </div>
      </div>
    </>
  );
}

  // Mine elements (when background is mine-open.png)
  if (backgroundFile === 'mine-open.png') {
    return (
      <>
        {/* Cave - Center, transparent by default */}
        <div className="absolute left-1/2 top-[40%] sm:top-[42%] transform -translate-x-1/2 z-15">
          <InteractiveElement
            src="/assets/locations/mine/cave.png"
            alt="Cave"
            animated={false}
            onClick={() => setCurrentLocation('cave-open')}
            requestInteraction={requestInteraction}
            effect="opacity"
            className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:size-[214px]"
          />
        </div>
      </>
    );
  }

  if (backgroundFile === 'cave-inside.png') {
    return (
      <>
        {/* Cave - Center, transparent by default */}
        <div className="absolute left-[10%] top-[64%] z-20">
          <InteractiveElement
            src="/assets/locations/cave/sign.png"
            alt="Cave"
            animated={false}
            onClick={() => setCurrentLocation('mine')}
            requestInteraction={requestInteraction}
            effect="scale"
            className="w-[80%]"
          />
        </div>
      </>
    );
  }

  // Beach elements (when background is beach.png or beach-open.png)
  if (backgroundFile === 'beach-open.png' || backgroundFile === 'beach.png') {
    return (
      <>
        {/* Boat - Center */}
        <div className="absolute left-1/4 top-[34%] sm:top-[39%] transform -translate-x-1/2 z-15">
          <InteractiveElement
            src="/assets/locations/beach/boat.png"
            alt="Boat"
            animated={false}
            onClick={() => handleElementClick('boat')}
            className="size-24 sm:size-28 md:size-32 lg:size-36"
          />
        </div>
      </>
    );
  }
// Plaza elements (when background is plaza-open.png)
if (backgroundFile === 'plaza-open.png') {
  return (
    <>
      <div className="absolute inset-x-0 top-0 flex items-center justify-center z-10">
        <div className="relative flex justify-center">
          <img
            src="/assets/world/buildings/plaza.png"
            alt="Plaza building"
            className="max-w-[50%]"
          />
          <InteractiveElement
            src="/assets/world/buildings/plaza-door.png"
            alt="Plaza Door"
            animated={false}
            onClick={() => setCurrentLocation('plaza-inside')}
            requestInteraction={requestInteraction}
            effect="door"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[7.6%] z-11"
          />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-10 sm:bottom-28 flex items-center justify-center z-10">
      <img src="/assets/locations/plaza/floor.png" alt="Floor" className="max-w-full max-h-full" />
      </div>
    </>
  );
}

// Plaza inside elements (when background is plaza-inside.png)
if (backgroundFile === 'plaza-inside.png') {
  return (
    <>
      {/*
        Plaza inside Door — closed art is the base layer, the open art is a
        hover/tap overlay on top of it (same pattern as the shopping-mall store
        doors). Sits at z-[9], the deepest layer of this room, so the balcony /
        staircase layer below still occludes its base correctly.
      */}
      <div className='absolute w-[11.5%] left-[43.6%] top-[33.5%] z-[9]'>
          <img
            src="/assets/locations/plaza/inside-door.png"
            alt="Plaza inside door"
            className='block w-full'
          />
        {/*
          The open-door PNG has a WIDER canvas than the closed one (432×351 vs
          424×351) because its panels swing outward past the door frame. Both are
          drawn on the same grid at the same scale, so rendering the overlay at
          432/424 = 101.887% of the group width — with height left automatic —
          reproduces the closed door's exact pixel scale and makes the shared
          frame/arch line up. Using w-full/h-full/inset-0 instead would letterbox
          it via object-contain (~1.9% too small, ~1px off).
        */}
        <InteractiveElement
          src="/assets/locations/plaza/inside-door-open.png"
          alt="Plaza inside door open"
          animated={false}
          effect="door"
          onClick={() => setCurrentLocation('plaza')}
          requestInteraction={requestInteraction}
          className="absolute top-0 left-0 w-[101.887%]"
        />
      </div>

      {/*
        Balcony railing + staircase foreground layer. Purely decorative, so it
        must not capture pointer events: it spans the full width and covers the
        door above, and without pointer-events-none it swallows the door's hover.
        Same convention as the shopping mall's glass barriers.
      */}
      <img
        src="/assets/locations/plaza/glass-barrier.png"
        alt="Glass Barrier"
        className="absolute opacity-60 top-[30.5%] w-full object-cover z-[10] pointer-events-none"
      />
      {/* <img
        src="/assets/locations/plaza/glass-barrier.png"
        alt="Glass Barrier"
        className="absolute top-[30.5%] w-full object-cover z-[2]"
      /> */}

      {/* Plaza Chill Lounge */}
      <div className='group absolute bottom-[28.2%] right-[6.5%] z-[11] w-[14.3%]'>
        <img
          src="/assets/locations/plaza/chill-lounge.png"
          alt="Plaza chill lounge"
          className="w-full cursor-pointer"
        />
        <InteractiveElement
          src="/assets/locations/plaza/chill-lounge-interactive.png"
          alt="Chill lounge entrace"
          effect="scale"
          className="absolute right-[20%] -bottom-[15%] w-[90%] group-hover:scale-110 group-hover:transition-all group-hover:duration-300 group-hover:ease-out"
        />
      </div>

      {/* Plaza Drawing Wall */}
      <div className='group absolute bottom-[35.8%] right-[26.8%] z-[11] w-[8.8%]'>
        <img
          src="/assets/locations/plaza/drawing-wall.png"
          alt="Plaza drawing wall"
          className="w-full cursor-pointer"
        />
        <InteractiveElement
          src="/assets/locations/plaza/drawing-wall-interactive.png"
          alt="Drawing wall entrace"
          effect="scale"
          className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-[40%] group-hover:scale-110 group-hover:transition-all group-hover:duration-300 group-hover:ease-out"
        />
      </div>

      {/* Plaza Information */}
      <div className='group absolute bottom-[29%] left-[6.5%] z-[11] w-[13.2%]'>
        <img
          src="/assets/locations/plaza/information.png"
          alt="Plaza information"
          className="w-full cursor-pointer"
        />
        <InteractiveElement
          src="/assets/locations/plaza/information-interactive.png"
          alt="Information door"
          effect="scale"
          className="absolute bottom-[0] right-0 group-hover:scale-110 group-hover:transition-all group-hover:duration-300 group-hover:ease-out"
        />
      </div>

      {/* Plaza Fountain */}
        <div className='absolute left-1/2 transform -translate-x-1/2 bottom-[10%] z-[24]'>
          <img src="/assets/locations/plaza/floor.png" alt="Floor" />
          <img src="/assets/locations/plaza/fountain-bottom.png" alt="Floor" className="absolute left-1/2 transform -translate-x-1/2 bottom-[30%] w-[70%]" />
          <img src="/assets/locations/plaza/fountain-top.png" alt="Floor" className="absolute left-1/2 transform -translate-x-1/2 bottom-[80%] w-[25%]" />
        </div>

      {/* Back button to return to plaza */}
      <BackArrow
        onClick={() => setCurrentLocation('plaza')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />
    </>
  );
}

// Nostr Station Inside elements
if (backgroundFile === 'nostr-station-inside.png') {
  return (
    <>
      {/* Back button to return to outside */}
      <BackArrow
        onClick={() => setCurrentLocation('nostr-station')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />

      <img src='/assets/locations/nostr-station/nostr-neon.png' alt="ticket counter" className="absolute top-[26%] left-1/2 transform -translate-x-1/2 w-[15%]" />

      {/* Nostr Station Chairs */}
      <InteractiveElement
        src="/assets/locations/nostr-station/chair.png"
        alt="Nostr Station Chair 1"
        type="chair"
        chairConfig={{
          seatAnchor: { xPercent: 50, yPercent: 38 }
        }}
        onClick={handleChairClick}
        effect="scale"
        className="absolute left-[17%] bottom-[25%] w-[12%] z-[15]"
      />
      <InteractiveElement
        src="/assets/locations/nostr-station/chair.png"
        alt="Nostr Station Chair 2"
        type="chair"
        chairConfig={{
          seatAnchor: { xPercent: 50, yPercent: 38 }
        }}
        onClick={handleChairClick}
        effect="scale"
        className="absolute left-[30%] bottom-[25%] w-[12%] z-[15]"
      />
      <InteractiveElement
        src="/assets/locations/nostr-station/chair.png"
        alt="Nostr Station Chair 3"
        type="chair"
        chairConfig={{
          seatAnchor: { xPercent: 50, yPercent: 38 }
        }}
        onClick={handleChairClick}
        effect="scale"
        className="absolute right-[17%] bottom-[25%] w-[12%] z-[15]"
      />
      <InteractiveElement
        src="/assets/locations/nostr-station/chair.png"
        alt="Nostr Station Chair 4"
        type="chair"
        chairConfig={{
          seatAnchor: { xPercent: 50, yPercent: 38 }
        }}
        onClick={handleChairClick}
        effect="scale"
        className="absolute right-[30%] bottom-[25%] w-[12%] z-[15]"
      />

      {/* Nostr Hub Modal */}
      <NostrHubModal
        isOpen={isNostrHubModalOpen}
        onClose={() => setIsNostrHubModalOpen(false)}
      />
    </>
  );
}

// Clothing Store Inside elements
if (backgroundFile === 'clothing-store-inside.png') {
  return (
    <>
      {/* Back button to return to shopping mall */}
      <BackArrow
        onClick={() => setCurrentLocation('shop')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />
    </>
  );
}

  // No interactive elements for other backgrounds
  return null;
}
