/**
 * Blobbi Island — the live external inventory store, as React sees it.
 *
 * ```
 *   authoritative fetch  ──►  ONE query per player: ExternalInventoryEvents
 *   live tail (1 REQ/relay) ─► setQueryData(merge)        ┘
 *                                    ↓
 *   deriveExternalInventoryStates (+ this tab's established spends)
 *                                    ↓
 *   useExternalInventoryView → { inventories, states }   → collection / UI
 * ```
 *
 * ## Initial fetch + live tail, not one or the other
 *
 * The query does the authoritative work (`fetchExternalInventoryEvents`):
 * author-wide discovery, every spend and fold for the discovered addresses,
 * bounded by-id retrieval of missing manifests. The tail then keeps it
 * current. A tail alone would miss whatever happened between mount and the
 * subscription; a fetch alone needs a refresh. Because the REQ carries no
 * `since`, the relay first replays every stored match (harmless: every merge
 * deduplicates) and then streams — so the tail is itself a second bootstrap,
 * which is what closes the gap.
 *
 * ## Recovery
 *
 * `NRelay1` reconnects with backoff and re-sends the REQ; the relay answers
 * with stored events and a FRESH EOSE. Every EOSE after the first is treated
 * as "we were away": the query is invalidated so the authoritative fetch
 * reconciles anything a different relay may hold. The same happens after the
 * iterator drops (2 s pause, then resubscribe), on `online`, and — the
 * TanStack default — on `refetchOnReconnect`. There is no polling.
 *
 * ## Lifecycle
 *
 * The tail is keyed on the player, the relay policy and the set of discovered
 * inventory addresses. Any change aborts and closes every relay and opens a
 * new tail; logout leaves nothing open. Events for another player can never
 * enter: the filters carry `authors:[player]` and the merge checks the author
 * against the store's owner again.
 *
 * ## Scale
 *
 * Subscriptions = relays in the policy, full stop. One inventory or fifty
 * changes the `#a` list inside the same three filters.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';

import { establishedSpendsSnapshot, subscribeEstablishedSpends } from './established-spends';
import type { DiscoveredInventory } from './external-inventories';
import {
  deriveExternalInventoryStates,
  emptyExternalInventoryEvents,
  externalInventoryLiveFilters,
  fetchExternalInventoryEvents,
  mergeExternalInventoryEvent,
  mergeExternalInventoryEvents,
  missingFoldReferencesOf,
  type ExternalInventoryEvents,
  type ExternalInventoryFetchDeps,
  type ExternalInventoryState,
  type ExternalInventoryView,
} from './external-inventory-events';
import {
  externalInventoryRelays,
  openLiveRelay,
  readFromExternalRelays,
  usableRelayHints,
  type ExternalReadResult,
} from './external-inventory-relays';
import type { EventReference, ExternalInventoryResolution } from './external-inventory-state';
import {
  buildGameInventoryFilter,
  buildGameInventoryFoldFilter,
  buildGameInventorySpendFilter,
} from './package';

/** Canonical query key. One store per player. */
export function externalInventoryEventsQueryKey(pubkey: string | undefined) {
  return ['blobbi-external-inventory-events', pubkey ?? ''] as const;
}

/** The relay reads the store's fetch needs, over the cross-game relay policy. */
export function externalInventoryFetchDeps(
  relays: readonly string[],
  owner: string,
  signal?: AbortSignal,
): ExternalInventoryFetchDeps {
  return {
    readSnapshots: () =>
      readFromExternalRelays(
        relays,
        [buildGameInventoryFilter({ authors: [owner] }) as unknown as NostrFilter],
        { signal },
      ),
    readLedger: (inventoryAddresses) =>
      readFromExternalRelays(
        relays,
        [
          buildGameInventorySpendFilter({
            authors: [owner],
            inventoryAddresses: [...inventoryAddresses],
          }) as unknown as NostrFilter,
          buildGameInventoryFoldFilter({
            authors: [owner],
            inventoryAddresses: [...inventoryAddresses],
          }) as unknown as NostrFilter,
        ],
        { signal },
      ),
    readFoldsById: (references): Promise<ExternalReadResult> => {
      const ids = [...new Set(references.map((reference) => reference.eventId))];
      if (ids.length === 0) return Promise.resolve({ events: [], answered: true });
      const hinted = usableRelayHints(references.map((reference) => reference.relay)).filter(
        (hint) => !relays.includes(hint),
      );
      return readFromExternalRelays(
        [...relays, ...hinted],
        [buildGameInventoryFoldFilter({ ids }) as unknown as NostrFilter],
        { signal },
      );
    },
  };
}

