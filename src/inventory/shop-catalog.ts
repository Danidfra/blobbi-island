/**
 * Blobbi Island: LOCAL coin economy for the shop.
 *
 * ## Why prices live here and not in the protocol registry
 *
 * A coin price is not a protocol fact. It is not part of the kind:31632
 * definition, it is never read from a relay, it changes on a different clock
 * from the definition (balancing, promotions, per-shop variation), and a second
 * currency: arcade tickets in the prize shop, will need its own price domain
 * rather than a second field bolted onto the item definition. So the price table
 * is a **distinct domain with its own source**, deliberately.
 *
 * ## Why that is not a return to drifting catalogs
 *
 * A separate source is only safe if it cannot disagree with the canonical one.
 * {@link validateCoinPrices} runs at module load and REJECTS a table that:
 *
 *   1. prices the same item twice;
 *   2. prices something that is not an official registered item;
 *   3. prices a non-consumable (currency is earned, never bought);
 *   4. uses a price that is not a positive integer.
 *
 * A violation throws at import time, so a broken table cannot reach a build:
 * the tests, the typecheck and `vite build` all import this module.
 *
 * ## Identity
 *
 * The table is keyed by the kind:31632 `d`: protocol identity, not by the
 * legacy `itemId`. Addresses are derived from the canonical registry.
 *
 * ## Missing prices are `null`, never `0`
 *
 * An item with no entry is NOT FOR SALE. `priceForAddress` returns `null`, which
 * is what makes `normalizePurchaseLines` reject it ("Item is not for sale"). An
 * earlier shape defaulted to `0`, which would have made any unpriced official
 * item: the Arcade Ticket, for one, purchasable for free.
 */

import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_ITEMS,
  CONSUMABLE_ITEM_CATEGORIES,
  officialCosmeticByD,
  officialItemByD,
} from '@/protocol/event-registry';

import { itemIdToAddress } from './registry';

/** One local price line: an official item `d` and its cost in coins. */
export interface CoinPriceEntry {
  /** kind:31632 `d` tag of an official item. */
  d: string;
  /** Price in coins. Positive integer. */
  coins: number;
}

/**
 * The Island coin price list.
 *
 * An ARRAY rather than a keyed object, so a duplicated item is a runtime error
 * caught by {@link validateCoinPrices} instead of one entry silently winning.
 */
export const COIN_PRICES: readonly CoinPriceEntry[] = [
  // Food
  { d: 'blobbi:food:apple', coins: 10 },
  { d: 'blobbi:food:burger', coins: 25 },
  { d: 'blobbi:food:cake', coins: 50 },
  { d: 'blobbi:food:pizza', coins: 35 },
  { d: 'blobbi:food:sushi', coins: 45 },
  // Toys
  { d: 'blobbi:toy:ball', coins: 30 },
  { d: 'blobbi:toy:teddy', coins: 60 },
  { d: 'blobbi:toy:blocks', coins: 40 },
  // Medicine
  { d: 'blobbi:medicine:vitamins', coins: 40 },
  { d: 'blobbi:medicine:super', coins: 100 },
  { d: 'blobbi:medicine:bandage', coins: 20 },
  { d: 'blobbi:medicine:health-elixir', coins: 150 },
  { d: 'blobbi:medicine:shell-repair-kit', coins: 60 },
  { d: 'blobbi:medicine:calcium', coins: 35 },
  // Hygiene
  { d: 'blobbi:hygiene:soap', coins: 15 },
  { d: 'blobbi:hygiene:shampoo', coins: 25 },
  { d: 'blobbi:hygiene:bubble-bath', coins: 40 },
  { d: 'blobbi:hygiene:soft-towel', coins: 20 },
  // Energy
  { d: 'blobbi:energy:drink', coins: 30 },
  //
  // NOT PRICED: deliberately:
  //   blobbi:currency:arcade-ticket: earned in the arcade, never bought with
  //   coins. Rule 3 below makes pricing it a hard error rather than a review
  //   catch.
];

