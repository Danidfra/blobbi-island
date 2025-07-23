import { createContext } from 'react';
import type { LocationId } from '@/lib/location-types';

interface LocationContextType {
  currentLocation: LocationId;
  setCurrentLocation: (location: LocationId) => void;
  isMapModalOpen: boolean;
  setIsMapModalOpen: (open: boolean) => void;
}

export const LocationContext = createContext<LocationContextType | undefined>(undefined);
