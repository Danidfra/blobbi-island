/**
 * Blobbi Island — Official item registry (Phase 2).
 *
 * The canonical identity of an item is its full kind:31632 address
 * (`31632:<issuer>:<d>`). The legacy `itemId` (e.g. `food_apple`) is retained
 * ONLY as a compatibility/UI identifier — it is never used as protocol
 * identity. The item `name` is likewise never used as identity.
 *
 * Addresses are constructed with the package's `buildGameItemAddress` so the
 * exact colon-splitting rules stay owned by `@nostr-games/inventory`.
 */

import { buildGameItemAddress } from './package';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';

/**
 * The 19 official Blobbi items. Each entry pairs the legacy `itemId` with the
 * `d` tag used in its published kind:31632 definition.
 *
 * This list is the authoritative Island-side mapping. The full address is
 * derived (issuer + d) rather than hardcoded, so it cannot drift from the
 * issuer constant.
 */
interface OfficialItemEntry {
  /** Legacy/UI identifier. */
  itemId: string;
  /** The `d` tag of the published kind:31632 definition. */
  d: string;
}

const OFFICIAL_ITEM_ENTRIES: readonly OfficialItemEntry[] = [
  // Food
  { itemId: 'food_apple', d: 'blobbi:food:apple' },
  { itemId: 'food_burger', d: 'blobbi:food:burger' },
  { itemId: 'food_cake', d: 'blobbi:food:cake' },
  { itemId: 'food_pizza', d: 'blobbi:food:pizza' },
  { itemId: 'food_sushi', d: 'blobbi:food:sushi' },
  // Toys
  { itemId: 'toy_ball', d: 'blobbi:toy:ball' },
  { itemId: 'toy_teddy', d: 'blobbi:toy:teddy' },
  { itemId: 'toy_blocks', d: 'blobbi:toy:blocks' },
  // Medicine
  { itemId: 'med_vitamins', d: 'blobbi:medicine:vitamins' },
  { itemId: 'med_super', d: 'blobbi:medicine:super' },
  { itemId: 'med_bandage', d: 'blobbi:medicine:bandage' },
  { itemId: 'med_elixir', d: 'blobbi:medicine:health-elixir' },
  { itemId: 'med_shell_repair', d: 'blobbi:medicine:shell-repair-kit' },
  { itemId: 'med_calcium', d: 'blobbi:medicine:calcium' },
  // Hygiene
  { itemId: 'hyg_soap', d: 'blobbi:hygiene:soap' },
  { itemId: 'hyg_shampoo', d: 'blobbi:hygiene:shampoo' },
  { itemId: 'hyg_bubble', d: 'blobbi:hygiene:bubble-bath' },
  { itemId: 'hyg_towel', d: 'blobbi:hygiene:soft-towel' },
  // Energy
  { itemId: 'nrg_drink', d: 'blobbi:energy:drink' },
];

/** A fully-resolved registry entry. */
export interface RegistryEntry {
  /** Full canonical kind:31632 address `31632:<issuer>:<d>`. */
  address: string;
  /** Legacy/UI identifier. */
  itemId: string;
  /** The `d` tag of the definition. */
  d: string;
}

const ENTRIES: readonly RegistryEntry[] = OFFICIAL_ITEM_ENTRIES.map((e) => ({
  address: buildGameItemAddress(OFFICIAL_ITEM_ISSUER_PUBKEY, e.d),
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
