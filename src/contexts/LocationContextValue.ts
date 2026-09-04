import { createContext } from 'react';
import type { LocationId } from '@/lib/location-types';
import type { Position } from '@/lib/types';

interface LocationContextType {
  currentLocation: LocationId;
  setCurrentLocation: (location: LocationId) => void;
  previousLocation: LocationId | null;
  /**
   * The resumed actor position for this session's opening location, in internal
   * ground coordinates, or `null` for the scene's canonical spawn.
   *
   * Non-null ONLY between the bootstrap adoption and the first navigation,
   * `setCurrentLocation` clears it, so it can place the actor on the first
   * frame without ever competing with normal spawn rules afterwards.
   *
   * Optional so the hand-built context doubles in component tests, which model
   * a session already under way, keep meaning exactly what they meant before:
   * no bootstrap position, use the canonical spawn. `LocationProvider` always
   * supplies it.
   */
  bootstrapPosition?: Position | null;
  isMapModalOpen: boolean;
  setIsMapModalOpen: (open: boolean) => void;
  isTransitioning: boolean;
}

export const LocationContext = createContext<LocationContextType | undefined>(undefined);
