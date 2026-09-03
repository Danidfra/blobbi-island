/**
 * Blobbi Island — the ONE store of everything Island knows about the
 * inventories another game writes for the signed-in player.
 *
 * ```
 *   external inventory event store            (per player, one TanStack query)
 *     ├── latest valid kind:31633 per context  (canonical newest-valid selection)
 *     ├── immutable kind:1416 spends           (deduplicated by id)
 *     └── immutable kind:1417 folds            (deduplicated by id)
 *            ↓  deriveExternalInventoryStates  (this module, pure)
 *   per-inventory state: ready | unresolved     (resolveGameInventoryState)
 *            ↓
 *   collection / UI
 * ```
 *
 * ## Why one store
 *
 * The first cross-game milestones kept discovery, per-inventory spends/folds
 * and the tab's own established spends in three places. That was fine for a
 * fetch-on-mount world and wrong for a live one: a kind:1417 that arrives
 * before the snapshot that references it had nowhere to live, a live
 * kind:31633 changed a query key and flashed the row back to "Syncing…", and
 * a live spend had to know which cache to land in. Here a live event of any
 * of the three kinds is merged into ONE immutable value by ONE pure function,
 * and the derivation is re-run over the result. The UI never learns what a
 * relay is.
 *
 * ## What merge decides, and what it does not
 *
 * `mergeExternalInventoryEvent` is a STORE operation: it decides whether an
 * event is worth keeping (right kind, right author, parses, newer than the
 * current snapshot for its context, not a duplicate). It decides nothing
 * about balances. Whether a spend applies, whether a fold settles anything,
 * whether a snapshot is resolvable — all of that is the package's
 * `resolveGameInventoryState`, run by `deriveExternalInventoryStates` over
 * the whole store. So:
 *
 * - a fold that arrives before the snapshot referencing it is stored and
 *   INERT: nothing references it, so the derivation ignores it — until the
 *   snapshot arrives and the chain reaches it;
 * - a snapshot that arrives before its fold is stored and derives as
 *   UNRESOLVED (no balance, never the raw number) — until the fold arrives,
 *   live or fetched by id, and the same derivation resolves it;
 * - a spend arriving from three relays is one spend; a spend for another
 *   inventory or by another author is kept out or ignored by the package.
 *
 * Spec: `docs/1416-1417-game-inventory-spend.md` in `@nostr-games/inventory`.
 */

import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import {
  selectNewestInventoryPerContext,
  type DiscoveredInventory,
} from './external-inventories';
import {
  dedupeEventsById,
  type ExternalReadResult,
} from './external-inventory-relays';
import {
  missingFoldReferences,
  resolveExternalInventoryState,
  type EventReference,
  type ExternalInventoryResolution,
} from './external-inventory-state';
import {
  KIND_GAME_INVENTORY,
  KIND_GAME_INVENTORY_FOLD,
  KIND_GAME_INVENTORY_SPEND,
  buildGameInventoryFilter,
  buildGameInventoryFoldFilter,
  buildGameInventorySpendFilter,
  type GameInventory,
  type GameInventoryFoldProblem,
} from './package';

/** Everything known about the player's external inventories. Immutable value. */
export interface ExternalInventoryEvents {
  /** The player whose inventories these are. Events by anybody else never enter. */
  owner: string;
  /**
   * The current valid kind:31633 per context, at most one per `d`, chosen by
   * the canonical newest-valid rule. Blobbi's own context is never here.
   */
  snapshots: readonly NostrEvent[];
  /** Every kind:1416 by the owner seen so far, deduplicated by id. */
  spends: readonly NostrEvent[];
  /** Every kind:1417 by the owner seen so far, deduplicated by id. */
  folds: readonly NostrEvent[];
}

export function emptyExternalInventoryEvents(owner: string): ExternalInventoryEvents {
  return { owner, snapshots: [], spends: [], folds: [] };
}

/**
 * Merge one live (or fetched) event into the store.
 *
 * Returns the SAME object when nothing changed, so a `setQueryData` caller
 * can no-op without re-rendering. Never throws on a bad event: a malformed
 * or foreign event is simply not stored.
 */
