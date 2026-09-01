import { useCallback, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreObjects,
  type ClothingStoreObject,
} from '@/lib/clothing-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { ClothingStoreModal } from './ClothingStoreModal';
import { FittingRoomModal } from './FittingRoomModal';

/**
 * The Clothing Store interior.
 *
 * ## Objects are data; this component is the renderer
 *
 * Every object owns its id, artwork, placement, depth, optional floor footprint
 * and — new here — its optional INTERACTION. Whether a sprite is scenery or a
 * control is a field, not a branch: the config carries `interaction`, and the
 * room renders a `<button>` for the ones that have it and an inert `<img>` for
 * the ones that do not.
 *
 * That matters because three objects just became interactive at once. Adding
 * the fourth is a config entry, not another copy of the walk-to-interact wiring.
 *
 * ## Scenery still does not pretend
 *
 * The rug, the wall art and the hat shelf render `alt="" aria-hidden` with
 * `pointer-events-none` and no cursor, because they do nothing. An affordance
 * arrives with a behaviour and not before — the arcade's thirty hover-stated,
 * handler-less props are the reason that rule exists.
 *
 * Nothing interactive TRANSFORMS on hover, either. The Care Store facade
 * settled that: a building that lifts off its own floor when you point at it
 * reads as broken, so these warm and glow and stay exactly where they stand.
 *
 * ## Two surfaces, five controls
 *
 * ```
 *   checkout ─┐
 *   table 1 ──┼─→ 'shop'         → <ClothingStoreModal>   (buys things)
 *   table 2 ──┤
 *   Shop btn ─┘
 *   fitting room → 'fitting-room' → <FittingRoomModal>    (writes nothing)
 * ```
 *
 * ONE state names which surface is open, so the two can never stack — see
 * `openSurface` below for why that is a slot rather than a pair of booleans.
 *
 * ## Presentation here, money elsewhere
 *
 * This component imports no inventory writer, no wallet and no publisher. The
 * financial surface arrives as `<ClothingStoreModal>` and the preview surface as
 * `<FittingRoomModal>`, each mounted only while open.
 */

interface ClothingStoreRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

/**
 * The affordance every interactive object in this room shares.
 *
 * Filter and glow, never transform. `focus-visible` matters as much as hover:
 * these are real buttons in the tab order, and a keyboard user gets the same
 * indication a pointer user does.
 */
const INTERACTIVE_AFFORDANCE =
  'cursor-pointer transition-[filter] duration-200 ease-cozy ' +
  'hover:brightness-105 hover:drop-shadow-[0_0_12px_rgba(255,236,190,0.7)] ' +
  'focus-visible:outline-none focus-visible:brightness-105 ' +
  'focus-visible:drop-shadow-[0_0_12px_rgba(255,236,190,0.9)] ' +
  'active:brightness-110 motion-reduce:transition-none';

export function ClothingStoreRoom({
  blobbiRef,
  selectedBlobbiId = null,
}: ClothingStoreRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();

  /**
   * WHICH surface is open, as one value rather than two booleans.
   *
   * The requirement is that the shop and the fitting room can never stack, and
   * a single slot makes that structural instead of guarded: there is no state
   * in which both are set, so no ordering of clicks and arrivals can produce
   * one. Two independent flags would have needed a guard, and a guard is a
   * thing that can be forgotten.
   *
   * It matters because a walk OUTLIVES the click that started it: an arrival
   * callback can land after the player has opened something else, which is
   * exactly when a second dialog would have appeared underneath the first.
   */
  const [openSurface, setOpenSurface] = useState<'shop' | 'fitting-room' | null>(
    null,
  );
  const isShopOpen = openSurface === 'shop';
  const isFittingRoomOpen = openSurface === 'fitting-room';

  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbiId ?? ''}`,
  });
  const { requestInteraction } = pendingInteraction;
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  /** Open a surface, unless one is already up. First one wins. */
  const open = useCallback((surface: 'shop' | 'fitting-room') => {
    setOpenSurface((current) => current ?? surface);
  }, []);
  const close = useCallback(() => setOpenSurface(null), []);

  return (
    <div className="relative h-full w-full">
      {clothingStoreObjects.map((object) =>
        object.interaction ? (
          <InteractiveObject
            key={object.id}
            object={object}
            onArrive={() => open(object.interaction!.opens)}
            requestInteraction={requestInteraction}
          />
        ) : (
          <img
            key={object.id}
            data-clothing-store-object={object.id}
            src={object.src}
            alt=""
            aria-hidden
            draggable={false}
            className={cn(object.className, 'pointer-events-none select-none')}
          />
        ),
      )}

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
        The persistent shortcut. Opens where the player stands — no walk —
        because its job is convenience, not immersion. Same state, same modal as
        the counter and both tables.
      */}
      <button
        type="button"
        data-clothing-store-shop-button
        aria-label={CLOTHING_STORE_SHOP_BUTTON.label}
        onClick={() => open('shop')}
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
        Mounted only while open, so neither surface runs its queries behind a
        closed dialog.
      */}
      {isShopOpen && (
        <ClothingStoreModal isOpen onClose={close} />
      )}
      {isFittingRoomOpen && (
        <FittingRoomModal isOpen onClose={close} />
      )}
    </div>
  );
}

/**
 * One clickable piece of furniture.
 *
 * A `<button>` wrapping the sprite rather than a hotspot floating over it: the
 * hit area is then the artwork itself at whatever size it is drawn, so resizing
 * an object can never leave its click target behind. `BLOCK_UI_SELECTOR` already
 * treats `button` as move-blocking, so a tap never also starts a raw world walk.
 */
function InteractiveObject({
  object,
  onArrive,
  requestInteraction,
}: {
  object: ClothingStoreObject;
  onArrive: () => void;
  requestInteraction: (opts: {
    target: { x: number; y: number };
    action: () => void;
  }) => void;
}) {
  return (
    <button
      type="button"
      data-clothing-store-object={object.id}
      data-clothing-store-interactive={object.interaction!.opens}
      aria-label={object.alt ?? undefined}
      onClick={() =>
        requestInteraction({
          target: object.interaction!.standPoint,
          action: onArrive,
        })
      }
      className={cn(object.className, INTERACTIVE_AFFORDANCE)}
    >
      <img src={object.src} alt="" aria-hidden draggable={false} className="w-full" />
    </button>
  );
}
