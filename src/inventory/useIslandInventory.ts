/**
 * Blobbi Island — kind:31633 inventory read model + hook (Phase 4).
 *
 * The protocol representation stays ADDRESS-BASED (the package `GameInventory`
 * with `31632:<issuer>:<d>` item addresses). This module adds an Island view
 * model that joins each address to its resolved catalog definition and legacy
 * itemId for the UI.
 *
 * Reads NEVER touch kind:11125 (`storage` or `inv`). Every user starts with an
 * empty inventory until they acquire items through kind:31633.
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  type GameInventory,
  KIND_GAME_INVENTORY,
  ISLAND_INVENTORY_D,
  buildGameInventoryEvent,
} from './package';
import { parseInventoryEvent, getInventoryItems } from './protocol-adapter';
import {
  type ResolvedBlobbiItemDefinition,
  bundledFallbackDefinition,
  unknownItemDefinition,
} from './catalog-fallback';
import { addressToItemId } from './registry';
import type { ItemCatalog } from './useItemCatalog';

/** Island view-model entry for a single owned item. */
export interface IslandInventoryEntry {
  /** Canonical kind:31632 address (protocol identity). */
  address: string;
  /** Legacy/UI id, or `null` for unknown items. */
  itemId: string | null;
  /** Positive integer quantity. */
  quantity: number;
  /** Resolved catalog definition for rendering / effects. */
  definition: ResolvedBlobbiItemDefinition;
}

/** Canonical TanStack Query key factory for the Island inventory. */
export function inventoryQueryKey(pubkey: string | undefined) {
  return ['blobbi-inventory-31633', pubkey] as const;
}

/**
 * Build a valid, empty package `GameInventory` for the given owner. Used as the
 * base for the very first mutation and to represent "no event yet".
 *
 * We build a real event template via the package builder and parse it back, so
 * the object is exactly what the package expects (never a hand-rolled shape).
 */
export function buildEmptyInventory(ownerPubkey: string): GameInventory {
  const template = buildGameInventoryEvent({ id: ISLAND_INVENTORY_D });
  const event: NostrEvent = {
    id: '',
    pubkey: ownerPubkey,
    created_at: 0,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: '',
  };
  // Parsing a freshly-built event cannot fail (valid d, right kind).
  return parseInventoryEvent(event)!;
}

/**
 * Fetch the newest valid kind:31633 inventory for the given pubkey via the
 * shared pool. Returns the parsed `GameInventory`, or an empty inventory when
 * no valid event exists.
 */
export async function fetchInventory(
  nostr: ReturnType<typeof useNostr>['nostr'],
  pubkey: string,
  signal: AbortSignal,
): Promise<GameInventory> {
  const events = await nostr.query(
    [
      {
        kinds: [KIND_GAME_INVENTORY],
        authors: [pubkey],
        '#d': [ISLAND_INVENTORY_D],
        limit: 1,
      },
    ],
    { signal },
  );

  // Select the newest valid event (relays can return out of order).
  const valid = events
    .map((e) => ({ event: e, parsed: parseInventoryEvent(e) }))
    .filter((x): x is { event: NostrEvent; parsed: GameInventory } =>
      Boolean(x.parsed),
    )
    .sort((a, b) => b.event.created_at - a.event.created_at);

  return valid.length > 0 ? valid[0].parsed : buildEmptyInventory(pubkey);
}

/**
 * Load the current user's canonical Island inventory (kind:31633).
 *
 * Exposes an empty inventory when no event exists. Uses a single canonical
 * query key. Never reads 11125.
 */
export function useIslandInventory() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: inventoryQueryKey(user?.pubkey),
    queryFn: async (c): Promise<GameInventory> => {
      if (!user?.pubkey) {
        // No user: return a placeholder empty inventory owned by nobody.
        return buildEmptyInventory('');
      }
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      return fetchInventory(nostr, user.pubkey, signal);
    },
    enabled: !!user?.pubkey,
    staleTime: 15000,
  });
}

/**
 * Join a package `GameInventory` with a resolved catalog into Island view-model
 * entries. When the catalog is unavailable, falls back to bundled/unknown
 * definitions so the UI still renders.
 */
export function toIslandEntries(
  inventory: GameInventory | undefined | null,
  catalog: ItemCatalog | undefined,
): IslandInventoryEntry[] {
  if (!inventory) return [];
  return getInventoryItems(inventory).map((item) => {
    const definition =
      catalog?.byAddress.get(item.address) ??
      bundledFallbackDefinition(item.address) ??
      unknownItemDefinition(item.address);
    return {
      address: item.address,
      itemId: addressToItemId(item.address),
      quantity: item.quantity,
      definition,
    };
  });
}