/** A validation failure in the local price table. */
export class CoinPriceValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid coin price table:\n- ${issues.join('\n- ')}`);
    this.name = 'CoinPriceValidationError';
  }
}

/**
 * Validate a price table against the canonical official-item registry.
 *
 * Pure and exported so tests can exercise the failure modes directly rather than
 * only observing that the shipped table happens to be valid.
 *
 * @returns the list of problems; empty means valid.
 */
export function validateCoinPrices(
  entries: readonly CoinPriceEntry[],
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    // 1. no duplicates
    if (seen.has(entry.d)) {
      issues.push(`duplicate price entry for "${entry.d}"`);
      continue;
    }
    seen.add(entry.d);

    // 2. must be an official registered item
    const item = officialItemByD(entry.d);
    if (!item) {
      issues.push(`"${entry.d}" is not an official registered item`);
      continue;
    }

    // 3. only consumables may be bought with coins
    if (!CONSUMABLE_ITEM_CATEGORIES.includes(item.category)) {
      issues.push(
        `"${entry.d}" has category "${item.category}", which is not purchasable with coins`,
      );
    }

    // 4. a price must be a positive integer
    if (!Number.isInteger(entry.coins) || entry.coins <= 0) {
      issues.push(
        `"${entry.d}" has an invalid price ${entry.coins} (expected a positive integer)`,
      );
    }
  }

  return issues;
}

const shippedIssues = validateCoinPrices(COIN_PRICES);
if (shippedIssues.length > 0) {
  // Fail loudly at import time: the typecheck, the tests and the production
  // build all import this module, so an invalid table cannot ship silently.
  throw new CoinPriceValidationError(shippedIssues);
}

const COINS_BY_D = new Map(COIN_PRICES.map((e) => [e.d, e.coins]));

export interface ShopEntry {
  address: string;
  itemId: string;
  price: number;
}

/**
 * Purchasable shop entries: every official item that has a coin price, in
 * canonical registry order (so the shop's ordering follows the catalog rather
 * than the order prices happen to be written in).
 */
export const SHOP_ENTRIES: readonly ShopEntry[] = ADDRESSED_OFFICIAL_ITEMS.flatMap(
  (item) => {
    const price = COINS_BY_D.get(item.d);
    return price === undefined
      ? []
      : [{ address: item.address, itemId: item.itemId, price }];
  },
);

const PRICE_BY_ITEM_ID = new Map(
  SHOP_ENTRIES.map((entry) => [entry.itemId, entry.price]),
);
const PRICE_BY_ADDRESS = new Map(
  SHOP_ENTRIES.map((entry) => [entry.address, entry.price]),
);

/**
 * The WEARABLE coin price list, a second price domain, deliberately separate.
 *
 * {@link COIN_PRICES} refuses to price anything that is not a consumable, and
 * that rule is load-bearing rather than incidental: it is what stops the Arcade
 * Ticket becoming purchasable, and it must not be relaxed. Wearables are priced
 * here instead, against their own validator, so a cosmetic can be sold without
 * weakening the guarantee that protects the consumable shop.
 *
 * ## It is EMPTY, and that is a decision rather than an omission
 *
 * Every official wearable this client knows is already spoken for:
 *
 *   Block Builder Cap      200 Arcade Tickets   (Prize Counter)
 *   Stargazer Glasses      500 Arcade Tickets   (Prize Counter)
 *   Starlight Bow Tie      900 Arcade Tickets   (Prize Counter)
 *   Celestial Seraph Necklace, reserved for a future special acquisition
 *                                path, deliberately NOT in the Arcade
 *                                (`official-prize-catalog.ts`)
 *
 * Putting a Coin price on any of the first three would let a player buy past
 * the ticket ladder that the Prize Counter exists to create, an Arcade economy
 * change, not a Clothing Store one. Putting a price on the fourth would decide
 * the "future special acquisition path" its own definition reserves. Neither is
 * this workstream's call to make, and neither is recoverable by a code review,
 * so the shelf ships honest and empty rather than stocked with a number nobody
 * chose.
 *
 * Everything downstream is built and tested. Adding a line here is all that
 * stocking the Clothing Store takes.
 */
export const WEARABLE_COIN_PRICES: readonly CoinPriceEntry[] = [];

/**
 * Validate a wearable price table against the canonical COSMETIC registry.
 *
 * Same shape as {@link validateCoinPrices}, different membership rule: an entry
 * must be an official cosmetic that is actually PUBLISHED (`active`). Selling a
 * `reserved` identity would put an item in a player's inventory that no client
 * can resolve to a name or a picture.
 */
export function validateWearablePrices(
  entries: readonly CoinPriceEntry[],
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.d)) {
      issues.push(`duplicate wearable price entry for "${entry.d}"`);
      continue;
    }
    seen.add(entry.d);

    const cosmetic = officialCosmeticByD(entry.d);
    if (!cosmetic) {
      issues.push(`"${entry.d}" is not an official registered cosmetic`);
      continue;
    }
    if (cosmetic.status !== 'active') {
      issues.push(
        `"${entry.d}" is ${cosmetic.status}, so its definition cannot be resolved by a buyer`,
      );
    }
    if (!Number.isInteger(entry.coins) || entry.coins <= 0) {
      issues.push(
        `"${entry.d}" has an invalid price ${entry.coins} (expected a positive integer)`,
      );
    }
  }

  return issues;
}

const shippedWearableIssues = validateWearablePrices(WEARABLE_COIN_PRICES);
if (shippedWearableIssues.length > 0) {
  throw new CoinPriceValidationError(shippedWearableIssues);
}

const WEARABLE_COINS_BY_D = new Map(
  WEARABLE_COIN_PRICES.map((e) => [e.d, e.coins]),
);

export interface WearableShopEntry extends ShopEntry {
  /** How many one player may hold. Every official cosmetic publishes 1. */
  maxStack: number;
}

/**
 * Purchasable wearables: every official cosmetic that has a coin price, in
 * canonical registry order.
 */
export const WEARABLE_SHOP_ENTRIES: readonly WearableShopEntry[] =
  ADDRESSED_OFFICIAL_COSMETICS.flatMap((cosmetic) => {
    const price = WEARABLE_COINS_BY_D.get(cosmetic.d);
    return price === undefined
      ? []
      : [
          {
            address: cosmetic.address,
            // Cosmetics have no legacy itemId; the `d` is the only non-address
            // identifier they have ever had.
            itemId: cosmetic.d,
            price,
            maxStack: cosmetic.maxStack,
          },
        ];
  });

const WEARABLE_PRICE_BY_ADDRESS = new Map(
  WEARABLE_SHOP_ENTRIES.map((entry) => [entry.address, entry.price]),
);

/** Look up a price by legacy itemId. `null` when the item is not for sale. */
export function priceForItemId(itemId: string): number | null {
  return PRICE_BY_ITEM_ID.get(itemId) ?? null;
}

/**
 * Look up a price by canonical address. `null` when the item is not for sale.
 *
 * THE pricing boundary, `useBatchPurchase` resolves every charge through this
 * one function, so both price domains have to answer here or a wearable could
 * not be bought through the shared purchase path at all. Consulting both keeps
 * ONE boundary rather than growing a second purchase flow beside it; the two
 * tables stay separate underneath because their membership rules differ.
 *
 * An address in neither table is NOT FOR SALE, which is what makes
 * `normalizePurchaseLines` reject it. Unknown is never free.
 */
export function priceForAddress(address: string): number | null {
  return (
    PRICE_BY_ADDRESS.get(address) ?? WEARABLE_PRICE_BY_ADDRESS.get(address) ?? null
  );
}

/**
 * The published stack ceiling for a purchasable address, or `null` for none.
 *
 * Consumables publish no `max_stack` and are unbounded; wearables publish `1`
 * and are therefore unique. This is the ONE place a purchase asks the question,
 * and it answers from the definition rather than from a category guess.
 */
export function stackLimitForAddress(address: string): number | null {
  return (
    WEARABLE_SHOP_ENTRIES.find((entry) => entry.address === address)?.maxStack ??
    null
  );
}

/** Resolve a shop entry from a legacy itemId. */
export function shopEntryForItemId(itemId: string): ShopEntry | null {
  const address = itemIdToAddress(itemId);
  if (!address) return null;
  return SHOP_ENTRIES.find((e) => e.address === address) ?? null;
}
