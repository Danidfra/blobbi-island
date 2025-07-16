import React, { createContext, useState, ReactNode } from 'react';
import type { LocationId } from '@/lib/location-types';

interface LocationContextType {
  currentLocation: LocationId;
  setCurrentLocation: (location: LocationId) => void;
  isMapModalOpen: boolean;
  setIsMapModalOpen: (open: boolean) => void;
}

export const LocationContext = createContext<LocationContextType | undefined>(undefined);

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