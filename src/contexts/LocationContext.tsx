import React, { useState, ReactNode, useRef, useEffect } from 'react';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';
import { clearArcadePass } from '@/lib/arcade-pass';
import { isArcadeLocation } from '@/lib/location-resume';
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

      // Leaving the arcade revokes the Arcade Pass — the product rule, unchanged.
      // Routed through the store (not a raw `sessionStorage.removeItem`) so the
      // HUD chip is notified; the direct write bypassed every subscriber.
      if (!isArcadeLocation(location)) {
        clearArcadePass();
      }

      transitionTimeout.current = setTimeout(() => {
        setIsTransitioning(false);
        transitionTimeout.current = null;
      }, 500); // Fade in
    }, 500); // Fade out
  };

  // NOTE: there is deliberately NO `beforeunload` handler clearing the Arcade
  // Pass here.
  //
  // One used to exist, and it is why a purchased pass vanished on refresh:
  // `sessionStorage` survives a reload in the same tab, but the handler deleted
  // the key on the way out, so the player came back without the pass they had
  // just paid 20 coins for. It was defensible before location resume — a reload
  // always landed you in Town, so you really had left the arcade — and became a
  // double charge the moment reloads started restoring where you were.
  //
  // The product rule is unchanged and lives where it belongs: the pass is
  // revoked when the LOCATION stops being an arcade location, both on navigation
  // (above) and on entry (`PlayingView`'s effect, which also covers a bootstrap
  // that resumes somewhere else). A reload is not a location change, so it no
  // longer counts as leaving. See `contexts/arcade-pass-reload.test.tsx`.
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