/** Merge a live event into the store held by the query (no-op when unchanged). */
export function applyLiveEvent(
  queryClient: QueryClient,
  pubkey: string,
  event: NostrEvent,
): { changed: boolean; newContext: boolean } {
  const key = externalInventoryEventsQueryKey(pubkey);
  const previous = queryClient.getQueryData<ExternalInventoryEvents>(key);
  if (!previous) return { changed: false, newContext: false };
  const next = mergeExternalInventoryEvent(previous, event);
  if (next === previous) return { changed: false, newContext: false };
  queryClient.setQueryData(key, next);
  const before = new Set(previous.snapshots.map((e) => e.tags.find(([n]) => n === 'd')?.[1]));
  const newContext = next.snapshots.some(
    (e) => !before.has(e.tags.find(([n]) => n === 'd')?.[1]),
  );
  return { changed: true, newContext };
}

/**
 * The authoritative store for the signed-in player.
 *
 * Disabled with nobody signed in. Throws on an unusable read so React Query
 * keeps the last good store on screen instead of deriving from nothing.
 */
export function useExternalInventoryEvents() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const relays = useMemo(() => externalInventoryRelays(config.relayUrl), [config.relayUrl]);
  const pubkey = user?.pubkey;

  return useQuery({
    queryKey: externalInventoryEventsQueryKey(pubkey),
    queryFn: async (c): Promise<ExternalInventoryEvents> => {
      if (!pubkey) return emptyExternalInventoryEvents('');
      const fetched = await fetchExternalInventoryEvents(
        externalInventoryFetchDeps(relays, pubkey, c.signal),
        pubkey,
      );
      if (fetched.status === 'error') throw new Error(fetched.error);
      return fetched.store;
    },
    enabled: !!pubkey,
    // The tail keeps this current; staleness only governs the safety-net
    // refetch on remount / reconnect.
    staleTime: 15000,
  });
}

const RESUBSCRIBE_DELAY_MS = 2000;

/**
 * The live tail: one REQ per relay in the policy, three filters in it.
 *
 * Events flow into the query through `applyLiveEvent`. A brand-new context
 * (a game Island has never seen) triggers an authoritative refetch, because
 * its spends and folds have never been asked for. A late EOSE (reconnect)
 * or a dropped iterator does the same, so a gap on one relay is reconciled
 * from all of them.
 */
export function useExternalInventoryLiveTail(
  pubkey: string | undefined,
  relays: readonly string[],
  inventoryAddresses: readonly string[],
): void {
  const queryClient = useQueryClient();
  // Stable identity for the effect: the SET of addresses, not the array.
  const addressesKey = [...inventoryAddresses].sort().join('\n');
  const relaysKey = relays.join('\n');

  useEffect(() => {
    // Both lists are read back from their keys so the effect's dependencies
    // are the SETS, and a caller passing a fresh array each render cannot
    // churn the subscriptions.
    const relayUrls = relaysKey ? relaysKey.split('\n') : [];
    if (!pubkey || relayUrls.length === 0) return;
    const owner = pubkey;
    const key = externalInventoryEventsQueryKey(owner);
    const filters = externalInventoryLiveFilters(owner, addressesKey ? addressesKey.split('\n') : []);
    const abort = new AbortController();
    const connections = relayUrls.map((url) => openLiveRelay(url));

    const invalidate = () => {
      if (abort.signal.aborted) return;
      void queryClient.invalidateQueries({ queryKey: key });
    };

    const tail = async (relay: (typeof connections)[number]) => {
      let eoseSeen = 0;
      while (!abort.signal.aborted) {
        try {
          for await (const msg of relay.req(filters, { signal: abort.signal })) {
            if (abort.signal.aborted) break;
            if (msg[0] === 'EVENT') {
              const { newContext } = applyLiveEvent(queryClient, owner, msg[2]);
              if (newContext) invalidate();
            } else if (msg[0] === 'EOSE') {
              eoseSeen += 1;
              // The first EOSE is the bootstrap replay. Any later one means
              // the socket reopened and the REQ was re-sent: reconcile.
              if (eoseSeen > 1) invalidate();
            } else if (msg[0] === 'CLOSED') {
              break;
            }
          }
        } catch {
          // Dropped iterator: fall through to the pause and resubscribe.
        }
        if (abort.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, RESUBSCRIBE_DELAY_MS));
        if (abort.signal.aborted) return;
        invalidate();
      }
    };

    for (const relay of connections) void tail(relay);

    const onOnline = () => invalidate();
    globalThis.addEventListener?.('online', onOnline);

    return () => {
      abort.abort();
      globalThis.removeEventListener?.('online', onOnline);
      for (const relay of connections) void relay.close();
    };
  }, [pubkey, relaysKey, addressesKey, queryClient]);
}

