/**
 * Blobbi Island: the live external inventory store, as React sees it.
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
 * deduplicates) and then streams, so the tail is itself a second bootstrap,
 * which is what closes the gap.
 *
 * ## Every cache write reconciles; none replaces
 *
 * Relays are eventually consistent, so a refetch that misses a spend the
 * tail streamed a moment ago, or the snapshot the owner just published, is
 * an incomplete read, and an incomplete read must not make the balance go
 * back UP. The reconciliation therefore lives at the ONE point where TanStack
 * writes the cache: the query's `structuralSharing` function. TanStack calls
 * it as `structuralSharing(state.data, newData)` inside `Query.setData`, for
 * a completed fetch and for every `setQueryData` alike, with the cache as it
 * is AT COMMIT TIME, so a live event that lands after the query function
 * returned and before its result is committed is still reconciled, and the
 * query function simply returns what the relays taught. Forgetting happens
 * only when the store itself goes away: logout, a different player (a
 * different query key), or cache removal.
 *
 * ## Recovery
 *
 * `NRelay1` reconnects with backoff and re-sends the REQ; the relay answers
 * with stored events and a FRESH EOSE. Every EOSE after the first is treated
 * as "we were away": the query is invalidated so the authoritative fetch
 * reconciles anything a different relay may hold. The same happens after the
 * iterator drops (2 s pause, then resubscribe), on `online`, and, the
 * TanStack default: on `refetchOnReconnect`. There is no polling, and there
 * is no loop: an invalidation refetches the SAME query; the tail is keyed on
 * the player, the relay policy and the address SET, none of which a refetch
 * changes unless a genuinely new context was discovered.
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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  reconcileExternalInventoryStores,
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
      // What the relays taught, and nothing else. Reconciliation with what
      // this tab already knows happens in `structuralSharing`, at commit.
      return fetched.store;
    },
    // THE monotonic write. TanStack invokes this with the cache as it is at
    // the moment of the write (`Query.setData` → `replaceData(state.data,
    // next)`), for the completed fetch and for every `setQueryData`, so no
    // write path can forget a known spend/fold or regress a newer valid
    // snapshot. Same owner by construction, the key is the pubkey, and
    // `reconcile` refuses another owner's store regardless.
    structuralSharing: (held: unknown, next: unknown) =>
      reconcileExternalInventoryStores(
        held as ExternalInventoryEvents | undefined,
        next as ExternalInventoryEvents,
      ),
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

/**
 * One missing manifest's fetch history, for the retry policy.
 *
 * `'unanswered'`: no relay gave a usable answer (timeout, offline, every
 * relay failed): the manifest MAY exist; try again soon. `'absent'`: at
 * least one relay answered and did not have it: it may still exist on a
 * relay that did not answer, or not yet, so retry with a longer wait.
 */
export interface FoldFetchAttempt {
  readonly tries: number;
  readonly inFlight: boolean;
  readonly outcome: 'unanswered' | 'absent' | null;
  /** Earliest time (ms) a recovery trigger may try again. */
  readonly nextEligibleAt: number;
}

const FOLD_RETRY_UNANSWERED_MS = 5_000;
const FOLD_RETRY_ABSENT_MS = 30_000;
const FOLD_RETRY_MAX_BACKOFF_MS = 5 * 60_000;

/**
 * When a missing manifest may be asked for again.
 *
 * - never while a read for it is in flight;
 * - a transient failure is retried after a short wait, an answered absence
 *   after a longer one, both doubling per attempt up to a cap, so a chain
 *   the owner never published cannot hammer the relays, and one that simply
 *   has not propagated yet is picked up at its deadline (one-shot wake-up)
 *   or on the next recovery trigger, whichever comes first;
 * - a manifest that is finally obtained drops out of the table entirely.
 */
