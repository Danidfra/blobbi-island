/**
 * Blobbi Island — shop catalog (Phase 7).
 *
 * Prices are Island-specific and kept LOCAL (never read from kind:31632).
 * Identity is the canonical item address; the shop lists all 19 official items.
 */

import { OFFICIAL_ITEM_REGISTRY } from './registry';
import { itemIdToAddress } from './registry';

/** Island shop prices in coins, keyed by legacy itemId. */
const PRICES_BY_ITEM_ID: Record<string, number> = {
  food_apple: 10,
  food_burger: 25,
  food_cake: 50,
  food_pizza: 35,
  food_sushi: 45,
  toy_ball: 30,
  toy_teddy: 60,
  toy_blocks: 40,
  med_vitamins: 40,
  med_super: 100,
  med_bandage: 20,
  med_elixir: 150,
  med_shell_repair: 60,
  med_calcium: 35,
  hyg_soap: 15,
  hyg_shampoo: 25,
  hyg_bubble: 40,
  hyg_towel: 20,
  nrg_drink: 30,
};

export interface ShopEntry {
  address: string;
  itemId: string;
  price: number;
}

/** All purchasable shop entries (canonical address + local price). */
export const SHOP_ENTRIES: readonly ShopEntry[] = OFFICIAL_ITEM_REGISTRY.map(
  (entry) => ({
    address: entry.address,
    itemId: entry.itemId,
    price: PRICES_BY_ITEM_ID[entry.itemId] ?? 0,
  }),
);

/** Look up a price by legacy itemId. */
export function priceForItemId(itemId: string): number | null {
  return PRICES_BY_ITEM_ID[itemId] ?? null;
}

/** Look up a price by canonical address. */
export function priceForAddress(address: string): number | null {
  const entry = SHOP_ENTRIES.find((e) => e.address === address);
  return entry ? entry.price : null;
}

/** Resolve a shop entry from a legacy itemId. */
export function shopEntryForItemId(itemId: string): ShopEntry | null {
  const address = itemIdToAddress(itemId);
  if (!address) return null;
  return SHOP_ENTRIES.find((e) => e.address === address) ?? null;
}