/** What the collection consumes: every discovered inventory and its state. */
export interface ExternalInventoryViewResult extends ExternalInventoryView {
  /** The authoritative fetch has not answered yet (and nothing is cached). */
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

const EMPTY_VIEW: ExternalInventoryView = { inventories: [], states: new Map() };

/**
 * Derived, live external inventory state for the signed-in player.
 *
 * Runs the tail, retrieves missing manifests for unresolved inventories once
 * per manifest id, and merges this tab's established spends into the
 * derivation. Rows never flash back to loading on a live update: the store
 * is replaced in place and re-derived.
 */
export function useExternalInventoryView(): ExternalInventoryViewResult {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const relays = useMemo(() => externalInventoryRelays(config.relayUrl), [config.relayUrl]);
  const query = useExternalInventoryEvents();
  const established = useSyncExternalStore(
    subscribeEstablishedSpends,
    establishedSpendsSnapshot,
    establishedSpendsSnapshot,
  );

  const view = useMemo((): ExternalInventoryView => {
    if (!query.data) return EMPTY_VIEW;
    const extra = query.data.snapshots.length
      ? [...established.values()].flat()
      : [];
    return deriveExternalInventoryStates(query.data, extra);
  }, [query.data, established]);

  const addresses = useMemo(
    () => view.inventories.map((inventory) => inventory.address),
    [view.inventories],
  );
  // The tail starts once the authoritative store exists: the addresses are
  // then known, so the REQ is opened ONCE with its full scope instead of
  // once for discovery and again after the fetch. Nothing is missed by
  // waiting — the REQ carries no `since`, so the relay replays every stored
  // match when the tail attaches.
  useExternalInventoryLiveTail(query.data ? user?.pubkey : undefined, relays, addresses);

  // Missing manifests: a snapshot that arrived (live or fetched) before the
  // fold it references derives as unresolved. Ask for the named ids once; a
  // later live kind:1417 resolves it just as well.
  const attempted = useRef(new Set<string>());
  const missing = useMemo(() => missingFoldReferencesOf(view), [view]);
  useEffect(() => {
    const pubkey = user?.pubkey;
    if (!pubkey || missing.length === 0) return;
    const wanted = missing.filter((ref) => !attempted.current.has(ref.eventId));
    if (wanted.length === 0) return;
    for (const ref of wanted) attempted.current.add(ref.eventId);
    const abort = new AbortController();
    void externalInventoryFetchDeps(relays, pubkey, abort.signal)
      .readFoldsById(wanted)
      .then((result) => {
        if (abort.signal.aborted || result.events.length === 0) return;
        const key = externalInventoryEventsQueryKey(pubkey);
        queryClient.setQueryData<ExternalInventoryEvents>(key, (previous) =>
          previous ? mergeExternalInventoryEvents(previous, result.events) : previous,
        );
      })
      .catch(() => {
        // Unresolved stays unresolved. Never guessed around.
      });
    return () => abort.abort();
  }, [missing, relays, user?.pubkey, queryClient]);

  return {
    ...view,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
  };
}

/**
 * Fetch and derive ONE external inventory's state right now — the FRESH read
 * a consumption performs immediately before signing a spend. Re-reads that
 * inventory's spends and folds from the relays (never `since`), against the
 * snapshot the caller already holds, plus this tab's established spends.
 * Not cached.
 */
export async function fetchExternalInventoryState(
  relays: readonly string[],
  inventory: DiscoveredInventory,
  signal?: AbortSignal,
): Promise<ExternalInventoryResolution | { status: 'error'; error: string }> {
  const fetched = await fetchExternalInventoryEvents(
    externalInventoryFetchDeps(relays, inventory.owner, signal),
    inventory.owner,
    { snapshots: [inventory.snapshot.event as NostrEvent], onlyAddresses: [inventory.address] },
  );
  if (fetched.status === 'error') return fetched;
  const view = deriveExternalInventoryStates(
    fetched.store,
    establishedSpendsSnapshot().get(inventory.address) ?? [],
  );
  const state = view.states.get(inventory.address);
  if (!state) return { status: 'error', error: 'The inventory snapshot did not parse.' };
  return state.resolution;
}

export type { ExternalInventoryState, EventReference };
