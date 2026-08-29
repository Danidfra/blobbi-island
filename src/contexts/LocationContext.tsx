import React, { useState, ReactNode, useRef, useEffect } from 'react';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { LocationContext } from './LocationContextValue';

interface LocationProviderProps {
  children: ReactNode;
  /**
   * Where this session opens, once the resume decision has been made.
   *
   * BOOTSTRAP ONLY. It is adopted at most once, without a scene transition, and
   * only before the player has navigated — see {@link bootstrappedRef}. A later
   * change to this prop cannot move anyone; `useIslandLocationResume` resolves
   * once by construction, and this latch means location stays owned by
   * `setCurrentLocation` even if it did not.
   *
   * `undefined` while the decision is pending, and omitted entirely by the dev
   * pages, which keep the plain Town default.
   */
  initialLocation?: LocationId;
  /**
   * Where in {@link initialLocation} the actor starts, in internal ground
   * coordinates, already validated against that scene by the resume policy.
   *
   * Travels with the location and is latched by the same rule, so there is one
   * bootstrap adoption rather than two racing ones. `null`/absent means the
   * scene's canonical spawn, which is what every non-resumed entry uses.
   *
   * Consumed by `PlayingView` as `MovableBlobbi`'s `initialPosition`, so the
   * actor's FIRST rendered frame is already in the right place — there is no
   * follow-up effect that moves it afterwards.
   */
  initialPosition?: Position | null;
}

export function LocationProvider({
  children,
  initialLocation,
  initialPosition = null,
}: LocationProviderProps) {
  const [currentLocation, setCurrentLocation] = useState<LocationId>(
    initialLocation ?? 'town',
  );
  const [bootstrapPosition, setBootstrapPosition] = useState<Position | null>(
    initialLocation !== undefined ? initialPosition : null,
  );
  const [previousLocation, setPreviousLocation] = useState<LocationId | null>(null);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeout = useRef<NodeJS.Timeout | null>(null);

  /**
   * Has the initial location been settled? True as soon as EITHER the resume
   * decision was adopted OR the player navigated — whichever happens first wins
   * permanently, so an in-flight resume can never override a real move.
   */
  const bootstrappedRef = useRef(initialLocation !== undefined);

  // Adopt a resume decision that arrived after mount. No transition: this is not
  // travel, it is where the session begins, and the world is not on screen yet
  // (`BlobbiIsland` holds the playing view until the decision settles).
  // Read at ADOPTION time, not capture time. The position travels with the
  // location and is applied in the same commit that adopts it; making the effect
  // depend on it would let a position change alone trigger a second bootstrap.
  const initialPositionRef = useRef(initialPosition);
  initialPositionRef.current = initialPosition;

  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (initialLocation === undefined) return;
    bootstrappedRef.current = true;
    setCurrentLocation(initialLocation);
    setBootstrapPosition(initialPositionRef.current);
  }, [initialLocation]);

  const transitionToLocation = (location: LocationId) => {
    bootstrappedRef.current = true;
    // A real move ends the bootstrap for POSITION too, immediately and not on
    // the far side of the fade: from here on the destination scene's own spawn
    // rules decide, and a late resume answer has nothing left to apply.
    setBootstrapPosition(null);
    if (transitionTimeout.current) {
      clearTimeout(transitionTimeout.current);
    }
    setIsTransitioning(true);
    transitionTimeout.current = setTimeout(() => {
      setPreviousLocation(currentLocation);
      setCurrentLocation(location);

      transitionTimeout.current = setTimeout(() => {
        setIsTransitioning(false);
        transitionTimeout.current = null;
      }, 500); // Fade in
    }, 500); // Fade out
  };

  // NOTE: this context does not touch the Arcade Pass at all, and must not.
  //
  // It used to revoke the pass on leaving the arcade, and a `beforeunload`
  // handler used to revoke it on reload — which is why a pass bought for 20
  // coins vanished on refresh once location resume started restoring where you
  // were. Both are gone along with the visit-scoped pass itself.
  //
  // The pass is now a 24-hour entitlement redeemed with Arcade Tickets. It
  // expires on a clock, not on a location change, so navigation has no say in
  // its lifetime. See `contexts/arcade-pass-reload.test.tsx`.
  useEffect(() => {
    return () => {
      if (transitionTimeout.current) {
        clearTimeout(transitionTimeout.current);
      }
    };
  }, []);

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        setCurrentLocation: transitionToLocation,
        previousLocation,
        bootstrapPosition,
        isMapModalOpen,
        setIsMapModalOpen,
        isTransitioning,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
