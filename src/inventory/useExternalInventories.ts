/**
 * Blobbi Island — the query hook over author-wide kind:31633 discovery.
 *
 * A thin TanStack wrapper around `fetchExternalInventories`. Everything that
 * decides anything — the filter, the per-context selection, the exclusion of
 * `blobbi:island` — lives in `external-inventories.ts` where it is pure and
 * testable without a renderer.
 *
 * Its own cache key, separate from `inventoryQueryKey`. The two reads answer
 * different questions and must never invalidate or overwrite one another:
 * `useIslandInventory` is the authoritative view of the inventory this game
 * WRITES, and this is a read-only view of the ones it does not.
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  fetchExternalInventories,
  type DiscoveredInventory,
} from './external-inventories';

/** Canonical TanStack Query key factory for discovered external inventories. */
export function externalInventoriesQueryKey(pubkey: string | undefined) {
  return ['blobbi-external-inventories-31633', pubkey] as const;
}

/**
 * Every kind:31633 inventory the signed-in player has authored, except Blobbi's
 * own. Disabled entirely when nobody is signed in — there is no player-wide
 * discovery without a player.
 */
export function useExternalInventories() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: externalInventoriesQueryKey(user?.pubkey),
    queryFn: async (c): Promise<DiscoveredInventory[]> => {
      if (!user?.pubkey) return [];
      return fetchExternalInventories(nostr, user.pubkey, { signal: c.signal });
    },
    enabled: !!user?.pubkey,
    // Same freshness as the Island inventory: a harvest in another game should
    // show up on the next look, not after a reload.
    staleTime: 15000,
  });
}
