/**
 * Blobbi Island — Official item registry (address/id projection).
 *
 * The canonical identity of an item is its full kind:31632 address
 * (`31632:<issuer>:<d>`). The legacy `itemId` (e.g. `food_apple`) is retained
 * ONLY as a compatibility/UI identifier — it is never used as protocol
 * identity. The item `name` is likewise never used as identity.
 *
 * This module no longer HOLDS the item list. It is a projection of the single
 * canonical source, `src/protocol/event-registry.ts`, which also feeds the
 * bundled fallback catalog, the shop catalog and the generated protocol
 * document. That is what stops those four from drifting apart.
 *
 * Addresses are constructed with the package's `buildGameItemAddress` (via the
 * canonical registry) so the exact colon-splitting rules stay owned by
 * `@nostr-games/inventory`.
 */

import { ADDRESSED_OFFICIAL_ITEMS } from '@/protocol/event-registry';

/** A fully-resolved registry entry. */
export interface RegistryEntry {
  /** Full canonical kind:31632 address `31632:<issuer>:<d>`. */
  address: string;
  /** Legacy/UI identifier. */
  itemId: string;
  /** The `d` tag of the definition. */
  d: string;
}

/**
 * Every official item the client recognises, in canonical order.
 *
 * Includes `reserved` items (identity claimed, official event not published
 * yet) and would include `deprecated` ones, because both must still resolve to
 * a definition when they appear in a player's kind:31633 inventory. Whether an
 * item is PURCHASABLE is a separate question, answered by `shop-catalog.ts`.
 */
const ENTRIES: readonly RegistryEntry[] = ADDRESSED_OFFICIAL_ITEMS.map((e) => ({
  address: e.address,
  itemId: e.itemId,
  d: e.d,
}));

/** All official item addresses (canonical identities). */
export const OFFICIAL_ITEM_ADDRESSES: readonly string[] = ENTRIES.map(
  (e) => e.address,
);

/** All official `d` tags, for constructing relay filters. */
export const OFFICIAL_ITEM_D_TAGS: readonly string[] = ENTRIES.map((e) => e.d);

/** All registry entries. */
export const OFFICIAL_ITEM_REGISTRY: readonly RegistryEntry[] = ENTRIES;

// --- Deterministic lookup maps -------------------------------------------

const byItemId = new Map<string, RegistryEntry>();
const byAddress = new Map<string, RegistryEntry>();
const byDTag = new Map<string, RegistryEntry>();

for (const entry of ENTRIES) {
  byItemId.set(entry.itemId, entry);
  byAddress.set(entry.address, entry);
  byDTag.set(entry.d, entry);
}

/** Resolve a legacy itemId to its full canonical address, or `null`. */
export function itemIdToAddress(itemId: string): string | null {
  return byItemId.get(itemId)?.address ?? null;
}

/** Resolve a full address to its legacy itemId, or `null` if not official. */
export function addressToItemId(address: string): string | null {
  return byAddress.get(address)?.itemId ?? null;
}

/** Resolve a definition `d` tag to its full canonical address, or `null`. */
export function dTagToAddress(d: string): string | null {
  return byDTag.get(d)?.address ?? null;
}

/** Look up a registry entry by any identity. */
export function getRegistryEntryByAddress(
  address: string,
): RegistryEntry | null {
  return byAddress.get(address) ?? null;
}

export function getRegistryEntryByItemId(itemId: string): RegistryEntry | null {
  return byItemId.get(itemId) ?? null;
}

/** Is this address one of the official Blobbi item addresses? */
export function isOfficialItemAddress(address: string): boolean {
  return byAddress.has(address);
}
