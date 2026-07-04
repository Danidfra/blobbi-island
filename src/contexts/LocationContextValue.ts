import { createContext } from 'react';
import type { LocationId } from '@/lib/location-types';

interface LocationContextType {
  currentLocation: LocationId;
  setCurrentLocation: (location: LocationId) => void;
  previousLocation: LocationId | null;
  isMapModalOpen: boolean;
  setIsMapModalOpen: (open: boolean) => void;
  isTransitioning: boolean;
}

export const LocationContext = createContext<LocationContextType | undefined>(undefined);
