import React, { useState, ReactNode } from 'react';
import type { LocationId } from '@/lib/location-types';
import { LocationContext } from './LocationContextValue';

interface LocationProviderProps {
  children: ReactNode;
}

export function LocationProvider({ children }: LocationProviderProps) {
  const [currentLocation, setCurrentLocation] = useState<LocationId>('town');
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        setCurrentLocation,
        isMapModalOpen,
        setIsMapModalOpen,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
