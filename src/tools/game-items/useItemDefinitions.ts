/**
 * Reading kind:31632 definitions FOR THE TOOLS — which is a different question
 * from the one `useItemCatalog` answers.
 *
 * `useItemCatalog` loads the game's canonical catalog and rejects every issuer
 * except `OFFICIAL_ITEM_ISSUER_PUBKEY`, because a stranger must not be able to
 * decide what a player's carrot looks like. An authoring tool has the opposite
 * need: it must show you what you just published under YOUR key, and it must be
 * able to display somebody else's definition so you can inspect or derive from
 * it.
 *
 * So these queries parse without an issuer filter — and that widens NOTHING.
 * Nothing here feeds the catalog, the shop, or accessory resolution; the trust
 * boundary is still `parseOfficialItemDefinition`, still in the adapter, still
 * rejecting non-official events before they can reach gameplay. What this
 * module produces is labelled inspection data, and every surface that shows it
 * says whose key signed it.
 *
 * ONE QUERY PER QUESTION, never one per row. The browser asks a single
 * by-author question; the inventory inspector asks a single by-address question
 * for every address it holds at once. That is what keeps a 40-item inventory
 * from opening 40 subscriptions — see `docs/game-item-tools.md`.
 */

import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import {
  dedupeRelayUrls,
  queryRelays,
  type RelayQueryOutcome,
} from '@/inventory/relay-fan-out';
import {
  KIND_GAME_ITEM_DEFINITION,
  OFFICIAL_ITEM_RELAYS,
  parseGameItemAddress,
  parseGameItemDefinitionResult,
  type GameItemDefinition,
  type ParseWarning,
} from '@/inventory/package';

/** A definition as the tools show it: the event, what it parsed to, and where it came from. */
export interface PublishedDefinitionRecord {
  address: string;
  event: NostrEvent;
  definition: GameItemDefinition;
  warnings: ParseWarning[];
  /** Relays this exact event was seen on. Empty for a locally-inserted publish. */
  relays: string[];
}

/** Query keys, exported so publish can update caches without a refetch. */
export const DEFINITIONS_BY_AUTHOR_KEY = 'game-item-definitions-by-author';
export const DEFINITIONS_BY_ADDRESS_KEY = 'game-item-definitions-by-address';

export function definitionsByAuthorQueryKey(authors: readonly string[]) {
  return [DEFINITIONS_BY_AUTHOR_KEY, [...authors].sort().join(',')] as const;
}

export function definitionsByAddressQueryKey(addresses: readonly string[]) {
  return [DEFINITIONS_BY_ADDRESS_KEY, [...addresses].sort().join(',')] as const;
}

/**
 * Reduce per-relay results to the newest VALID event per address.
 *
 * Parse first, compare second — exactly like `selectNewestValidDefinitions` in
 * the catalog. A newer malformed event must not be able to hide an older good
 * one, and an event that fails to parse is not a definition at any age.
 *
 * Exported for tests.
 */
export function selectNewestDefinitions(
  outcomes: readonly RelayQueryOutcome[],
): Map<string, PublishedDefinitionRecord> {
  const byAddress = new Map<string, PublishedDefinitionRecord>();
  for (const outcome of outcomes) {
    for (const event of outcome.events) {
      const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
      if (!result.ok) continue;
      const address = result.value.address;
      const existing = byAddress.get(address);
      if (!existing) {
        byAddress.set(address, {
          address,
          event,
          definition: result.value,
          warnings: result.warnings,
          relays: [outcome.relay],
        });
        continue;
      }
      if (event.created_at > existing.event.created_at) {
        byAddress.set(address, {
          address,
          event,
          definition: result.value,
          warnings: result.warnings,
          relays: [outcome.relay],
        });
      } else if (event.id === existing.event.id && !existing.relays.includes(outcome.relay)) {
        // The same event on another relay: record the extra source rather than
        // replacing a record that is already current.
        existing.relays.push(outcome.relay);
      }
    }
  }
  return byAddress;
}

/** The relays the tools read and write: the official ones plus the configured one. */
export function useToolRelayUrls(): string[] {
  const { config } = useAppContext();
  return useMemo(
    () => dedupeRelayUrls([...OFFICIAL_ITEM_RELAYS, config.relayUrl]),
    [config.relayUrl],
  );
}

/**
 * Every kind:31632 definition published by the given authors.
 *
 * Disabled when there are no authors, so a logged-out visitor does not issue a
 * pointless unbounded query.
 */
