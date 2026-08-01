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

import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
  ADDRESSED_OFFICIAL_ITEMS,
} from '@/protocol/event-registry';

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

// --- Official cosmetics ---------------------------------------------------
//
// Projected from the same canonical registry, kept in its own set of exports
// because cosmetics are not care items and must never leak into the shop, the
// care flows or the consumable counts. See the `OFFICIAL_COSMETIC_DEFINITIONS`
// note in `src/protocol/event-registry.ts` for why they are a separate list.

const COSMETIC_ENTRIES = ADDRESSED_OFFICIAL_COSMETICS;

/** All official cosmetic addresses (canonical identities). */
export const OFFICIAL_COSMETIC_ADDRESSES: readonly string[] =
  COSMETIC_ENTRIES.map((e) => e.address);

/** All official cosmetic `d` tags, for constructing relay filters. */
export const OFFICIAL_COSMETIC_D_TAGS: readonly string[] = COSMETIC_ENTRIES.map(
  (e) => e.d,
);

const cosmeticByDTag = new Map(COSMETIC_ENTRIES.map((e) => [e.d, e]));
/**
 * Resolve a cosmetic `d` tag to its full canonical address, or `null`.
 *
 * `null` for any `d` this repository has not declared official. The address is
 * always built from the official issuer, so this can never produce an address
 * belonging to another author.
 */
export function cosmeticDTagToAddress(d: string): string | null {
  return cosmeticByDTag.get(d)?.address ?? null;
}

const cosmeticAddresses = new Set(OFFICIAL_COSMETIC_ADDRESSES);

/**
 * Is this address one of the official Blobbi cosmetic addresses?
 *
 * Compares the WHOLE address, not the `d` tail: `31632:<stranger>:<same-d>` is
 * a different item by a different author, and must answer `false`.
 */
export function isOfficialCosmeticAddress(address: string): boolean {
  return cosmeticAddresses.has(address);
}

// --- Official visual-effect items -----------------------------------------
//
// Projected from the same canonical registry. Effect items are cosmetics in
// the published events' `type` tag but a separate identity list here: they are
// never care items, never image-drawn wearables, and what they unlock — a
// locally implemented renderer effect — is authorized through
// `src/effects/official-visual-effect-items.ts` by FULL address only.

const EFFECT_ENTRIES = ADDRESSED_OFFICIAL_EFFECT_ITEMS;

/** All official visual-effect item addresses (canonical identities). */
export const OFFICIAL_EFFECT_ITEM_ADDRESSES: readonly string[] =
  EFFECT_ENTRIES.map((e) => e.address);

/** All official effect-item `d` tags, for constructing relay filters. */
export const OFFICIAL_EFFECT_ITEM_D_TAGS: readonly string[] = EFFECT_ENTRIES.map(
  (e) => e.d,
);

const effectItemAddresses = new Set(OFFICIAL_EFFECT_ITEM_ADDRESSES);

/**
 * Is this address one of the official visual-effect item addresses?
 *
 * Compares the WHOLE address: a copied `d` under another issuer answers
 * `false`, which is what keeps a third-party `blobbi:effect:celestial-aura`
 * from ever entering the effect path.
 */
export function isOfficialEffectItemAddress(address: string): boolean {
  return effectItemAddresses.has(address);
}
