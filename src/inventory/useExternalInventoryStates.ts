/**
 * Blobbi Island — the query hook over spend-aware external inventory state.
 *
 * One query per discovered inventory, keyed by the inventory ADDRESS and the
 * snapshot's fold head. The key includes the head so that when the owner
 * publishes a folding snapshot (new manifest, new head) the spends and
 * manifests are fetched afresh against it, and so that a non-folding
 * replacement (same head) keeps the events it already has.
 *
 * The query holds EVENTS (spends and manifests). The derivation runs in a
 * memo over `snapshot + fetched events + the spends this tab established`, so
 * a spend Island just published reduces the effective quantity at once and a
 * lagging relay answer can never bounce it back. Nothing here ever mutates
 * the raw snapshot: when the owner later folds that spend, the new snapshot's
 * chain excludes it and the derivation stops subtracting it — which is why
 * the pending → folded transition leaves the effective number where it was.
 *
 * Everything that decides anything lives in `external-inventory-state.ts`,
 * pure and tested without a renderer; this file only wires relays and React.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';

import type { DiscoveredInventory } from './external-inventories';
import {
  externalInventoryRelays,
  readFromExternalRelays,
  usableRelayHints,
  type ExternalReadResult,
} from './external-inventory-relays';
import {
  loadExternalInventoryEvents,
  resolveExternalInventoryState,
  type EventReference,
  type ExternalInventoryEvents,
  type ExternalInventoryReadDeps,
  type ExternalInventoryResolution,
} from './external-inventory-state';
import {
  establishedSpendsSnapshot,
  subscribeEstablishedSpends,
} from './established-spends';
import {
  buildGameInventoryFoldFilter,
  buildGameInventorySpendFilter,
  type GameInventory,
  type GameInventoryFoldProblem,
} from './package';

/** Canonical query key. Identity is the inventory address plus its fold head. */
export function externalInventoryStateQueryKey(
  inventoryAddress: string,
  headFoldId: string | undefined,
) {
  return ['blobbi-external-inventory-state', inventoryAddress, headFoldId ?? ''] as const;
}

/**
 * The relay reads one inventory's derivation needs.
 *
 * - spends: `kinds:[1416]`, `authors:[owner]`, `#a:[<full inventory address>]`
 *   — scoped by owner AND the full coordinate, never by `d`, never by item,
 *   and never with `since`;
 * - folds: `kinds:[1417]`, same scoping;
 * - folds by id: the configured relays plus every usable relay hint the chain
 *   carried for that id. A hint is one more place to look, never the only one.
 */
export function externalInventoryReadDeps(
  relays: readonly string[],
  inventory: Pick<DiscoveredInventory, 'owner' | 'address'>,
  signal?: AbortSignal,
): ExternalInventoryReadDeps {
  return {
    readSpends: () =>
      readFromExternalRelays(
        relays,
        [
          buildGameInventorySpendFilter({
            authors: [inventory.owner],
            inventoryAddresses: [inventory.address],
          }) as unknown as NostrFilter,
        ],
        { signal },
      ),
    readFolds: () =>
      readFromExternalRelays(
        relays,
        [
          buildGameInventoryFoldFilter({
            authors: [inventory.owner],
            inventoryAddresses: [inventory.address],
          }) as unknown as NostrFilter,
        ],
        { signal },
      ),
    readFoldsById: (references: EventReference[]): Promise<ExternalReadResult> => {
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

/**
 * Fetch and derive one external inventory's state right now — the FRESH read
 * a consumption performs immediately before signing a spend. Not cached.
 */
export async function fetchExternalInventoryState(
  relays: readonly string[],
  inventory: DiscoveredInventory,
  signal?: AbortSignal,
): Promise<ExternalInventoryResolution | { status: 'error'; error: string }> {
  const load = await loadExternalInventoryEvents(
    externalInventoryReadDeps(relays, inventory, signal),
    inventory.snapshot,
  );
  if (load.status === 'error') return load;
  return resolveExternalInventoryState({
    snapshot: inventory.snapshot,
    folds: load.folds,
    spends: [...load.spends, ...(establishedSpendsSnapshot().get(inventory.address) ?? [])],
  });
}

export type ExternalInventoryStatus = 'loading' | 'error' | 'ready' | 'unresolved';

/** What the collection sees for one discovered inventory. */
export interface ExternalInventoryState {
  inventory: DiscoveredInventory;
  status: ExternalInventoryStatus;
  /** The derived resolution, once the events have loaded. */
  resolution?: ExternalInventoryResolution;
  /** The EFFECTIVE inventory. Present only when `status === 'ready'`. */
  effective?: GameInventory;
  problems?: GameInventoryFoldProblem[];
  error?: string;
}

/**
 * Spend-aware state for every discovered inventory, keyed by inventory
 * address. An inventory whose events are still loading, failed to load, or
 * whose chain did not resolve has no `effective` inventory — and nothing
 * downstream may spend against it.
 */
export function useExternalInventoryStates(
  inventories: readonly DiscoveredInventory[] | undefined,
): ReadonlyMap<string, ExternalInventoryState> {
  const { config } = useAppContext();
  const relays = useMemo(() => externalInventoryRelays(config.relayUrl), [config.relayUrl]);
  const list = inventories ?? EMPTY_INVENTORIES;

  const queries = useQueries({
    queries: list.map((inventory) => ({
      queryKey: externalInventoryStateQueryKey(inventory.address, inventory.fold?.eventId),
      queryFn: async (c: { signal: AbortSignal }): Promise<ExternalInventoryEvents> => {
        const load = await loadExternalInventoryEvents(
          externalInventoryReadDeps(relays, inventory, c.signal),
          inventory.snapshot,
        );
        // An unusable read throws, so React Query keeps the last good events
        // on screen instead of deriving from nothing.
        if (load.status === 'error') throw new Error(load.error);
        return { spends: load.spends, folds: load.folds };
      },
      // Same freshness as the snapshots themselves.
      staleTime: 15000,
    })),
  });

  const established = useSyncExternalStore(
    subscribeEstablishedSpends,
    establishedSpendsSnapshot,
    establishedSpendsSnapshot,
  );

  return useMemo(() => {
    const states = new Map<string, ExternalInventoryState>();
    list.forEach((inventory, index) => {
      const query = queries[index];
      if (!query.data) {
        states.set(inventory.address, {
          inventory,
          status: query.isError ? 'error' : 'loading',
          ...(query.error instanceof Error ? { error: query.error.message } : {}),
        });
        return;
      }
      const resolution = resolveExternalInventoryState({
        snapshot: inventory.snapshot,
        folds: query.data.folds,
        spends: [...query.data.spends, ...(established.get(inventory.address) ?? [])],
      });
      if (resolution.status === 'ready') {
        states.set(inventory.address, {
          inventory,
          status: 'ready',
          resolution,
          effective: resolution.inventory,
        });
      } else {
        states.set(inventory.address, {
          inventory,
          status: 'unresolved',
          resolution,
          problems: resolution.problems,
        });
      }
    });
    return states;
  }, [list, queries, established]);
}

const EMPTY_INVENTORIES: readonly DiscoveredInventory[] = [];
