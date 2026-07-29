import { FoodShopModal } from './FoodShopModal';
import { PhotoBoothModal } from './PhotoBoothModal';
import { ShareModal } from './ShareModal';
import { NostrHubModal } from '@/components/NostrHubModal';
import React, { useState, useRef } from 'react';
import { useLocation } from '@/hooks/useLocation';
import { getBackgroundForLocation } from '@/lib/location-backgrounds';
import { MovableBlobbiRef } from './MovableBlobbi';
import { MovementBlocker } from './MovementBlocker';
import type { Blobbi } from '@/hooks/useBlobbis';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import { BackArrow } from './BackArrow';
import { InteractiveElement, type InteractiveElementProps } from './InteractiveElement';
import { MineCaveEntrance } from './MineCaveEntrance';
import { ArcadeRoom } from './arcade/ArcadeRoom';
import { arcadeFloorForBackground } from '@/lib/arcade-machines-config';
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
  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbi?.id ?? ''}`,
  });
  const { requestInteraction } = pendingInteraction;
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  /**
   * Legacy chair behaviour for the Nostr Station / shop: walk the Blobbi to a
   * point derived from the chair's rect. There is no arrival callback and no
   * seated state — those rooms have never had one. The theater uses
   * <TheaterSeat> instead, and the arcade's chairs now go through the shared
   * walk-to-interact system (see `arcade/ArcadeRoom.tsx`).
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

  /**
   * Placeholder for elements that still have no behaviour (currently only the
   * beach boat). It logs and does nothing else.
   *
   * It used to special-case the literal string `'dance-machine'` and open a
   * hard-coded "Dance Dance Blobbi" modal — and all nine arcade machines,
   * including a pool table and an air hockey table, passed that string. That
   * dispatch is gone: arcade machines are a registry, and what a machine opens
   * is decided from its own configuration in `arcade/ArcadeRoom.tsx`.
   */
  const handleElementClick = (elementName: string) => {
    console.log(`Interactive element clicked: ${elementName} (location: ${currentLocation})`);
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

  if (backgroundFile === 'back-yard-open.webp') {
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

  /*
    Arcade — all three floors, delegated to `arcade/ArcadeRoom.tsx`.

    This branch used to be ~285 lines: nine machines that all called
    `handleElementClick('dance-machine')`, four chairs in two byte-identical
    table groups, two counters, an elevator, four modals and the game-modal
    state. The arcade owns its own walk-to-interact instance, its own lifecycle
    state machine and its own shell now, so adding a real game does not grow
    this file at all.
  */
  const arcadeFloor = arcadeFloorForBackground(backgroundFile);
  if (arcadeFloor) {
    return (
      <ArcadeRoom
        blobbiRef={blobbiRef}
        floor={arcadeFloor}
        selectedBlobbiId={selectedBlobbi?.id ?? null}
      />
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
if (backgroundFile === 'nostr-station-open.webp') {
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

  // Mine elements (when background is mine-open.webp)
  if (backgroundFile === 'mine-open.webp') {
    /*
      The cave used to be a single `/assets/locations/mine/cave.png` overlay
      dropped on the spot where `mine-open.png` had the cave mouth painted into
      it. The migrated `mine-open.webp` is a bare forest path, so that overlay
      had nothing to sit on and its whole rectangle — transparent pixels
      included — was clickable. It is replaced by a composed structure whose art
      is inert and whose only hit target is the arch opening; the destination,
      the walk-to-interact flow and this room's `requestInteraction` are
      unchanged. See `MineCaveEntrance` / `mine-cave-config.ts`.
    */
    return (
      <MineCaveEntrance
        requestInteraction={requestInteraction}
        onEnter={() => setCurrentLocation('cave-open')}
        locationKey={currentLocation}
      />
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

  // Beach elements (when background is beach.png or beach-open.webp)
  if (backgroundFile === 'beach-open.webp' || backgroundFile === 'beach.png') {
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
// Plaza elements (when background is plaza-open.webp)
if (backgroundFile === 'plaza-open.webp') {
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
