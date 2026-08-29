/**
 * Writes a confirmed kind:31633 event straight into the canonical inventory
 * query cache.
 *
 * The reader already folds the confirmed event in (see `useIslandInventory`),
 * which makes a lagging relay unable to roll the UI backwards — but that only
 * takes effect on the NEXT read, which is a round trip away. This closes the
 * gap: the moment a relay accepts a write, every consumer of the inventory
 * query re-renders with it.
 *
 * Mount ONCE at the authenticated app root. It renders nothing, publishes
 * nothing, and is the only place a feature's cache is updated on its behalf —
 * so no surface has to patch quantities itself.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { subscribeConfirmedInventory } from './confirmed-inventory';
import { parseInventoryEvent } from './protocol-adapter';
import { inventoryQueryKey } from './useIslandInventory';
import type { GameInventory } from './package';

export function useInventoryCacheSync(): void {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  useEffect(() => {
    if (!pubkey) return;
    return subscribeConfirmedInventory((owner, event) => {
      // Another account's write must not touch this account's cache.
      if (owner !== pubkey) return;
      const parsed = parseInventoryEvent(event);
      if (!parsed) return;
      queryClient.setQueryData<GameInventory>(inventoryQueryKey(owner), (current) => {
        // Never go backwards: an in-flight read that resolves later with an
        // older event is still handled by the reader's own fold, and a slow
        // callback must not undo a newer confirmation either.
        const currentAt = current?.event?.created_at ?? -1;
        return currentAt > event.created_at ? current : parsed;
      });
    });
  }, [pubkey, queryClient]);
}
