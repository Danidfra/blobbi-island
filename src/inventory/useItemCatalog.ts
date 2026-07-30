/**
 * Blobbi Island — item catalog query hook (Phase 3).
 *
 * Loads the official kind:31632 Game Item Definitions from the official issuer,
 * preferring the official item relays and additionally using the app's
 * currently-configured relay. Selection, issuer enforcement, and view-model
 * mapping are Island concerns; parsing/validation is delegated to
 * `@nostr-games/inventory` via the protocol adapter.
 *
 * Relay orchestration note: the app's shared `NPool` routes every query to a
 * single configured relay. The official definitions may live elsewhere, so this
 * hook opens short-lived direct `NRelay1` connections to the official relays
 * (plus the configured relay) purely to fetch the catalog. This is intentional
 * relay orchestration that the framework-free package does not handle.
 */

import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';

import { dedupeRelayUrls, queryRelays } from './relay-fan-out';

import {
  KIND_GAME_ITEM_DEFINITION,
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  OFFICIAL_ITEM_RELAYS,
} from './package';
import {
  OFFICIAL_COSMETIC_ADDRESSES,
  OFFICIAL_COSMETIC_D_TAGS,
  OFFICIAL_ITEM_ADDRESSES,
  OFFICIAL_ITEM_D_TAGS,
} from './registry';
import {
  type ResolvedBlobbiItemDefinition,
  bundledCosmeticFallbackDefinition,
  bundledFallbackDefinition,
} from './catalog-fallback';
import {
  parseOfficialItemDefinition,
  resolveFromDefinition,
} from './protocol-adapter';
import type { GameItemDefinition } from './package';

/** Canonical TanStack Query key for the item catalog. */
export const ITEM_CATALOG_QUERY_KEY = ['blobbi-item-catalog'] as const;

/** A resolved catalog: address → resolved definition. */
export interface ItemCatalog {
  /** Map of address → resolved definition (covers all 19 official items). */
  byAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /** How many of the 19 official items were resolved from a fetched 31632. */
  fetchedCount: number;
  /** Total official items. */
  totalCount: number;
  /** How many official COSMETICS were resolved from a fetched 31632. */
  cosmeticsFetched: number;
  /** Total official cosmetics. */
  cosmeticsTotal: number;
}

/**
 * Query the official relays (and the configured relay) for the 19 official item
 * definitions. Returns the newest valid addressable event per address.
 */
async function fetchOfficialDefinitions(
  relayUrls: string[],
  signal: AbortSignal,
): Promise<Map<string, GameItemDefinition>> {
  // ONE filter covering consumables AND cosmetics. They are separate identity
  // lists but the same issuer, the same kind and the same cache, so splitting
  // them would buy nothing and cost a second round trip per relay — and the
  // accessory path explicitly must not add a query per Blobbi or per accessory.
  const filter = {
    kinds: [KIND_GAME_ITEM_DEFINITION],
    authors: [OFFICIAL_ITEM_ISSUER_PUBKEY],
    '#d': [...OFFICIAL_ITEM_D_TAGS, ...OFFICIAL_COSMETIC_D_TAGS],
  };

  // Query each relay in parallel with a bounded timeout; tolerate failures.
  // The fan-out itself lives in `relay-fan-out.ts`, shared with the game item
  // tools so there is one multi-relay implementation rather than several.
  const outcomes = await queryRelays(relayUrls, [filter], { signal });

  return selectNewestValidDefinitions(outcomes.map((o) => o.events));
}

/**
 * Select the newest VALID official definition per address across event batches.
 *
 * Parsing/issuer-enforcement happens FIRST (via `parseOfficialItemDefinition`),
 * so a newer INVALID event or an event from a wrong issuer can never win over —
 * or hide — an older valid one, and never enters the fetched map at all.
 * Exported for testing.
 */
export function selectNewestValidDefinitions(
  perRelayEvents: readonly NostrEvent[][],
): Map<string, GameItemDefinition> {
  const byAddress = new Map<string, GameItemDefinition>();
  for (const events of perRelayEvents) {
    for (const event of events) {
      const def = parseOfficialItemDefinition(event);
      if (!def) continue; // rejects wrong issuer / invalid definitions
      const existing = byAddress.get(def.address);
      if (!existing || event.created_at > existing.event.created_at) {
        byAddress.set(def.address, def);
      }
    }
  }
  return byAddress;
}

/**
 * Load and resolve the canonical Blobbi item catalog.
 *
 * Resolution order per address: fetched 31632 → bundled fallback → (never
 * unknown here, since all 19 are official). Loading/partial/success/error
 * states are exposed via the standard TanStack Query result plus `fetchedCount`
 * on the data.
 */
export function useItemCatalog() {
  const { config } = useAppContext();

  return useQuery({
    // ONE canonical catalog key. The relay is only an internal query input, NOT
    // part of the catalog identity: the catalog always resolves the same 19
    // official addresses, always prefers the official relays, and falls back to
    // bundled metadata. Including the relay in the key would create redundant
    // duplicate caches on relay change. `NostrProvider` already resets queries
    // when the configured relay changes, so a relay switch is reconciled without
    // fragmenting the cache.
    queryKey: ITEM_CATALOG_QUERY_KEY,
    queryFn: async (c): Promise<ItemCatalog> => {
      // Prefer official relays; also include the configured relay as an
      // additional source. De-duplicate while preserving order.
      const relayUrls = dedupeRelayUrls([
        ...OFFICIAL_ITEM_RELAYS,
        config.relayUrl,
      ]);

      let fetched = new Map<string, GameItemDefinition>();
      try {
        fetched = await fetchOfficialDefinitions(relayUrls, c.signal);
      } catch {
        // Relay-wide failure → rely entirely on bundled fallback below.
        fetched = new Map();
      }

      const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
      let fetchedCount = 0;
      for (const address of OFFICIAL_ITEM_ADDRESSES) {
        const def = fetched.get(address);
        if (def) {
          byAddress.set(address, resolveFromDefinition(def));
          fetchedCount += 1;
        } else {
          // Bundled fallback is guaranteed for official addresses.
          byAddress.set(address, bundledFallbackDefinition(address)!);
        }
      }

      // Cosmetics resolve into the SAME map, so `useAccessoryItemDefinitions`
      // and every consumable consumer read one catalog. They are counted
      // separately because `fetchedCount`/`totalCount` are the CARE-item
      // coverage figures the existing UI reports, and folding hats into them
      // would silently change what those numbers mean.
      let cosmeticsFetched = 0;
      for (const address of OFFICIAL_COSMETIC_ADDRESSES) {
        const def = fetched.get(address);
        if (def) {
          byAddress.set(address, resolveFromDefinition(def));
          cosmeticsFetched += 1;
        } else {
          byAddress.set(address, bundledCosmeticFallbackDefinition(address)!);
        }
      }

      return {
        byAddress,
        fetchedCount,
        totalCount: OFFICIAL_ITEM_ADDRESSES.length,
        cosmeticsFetched,
        cosmeticsTotal: OFFICIAL_COSMETIC_ADDRESSES.length,
      };
    },
    // Definitions are effectively static; cache aggressively.
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24,
    // Even if relays fail, the queryFn always resolves (bundled fallback),
    // so there is no need to retry aggressively.
    retry: 1,
  });
}
