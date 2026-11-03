/**
 * Blobbi Island: which relays each kind of event is read from and written to.
 *
 * The Island used to speak to ONE relay for everything. It now has a primary
 * relay (`wss://relay.blobbi.pet` unless the player chose another) and the
 * relays it used before as secondaries. Not every event belongs on every
 * relay, so routing is by FLOW, and a flow is chosen by the event kind:
 *
 * ```
 *   flow      kinds                                  read / write            sync
 *   state     31124 11125 31125 1124                 primary + secondaries   own events, both ways
 *             31633 31634 1416 1417
 *   catalog   31632                                  primary + secondaries   no (issuer events; see below)
 *   realtime  31950 21201 31951 21951                primary + rendezvous    no (ephemeral or expiring)
 *   identity  0                                      primary + secondaries   own event, toward the primary only
 *   public    everything the Blobbi relay does not   secondaries             no
 *             accept: 1, 36767, 16767, 30078, ...
 *   any       a filter with no `kinds`               primary + secondaries   no
 * ```
 *
 * - **state** is the player's own persistent Blobbi state. It is written to
 *   every relay of the flow and carried to whichever one lacks it.
 * - **catalog** definitions are signed by item issuers, not by the player. The
 *   catalog hooks fan out on their own list (`OFFICIAL_ITEM_RELAYS`); this
 *   entry only covers a definition that goes through the shared pool.
 * - **realtime** needs every player in a room on the same relay. It goes to
 *   the primary and to ONE rendezvous secondary (the first: the relay every
 *   earlier build used), so a player the primary's write list refuses, and a
 *   player on an older build, still meet everyone else.
 * - **public** events are refused by the Blobbi relay's policy (`blocked:`),
 *   so sending them there would only turn a working share into an error.
 *   They keep going where they always went. When the player's primary is some
 *   other relay, that relay takes them too.
 *
 * World travel (31126 / 21124) does not pass through here: the kit's travel
 * session talks to its own relay list (`worldTravelRelays` below).
 */

import {
  BLOBBI_RELAY_URL,
  blobbiRelayAcceptsKind,
  dedupeRelayUrls,
  normalizeRelayUrl,
  type RelayEvent,
  type RelayFilter,
  type SyncPolicy,
} from './relay-routing';

/** The relays the Island used before the Blobbi relay existed; the default secondaries. */
export const DEFAULT_SECONDARY_RELAYS: readonly string[] = ['wss://relay.ditto.pub', 'wss://relay.primal.net'];

/** The player's relay selection. */
export interface IslandRelayConfig {
  /** Asked first and written first. */
  primary: string;
  /** Read alongside the primary, and written alongside it. */
  secondaries: readonly string[];
}

export type IslandFlow = 'state' | 'catalog' | 'realtime' | 'identity' | 'public' | 'any';

const STATE_KINDS = new Set([31124, 11125, 31125, 1124, 31633, 31634, 1416, 1417]);
const REALTIME_KINDS = new Set([31950, 21201, 31951, 21951]);

export function flowOfKind(kind: number): IslandFlow {
  if (STATE_KINDS.has(kind)) return 'state';
  if (REALTIME_KINDS.has(kind)) return 'realtime';
  if (kind === 31632) return 'catalog';
  if (kind === 0) return 'identity';
  return 'public';
}

/** The flow a filter belongs to. A filter naming kinds of several flows is read as the widest of them. */
export function flowOfFilter(filter: RelayFilter): IslandFlow {
  if (!filter.kinds || filter.kinds.length === 0) return 'any';
  const flows = new Set(filter.kinds.map(flowOfKind));
  if (flows.size === 1) return [...flows][0];
  return 'any';
}

/** Primary first, then the secondaries, normalized and without repeats. */
export function allRelays(config: IslandRelayConfig): string[] {
  return dedupeRelayUrls([config.primary, ...config.secondaries]);
}

const isBlobbiRelay = (url: string): boolean => normalizeRelayUrl(url) === BLOBBI_RELAY_URL;

/** The relays a flow reads from and writes to. */
export function relaysForFlow(flow: IslandFlow, config: IslandRelayConfig, kind?: number): string[] {
  const all = allRelays(config);
  switch (flow) {
    case 'realtime':
      // The primary, and one rendezvous relay.
      return all.slice(0, 2);
    case 'public': {
      // Not the Blobbi relay: its policy refuses these kinds. Unless it is all there is.
      if (kind !== undefined && blobbiRelayAcceptsKind(kind)) return all;
      const others = all.filter((url) => !isBlobbiRelay(url));
      return others.length > 0 ? others : all;
    }
    default:
      return all;
  }
}

/** Where one event is published. */
export function relaysForEvent(event: Pick<RelayEvent, 'kind'>, config: IslandRelayConfig): string[] {
  return relaysForFlow(flowOfKind(event.kind), config, event.kind);
}

/** Which relays get which filters of one REQ. */
export function routeFilters<F extends RelayFilter>(filters: readonly F[], config: IslandRelayConfig): Map<string, F[]> {
  const routes = new Map<string, F[]>();
  for (const filter of filters) {
    const flow = flowOfFilter(filter);
    // A `public` filter names kinds of that one flow; any of them stands for the rest.
    const relays = relaysForFlow(flow, config, flow === 'public' ? filter.kinds?.find((k) => !blobbiRelayAcceptsKind(k)) : undefined);
    for (const relay of relays) {
      const held = routes.get(relay);
      if (held) held.push(filter);
      else routes.set(relay, [filter]);
    }
  }
  return routes;
}

/**
 * Whether every filter is realtime. A realtime read streams what arrives and
 * ends on the first relay's EOSE; every other read waits to merge its relays.
 */
export function isRealtimeRead(filters: readonly RelayFilter[]): boolean {
  return filters.length > 0 && filters.every((filter) => flowOfFilter(filter) === 'realtime');
}

/**
 * What may be carried between the Island's relays, and where to.
 *
 * Only the signed-in player's own events: carrying somebody else's event to a
 * relay they never sent it to is not the Island's decision to make. `state`
 * goes to every relay of the flow; the player's kind 0 goes toward the primary
 * only (the Island never writes kind 0, so it has no say over where the public
 * copy lives). Realtime, catalog and public events are never carried.
 */
export function islandSyncPolicy(config: IslandRelayConfig, ownPubkey: string | null): SyncPolicy {
  return {
    allows(event) {
      if (!ownPubkey || event.pubkey !== ownPubkey) return false;
      const flow = flowOfKind(event.kind);
      return flow === 'state' || flow === 'identity';
    },
    destinations(event) {
      return flowOfKind(event.kind) === 'identity' ? [normalizeRelayUrl(config.primary) ?? config.primary] : allRelays(config);
    },
  };
}

/**
 * The relays the kit's world-travel session uses: the primary, then the kit's
 * own fixed list. The session keeps its own census and repair, so it is given
 * a list rather than routed through the pool.
 */
export function worldTravelRelays(config: IslandRelayConfig, kitRelays: readonly string[]): string[] {
  const primary = normalizeRelayUrl(config.primary);
  // 31126 / 21124 are Blobbi kinds; a primary that is not the Blobbi relay is the player's choice and is kept too.
  return dedupeRelayUrls([primary, ...kitRelays]);
}
