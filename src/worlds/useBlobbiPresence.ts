/**
 * Whether the player's own Blobbi is HERE, as the Island shows it: the one
 * presence controller every journey goes through. It is the Home's teleport
 * presence machine (`./teleport/presence.ts`, through its React binding
 * `usePresence`), so a Blobbi leaves the Island and arrives on it with the
 * very same choreography, timings and motes as it does at the Home and in
 * Pixel: gather, dissolve top-down into rising motes, gone; motes falling,
 * form bottom-up, hold, open.
 *
 *   present    standing in the room, as always
 *   departing  the departure plays; at its end it is absent
 *   absent     not drawn: it is in another world (or its place is not known)
 *   arriving   the arrival plays; at its end it is present
 *
 * The same four verbs the kit's world-travel sync drives (`ShownBlobbi`):
 * `leave()`, `enter()`, `settle(state)` (be there at once, no journey) and
 * `cancel()` (end a journey under way: present again). A journey turned
 * back continues from the same visible amount of body; journeys never
 * stack; under reduced motion both are the short fade.
 *
 * The controller object is stable for the life of the component, so a
 * consumer can hold it in a ref or hand it to the sync; `state` and
 * `journey` re-render.
 */
import type { PresenceController, PresenceState } from './teleport/presence';
import type { Journey } from './teleport/presence';
import { ARRIVE, DEPART, REDUCED } from './teleport/timeline';
import { usePresence } from './teleport/react/usePresence';

export type BlobbiPresenceState = PresenceState;
export type { Journey };

export const PRESENCE = {
  /** The departure's length (the Home's timeline). */
  departMs: DEPART.total,
  /** The arrival's length. */
  arriveMs: ARRIVE.total,
  /** Reduced motion: the short fade each way. */
  reducedMs: REDUCED.total,
  /** How long the arrival's motes come down before the body starts to form (the kit's `arrivalLeadMs`). */
  arriveLeadMs: ARRIVE.incoming,
} as const;

export type BlobbiPresenceController = Pick<PresenceController, 'getState' | 'leave' | 'enter' | 'settle' | 'cancel' | 'isDisposed'>;

export interface BlobbiPresence {
  state: BlobbiPresenceState;
  /** The journey under way, for the drawing (`TeleportFrame2D`), or null. */
  journey: Journey | null;
  controller: BlobbiPresenceController;
}

export interface UseBlobbiPresenceOptions {
  /** Where it starts (an Island whose Blobbi's place is not known yet starts absent). */
  initial?: 'present' | 'absent';
  reducedMotion?: boolean;
}

export function useBlobbiPresence({ initial = 'present', reducedMotion = false }: UseBlobbiPresenceOptions = {}): BlobbiPresence {
  const presence = usePresence({ initial, reducedMotion: () => reducedMotion });
  return { state: presence.state, journey: presence.journey, controller: presence.controller };
}
