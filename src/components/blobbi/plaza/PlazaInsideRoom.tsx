import { useLocation } from '@/hooks/useLocation';
import { usePendingInteraction } from '@/hooks/usePendingInteraction';
import { useCancelInteractionOnWorldClick } from '@/hooks/useCancelInteractionOnWorldClick';
import {
  PLAZA_DEPTH,
  PLAZA_DOOR,
  PLAZA_FOUNTAIN,
  PLAZA_OVERLAY,
  plazaInsideBlockers,
  plazaStorefronts,
} from '@/lib/plaza-inside-config';
import type { MovableBlobbiRef } from '../MovableBlobbi';
import { BackArrow } from '../BackArrow';
import { InteractiveElement } from '../InteractiveElement';
import { MovementBlocker } from '../MovementBlocker';
import { StorefrontHotspot } from '../StorefrontHotspot';

/**
 * The Plaza interior.
 *
 * A room in the shape the arcade and the shop interiors established: its own
 * walk-to-interact instance, its own collision furniture, and a config file
 * (`plaza-inside-config.ts`) holding every number. `InteractiveElements`
 * dispatches to it on background and knows nothing else about the place.
 *
 * ## Almost everything is in the picture
 *
 * `plaza-inside.webp` paints the six storefronts, the balcony, the staircase,
 * the rug and the planters. The room therefore composes only what a picture
 * cannot do:
 *
 * - the **door**, whose open-door overlay is a hover/tap affordance;
 * - the **balcony-and-staircase overlay**, the room's one occluder, so a Blobbi
 *   on the upper corridor passes behind the railing (which band it is in is
 *   `interactive-elements-config.ts`'s business);
 * - six **storefront hotspots**, one per painted bay, each a `<button>` that
 *   walks the player there and then either goes in or says "Coming soon";
 * - the **fountain**, the one prop with no painted counterpart;
 * - the **blockers** for the things standing on the ground floor.
 *
 * The chill lounge, drawing wall and information kiosk sprites that used to
 * float over the old plate are gone: the new plate paints their successors.
 */

interface PlazaInsideRoomProps {
  blobbiRef: React.RefObject<MovableBlobbiRef>;
  /** Selected Blobbi id, used only to invalidate pending walks when it changes. */
  selectedBlobbiId?: string | null;
}

export function PlazaInsideRoom({ blobbiRef, selectedBlobbiId = null }: PlazaInsideRoomProps) {
  const { currentLocation, setCurrentLocation } = useLocation();

  const pendingInteraction = usePendingInteraction({
    blobbiRef,
    cancelKey: `${currentLocation}:${selectedBlobbiId ?? ''}`,
  });
  const { requestInteraction } = pendingInteraction;
  useCancelInteractionOnWorldClick(pendingInteraction, currentLocation);

  return (
    <>
      {/*
        The door — closed art as the base, the open art as a hover/tap overlay
        (the shopping mall's store-door pattern). Deepest layer in the room, so
        the overlay's top step covers its base. The group is stretched
        vertically to fit the painted door behind it; see `PLAZA_DOOR`.
      */}
      <div
        data-plaza-door
        className="absolute"
        style={{
          left: `${PLAZA_DOOR.placement.left}%`,
          top: `${PLAZA_DOOR.placement.top}%`,
          width: `${PLAZA_DOOR.placement.width}%`,
          zIndex: PLAZA_DEPTH.door,
          transform: `scaleY(${PLAZA_DOOR.scaleY})`,
          transformOrigin: 'top center',
        }}
      >
        <img src={PLAZA_DOOR.closedSrc} alt={PLAZA_DOOR.closedAlt} className="block w-full" />
        <InteractiveElement
          src={PLAZA_DOOR.openSrc}
          alt={PLAZA_DOOR.openAlt}
          animated={false}
          effect="door"
          onClick={() => setCurrentLocation(PLAZA_DOOR.leadsTo)}
          requestInteraction={requestInteraction}
          walkTarget={PLAZA_DOOR.walkTarget}
          className={PLAZA_DOOR.openOverlayClassName}
        />
      </div>

      {/*
        The occluder: the plate's own railing and staircase, cut out and drawn
        above the Blobbi. Pointer-transparent, or it would swallow the door's
        hover and every upper-floor tap.
      */}
      <img
        src={PLAZA_OVERLAY.src}
        alt={PLAZA_OVERLAY.alt}
        className={PLAZA_OVERLAY.className}
        style={{ zIndex: PLAZA_DEPTH.overlay }}
      />

      {/* The six storefronts. Which ones are open is config, not code. */}
      {plazaStorefronts.map((store) => (
        <StorefrontHotspot
          key={store.id}
          config={store}
          zIndex={PLAZA_DEPTH.storefront}
          requestInteraction={requestInteraction}
          onEnter={setCurrentLocation}
        />
      ))}

      {/* The fountain, on the open floor below the rug. */}
      <div
        data-plaza-fountain
        className="absolute -translate-x-1/2"
        style={{
          left: `${PLAZA_FOUNTAIN.placement.centerX}%`,
          bottom: `${PLAZA_FOUNTAIN.placement.bottom}%`,
          width: `${PLAZA_FOUNTAIN.placement.width}%`,
          zIndex: PLAZA_DEPTH.fountain,
        }}
      >
        <img src={PLAZA_FOUNTAIN.plinthSrc} alt="" aria-hidden className="block w-full" />
        <img src={PLAZA_FOUNTAIN.basinSrc} alt="Plaza fountain" className={PLAZA_FOUNTAIN.basinClassName} />
        <img src={PLAZA_FOUNTAIN.spireSrc} alt="" aria-hidden className={PLAZA_FOUNTAIN.spireClassName} />
      </div>

      {/*
        Collision furniture. Registers on mount, deregisters on unmount; the red
        outlines only appear with the shared developer debug-overlays switch.
      */}
      {plazaInsideBlockers.map((blocker) => (
        <MovementBlocker
          key={blocker.id}
          id={blocker.id}
          x={blocker.x}
          y={blocker.y}
          width={blocker.width}
          height={blocker.height}
        />
      ))}

      <BackArrow
        onClick={() => setCurrentLocation(PLAZA_DOOR.leadsTo)}
        className="absolute top-[5%] left-4 w-12 h-12 z-20 text-current"
      />
    </>
  );
}
