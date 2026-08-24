/**
 * React bindings for the player-safety store.
 *
 * `useSyncExternalStore` over the module's own subscribe/snapshot pair, which is
 * the same shape `useArcadePass` uses. The snapshot is referentially stable
 * between real changes (see `relationships.ts`), so nothing tears and nothing
 * re-renders in a loop.
 *
 * Because the store's `storage` listener fires in every other tab, a component
 * using these hooks updates when the player blocks someone in a different tab —
 * with no extra machinery here.
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  NO_RELATIONSHIP,
  relationshipFor,
  relationshipsSnapshot,
  subscribeRelationships,
  type PlayerRelationship,
  type PlayerSafetyEntry,
} from './relationships';

/** No relationships. A stable empty array keeps the server snapshot identity-safe. */
const EMPTY: readonly PlayerSafetyEntry[] = Object.freeze([]);

/** Every relationship this player has, newest change first. */
export function usePlayerSafetyEntries(): readonly PlayerSafetyEntry[] {
  return useSyncExternalStore(subscribeRelationships, relationshipsSnapshot, () => EMPTY);
}

/**
 * The relationship with one player.
 *
 * Derived from the same snapshot rather than read independently, so a component
 * showing one player and a component showing the list can never disagree.
 */
export function usePlayerRelationship(pubkey: string | null | undefined): PlayerRelationship {
  const entries = usePlayerSafetyEntries();
  const key = pubkey?.toLowerCase() ?? '';
  const entry = entries.find((candidate) => candidate.pubkey === key);
  return entry ? { muted: entry.muted, blocked: entry.blocked } : NO_RELATIONSHIP;
}

/**
 * Subscribe to relationship changes without re-rendering on them.
 *
 * For the places that must EVICT state when someone is blocked — the presence
 * map, the bubble queue — where the reaction is imperative and a re-render is
 * beside the point.
 */
export function useOnPlayerSafetyChange(onChange: () => void): void {
  const stable = useCallback(onChange, [onChange]);
  useSyncExternalStore(
    useCallback(
      (notify) =>
        subscribeRelationships(() => {
          stable();
          notify();
        }),
      [stable],
    ),
    // A constant snapshot: this hook exists for the side effect, and returning
    // anything that changed would re-render every consumer on every change.
    () => 0,
    () => 0,
  );
}

export { relationshipFor };
