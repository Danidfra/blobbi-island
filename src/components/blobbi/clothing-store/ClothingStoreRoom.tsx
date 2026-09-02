import { useCallback, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  CLOTHING_STORE_SHOP_BUTTON,
  clothingStoreBlockers,
  clothingStoreHotspots,
  type ClothingStoreHotspot,
  type ClothingStoreSurface,
} from '@/lib/clothing-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { ClothingStoreModal } from './ClothingStoreModal';
import { FittingRoomModal } from './FittingRoomModal';

/**
 * The Clothing Store interior.
 *
 * ## The room is a picture; this component is what you can do to it
 *
 * `clothing-store.webp` paints the whole boutique — booths, mirror, shelving,
 * checkout, rack, bookcase, rug. There is no scene list any more and nothing to
 * render for it: the nine sprites this component used to compose (rug, posters,
 * sign, hat shelf, checkout, fitting room, two display tables) drew furniture
 * the artwork now contains, and drawing them over it would have shown the room
 * twice.
 *
 * What is left is collision and controls. Four blocker rectangles say where the
 * floor is occupied; three hotspots say which regions of the image are buttons.
 *
 * ## Four controls, two surfaces
 *
 * ```
 *   checkout ───────→ 'shop'         → <ClothingStoreModal>   (buys things)
 *   Shop button ────↗
 *   fitting room L ─→ 'fitting-room' → <FittingRoomModal>     (writes nothing)
 *   fitting room R ─↗
 * ```
 *
 * TWO booths and ONE preview modal; TWO shop controls and ONE shop modal. There
 * is exactly one `<ClothingStoreModal>` and one `<FittingRoomModal>` in this
 * tree, and `openSurface` decides which — see below for why that is a slot
 * rather than a pair of booleans.
 *
 * The three hotspots walk the Blobbi over and open on ARRIVAL; the corner Shop
 * button opens where the player stands, because its job is convenience rather
 * than immersion. That difference is the whole reason both exist.
 *
 * ## Nothing here transforms on hover
 *
 * The furniture is background pixels, so there is nothing to lift even if we
 * wanted to — and the Care Store facade settled that we do not: a thing that
 * moves off its own floor when you point at it reads as broken. The hotspots
 * tint and ring in place instead, on hover, on focus-visible and on press
 * alike, so pointer, keyboard and touch all get the same answer.
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
 * The affordance every hotspot in this room shares.
 *
 * A tint and a ring rather than a filter, because a hotspot is a transparent
 * region: there is nothing of its own to brighten, so the highlight has to be
 * the overlay itself. It is invisible at rest — the artwork already looks like a
 * counter and like two fitting rooms — and appears on hover, on `focus-visible`
 * and on press. No transform, no scale, no translation: the background never
 * moves.
 */
const HOTSPOT_AFFORDANCE =
  'cursor-pointer rounded-2xl bg-island-cream/0 ring-2 ring-inset ring-island-cream/0 ' +
  'transition-[background-color,box-shadow] duration-200 ease-cozy ' +
  'hover:bg-island-cream/15 hover:ring-island-cream/60 ' +
  'focus-visible:bg-island-cream/15 focus-visible:outline-none focus-visible:ring-island-cream/80 ' +
  'active:bg-island-cream/25 motion-reduce:transition-none';

export function ClothingStoreRoom({
  blobbiRef,
  selectedBlobbiId = null,
}: ClothingStoreRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();

  /**
   * WHICH surface is open, as one value rather than two booleans.
   *
   * The requirement is that the shop and the fitting room can never stack, and a
   * single slot makes that structural instead of guarded: there is no state in
   * which both are set, so no ordering of clicks and arrivals can produce one.
   * Two independent flags would have needed a guard, and a guard is a thing that
   * can be forgotten.
   *
   * It matters because a walk OUTLIVES the click that started it: an arrival
   * callback can land after the player has opened something else, which is
   * exactly when a second dialog would have appeared underneath the first.
   */
  const [openSurface, setOpenSurface] = useState<ClothingStoreSurface | null>(
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
  const open = useCallback((surface: ClothingStoreSurface) => {
    setOpenSurface((current) => current ?? surface);
  }, []);
  const close = useCallback(() => setOpenSurface(null), []);

  return (
    <div className="relative h-full w-full">
      {clothingStoreHotspots.map((hotspot) => (
        <Hotspot
          key={hotspot.id}
          hotspot={hotspot}
          onArrive={() => open(hotspot.opens)}
          requestInteraction={requestInteraction}
        />
      ))}

      {/*
        Floor footprints. Registered with the shared movement context, so the
        walk system, the route planner and remote presence all see the same
        rectangles; the red outlines only appear with the developer
        debug-overlays switch.
      */}
      {clothingStoreBlockers.map((blocker) => (
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
        The persistent shortcut. Opens where the player stands — no walk — and
        flips the same slot the checkout does, to the same value.
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
      {isShopOpen && <ClothingStoreModal isOpen onClose={close} />}
      {isFittingRoomOpen && <FittingRoomModal isOpen onClose={close} />}
    </div>
  );
}

/**
 * One clickable region of the artwork.
 *
 * A real `<button>` over the painted furniture rather than an image with a
 * handler, because there is no image: the counter and both booths are part of
 * the background. `BLOCK_UI_SELECTOR` already treats `button` as move-blocking,
 * so a tap never also starts a raw world walk, and the walk it does start goes
 * through the SAME `requestInteraction` path every door in the game uses — the
 * surface opens on arrival, never on the click.
 */
function Hotspot({
  hotspot,
  onArrive,
  requestInteraction,
}: {
  hotspot: ClothingStoreHotspot;
  onArrive: () => void;
  requestInteraction: (opts: {
    target: { x: number; y: number };
    action: () => void;
  }) => void;
}) {
  return (
    <button
      type="button"
      data-clothing-store-hotspot={hotspot.id}
      data-clothing-store-opens={hotspot.opens}
      aria-label={hotspot.label}
      onClick={() =>
        requestInteraction({ target: hotspot.standPoint, action: onArrive })
      }
      className={cn(hotspot.className, HOTSPOT_AFFORDANCE)}
    />
  );
}
