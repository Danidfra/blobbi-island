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
import { InteractiveElement } from './InteractiveElement';
import { MineCaveEntrance } from './MineCaveEntrance';
import { ArcadeRoom } from './arcade/ArcadeRoom';
import { CareStoreRoom } from './care-store/CareStoreRoom';
import { ClothingStoreRoom } from './clothing-store/ClothingStoreRoom';
import { BadgesStoreRoom } from './badges-store/BadgesStoreRoom';
import { FurnitureStoreRoom } from './furniture-store/FurnitureStoreRoom';
import { PlazaInsideRoom } from './plaza/PlazaInsideRoom';
import { CARE_STORE_FACADE } from '@/lib/care-store-config';
import { BADGES_STORE_FACADE } from '@/lib/badges-store-config';
import { CLOTHING_STORE_FACADE } from '@/lib/clothing-store-config';
import { FURNITURE_STORE_FACADE } from '@/lib/furniture-store-config';
import { MALL_PHOTO_BOOTH } from '@/lib/photo-booth-config';
import { PLAZA_INSIDE_BACKGROUND } from '@/lib/plaza-inside-config';
import { arcadeFloorForBackground } from '@/lib/arcade-machines-config';
import { TownBush } from './TownBush';
import { townBushes } from '@/lib/town-bushes-config';
import { TheaterSeat } from './theater/TheaterSeat';
import { TheaterStage } from './theater/TheaterStage';
import { theaterSeats } from '@/lib/theater-seats-config';
import { RoomSeat, RoomTable } from './RoomSeat';
import { roomSeatsFor, roomTablesFor } from '@/lib/room-seats-config';
import { TreasureHuntShack } from './beach/TreasureHuntShack';
import { TreasureHuntModal } from './beach/TreasureHuntModal';
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
   * Theater seats that currently LOOK occupied, remote players' winning
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
   * to presence: this component never interprets it.
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
  /**
   * LOCAL-ONLY suppression of the player's actor while a contained minigame
   * is running (the treasure hunt). Never touches the pose controller or
   * presence: see the note in `PlayingView`.
   */
  onActorSuppressionChange?: (suppressed: boolean) => void;
}

const noopHide = () => {};
const noopSit = () => {};
const NO_OCCUPIED_SEATS: ReadonlySet<string> = new Set();

