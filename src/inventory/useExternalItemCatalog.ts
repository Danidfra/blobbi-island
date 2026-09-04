/**
 * Blobbi Island: resolving the kind:31632 definitions of items owned in
 * ANOTHER game's inventory.
 *
 * `useItemCatalog` answers "what are Blobbi's own items": one filter, the
 * official issuer, a fixed list of official `d` tags, a one-hour cache and
 * bundled fallbacks. It is deliberately closed, the game must not be at the
 * mercy of a relay to know what an apple is.
 *
 * This hook answers a different question: a discovered inventory
 * (`external-inventories.ts`) names items by full address, and Island has never
 * heard of any of them. It cannot ship a fallback for an item it does not know,
 * and it must not invent one, so this resolves what the issuer actually
 * published, or nothing at all.
 *
 * ## Trust, then fetch. Never the other way round.
 *
 * Addresses are grouped by ISSUER and every issuer that is not a trusted
 * partner is dropped BEFORE a query is built. An untrusted issuer therefore
 * costs no connection, produces no cache entry and can never reach the UI,
 * the failure mode is a missing tile, which is the correct one.
 *
 * `parseTrustedItemDefinition` then re-checks the issuer on the returned
 * events, because what a relay serves is not necessarily what was asked for.
 *
 * ## Why one query per issuer
 *
 * `authors` and `#d` in a single filter are ANDed, so one combined filter
 * across two issuers would also match issuer A publishing issuer B's `d`: the
 * exact `d`-as-identity confusion this whole design refuses. One filter per
 * issuer keeps `31632:<issuer>:<d>` intact as the unit of identity, and there
 * are as many round trips as there are partner games in the player's
 * inventories: today, one.
 */

import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';

import { dedupeRelayUrls, queryRelays } from './relay-fan-out';
import {
  KIND_GAME_ITEM_DEFINITION,
  OFFICIAL_ITEM_RELAYS,
  parseGameItemAddress,
  type GameItemDefinition,
} from './package';
import { parseTrustedItemDefinition, resolveFromDefinition } from './protocol-adapter';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import {
  getTrustedItemIssuer,
  type TrustedItemIssuer,
} from './trusted-issuers';
import type { DiscoveredInventoryItem } from './external-inventories';

/** Resolved definitions for external items, keyed by full address. */
export interface ExternalItemCatalog {
  byAddress: ReadonlyMap<string, ResolvedBlobbiItemDefinition>;
  /** How many of the requested trusted addresses actually resolved. */
  resolvedCount: number;
  /** How many trusted addresses were asked for. */
  requestedCount: number;
}

const EMPTY_CATALOG: ExternalItemCatalog = {
  byAddress: new Map(),
  resolvedCount: 0,
  requestedCount: 0,
};

/**
 * How many relay-hint URLs one issuer's fetch may contribute.
 *
 * A hint is an arbitrary string in an event: benign in practice (the player
 * signed their own inventory), but an unbounded list of them would turn one
 * catalog load into an unbounded fan-out of WebSocket connections. Two is
 * enough for the redundancy a hint exists to provide.
 */
const MAX_RELAY_HINTS_PER_ISSUER = 2;

/** Total relays one issuer's fetch may open, hints and known relays together. */
const MAX_RELAYS_PER_ISSUER = 6;

/** One issuer's slice of the work: who they are, and which `d` values to ask for. */
export interface IssuerRequest {
  issuer: TrustedItemIssuer;
  /** `d` tags to request, deduped. */
  dTags: string[];
  /** Relay hints carried by the referencing `a` tags, already sanitized. */
  hints: string[];
  /** Full addresses expected back, for post-fetch containment. */
  addresses: Set<string>;
}

/**
 * A relay hint we are willing to connect to.
 *
 * Nostr relay URLs are `ws://` or `wss://`. Anything else in that tag slot is
 * not a relay, so it is not "a hint we could not use": it is not a hint.
 */
