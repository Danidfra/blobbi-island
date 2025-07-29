import React, { useState, ReactNode, useRef, useEffect } from 'react';
import type { LocationId } from '@/lib/location-types';
import { LocationContext } from './LocationContextValue';

interface LocationProviderProps {
  children: ReactNode;
}

export function LocationProvider({ children }: LocationProviderProps) {
  const [currentLocation, setCurrentLocation] = useState<LocationId>('town');
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeout = useRef<NodeJS.Timeout | null>(null);

  const transitionToLocation = (location: LocationId) => {
    if (transitionTimeout.current) {
      clearTimeout(transitionTimeout.current);
    }
    setIsTransitioning(true);
    transitionTimeout.current = setTimeout(() => {
      setCurrentLocation(location);

      // Clear arcade pass when leaving arcade locations
      if (!location.startsWith('arcade')) {
        sessionStorage.removeItem('has-arcade-pass');
      }

      transitionTimeout.current = setTimeout(() => {
        setIsTransitioning(false);
        transitionTimeout.current = null;
      }, 500); // Fade in
    }, 500); // Fade out
  };

  useEffect(() => {
    // Clear arcade pass on page load/reload
    const handleBeforeUnload = () => {
      sessionStorage.removeItem('has-arcade-pass');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
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
        isMapModalOpen,
        setIsMapModalOpen,
        isTransitioning,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