export function mergeExternalInventoryEvent(
  store: ExternalInventoryEvents,
  event: NostrEvent,
): ExternalInventoryEvents {
  if (event.pubkey !== store.owner) return store;

  switch (event.kind) {
    case KIND_GAME_INVENTORY: {
      if (store.snapshots.some((e) => e.id === event.id)) return store;
      // Canonical selection over {current winner for this context, candidate}:
      // parse before compare, so a malformed newer event cannot shadow the
      // valid current snapshot; equal created_at breaks on the lower id.
      const pool = [...store.snapshots, event];
      const candidates = selectNewestInventoryPerContext(pool, { owner: store.owner });
      const winners = new Set(candidates.map((inventory) => inventory.snapshot.event.id));
      const after = pool.filter((e) => winners.has(e.id));
      const before = new Set(store.snapshots.map((e) => e.id));
      if (after.length === before.size && after.every((e) => before.has(e.id))) return store;
      return { ...store, snapshots: after };
    }
    case KIND_GAME_INVENTORY_SPEND: {
      if (store.spends.some((e) => e.id === event.id)) return store;
      return { ...store, spends: [...store.spends, event] };
    }
    case KIND_GAME_INVENTORY_FOLD: {
      if (store.folds.some((e) => e.id === event.id)) return store;
      return { ...store, folds: [...store.folds, event] };
    }
    default:
      return store;
  }
}

/** Merge many events; same-object return when nothing changed. */
export function mergeExternalInventoryEvents(
  store: ExternalInventoryEvents,
  events: readonly NostrEvent[],
): ExternalInventoryEvents {
  return events.reduce(mergeExternalInventoryEvent, store);
}

export type ExternalInventoryStatus = 'ready' | 'unresolved';

/** What the collection sees for one discovered inventory. */
export interface ExternalInventoryState {
  inventory: DiscoveredInventory;
  status: ExternalInventoryStatus;
  resolution: ExternalInventoryResolution;
  /** The EFFECTIVE inventory. Present only when `status === 'ready'`. */
  effective?: GameInventory;
  problems?: GameInventoryFoldProblem[];
}

export interface ExternalInventoryView {
  inventories: DiscoveredInventory[];
  states: ReadonlyMap<string, ExternalInventoryState>;
}

/**
 * Derive every inventory's state from the store. Pure.
 *
 * `extraSpends` are the spends THIS TAB established (see
 * `established-spends.ts`): merged in here rather than written into the
 * store, so a refetch that races the relay can never make them vanish.
 */
export function deriveExternalInventoryStates(
  store: ExternalInventoryEvents,
  extraSpends: readonly NostrEvent[] = [],
): ExternalInventoryView {
  const inventories = selectNewestInventoryPerContext(store.snapshots, { owner: store.owner });
  const spends = dedupeEventsById([...store.spends, ...extraSpends]);
  const states = new Map<string, ExternalInventoryState>();
  for (const inventory of inventories) {
    const resolution = resolveExternalInventoryState({
      snapshot: inventory.snapshot,
      folds: store.folds,
      spends,
    });
    states.set(
      inventory.address,
      resolution.status === 'ready'
        ? { inventory, status: 'ready', resolution, effective: resolution.inventory }
        : { inventory, status: 'unresolved', resolution, problems: resolution.problems },
    );
  }
  return { inventories, states };
}

/**
 * The manifests every unresolved inventory is missing, with relay hints,
 * deduplicated by id — what a bounded by-id fetch should ask for.
 */
export function missingFoldReferencesOf(view: ExternalInventoryView): EventReference[] {
  const seen = new Set<string>();
  const refs: EventReference[] = [];
  for (const state of view.states.values()) {
    if (state.status !== 'unresolved') continue;
    for (const ref of missingFoldReferences(state.inventory.snapshot, state.resolution.chain)) {
      if (seen.has(ref.eventId)) continue;
      seen.add(ref.eventId);
      refs.push(ref);
    }
  }
  return refs;
}

// ── filters ─────────────────────────────────────────────────────────────────

/**
 * The filters ONE live subscription carries for one player, whatever the
 * number of inventories:
 *
 *   { kinds:[31633], authors:[player] }                        ← every context, so
 *                                                               a new game's inventory is discovered live
 *   { kinds:[1416],  authors:[player], #a:[addr1, addr2, …] } ← batched by inventory address
 *   { kinds:[1417],  authors:[player], #a:[addr1, addr2, …] }
 *
 * One REQ per relay; three filters in it. Ten or fifty inventories change the
 * length of the `#a` list, not the number of subscriptions. There is no
 * per-item and no per-inventory subscription. The spend and fold filters are
 * omitted while no inventory is known — a `#a: []` filter would match nothing
 * and some relays reject it.
 */