export function InteractiveElements({ blobbiRef, selectedBlobbi, sittingIn = null, occupiedSeats = NO_OCCUPIED_SEATS, onSitInSeat, onActivityChange, sessionParticipants = 1, hiddenIn = null, onHideInSpot, onActorSuppressionChange }: InteractiveElementsProps) {
  const { currentLocation, setIsMapModalOpen, setCurrentLocation } = useLocation();
  const backgroundFile = getBackgroundForLocation(currentLocation);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFoodShopModalOpen, setIsFoodShopModalOpen] = useState(false);
  const [isTreasureHuntOpen, setIsTreasureHuntOpen] = useState(false);
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

  /*
   * Chairs (Nostr Station / shop) route through the SAME canonical
   * walk-to-interact path as every door and kiosk: `InteractiveElement`
   * resolves the chair's configured seat-anchor fraction (the accepted
   * `{50, 85}` pseudo-sit) through `resolveElementApproachTarget`, walks the
   * Blobbi there, and fires the chair's `onClick`: the Nostr Hub modal,
   * only on CONFIRMED ARRIVAL. The shop chairs attach no action: walking to
   * the cushion is the whole interaction. The legacy inline flow (its own
   * rect math, action fired immediately on click while still far away) is
   * gone; there is still no seated state in these rooms, by design.
   */

  /*
    Props with no behaviour yet (the beach boat, the coffee shop, the plaza
    kiosks) are rendered INERT, plain art, no cursor, no hover, no handler,
    with a small "Coming later" caption where that helps. They used to carry
    the full interactive treatment and a placeholder click that only logged,
    which read as broken rather than unfinished.

    (This is also where a `'dance-machine'` string dispatch used to live; arcade
    machines are a registry now, `arcade/ArcadeRoom.tsx` decides what opens.)
  */

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
    Arcade: all three floors, delegated to `arcade/ArcadeRoom.tsx`.

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
        sittingIn={sittingIn}
        onSitInSeat={onSitInSeat}
      />
    );
  }

  /*
    Care Store: same delegation as the arcade. Its blockers, its checkout
    hotspot and its shop modal all live in `care-store/`, so nothing about a
    care item ever reaches this dispatcher.
  */
  if (backgroundFile === 'care-store-inside.webp') {
    return (
      <CareStoreRoom
        blobbiRef={blobbiRef}
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
          player and no error, just an idle theater with its curtain closed.

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

        {/* Little stage door: decoration. It has no behaviour by design; it
            slides on hover and leads nowhere. */}
        <InteractiveElement
          src="/assets/locations/stage/open-little-door.png"
          alt="Stage little door"
          effect="slide"
          slideDirection="right"
          className="w-[46px] absolute bottom-[22.8%] left-[45.4%]"
        />

        {/*
          Seating. 28 chair sprites: 26 OCCUPIABLE seats plus 2 DECORATIVE
          chairs: driven by `theaterSeats`, replacing six flex rows of identical
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

          {/*
            Coffee Shop: ground floor, left of the Photo Booth. Decorative: it
            has no door, no interior and no click handler, and gains none here.

            Re-placed for the REPLACEMENT artwork. The old `.png` was 579×385
            with essentially no transparent padding, so its box was its picture;
            `coffee-shop.webp` is a 1536×1024 box with ink margins l 2.28 %,
            r 2.08 %, t 2.73 %, b 2.54 %, which would have shrunk the stall and
            floated it off the floor at the old numbers.

            The box below reproduces the old PAINTED extent exactly, x 28.0 →
            50.38, base on y = 87.94, so nothing else on the ground floor moves:

              box width  W = 22.383 / 0.9564 = 23.4 %  → box height 23.41 %
              box left     = 28.0 − 0.0228 · W = 27.47 %
              box bottom   = 87.94 + 0.0254 · 23.41 = 88.53 %  (bottom-[11.47%])

            The empty `<img />` that used to sit above the stall went with the
            swap: it had no `src`, so it rendered a broken-image box that the
            artwork happened to cover.
          */}
          <div className='absolute bottom-[11.47%] left-[27.47%] z-20 w-[23.4%]'>
            <InteractiveElement
              src="/assets/locations/shop/coffee-shop.webp"
              alt="Shopping coffe shop"
              effect="scale"
              animated={false}
              inert
              comingLater
            />
          </div>

          {/*
            Photo Booth: moved down to the ground floor, into the bay beside the
            Coffee Shop. A single narrow booth reads correctly in a wide bay,
            where a full-width storefront would not; the Care Store took its old
            middle-level slot in return. Its door overlay is positioned inside
            this box, so it travelled with it. See `photo-booth-config.ts`.
          */}
          <div className={MALL_PHOTO_BOOTH.containerClassName}>
            <img src={MALL_PHOTO_BOOTH.src} alt="Photo booth" />
            <InteractiveElement
              src={MALL_PHOTO_BOOTH.doorSrc}
              alt={MALL_PHOTO_BOOTH.doorAlt}
              effect="opacity"
              className={MALL_PHOTO_BOOTH.doorClassName}
              onClick={() => setIsPhotoBoothModalOpen(true)}
              requestInteraction={requestInteraction}
              walkTarget={MALL_PHOTO_BOOTH.walkTarget}
            />
          </div>

          {/*
            Badges Store: the middle level's far-left bay.

            The facade IS the entrance. It used to carry a separate
            `badges-store-door.png` overlay with NO click handler: a door-shaped
            affordance that hovered, invited a tap and did nothing. That overlay
            is gone rather than wired up, because the Care Store settled the
            question next door: one storefront, one way in, and the way in is
            the building.

            Hover/focus/press are a FILTER, never a transform: `animated={false}`
            keeps `InteractiveElement`'s hover-scale and tap-pop off so the shop
            warms and glows without lifting off its own floor.
          */}
          <div
            data-badges-store-facade
            className={`${BADGES_STORE_FACADE.containerClassName} transition-[filter] duration-200 ease-cozy hover:brightness-105 hover:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] focus-within:brightness-105 focus-within:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] active:brightness-110 motion-reduce:transition-none`}
          >
            <InteractiveElement
              src={BADGES_STORE_FACADE.src}
              alt={BADGES_STORE_FACADE.alt}
              effect="scale"
              animated={false}
              onClick={() => setCurrentLocation('badges-store-inside')}
              requestInteraction={requestInteraction}
              walkTarget={BADGES_STORE_FACADE.walkTarget}
            />
          </div>

        {/*
          Plants.

          The middle level's LEFT plant is deliberately absent: it used to fill
          the narrow gap beside the Photo Booth, and once the Care Store took
          that bay it only crowded the storefront's shoulder. Its mirror on the
          right stays: it still marks the edge of the Clothing Store.
        */}
          <img
            className='absolute bottom-[38.5%] right-[26%] z-[15] w-[3%]'
            src="/assets/locations/shop/plant-1.png"
            alt=""
            aria-hidden
          />
          <img
            className='absolute bottom-[10.5%] left-[20.4%] z-[15] w-[7%]'
            src="/assets/locations/shop/plant-2.png"
            alt=""
            aria-hidden
          />

          <img
            className='absolute bottom-[10.5%] right-[20.4%] z-[15] w-[7%]'
            src="/assets/locations/shop/plant-2.png"
            alt=""
            aria-hidden
          />
          <img
            className='absolute bottom-[66.5%] left-[16%] z-[9] w-[6%]'
            src="/assets/locations/shop/plant-3.png"
            alt=""
            aria-hidden
          />

          <img
            className='absolute bottom-[66.5%] right-[16%] z-[9] w-[6%]'
            src="/assets/locations/shop/plant-3.png"
            alt=""
            aria-hidden
          />


          {/*
            Care Store: on the middle level, in the bay the Photo Booth used to
            hold, between the left plant and the Clothing Store.

            The facade IS the entrance: no separate door overlay exists for it,
            so the whole storefront is the click target. The affordance is a
            FILTER, never a transform, a building that lifts off its own floor
            when you point at it looks broken, so hover/focus/press only warm and
            brighten it while it stays exactly where it stands. `animated={false}`
            keeps `InteractiveElement`'s hover-scale and tap-pop off for the same
            reason (the arcade Prize Counter does likewise).
          */}
          <div
            data-care-store-facade
            className={`${CARE_STORE_FACADE.containerClassName} transition-[filter] duration-200 ease-cozy hover:brightness-105 hover:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] focus-within:brightness-105 focus-within:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] active:brightness-110 motion-reduce:transition-none`}
          >
            <InteractiveElement
              src={CARE_STORE_FACADE.src}
              alt={CARE_STORE_FACADE.alt}
              effect="scale"
              animated={false}
              onClick={() => setCurrentLocation('care-store-inside')}
              requestInteraction={requestInteraction}
              walkTarget={CARE_STORE_FACADE.walkTarget}
            />
          </div>

          {/*
            Clothing Store: the middle level's right-hand bay.

            The facade IS the entrance. It used to be a `clothing-store.png`
            storefront with a separate `doors/clothing-store-door.png` overlay
            carrying the click; the new artwork is an open-front shop with no
            door painted in it at all, so the overlay is deleted rather than
            re-placed: a door-shaped affordance over a doorless shop is exactly
            the trap the Badges Store facade next door already walked out of.

            Hover/focus/press are a FILTER, never a transform: `animated={false}`
            keeps `InteractiveElement`'s hover-scale and tap-pop off so the shop
            warms and glows without lifting off its own floor, matching both its
            neighbours.
          */}
          <div
            data-clothing-store-facade
            className={`${CLOTHING_STORE_FACADE.containerClassName} transition-[filter] duration-200 ease-cozy hover:brightness-105 hover:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] focus-within:brightness-105 focus-within:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] active:brightness-110 motion-reduce:transition-none`}
          >
            <InteractiveElement
              src={CLOTHING_STORE_FACADE.src}
              alt={CLOTHING_STORE_FACADE.alt}
              effect="scale"
              animated={false}
              onClick={() => setCurrentLocation('clothing-store-inside')}
              requestInteraction={requestInteraction}
              walkTarget={CLOTHING_STORE_FACADE.walkTarget}
            />
          </div>

          {/*
            Furniture Store: the mall's TOP level.

            The facade IS the entrance, and here that is a fix rather than a
            restatement: the old storefront carried a
            `doors/furniture-store-door.png` overlay with NO click handler at
            all, so the shop hovered, invited a tap and had no way in. The new
            artwork is an open-front showroom with no door painted in it, so the
            overlay is deleted rather than finally wired up, exactly as the
            Badges Store's dead door was.

            Hover/focus/press are a FILTER, never a transform: `animated={false}`
            keeps `InteractiveElement`'s hover-scale and tap-pop off so the shop
            warms and glows without lifting off its own floor, matching all
            three storefronts on the level below.
          */}
          <div
            data-furniture-store-facade
            className={`${FURNITURE_STORE_FACADE.containerClassName} transition-[filter] duration-200 ease-cozy hover:brightness-105 hover:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] focus-within:brightness-105 focus-within:drop-shadow-[0_0_12px_rgba(255,236,190,0.65)] active:brightness-110 motion-reduce:transition-none`}
          >
            <InteractiveElement
              src={FURNITURE_STORE_FACADE.src}
              alt={FURNITURE_STORE_FACADE.alt}
              effect="scale"
              animated={false}
              onClick={() => setCurrentLocation('furniture-store-inside')}
              requestInteraction={requestInteraction}
              walkTarget={FURNITURE_STORE_FACADE.walkTarget}
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

        {/*
          The coffee-shop terrace: two tables, four chairs, from
          `room-seats-config.ts`. Each chair is an obstacle (its footprint), an
          approach point (the floor in front of it) and a seat (the cushion
          anchor the body is pinned to on arrival); each table is an obstacle.
          They used to be flex groups the Blobbi walked straight through.
        */}
        {roomTablesFor(backgroundFile).map((table) => (
          <RoomTable key={table.id} config={table} />
        ))}
        {roomSeatsFor(backgroundFile).map((seat) => (
          <RoomSeat
            key={seat.id}
            config={seat}
            requestInteraction={requestInteraction}
            sittingIn={sittingIn}
            onSit={onSitInSeat}
          />
        ))}
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

        {/* Interactive bushes: driven by shared config (art, placement, fixed
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

        {/* Streetlights: decorative art plus the movement blocker at each foot.
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
      had nothing to sit on and its whole rectangle, transparent pixels
      included: was clickable. It is replaced by a composed structure whose art
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
            inert
            comingLater
            className="relative size-24 sm:size-28 md:size-32 lg:size-36"
          />
        </div>

        {/* Treasure-hunting shack on the right sand shelf. Arrival opens the
            contained hunt; the modal reports LOCAL actor suppression while a
            hunt is actually running (never the published hidden pose; that
            would tell remote players this Blobbi is hidden in a world spot). */}
        <TreasureHuntShack
          requestInteraction={requestInteraction}
          onArrive={() => setIsTreasureHuntOpen(true)}
        />
        <TreasureHuntModal
          open={isTreasureHuntOpen}
          onClose={() => setIsTreasureHuntOpen(false)}
          onActorSuppressionChange={onActorSuppressionChange}
        />
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

/*
  Plaza interior: delegated to `plaza/PlazaInsideRoom.tsx`, like the arcade
  and the shop interiors. The new plate paints the storefronts, balcony,
  staircase and rug, so the room composes only the door, the railing/stairs
  occluder, six storefront hotspots, the fountain and its blockers; every
  number in `plaza-inside-config.ts`.
*/
if (backgroundFile === PLAZA_INSIDE_BACKGROUND) {
  return <PlazaInsideRoom blobbiRef={blobbiRef} selectedBlobbiId={selectedBlobbi?.id ?? null} />;
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

      {/*
        The four gaming chairs: real seats now (`room-seats-config.ts`).
        Arrival sits the Blobbi down AND opens the hub, as the old pseudo-sit
        did; the walk boundary's corridors are what keep walkers out of the
        chair bodies, so these register no footprint of their own.
      */}
      {roomSeatsFor(backgroundFile).map((seat) => (
        <RoomSeat
          key={seat.id}
          config={seat}
          requestInteraction={requestInteraction}
          sittingIn={sittingIn}
          onSit={onSitInSeat}
          onArrive={() => setIsNostrHubModalOpen(true)}
        />
      ))}

      {/* Nostr Hub Modal */}
      <NostrHubModal
        isOpen={isNostrHubModalOpen}
        onClose={() => setIsNostrHubModalOpen(false)}
      />
    </>
  );
}

/*
  Clothing Store: delegated, like the arcade and the Care Store. The boutique
  is painted into `clothing-store.webp`, so what lives in `clothing-store/` is
  its collision, its checkout and fitting-room hotspots, and its two modals.
*/
if (backgroundFile === 'clothing-store.webp') {
  return (
    <ClothingStoreRoom
      blobbiRef={blobbiRef}
      selectedBlobbiId={selectedBlobbi?.id ?? null}
    />
  );
}

/*
  Badges Store: delegated for the same reason as its neighbours. The room's two
  display units, its checkout hotspot, its collision and its shop all live in
  `badges-store/`.
*/
if (backgroundFile === 'badges-store-inside.webp') {
  return (
    <BadgesStoreRoom
      blobbiRef={blobbiRef}
      selectedBlobbiId={selectedBlobbi?.id ?? null}
    />
  );
}

/*
  Furniture Store: delegated like every other mall interior. The showroom is
  painted into `furniture-store-inside.webp`, so what lives in
  `furniture-store/` is its collision, its checkout hotspot and its modal.
*/
if (backgroundFile === 'furniture-store-inside.webp') {
  return (
    <FurnitureStoreRoom
      blobbiRef={blobbiRef}
      selectedBlobbiId={selectedBlobbi?.id ?? null}
    />
  );
}

  // No interactive elements for other backgrounds
  return null;
}