export const foldRetryPolicy = {
  eligible(attempt: FoldFetchAttempt | undefined, now: number): boolean {
    if (!attempt) return true;
    if (attempt.inFlight) return false;
    return now >= attempt.nextEligibleAt;
  },
  started(attempt: FoldFetchAttempt | undefined, now: number): FoldFetchAttempt {
    return {
      tries: (attempt?.tries ?? 0) + 1,
      inFlight: true,
      outcome: attempt?.outcome ?? null,
      nextEligibleAt: now,
    };
  },
  /**
   * The read was cancelled by THIS client (the effect re-ran, the view
   * changed, the component unmounted): not by the network. It is eligible
   * again at once; the trigger that cancelled it is the one that retries.
   */
  aborted(attempt: FoldFetchAttempt | undefined, now: number): FoldFetchAttempt {
    return {
      tries: Math.max(0, (attempt?.tries ?? 1) - 1),
      inFlight: false,
      outcome: attempt?.outcome ?? null,
      nextEligibleAt: now,
    };
  },
  finished(attempt: FoldFetchAttempt | undefined, answered: boolean, now: number): FoldFetchAttempt {
    const tries = attempt?.tries ?? 1;
    const base = answered ? FOLD_RETRY_ABSENT_MS : FOLD_RETRY_UNANSWERED_MS;
    const wait = Math.min(base * 2 ** Math.max(0, tries - 1), FOLD_RETRY_MAX_BACKOFF_MS);
    return {
      tries,
      inFlight: false,
      outcome: answered ? 'absent' : 'unanswered',
      nextEligibleAt: now + wait,
    };
  },
};

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
  // waiting: the REQ carries no `since`, so the relay replays every stored
  // match when the tail attaches.
  useExternalInventoryLiveTail(query.data ? user?.pubkey : undefined, relays, addresses);

  // Missing manifests: a snapshot that arrived (live or fetched) before the
  // fold it references derives as unresolved. Ask for the named ids by id;
  // a later live kind:1417 resolves it just as well. Retries are paced by
  // `foldRetryPolicy` and re-evaluated on RECOVERY TRIGGERS (a refetch
  // completing, the view changing): and, so that a quiet tab is not stuck
  // once the network is healthy again, by ONE one-shot wake-up armed for the
  // nearest eligibility deadline. That is not polling: with nothing missing,
  // or nothing waiting on a deadline, no timer exists; when one fires it
  // asks once, and a failure computes the next, longer deadline.
  const attempts = useRef(new Map<string, FoldFetchAttempt>());
  const missing = useMemo(() => missingFoldReferencesOf(view), [view]);
  // Bumped by the wake-up timer: a ref-held table does not re-render, so the
  // timer deliberately goes through state to re-run the retry effect.
  const [wakeUp, setWakeUp] = useState(0);
  // Another player, another table: manifest ids do not collide across
  // players, but a retry history is knowledge about ONE player's chains.
  useEffect(() => {
    attempts.current.clear();
  }, [user?.pubkey]);
  useEffect(() => {
    const pubkey = user?.pubkey;
    if (!pubkey || missing.length === 0) return;
    const now = Date.now();
    const table = attempts.current;
    const wanted = missing.filter((ref) => foldRetryPolicy.eligible(table.get(ref.eventId), now));

    // Arm ONE wake-up for the nearest deadline among the manifests still
    // waiting (not in flight, not yet eligible). Cleared whenever this effect
    // re-runs: a live fold, a refetch, a view change, so a manifest that
    // arrives before the deadline never causes a read, and there is never
    // more than one pending timer.
    const nearest = missing.reduce<number | null>((soonest, ref) => {
      const attempt = table.get(ref.eventId);
      if (!attempt || attempt.inFlight || attempt.nextEligibleAt <= now) return soonest;
      return soonest === null ? attempt.nextEligibleAt : Math.min(soonest, attempt.nextEligibleAt);
    }, null);
    const wakeUpTimer =
      nearest === null
        ? null
        : setTimeout(() => setWakeUp((tick) => tick + 1), Math.max(0, nearest - now));

    if (wanted.length === 0) {
      return () => {
        if (wakeUpTimer !== null) clearTimeout(wakeUpTimer);
      };
    }
    for (const ref of wanted) {
      table.set(ref.eventId, foldRetryPolicy.started(table.get(ref.eventId), now));
    }
    const abort = new AbortController();
    void externalInventoryFetchDeps(relays, pubkey, abort.signal)
      .readFoldsById(wanted)
      .then((result) => {
        if (abort.signal.aborted) return;
        const found = new Set(result.events.map((event) => event.id));
        for (const ref of wanted) {
          if (found.has(ref.eventId)) table.delete(ref.eventId);
          else {
            table.set(
              ref.eventId,
              foldRetryPolicy.finished(table.get(ref.eventId), result.answered, Date.now()),
            );
          }
        }
        if (result.events.length === 0) {
          // Nothing arrived: the table now holds a new deadline for each
          // manifest asked for, so re-run to arm the wake-up for it.
          setWakeUp((tick) => tick + 1);
          return;
        }
        const key = externalInventoryEventsQueryKey(pubkey);
        queryClient.setQueryData<ExternalInventoryEvents>(key, (previous) =>
          previous ? mergeExternalInventoryEvents(previous, result.events) : previous,
        );
      })
      .catch(() => {
        // A thrown read is a transport failure: unanswered, retry later.
        // Unresolved stays unresolved. Never guessed around.
        if (abort.signal.aborted) return;
        for (const ref of wanted) {
          table.set(ref.eventId, foldRetryPolicy.finished(table.get(ref.eventId), false, Date.now()));
        }
        setWakeUp((tick) => tick + 1);
      });
    return () => {
      if (wakeUpTimer !== null) clearTimeout(wakeUpTimer);
      abort.abort();
      // A cancelled read must not strand its manifests as "in flight".
      const cancelledAt = Date.now();
      for (const ref of wanted) {
        const attempt = table.get(ref.eventId);
        if (attempt?.inFlight) table.set(ref.eventId, foldRetryPolicy.aborted(attempt, cancelledAt));
      }
    };
    // `query.dataUpdatedAt` is a deliberate dependency: every completed
    // authoritative refetch (reconnect, `online`, new context, remount) is a
    // recovery trigger that re-evaluates eligibility. `wakeUp` is the
    // one-shot timer's signal.
  }, [missing, relays, user?.pubkey, queryClient, query.dataUpdatedAt, wakeUp]);

  return {
    ...view,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
  };
}

/**
 * Fetch and derive ONE external inventory's state right now, the FRESH read
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
