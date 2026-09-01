import { useCallback, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  CLOTHING_STORE_CHECKOUT,
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreObjects,
} from '@/lib/clothing-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { ClothingStoreModal } from './ClothingStoreModal';

/**
 * The Clothing Store interior.
 *
 * The room used to be an empty shell with a back arrow in it — the background
 * artwork is literally four walls, three ceiling lights and a floor. Everything
 * that makes it a boutique is a separate sprite, listed in
 * `clothing-store-config.ts` and rendered here.
 *
 * ## Objects are DATA, and this component is the renderer
 *
 * Each object owns its id, its artwork, its placement, its depth and its floor
 * footprint. That is not abstraction for its own sake: these objects are going
 * to grow behaviour one at a time — a fitting room you can try clothes in, a
 * rack you can browse — and each of those should attach to one entry rather
 * than to a hand-placed `<img>` buried in JSX.
 *
 * ## Scenery does not pretend to be interactive
 *
 * Nothing here is clickable except the checkout and the Shop shortcut. The
 * objects render `alt="" aria-hidden` and carry no cursor, because they do
 * nothing yet — the arcade's audit found thirty decorative sprites with hover
 * states and no handlers, and a dead affordance is worse than an honest one.
 * When an object earns a behaviour it earns a name at the same moment.
 *
 * ## Presentation here, money elsewhere
 *
 * This component imports no inventory writer, no wallet and no publisher. The
 * whole financial surface arrives as `<ClothingStoreModal>`, mounted only while
 * open — same split as the Care Store, for the same reason.
 *
 * ## Two ways in, one shop
 *
 * The counter walks you over and opens on ARRIVAL; the corner Shop button opens
 * where you stand. Two CONTROLS, one `isShopOpen` flag, one modal in the tree.
 */

interface ClothingStoreRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

export function ClothingStoreRoom({
  blobbiRef,
  selectedBlobbiId = null,
}: ClothingStoreRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();
  const [isShopOpen, setIsShopOpen] = useState(false);

  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbiId ?? ''}`,
  });
  const { requestInteraction } = pendingInteraction;
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  /** The one and only way this room opens its shop. Both controls call it. */
  const openShop = useCallback(() => setIsShopOpen(true), []);

  return (
    <div className="relative h-full w-full">
      {/*
        The boutique. Rendered back-to-front in config order; each sprite's own
        `z-` class does the real stacking against the Blobbi's depth bands.
      */}
      {clothingStoreObjects.map((object) => (
        <img
          key={object.id}
          data-clothing-store-object={object.id}
          src={object.src}
          alt={object.alt ?? ''}
          {...(object.alt === null ? { 'aria-hidden': true } : {})}
          draggable={false}
          className={cn(object.className, 'pointer-events-none select-none')}
        />
      ))}

      {/*
        Floor footprints. Registered with the shared movement context, so the
        walk system and remote presence both see them; the red outlines only
        appear with the developer debug-overlays switch.
      */}
      {clothingStoreObjects.map((object) =>
        object.blocker ? (
          <MovementBlocker
            key={`blocker-${object.id}`}
            id={object.id}
            x={object.blocker.x}
            y={object.blocker.y}
            width={object.blocker.width}
            height={object.blocker.height}
          />
        ) : null,
      )}

      {/*
        The checkout. Unobtrusive by default — the artwork already looks like a
        till — and it warms on hover, focus and press so the affordance reaches
        pointer, keyboard and touch alike. No transform: a counter that jumps
        when you point at it reads as broken.
      */}
      <button
        type="button"
        data-clothing-store-checkout
        aria-label={CLOTHING_STORE_CHECKOUT.label}
        className={`${CLOTHING_STORE_CHECKOUT.className} cursor-pointer rounded-2xl bg-island-cream/0 ring-2 ring-inset ring-island-cream/0 transition-[background-color,box-shadow] duration-200 hover:bg-island-cream/15 hover:ring-island-cream/60 focus-visible:bg-island-cream/15 focus-visible:outline-none focus-visible:ring-island-cream/80 active:bg-island-cream/25 motion-reduce:transition-none`}
        onClick={() =>
          requestInteraction({
            target: CLOTHING_STORE_CHECKOUT.standPoint,
            action: openShop,
          })
        }
      />

      {/*
        The persistent shortcut. Opens where the player stands — no walk —
        because its job is convenience, not immersion. Same handler, same state,
        same modal as the counter above.
      */}
      <button
        type="button"
        data-clothing-store-shop-button
        aria-label={CLOTHING_STORE_SHOP_BUTTON.label}
        onClick={openShop}
        className={`${CLOTHING_STORE_SHOP_BUTTON.className} inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-island-wood/30 bg-island-cream/90 px-3 py-1.5 text-xs font-bold text-island-ink shadow-cozy-raised backdrop-blur-sm transition-transform duration-150 ease-cozy hover:-translate-y-0.5 hover:bg-island-cream active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
      >
        <ShoppingBag aria-hidden className="size-4" />
        {CLOTHING_STORE_SHOP_BUTTON.text}
      </button>

      <BackArrow
        onClick={() => setCurrentLocation('shop')}
        className="absolute top-[5%] left-4 w-12 h-12 z-[40] text-current"
      />

      {/*
        Mounted only while open, so the shop's inventory and catalog queries do
        not run behind a closed dialog.
      */}
      {isShopOpen && (
        <ClothingStoreModal isOpen onClose={() => setIsShopOpen(false)} />
      )}
    </div>
  );
}
