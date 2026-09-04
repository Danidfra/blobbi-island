import { describe, it, expect } from 'vitest';
import {
  SHOP_ENTRIES,
  priceForItemId,
  priceForAddress,
  shopEntryForItemId,
  itemIdToAddress,
  dTagToAddress,
} from '@/inventory';
import {
  COIN_PRICES,
  validateCoinPrices,
  type CoinPriceEntry,
} from './shop-catalog';
import {
  ACTIVE_OFFICIAL_ITEMS,
  ARCADE_TICKET_D,
  CONSUMABLE_ITEM_CATEGORIES,
  officialItemByD,
} from '@/protocol/event-registry';

describe('shop catalog', () => {
  it('lists all 19 purchasable official items with prices', () => {
    expect(SHOP_ENTRIES).toHaveLength(19);
    for (const entry of SHOP_ENTRIES) {
      expect(entry.price).toBeGreaterThan(0);
    }
  });

  it('uses the expected Ditto prices', () => {
    expect(priceForItemId('food_apple')).toBe(10);
    expect(priceForItemId('food_cake')).toBe(50);
    expect(priceForItemId('med_super')).toBe(100);
    expect(priceForItemId('med_elixir')).toBe(150);
    expect(priceForItemId('hyg_soap')).toBe(15);
    expect(priceForItemId('nrg_drink')).toBe(30);
  });

  it('resolves prices by address', () => {
    const apple = itemIdToAddress('food_apple')!;
    expect(priceForAddress(apple)).toBe(10);
  });

  it('resolves a shop entry from an itemId', () => {
    const entry = shopEntryForItemId('toy_teddy');
    expect(entry).not.toBeNull();
    expect(entry!.price).toBe(60);
    expect(entry!.address).toBe(itemIdToAddress('toy_teddy'));
  });

  it('returns null for non-shop items', () => {
    expect(priceForItemId('nope')).toBeNull();
    expect(priceForAddress('31632:x:y')).toBeNull();
    expect(shopEntryForItemId('nope')).toBeNull();
  });
});

/**
 * The price table is a SEPARATE domain from the protocol registry, local
 * economy configuration, not a definition fact. That is only safe because it is
 * validated against the canonical registry rather than trusted.
 */
describe('local coin price table', () => {
  it('is valid against the canonical official-item registry', () => {
    expect(validateCoinPrices(COIN_PRICES)).toEqual([]);
  });

  it('prices only official registered items', () => {
    for (const entry of COIN_PRICES) {
      expect(officialItemByD(entry.d), entry.d).not.toBeNull();
    }
  });

  it('prices every ACTIVE consumable exactly once', () => {
    const priced = COIN_PRICES.map((e) => e.d).sort();
    const consumables = ACTIVE_OFFICIAL_ITEMS.filter((i) =>
      CONSUMABLE_ITEM_CATEGORIES.includes(i.category),
    )
      .map((i) => i.d)
      .sort();
    expect(priced).toEqual(consumables);
  });

  it('rejects a duplicate price entry', () => {
    const table: CoinPriceEntry[] = [
      { d: 'blobbi:food:apple', coins: 10 },
      { d: 'blobbi:food:apple', coins: 999 },
    ];
    expect(validateCoinPrices(table)).toEqual([
      'duplicate price entry for "blobbi:food:apple"',
    ]);
  });

  it('rejects a price for an item that is not officially registered', () => {
    const issues = validateCoinPrices([
      { d: 'blobbi:food:not-a-real-item', coins: 10 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('is not an official registered item');
  });

  it('rejects a coin price for a currency item', () => {
    const issues = validateCoinPrices([{ d: ARCADE_TICKET_D, coins: 5 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('not purchasable with coins');
  });

  it('rejects zero, negative and fractional prices', () => {
    for (const coins of [0, -5, 2.5]) {
      const issues = validateCoinPrices([{ d: 'blobbi:food:apple', coins }]);
      expect(issues, `coins=${coins}`).toHaveLength(1);
      expect(issues[0]).toContain('invalid price');
    }
  });
});

describe('unpriced official items are not purchasable', () => {
  const ticket = dTagToAddress(ARCADE_TICKET_D)!;

  it('excludes the Arcade Ticket from the coin shop', () => {
    expect(COIN_PRICES.some((e) => e.d === ARCADE_TICKET_D)).toBe(false);
    expect(SHOP_ENTRIES.some((e) => e.address === ticket)).toBe(false);
  });

  it('returns null rather than 0 for an unpriced official item', () => {
    // A 0 would read as "free" to the purchase path; null makes it throw
    // "Item is not for sale".
    expect(priceForAddress(ticket)).toBeNull();
    expect(priceForItemId('cur_arcade_ticket')).toBeNull();
    expect(shopEntryForItemId('cur_arcade_ticket')).toBeNull();
  });
});
