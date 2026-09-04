import { useCallback, useState } from 'react';
import { Award } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  BADGES_STORE_CHECKOUT,
  BADGES_STORE_CHECKOUT_BLOCKER,
  BADGES_STORE_SHOP_BUTTON,
  badgesStoreObjects,
  type BadgesStoreObject,
} from '@/lib/badges-store-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { MovementBlocker } from '../MovementBlocker';
import { BadgesStoreModal } from './BadgesStoreModal';

/**
 * The Badges Store interior.
 *
 * ## Four ways in, one surface
 *
 * ```
 *   checkout ──┐
 *   case ──────┼─→ isOpen → <BadgesStoreModal>
 *   rack ──────┤
 *   Badges btn ┘
 * ```
 *
 * The three fixtures walk the Blobbi to a stand point and open on ARRIVAL; the
 * corner button opens where the player stands, because its job is convenience
 * rather than immersion. All four flip one boolean, so there is no state in
 * which two badge dialogs exist, the Clothing Store needed a slot for that
 * (it has two surfaces); this room has one, and one boolean says it.
 *
 * A walk OUTLIVES the click that started it, so `open()` is idempotent: an
 * arrival landing after the player already opened the modal changes nothing.
 *
 * ## Objects are data
 *
 * The case and the rack come from `badges-store-config.ts` with their own ids,
 * artwork, placement, footprint and interaction. The checkout is not in that
 * list because it is PAINTED INTO the background; there is no sprite to wrap,
 * so it gets a hotspot button over the artwork instead, exactly as the Clothing
 * Store's does.
 *
 * Nothing here transforms on hover. The Care Store facade settled that: a thing
 * that lifts off its own floor when you point at it reads as broken, so these
 * warm and glow and stay where they stand.
 *
 * ## Presentation here, protocol elsewhere
 *
 * This component imports no publisher, no wallet and no signer. Whatever a
 * badge turns out to be, acquiring one happens behind `src/badges/`.
 */

interface BadgesStoreRoomProps {
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

export function BadgesStoreRoom({
  blobbiRef,
  selectedBlobbiId = null,
}: BadgesStoreRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();

  const [isShopOpen, setIsShopOpen] = useState(false);

  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbiId ?? ''}`,
  });
  const { requestInteraction } = pendingInteraction;
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  const open = useCallback(() => setIsShopOpen(true), []);
  const close = useCallback(() => setIsShopOpen(false), []);

  return (
    <div className="relative h-full w-full">
      {badgesStoreObjects.map((object) =>
        object.interaction ? (
          <InteractiveObject
            key={object.id}
            object={object}
            onArrive={open}
            requestInteraction={requestInteraction}
          />
        ) : (
          <img
            key={object.id}
            data-badges-store-object={object.id}
            src={object.src}
            alt=""
            aria-hidden
            draggable={false}
            className={cn(object.className, 'pointer-events-none select-none')}
          />
        ),
      )}

      {/*
        The checkout. A hotspot rather than a sprite, because the counter is
        part of the background artwork; see BADGES_STORE_CHECKOUT.
      */}
      <button
        type="button"
        data-badges-store-object={BADGES_STORE_CHECKOUT.id}
        data-badges-store-interactive="badges"
        aria-label={BADGES_STORE_CHECKOUT.alt}
        onClick={() =>
          requestInteraction({
            target: BADGES_STORE_CHECKOUT.standPoint,
            action: open,
          })
        }
        className={cn(
          BADGES_STORE_CHECKOUT.className,
          'rounded-panel',
          INTERACTIVE_AFFORDANCE,
        )}
      />

      {/*
        Floor footprints. Registered with the shared movement context, so the
        walk system, the route planner and remote presence all see the same
        rectangles; the red outlines only appear with the debug-overlays switch.
      */}
      {badgesStoreObjects.map((object) =>
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
      <MovementBlocker
        id={BADGES_STORE_CHECKOUT.id}
        x={BADGES_STORE_CHECKOUT_BLOCKER.x}
        y={BADGES_STORE_CHECKOUT_BLOCKER.y}
        width={BADGES_STORE_CHECKOUT_BLOCKER.width}
        height={BADGES_STORE_CHECKOUT_BLOCKER.height}
      />

      {/*
        The persistent shortcut. Opens where the player stands, no walk, and
        flips the same flag the three fixtures do.
      */}
      <button
        type="button"
        data-badges-store-shop-button
        aria-label={BADGES_STORE_SHOP_BUTTON.label}
        onClick={open}
        className={`${BADGES_STORE_SHOP_BUTTON.className} inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-island-wood/30 bg-island-cream/90 px-3 py-1.5 text-xs font-bold text-island-ink shadow-cozy-raised backdrop-blur-sm transition-transform duration-150 ease-cozy hover:-translate-y-0.5 hover:bg-island-cream active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
      >
        <Award aria-hidden className="size-4" />
        {BADGES_STORE_SHOP_BUTTON.text}
      </button>

      <BackArrow
        onClick={() => setCurrentLocation('shop')}
        className="absolute top-[5%] left-4 w-12 h-12 z-[40] text-current"
      />

      {/* Mounted only while open. */}
      {isShopOpen && <BadgesStoreModal isOpen onClose={close} />}
    </div>
  );
}

/**
 * One clickable fixture.
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
  object: BadgesStoreObject;
  onArrive: () => void;
  requestInteraction: (opts: {
    target: { x: number; y: number };
    action: () => void;
  }) => void;
}) {
  return (
    <button
      type="button"
      data-badges-store-object={object.id}
      data-badges-store-interactive={object.interaction!.opens}
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
