import { useCallback, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  CARE_STORE_CHECKOUT,
  CARE_STORE_SHOP_BUTTON,
  careStoreBlockers,
} from '@/lib/care-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { CareStoreModal } from './CareStoreModal';

/**
 * The Care Store interior.
 *
 * A room, in the shape the arcade established: its own walk-to-interact
 * instance, its own collision furniture, its own modal, and a config file
 * (`care-store-config.ts`) holding every number. `InteractiveElements` dispatches
 * to it on background and knows nothing else about the place.
 *
 * ## Presentation here, money elsewhere
 *
 * This component renders four blocker rectangles, two shop controls and a back
 * arrow. It imports no inventory writer, no wallet and no Nostr publisher, the whole
 * financial surface arrives as `<CareStoreModal>`, mounted only while open, and
 * the modal in turn only calls the shared purchase hook. The room cannot spend a
 * Coin even by mistake.
 *
 * ## The checkout is a button, not a sprite
 *
 * The counter is painted into `care-store-inside.webp`, so there is no image to
 * hang an `InteractiveElement` on. Rather than invent a transparent prop, the
 * hotspot is a real `<button>` over the counter's face: it is keyboard
 * reachable, it carries its own accessible name, and `BLOCK_UI_SELECTOR` already
 * treats `button` as move-blocking, so tapping it never also starts a raw world
 * walk. It routes through the SAME `requestInteraction` path every door uses, so
 * the Blobbi walks over and the modal opens on arrival; never on the click.
 *
 * ## Two ways in, one shop
 *
 * The counter is the immersive route; the corner Shop button is the obvious one.
 * They are two CONTROLS, not two shops: both set the single `isShopOpen` flag
 * this component owns, and there is exactly one `<CareStoreModal>` in the tree.
 * The only difference between them is the walk, the counter makes you go to the
 * till, the shortcut does not, which is the whole point of having both.
 */

interface CareStoreRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

export function CareStoreRoom({ blobbiRef, selectedBlobbiId = null }: CareStoreRoomProps) {
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
        Collision furniture. The blockers register with the movement context on
        mount and deregister on unmount; the red outlines only appear with the
        shared developer debug-overlays switch.
      */}
      {careStoreBlockers.map((blocker) => (
        <MovementBlocker
          key={blocker.id}
          id={blocker.id}
          x={blocker.x}
          y={blocker.y}
          width={blocker.width}
          height={blocker.height}
        />
      ))}

      {/*
        The checkout. Unobtrusive by default, the artwork already looks like a
        counter: and it lifts on hover/focus/press so the affordance is there on
        pointer, keyboard and touch alike.
      */}
      <button
        type="button"
        data-care-store-checkout
        aria-label={CARE_STORE_CHECKOUT.label}
        className={`${CARE_STORE_CHECKOUT.className} cursor-pointer rounded-2xl bg-island-cream/0 ring-2 ring-inset ring-island-cream/0 transition-[background-color,box-shadow] duration-200 hover:bg-island-cream/15 hover:ring-island-cream/60 focus-visible:bg-island-cream/15 focus-visible:outline-none focus-visible:ring-island-cream/80 active:bg-island-cream/25 motion-reduce:transition-none`}
        onClick={() =>
          requestInteraction({
            target: CARE_STORE_CHECKOUT.standPoint,
            action: openShop,
          })
        }
      />

      {/*
        The persistent shortcut. Opens the shop where the player stands; no
        walk: because its job is convenience, not immersion. Same handler, same
        state, same modal as the counter above.
      */}
      <button
        type="button"
        data-care-store-shop-button
        aria-label={CARE_STORE_SHOP_BUTTON.label}
        onClick={openShop}
        className={`${CARE_STORE_SHOP_BUTTON.className} inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-island-wood/30 bg-island-cream/90 px-3 py-1.5 text-xs font-bold text-island-ink shadow-cozy-raised backdrop-blur-sm transition-transform duration-150 ease-cozy hover:-translate-y-0.5 hover:bg-island-cream active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
      >
        <ShoppingBag aria-hidden className="size-4" />
        {CARE_STORE_SHOP_BUTTON.text}
      </button>

      <BackArrow
        onClick={() => setCurrentLocation('shop')}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />

      {/*
        Mounted only while open, so the shop's inventory and catalog queries do
        not run behind a closed dialog.
      */}
      {isShopOpen && <CareStoreModal isOpen onClose={() => setIsShopOpen(false)} />}
    </div>
  );
}
