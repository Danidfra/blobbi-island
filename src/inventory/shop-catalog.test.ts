import { describe, it, expect } from 'vitest';
import {
  SHOP_ENTRIES,
  priceForItemId,
  priceForAddress,
  shopEntryForItemId,
  itemIdToAddress,
} from '@/inventory';

describe('shop catalog', () => {
  it('lists all 19 official items with prices', () => {
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
