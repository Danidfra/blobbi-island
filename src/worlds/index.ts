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
 *   away / looking / coming / here, "Bring here"; opening the Island brings
 *   an away Blobbi here once per page, and a door moves it to the world it
 *   opens before the page goes (world-travel-departure.ts)
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
export { useIslandWorldTravel } from './useIslandWorldTravel';
export type { AutoArrival, AutoArrivalInput, DepartToInput, DepartureOutcome, DepartureResult } from './world-travel-departure';
export { ARRIVAL_INTENT_TTL_MS, ArrivalIntent, DEPART_PUBLISH_TIMEOUT_MS, DEPART_SIGN_TIMEOUT_MS, SIGN_PROMPT_TIMEOUT_MS, SignerTimeoutError, autoArrivalDecision, boundedSigner, departTo, dropLegacyHandoff, dropLegacyHandoffStore, pageAgeMs, pageIsFresh } from './world-travel-departure';
export type { EntryDecision, EntryFacts } from './entry-arrival';
export { ENTRY_BEAT_MS, ENTRY_HOLD_MAX_MS, entryArrivalEnabled, entryDecision, setEntryArrivalEnabled } from './entry-arrival';
export type { WorldTravelView } from './world-travel-context';
export { DEFAULT_WORLD_TRAVEL_VIEW, WorldTravelContext, useWorldTravelView } from './world-travel-context';
export { WorldTravelProvider } from './WorldTravelProvider';
export { WorldsModal } from './WorldsModal';
export { DepartureNotice } from './DepartureNotice';
export { WorldAwayNotice } from './WorldAwayNotice';