export function isUsableRelayHint(hint: string): boolean {
  if (!hint) return false;
  try {
    const url = new URL(hint);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

/**
 * Group item references by trusted issuer, dropping everything else.
 *
 * Exported for testing: this is the gate, and a gate deserves its own test
 * rather than only being observed through a rendered grid.
 */
export function groupTrustedRequests(
  items: readonly DiscoveredInventoryItem[],
): IssuerRequest[] {
  const byIssuer = new Map<string, IssuerRequest>();

  for (const item of items) {
    const parsed = parseGameItemAddress(item.address);
    // A reference that is not a well-formed kind:31632 address names nothing.
    if (!parsed) continue;

    const issuer = getTrustedItemIssuer(parsed.pubkey);
    // Untrusted issuer, or this game's own issuer (whose catalog is loaded by
    // `useItemCatalog` and must not be fetched twice).
    if (!issuer || issuer.role !== 'partner') continue;

    let request = byIssuer.get(issuer.pubkey);
    if (!request) {
      request = { issuer, dTags: [], hints: [], addresses: new Set() };
      byIssuer.set(issuer.pubkey, request);
    }

    if (!request.addresses.has(item.address)) {
      request.addresses.add(item.address);
      request.dTags.push(parsed.itemId);
    }

    // Hints are collected only AFTER the issuer passed the trust gate, and
    // only up to the cap.
    if (
      isUsableRelayHint(item.relay) &&
      !request.hints.includes(item.relay) &&
      request.hints.length < MAX_RELAY_HINTS_PER_ISSUER
    ) {
      request.hints.push(item.relay);
    }
  }

  // Deterministic order, so the query key and the fetch order are stable.
  for (const request of byIssuer.values()) request.dTags.sort();
  return [...byIssuer.values()].sort((a, b) =>
    a.issuer.pubkey.localeCompare(b.issuer.pubkey),
  );
}

/**
 * Newest VALID trusted definition per address, restricted to what was asked for.
 *
 * Parse first, compare second, the same rule `selectNewestValidDefinitions`
 * follows for the official catalog, and for the same reason: a newer invalid
 * event must never hide an older good one. The extra `expected` containment
 * check means a relay that answers with events nobody requested cannot inject
 * a definition into the catalog.
 *
 * Exported for testing.
 */
export function selectNewestTrustedDefinitions(
  perRelayEvents: readonly (readonly NostrEvent[])[],
  expected: ReadonlySet<string>,
): Map<string, GameItemDefinition> {
  const byAddress = new Map<string, GameItemDefinition>();
  for (const events of perRelayEvents) {
    for (const event of events) {
      const def = parseTrustedItemDefinition(event);
      if (!def) continue; // untrusted issuer or unparseable
      if (!expected.has(def.address)) continue;
      const existing = byAddress.get(def.address);
      if (!existing || event.created_at > existing.event.created_at) {
        byAddress.set(def.address, def);
      }
    }
  }
  return byAddress;
}

/** Canonical query key. Identity is the exact set of addresses being resolved. */
export function externalItemCatalogQueryKey(addresses: readonly string[]) {
  return ['blobbi-external-item-catalog', [...addresses].sort().join(',')] as const;
}

/**
 * Resolve the definitions for the given external item references.
 *
 * Pass every item reference from every discovered inventory; this hook decides
 * which of them are resolvable. When none are (no partner issuers involved, or
 * nobody signed in), it settles immediately with an empty catalog and opens no
 * connection.
 */
export function useExternalItemCatalog(
  items: readonly DiscoveredInventoryItem[],
) {
  const { config } = useAppContext();

  const requests = groupTrustedRequests(items);
  const addresses = requests.flatMap((request) => [...request.addresses]);

  return useQuery({
    queryKey: externalItemCatalogQueryKey(addresses),
    queryFn: async (c): Promise<ExternalItemCatalog> => {
      if (requests.length === 0) return EMPTY_CATALOG;

      const byAddress = new Map<string, ResolvedBlobbiItemDefinition>();
      let requestedCount = 0;

      for (const request of requests) {
        requestedCount += request.addresses.size;

        // Preference order: the relays the issuer is known to publish on, then
        // the hints their own inventory tags carried, then the relays this app
        // already talks to. Capped, so a hint cannot widen the fan-out beyond
        // what a catalog load is worth.
        const relayUrls = dedupeRelayUrls([
          ...request.issuer.relays,
          ...request.hints,
          ...OFFICIAL_ITEM_RELAYS,
          config.relayUrl,
        ]).slice(0, MAX_RELAYS_PER_ISSUER);

        const outcomes = await queryRelays(
          relayUrls,
          [
            {
              kinds: [KIND_GAME_ITEM_DEFINITION],
              authors: [request.issuer.pubkey],
              '#d': request.dTags,
            },
          ],
          { signal: c.signal },
        );

        const fetched = selectNewestTrustedDefinitions(
          outcomes.map((outcome) => outcome.events),
          request.addresses,
        );

        // `resolveFromDefinition` is the SAME generic normalization the official
        // catalog uses. Nothing about a partner item is interpreted specially:
        // name, type, category, topics, rarity, description and every image
        // view come from the published definition, and the Blobbi-specific
        // fields it looks for (`content.metadata`, `content.effects`) are
        // simply absent, which resolves to `action: null` and no effects.
        for (const [address, def] of fetched) {
          byAddress.set(address, resolveFromDefinition(def));
        }
      }

      return {
        byAddress,
        resolvedCount: byAddress.size,
        requestedCount,
      };
    },
    // Definitions are effectively static, exactly as in the official catalog.
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });
}
