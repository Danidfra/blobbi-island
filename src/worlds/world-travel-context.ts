/**
 * What the world reads about its own Blobbi's travels: whether it is here
 * (and how it is drawn while it comes or goes), and the one way to open the
 * Worlds sheet. Provided by `WorldTravelProvider` around the playing view.
 *
 * The default (no provider: component tests, the dev harnesses) is a Blobbi
 * that is simply here, with no departure and no sheet, so every consumer
 * keeps rendering exactly as it did before travel existed.
 */
import { createContext, useContext } from 'react';

import type { BlobbiPresenceState, Journey } from './useBlobbiPresence';
import type { DeparturePhase } from './useWorldDeparture';

export interface WorldTravelView {
  /** How the Island draws its own Blobbi now. */
  presence: BlobbiPresenceState;
  /** The journey under way (the teleport's drawing follows it), or null. */
  journey: Journey | null;
  /** The goodbye under way, if any (`waving` is the wiggle). */
  departure: DeparturePhase;
  /**
   * The Blobbi is here and standing: the room may publish its presence
   * (kind 31950) for it. False while it is away, on its way, or leaving: a
   * Blobbi in another world is not standing in an Island room, and the two
   * presences must never contradict each other.
   */
  blobbiHere: boolean;
  openWorlds: () => void;
}

export const DEFAULT_WORLD_TRAVEL_VIEW: WorldTravelView = {
  presence: 'present',
  journey: null,
  departure: 'idle',
  blobbiHere: true,
  openWorlds: () => {},
};

export const WorldTravelContext = createContext<WorldTravelView>(DEFAULT_WORLD_TRAVEL_VIEW);

export function useWorldTravelView(): WorldTravelView {
  return useContext(WorldTravelContext);
}
