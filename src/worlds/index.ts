/**
 * World Navigation and World Travel: taking the Blobbi to the other Blobbi
 * worlds, and knowing where it is (`docs/world-travel.md`).
 *
 * ```
 *   dock "Worlds" ──▶ WorldsModal ──▶ useWorldDeparture (notice, wave, leave)
 *                                            │
 *                               useBlobbiPresence (the actor dissolves)
 *                                            │
 *                               requestEgress({ class: 'world-travel' })
 *                                            ▼
 *                                   the other world's origin
 *
 *   useIslandWorldTravel (kit World Travel, kind 31126) ──▶ the same presence:
 *   away / looking / coming / here, "Call here", following the player
 * ```
 */
export type { World, WorldId, OpenWorld, WorldUrlOverrides } from './worlds';
export { WORLDS_CHECKED_ON, WORLD_ISLAND, WORLD_FARM, WORLD_RUMBLE, isTravelUrl, worldById, worldByTravelId, worldUrlEnvName, worldUrlOverrides, worlds } from './worlds';
export type { TravelMode } from './travel-mode';
export { TRAVEL_MODE_KEY, isTrustedInput, setTravelMode, setTrustedInputCheck, travelMode } from './travel-mode';
export type { TravelBuildCheck } from './travel-build';
export { checkTravelBuild } from './travel-build';
export type { BlobbiPresence, BlobbiPresenceController, BlobbiPresenceState } from './useBlobbiPresence';
export { PRESENCE, useBlobbiPresence } from './useBlobbiPresence';
export type { DeparturePhase, WorldDeparture } from './useWorldDeparture';
export { DEPARTURE, useWorldDeparture } from './useWorldDeparture';
export type { IslandWorldTravel } from './useIslandWorldTravel';
export { ISLAND_FOLLOW_AFTER, useIslandWorldTravel } from './useIslandWorldTravel';
export type { EntryDecision, EntryFacts } from './entry-arrival';
export { ENTRY_BEAT_MS, ENTRY_HOLD_MAX_MS, entryArrivalEnabled, entryDecision, setEntryArrivalEnabled } from './entry-arrival';
export type { WorldTravelView } from './world-travel-context';
export { DEFAULT_WORLD_TRAVEL_VIEW, WorldTravelContext, useWorldTravelView } from './world-travel-context';
export { WorldTravelProvider } from './WorldTravelProvider';
export { WorldsModal } from './WorldsModal';
export { DepartureNotice } from './DepartureNotice';
export { WorldAwayNotice } from './WorldAwayNotice';
