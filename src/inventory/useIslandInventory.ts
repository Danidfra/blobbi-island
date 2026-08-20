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
import {
  readRelayConfirmedOrThrow,
  readRelayEventsOrThrow,
  type RelayReader,
} from '@/lib/relay-read';
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
 * The narrow relay surface an inventory read needs.
 *
 * Structurally the shared {@link RelayReader}: `query` plus the OPTIONAL
 * EOSE-aware `req`. Production always has `req` (`NPool` implements `NRelay`);
 * a fake with only `query` still works, on the weaker "a resolved call is an
 * answer" assumption. See `src/lib/relay-read.ts`.
 */
export type InventoryReadNostr = RelayReader;

export interface InventoryWithMeta {
  readonly inventory: GameInventory;
  /** `created_at` of the newest valid event, or 0 when none exists. */
  readonly createdAt: number;
}

const INVENTORY_FILTERS = (pubkey: string) => [
  {
    kinds: [KIND_GAME_INVENTORY],
    authors: [pubkey],
    '#d': [ISLAND_INVENTORY_D],
    limit: 1,
  },
];

const INVENTORY_READ_TIMEOUT_MS = 3000;

/**
 * Fetch the newest valid kind:31633 together with its `created_at`.
 *
 * CORRECTION (this phase): the previous comment here claimed a timeout/abort
 * makes `nostr.query` reject. It does not — `NPool.query` swallows every
 * failure and resolves with partial results, usually `[]`. That is why the
 * read now goes through {@link readRelayEventsOrThrow}, which reports an
 * unusable read as {@link RelayReadUnknownError} instead of as "no inventory".
 * Every caller already treats a throw as "unknown": the Coin wallet maps it to
 * `read-failed`, the read-back verification to `verified: false`, and the
 * economy-entry service to "cannot confirm — publish nothing".
 *
 * NOTE this is the SINGLE read. Anything that will become a PUBLISH BASE must
 * use {@link readAuthoritativeInventoryBase} instead.
 */
export async function fetchInventoryWithMeta(
  nostr: InventoryReadNostr,
  pubkey: string,
): Promise<InventoryWithMeta> {
  const events = await readRelayEventsOrThrow(nostr, INVENTORY_FILTERS(pubkey), {
    timeoutMs: INVENTORY_READ_TIMEOUT_MS,
  });
  return selectNewestInventory(events, pubkey);
}

/** Newest valid inventory event, or an empty base when there genuinely is none. */
function selectNewestInventory(
  events: NostrEvent[],
  pubkey: string,
): InventoryWithMeta {
  const valid = events
    .map((event) => ({ event, parsed: parseInventoryEvent(event) }))
    .filter((x): x is { event: NostrEvent; parsed: GameInventory } => Boolean(x.parsed))
    .sort((a, b) => b.event.created_at - a.event.created_at);
  if (valid.length === 0) {
    return { inventory: buildEmptyInventory(pubkey), createdAt: 0 };
  }
  return { inventory: valid[0].parsed, createdAt: valid[0].event.created_at };
}

/**
 * Read the base a REPLACEMENT event may safely be built from.
 *
 * kind:31633 is replaceable: a publish does not patch the inventory, it
 * replaces it. So an empty base is not merely a missing delta — it erases
 * every item the player owns. And a resolved-empty read is NOT proof of an
 * empty inventory: "new account" and "this relay does not carry (or has not
 * caught up with) the event" look identical over Nostr.
 *
 * This is the read that resolves that ambiguity:
 *
 * - first read returns an event    ⇒ use it;
 * - first read empty, second returns an event ⇒ use it (the first answer was
 *   wrong; without this the player's whole inventory would be replaced —
 *   the reported "Mine reward replaced my balance" bug);
 * - both reads empty               ⇒ genuinely no inventory; an empty base is
 *   correct and a first-ever write still works;
 * - either read UNKNOWN            ⇒ throws {@link RelayReadUnknownError}.
 *   Publishing from an unconfirmed empty base is exactly the defect.
 *
 * (Before this phase the "unknown" branch relied on `nostr.query` rejecting on
 * timeout. It never does — see `src/lib/relay-read.ts` — so the guarantee was
 * only as strong as "two consecutive timeouts are unlikely". It is now real.)
 */
export async function readAuthoritativeInventoryBase(
  nostr: InventoryReadNostr,
  pubkey: string,
): Promise<InventoryWithMeta> {
  // Confirmation lives in the shared primitive: an EOSE-completed empty answer
  // is re-read once before it is believed, and an unusable read throws rather
  // than degrading to "no inventory".
  const events = await readRelayConfirmedOrThrow(nostr, INVENTORY_FILTERS(pubkey), {
    timeoutMs: INVENTORY_READ_TIMEOUT_MS,
  });
  return selectNewestInventory(events, pubkey);
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
      // Same confirmed-empty rule as the publish base: an unusable read must
      // not render as "you own nothing" (a Coin balance of 0 is alarming and
      // wrong). Throwing keeps React Query's last good inventory on screen.
      const events = await readRelayConfirmedOrThrow(nostr, INVENTORY_FILTERS(user.pubkey), {
        signal: c.signal,
        timeoutMs: INVENTORY_READ_TIMEOUT_MS,
      });
      return selectNewestInventory(events, user.pubkey).inventory;
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
