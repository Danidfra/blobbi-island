/**
 * What the Clothing Store sells.
 *
 * ## Derived, never declared
 *
 * Like the Care Store's shelf, this is a PROJECTION and not a list. Its two
 * sources already exist:
 *
 *   1. `ADDRESSED_OFFICIAL_COSMETICS` — the canonical kind:31632 cosmetic
 *      registry, which already carries every wearable's name, symbol, artwork
 *      and published `max_stack`;
 *   2. `WEARABLE_COIN_PRICES` in `shop-catalog.ts` — the Island's wearable coin
 *      price domain.
 *
 * So the store cannot list an unofficial item, cannot list an unpriced one, and
 * cannot disagree with any other surface about what a thing costs. Identity is
 * the canonical address (`31632:<issuer>:<d>`) throughout; nothing here reads an
 * event, so an event id could not become identity even by accident.
 *
 * ## The shelf is EMPTY today, deliberately
 *
 * All four official wearables are already spoken for — three are Arcade Prize
 * Counter items with Arcade Ticket prices, and the fourth's definition reserves
 * it for a future special acquisition path. Pricing any of them in Coins is an
 * economy decision about the Arcade, not about this shop, so
 * `WEARABLE_COIN_PRICES` ships empty and the modal says so honestly rather than
 * inventing a number. See that table for the full reasoning.
 *
 * Everything below — and the whole purchase path behind it — is built and
 * tested against a fixture price table. Stocking the store is one line of data.
 *
 * ## Slots are read from the DEFINITION, never from this file
 *
 * Where a wearable goes on a Blobbi is `content.visual.slot` in the issuer's
 * published definition, resolved by `placement/policy.ts`. This module does not
 * duplicate it: the modal groups by the slot the catalog resolves at runtime, so
 * an issuer moving an item from `headwear` to `face-mark` moves it in the shop
 * too, with no edit here.
 */

import {
  ADDRESSED_OFFICIAL_COSMETICS,
  officialCosmeticByAddress,
} from '@/protocol/event-registry';

import { WEARABLE_SHOP_ENTRIES } from './shop-catalog';

export interface ClothingStoreProduct {
  /** Canonical kind:31632 address — the item's identity. */
  readonly address: string;
  /** The definition's `d` tag. */
  readonly d: string;
  readonly name: string;
  /** The published `symbol` emoji, used when the artwork cannot load. */
  readonly symbol: string;
  /** Bundled fallback artwork from the registry, when the definition has one. */
  readonly primaryImage: string | null;
  /** Canonical coin price, from the shared wearable price table. */
  readonly price: number;
  /**
   * How many one player may hold, from the definition's published `max_stack`.
   *
   * Every official cosmetic publishes `1`, so in practice a wearable is UNIQUE:
   * owned once, never bought again. That is read here, not assumed — an issuer
   * publishing a genuinely stackable wearable would be honoured without a code
   * change, and the guard that enforces it lives in the mutation layer rather
   * than in the button (see `useBatchPurchase`).
   */
  readonly maxStack: number;
}

/**
 * Every wearable the Clothing Store sells, in canonical registry order.
 *
 * Empty while `WEARABLE_COIN_PRICES` is — see the note above.
 */
export const CLOTHING_STORE_PRODUCTS: readonly ClothingStoreProduct[] =
  WEARABLE_SHOP_ENTRIES.flatMap((entry) => {
    const cosmetic = officialCosmeticByAddress(entry.address);
    // Unreachable through `validateWearablePrices`, which rejects a price for
    // anything that is not an active official cosmetic. Kept because a shelf
    // that silently shows an unresolvable item is worse than a shorter shelf.
    if (!cosmetic) return [];
    return [
      {
        address: cosmetic.address,
        d: cosmetic.d,
        name: cosmetic.name,
        symbol: cosmetic.symbol,
        primaryImage: cosmetic.primaryImage,
        price: entry.price,
        maxStack: entry.maxStack,
      },
    ];
  });

/** Is this address something the Clothing Store sells? */
export function isClothingStoreProduct(address: string): boolean {
  return CLOTHING_STORE_PRODUCTS.some((p) => p.address === address);
}

/**
 * Every official wearable, whether or not it is for sale.
 *
 * The modal uses this to tell the player what the store is FOR while its shelf
 * is empty — "these exist, they are not on sale here yet" is a truthful thing to
 * show, and an unexplained blank room is not.
 */
export const OFFICIAL_WEARABLES = ADDRESSED_OFFICIAL_COSMETICS;
