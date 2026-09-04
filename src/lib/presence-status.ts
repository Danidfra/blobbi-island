/**
 * What the player should be told about multiplayer presence — ONE small
 * store, written by the presence lifecycle and read by the HUD.
 *
 * Presence is best-effort chrome around the game: the Island is fully
 * playable without it. The only state worth a word to the player is the one
 * they caused and can change — declining to sign presence — and even that is
 * said once, quietly, without a kind number, a signer name or a relay in
 * sight.
 */

import { useSyncExternalStore } from 'react';

export type PresenceStatus =
  /** No presence lifecycle is running (not in the world, or signed out). */
  | 'idle'
  /** Presence is being published normally (or is still starting). */
  | 'live'
  /**
   * The signer declined to sign presence. Other players cannot see this
   * Blobbi; this Blobbi still sees them. Nothing is retried until the world
   * is entered again.
   */
  | 'signer-declined';

let status: PresenceStatus = 'idle';
const listeners = new Set<() => void>();

export function setPresenceStatus(next: PresenceStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of [...listeners]) listener();
}

export function getPresenceStatus(): PresenceStatus {
  return status;
}

export function usePresenceStatus(): PresenceStatus {
  return useSyncExternalStore(subscribe, getPresenceStatus, () => 'idle');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Player-facing copy for a status, or `null` when there is nothing to say. */
export function presenceStatusMessage(value: PresenceStatus): string | null {
  return value === 'signer-declined' ? "You're exploring offline from other players." : null;
}