export function externalInventoryLiveFilters(
  owner: string,
  inventoryAddresses: readonly string[],
): NostrFilter[] {
  const filters: NostrFilter[] = [
    buildGameInventoryFilter({ authors: [owner] }) as unknown as NostrFilter,
  ];
  if (inventoryAddresses.length > 0) {
    const addresses = [...inventoryAddresses];
    filters.push(
      buildGameInventorySpendFilter({ authors: [owner], inventoryAddresses: addresses }) as unknown as NostrFilter,
      buildGameInventoryFoldFilter({ authors: [owner], inventoryAddresses: addresses }) as unknown as NostrFilter,
    );
  }
  return filters;
}

// ── fetching ────────────────────────────────────────────────────────────────

/** How the store reaches relays. Wired in `useExternalInventoryEvents.ts`. */
export interface ExternalInventoryFetchDeps {
  /** Every kind:31633 by the owner: author-wide discovery, no `#d`. */
  readSnapshots(): Promise<ExternalReadResult>;
  /**
   * Every kind:1416 AND kind:1417 by the owner naming these FULL inventory
   * addresses, in one round trip. Never with `since`.
   */
  readLedger(inventoryAddresses: readonly string[]): Promise<ExternalReadResult>;
  /** Specific kind:1417 events by id, on the configured relays plus each hint. */
  readFoldsById(references: readonly EventReference[]): Promise<ExternalReadResult>;
}

export type ExternalInventoryFetch =
  | { status: 'ok'; store: ExternalInventoryEvents }
  | { status: 'error'; error: string };

/** Upper bound on by-id fetch rounds while walking unusually deep chains. */
export const MAX_FOLD_FETCH_ROUNDS = 8;

/**
 * The AUTHORITATIVE fetch: the store as the relays currently hold it.
 *
 * 1. author-wide kind:31633 discovery, canonical newest-valid selection;
 * 2. one round trip for every spend and fold naming the discovered
 *    addresses (no `since`);
 * 3. derive; for every unresolved inventory fetch its missing manifests by
 *    id (configured relays + relay hints) and derive again, bounded.
 *
 * An unanswered read is an ERROR — never an empty store. Steps 2–3 for a
 * subset only (`onlyAddresses`) let a consumption preflight refresh one
 * inventory's ledger without re-discovering everything; the caller supplies
 * the snapshots it already trusts.
 */
export async function fetchExternalInventoryEvents(
  deps: ExternalInventoryFetchDeps,
  owner: string,
  options: { snapshots?: readonly NostrEvent[]; onlyAddresses?: readonly string[] } = {},
): Promise<ExternalInventoryFetch> {
  let store = emptyExternalInventoryEvents(owner);

  if (options.snapshots) {
    store = mergeExternalInventoryEvents(store, options.snapshots);
  } else {
    const discovered = await deps.readSnapshots();
    if (!discovered.answered) {
      return { status: 'error', error: 'No relay answered when discovering your other inventories.' };
    }
    store = mergeExternalInventoryEvents(store, discovered.events);
  }

  const inventories = selectNewestInventoryPerContext(store.snapshots, { owner });
  const addresses = inventories
    .map((inventory) => inventory.address)
    .filter((address) => !options.onlyAddresses || options.onlyAddresses.includes(address));
  if (addresses.length === 0) return { status: 'ok', store };

  const ledger = await deps.readLedger(addresses);
  if (!ledger.answered) {
    return { status: 'error', error: 'No relay answered when reading spends and settlement records.' };
  }
  store = mergeExternalInventoryEvents(store, ledger.events);

  for (let round = 0; round < MAX_FOLD_FETCH_ROUNDS; round += 1) {
    const missing = missingFoldReferencesOf(deriveExternalInventoryStates(store));
    if (missing.length === 0) break;
    const fetched = await deps.readFoldsById(missing);
    const next = mergeExternalInventoryEvents(store, fetched.events);
    if (next === store) break; // nothing new: unresolved is reported, never guessed around
    store = next;
  }

  return { status: 'ok', store };
}
