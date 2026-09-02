import { useCallback, useState } from 'react';
import { Sofa } from 'lucide-react';

import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  FURNITURE_STORE_CHECKOUT,
  FURNITURE_STORE_SHOP_BUTTON,
  furnitureStoreBlockers,
} from '@/lib/furniture-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { FurnitureStoreModal } from './FurnitureStoreModal';

/**
 * The Furniture Store showroom.
 *
 * A room in the shape the Care, Badges and Clothing Stores settled: the painted
 * background IS the scene, transparent hotspots provide interaction, blockers
 * provide collision, and the shared walk-to-interact path moves the Blobbi.
 *
 * ## Nothing is drawn here
 *
 * Not one sprite. Every sofa, bed, lamp and wardrobe is painted into
 * `furniture-store-inside.webp`, and the two roped-off display platforms they
 * stand on are excluded by the walk boundary's own shape rather than by a pile
 * of blocker rectangles — so this component renders collision, two controls and
 * a back arrow, and that is all. An `<img>` appearing in this tree would be the
 * showroom drawn twice.
 *
 * ## The checkout is a button, not a sprite
 *
 * The desk is part of the background, so rather than invent a transparent prop
 * to carry a click, the hotspot is a real `<button>` over the desk's face: it is
 * keyboard reachable, it carries its own accessible name, and
 * `BLOCK_UI_SELECTOR` already treats `button` as move-blocking, so tapping it
 * never also starts a raw world walk. It routes through the SAME
 * `requestInteraction` path every door uses, so the Blobbi walks up the aisle
 * and the modal opens ON ARRIVAL — never on the click.
 *
 * Its affordance is a tint and an inset ring, never a transform: a hotspot has
 * no artwork of its own to brighten, and the background must not appear to move
 * when you point at it.
 *
 * ## Two ways in, one shop
 *
 * The desk is the immersive route; the corner button is the obvious one. They
 * are two CONTROLS, not two shops: both set the single `isShopOpen` flag this
 * component owns, and there is exactly one `<FurnitureStoreModal>` in the tree.
 * The only difference between them is the walk — the desk makes you go to the
 * till, the shortcut does not — which is the whole point of having both.
 *
 * `open()` is idempotent because a walk OUTLIVES the click that started it: an
 * arrival landing after the player already opened the modal must change
 * nothing.
 *
 * ## Presentation here, money elsewhere
 *
 * This component imports no inventory writer, no wallet and no publisher. The
 * shopping surface arrives as `<FurnitureStoreModal>`, mounted only while open —
 * and that modal is deliberately a foundation with no catalog and no prices
 * yet.
 */

interface FurnitureStoreRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

export function FurnitureStoreRoom({
  blobbiRef,
  selectedBlobbiId = null,
}: FurnitureStoreRoomProps) {
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
  const closeShop = useCallback(() => setIsShopOpen(false), []);

  return (
    <div className="relative h-full w-full">
      {/*
        Collision. Registered with the shared movement context, so the walk
        system, the route planner and remote presence all see the same
        rectangles; the red outlines only appear with the developer
        debug-overlays switch.
      */}
      {furnitureStoreBlockers.map((blocker) => (
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
        The checkout. Invisible at rest — the artwork already looks like a desk —
        and it tints and rings on hover, focus-visible and press alike, so
        pointer, keyboard and touch all get the same answer.
      */}
      <button
        type="button"
        data-furniture-store-checkout
        aria-label={FURNITURE_STORE_CHECKOUT.label}
        className={`${FURNITURE_STORE_CHECKOUT.className} cursor-pointer rounded-2xl bg-island-cream/0 ring-2 ring-inset ring-island-cream/0 transition-[background-color,box-shadow] duration-200 ease-cozy hover:bg-island-cream/15 hover:ring-island-cream/60 focus-visible:bg-island-cream/15 focus-visible:outline-none focus-visible:ring-island-cream/80 active:bg-island-cream/25 motion-reduce:transition-none`}
        onClick={() =>
          requestInteraction({
            target: FURNITURE_STORE_CHECKOUT.standPoint,
            action: openShop,
          })
        }
      />

      {/*
        The persistent shortcut. Opens where the player stands — no walk —
        because its job is convenience, not immersion. Same handler, same state,
        same modal as the desk above.
      */}
      <button
        type="button"
        data-furniture-store-shop-button
        aria-label={FURNITURE_STORE_SHOP_BUTTON.label}
        onClick={openShop}
        className={`${FURNITURE_STORE_SHOP_BUTTON.className} inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-island-wood/30 bg-island-cream/90 px-3 py-1.5 text-xs font-bold text-island-ink shadow-cozy-raised backdrop-blur-sm transition-transform duration-150 ease-cozy hover:-translate-y-0.5 hover:bg-island-cream active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
      >
        <Sofa aria-hidden className="size-4" />
        {FURNITURE_STORE_SHOP_BUTTON.text}
      </button>

      <BackArrow
        onClick={() => setCurrentLocation('shop')}
        className="absolute top-[5%] left-4 w-12 h-12 z-[40] text-current"
      />

      {/* Mounted only while open. */}
      {isShopOpen && <FurnitureStoreModal isOpen onClose={closeShop} />}
    </div>
  );
}