export function useItemDefinitionsByAuthor(authors: readonly string[]) {
  const relayUrls = useToolRelayUrls();
  const authorList = useMemo(
    () => [...new Set(authors.filter(Boolean))].sort(),
    [authors],
  );

  return useQuery({
    queryKey: definitionsByAuthorQueryKey(authorList),
    queryFn: async (c): Promise<PublishedDefinitionRecord[]> => {
      const filters: NostrFilter[] = [
        { kinds: [KIND_GAME_ITEM_DEFINITION], authors: authorList, limit: 500 },
      ];
      const outcomes = await queryRelays(relayUrls, filters, { signal: c.signal });
      return [...selectNewestDefinitions(outcomes).values()];
    },
    enabled: authorList.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Resolve a specific set of addresses in ONE batched query.
 *
 * Filters are grouped by author so each relay request is precise
 * (`authors: [issuer], '#d': [...their d tags]`) instead of a cross product of
 * every issuer against every `d`. The inventory inspector calls this once with
 * every address it holds; there is no per-row query anywhere in this tool.
 */
export function useItemDefinitionsByAddress(addresses: readonly string[]) {
  const relayUrls = useToolRelayUrls();
  const addressList = useMemo(
    () => [...new Set(addresses.filter(Boolean))].sort(),
    [addresses],
  );

  return useQuery({
    queryKey: definitionsByAddressQueryKey(addressList),
    queryFn: async (c): Promise<Map<string, PublishedDefinitionRecord>> => {
      const byAuthor = new Map<string, string[]>();
      for (const address of addressList) {
        const parsed = parseGameItemAddress(address);
        if (!parsed) continue;
        const list = byAuthor.get(parsed.pubkey) ?? [];
        list.push(parsed.itemId);
        byAuthor.set(parsed.pubkey, list);
      }
      if (byAuthor.size === 0) return new Map();

      const filters: NostrFilter[] = [...byAuthor.entries()].map(
        ([pubkey, dTags]) => ({
          kinds: [KIND_GAME_ITEM_DEFINITION],
          authors: [pubkey],
          '#d': dTags,
        }),
      );

      const outcomes = await queryRelays(relayUrls, filters, { signal: c.signal });
      const found = selectNewestDefinitions(outcomes);
      // A relay may answer with more than we asked for; keep only what we hold.
      const wanted = new Set(addressList);
      for (const address of [...found.keys()]) {
        if (!wanted.has(address)) found.delete(address);
      }
      return found;
    },
    enabled: addressList.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Insert a just-published event into every cached list that should contain it,
 * so the UI reflects a publication WITHOUT a refetch and without a reload.
 *
 * De-duplication is by address, not by event id: an addressable update is a new
 * event for an address that already had one, and showing both would misrepresent
 * how replaceable events work. Newest `created_at` wins, which is the same rule
 * the queries use — a slow relay replying with the previous event a second later
 * cannot demote what was just published.
 */
export function upsertDefinitionRecord(
  queryClient: QueryClient,
  record: PublishedDefinitionRecord,
): void {
  queryClient.setQueriesData<PublishedDefinitionRecord[]>(
    { queryKey: [DEFINITIONS_BY_AUTHOR_KEY] },
    (previous) => {
      if (!previous) return previous;
      const existing = previous.find((r) => r.address === record.address);
      if (existing && existing.event.created_at > record.event.created_at) {
        return previous;
      }
      return [record, ...previous.filter((r) => r.address !== record.address)];
    },
  );

  queryClient.setQueriesData<Map<string, PublishedDefinitionRecord>>(
    { queryKey: [DEFINITIONS_BY_ADDRESS_KEY] },
    (previous) => {
      if (!previous || !previous.has(record.address)) return previous;
      const existing = previous.get(record.address);
      if (existing && existing.event.created_at > record.event.created_at) {
        return previous;
      }
      const next = new Map(previous);
      next.set(record.address, record);
      return next;
    },
  );
}

/** Turn a signed event into a record, or `null` when it is not a definition. */
export function toDefinitionRecord(
  event: NostrEvent,
  relays: readonly string[] = [],
): PublishedDefinitionRecord | null {
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) return null;
  return {
    address: result.value.address,
    event,
    definition: result.value,
    warnings: result.warnings,
    relays: [...relays],
  };
}

/**
 * Fetch ONE definition by address, on demand.
 *
 * A mutation rather than a query because it is triggered by a button press with
 * a value typed a moment earlier — there is no ongoing "current address" to
 * keep fresh, and a query keyed on a half-typed address would fire a relay
 * request per keystroke.
 */
export function useLoadItemDefinition() {
  const relayUrls = useToolRelayUrls();

  return useMutation({
    mutationFn: async (address: string): Promise<PublishedDefinitionRecord> => {
      const parsed = parseGameItemAddress(address.trim());
      if (!parsed) {
        throw new Error(
          `"${address}" is not a kind:31632 address. Expected 31632:<pubkey>:<d>.`,
        );
      }
      const outcomes = await queryRelays(
        relayUrls,
        [
          {
            kinds: [KIND_GAME_ITEM_DEFINITION],
            authors: [parsed.pubkey],
            '#d': [parsed.itemId],
          },
        ],
        { signal: AbortSignal.timeout(6000) },
      );
      const found = selectNewestDefinitions(outcomes).get(address.trim());
      if (!found) {
        const unreachable = outcomes.filter((o) => o.error).length;
        throw new Error(
          unreachable === outcomes.length
            ? 'No relay could be reached.'
            : 'No valid kind:31632 event was found at that address.',
        );
      }
      return found;
    },
  });
}

/** Invalidate every definition query, e.g. after the account or relay changes. */
export function useRefreshDefinitions() {
  const queryClient = useQueryClient();
  return useMemo(
    () => () => {
      queryClient.invalidateQueries({ queryKey: [DEFINITIONS_BY_AUTHOR_KEY] });
      queryClient.invalidateQueries({ queryKey: [DEFINITIONS_BY_ADDRESS_KEY] });
    },
    [queryClient],
  );
}
