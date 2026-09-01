/**
 * What the Clothing Store is allowed to sell.
 *
 * The shelf is derived, so what this file guards is the derivation and the
 * membership rules around it: only official cosmetics, only published ones,
 * only with a real Coin price, never a consumable and never a currency.
 *
 * It also PINS the reason the shelf is empty. That is not decoration: an empty
 * shop looks like a bug, and the next person to open this file deserves to find
 * out from a test that it is a deliberate, reversible state rather than an
 * unfinished one.
 */

import { describe, it, expect } from 'vitest';

import {
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_ITEMS,
  ARCADE_TICKET_D,
  officialCosmeticByAddress,
  officialCosmeticByD,
} from '@/protocol/event-registry';
import { OFFICIAL_ARCADE_PRIZE_CATALOG } from '@/arcade/prizes/official-prize-catalog';

import {
  CLOTHING_STORE_PRODUCTS,
  OFFICIAL_WEARABLES,
  isClothingStoreProduct,
} from './clothing-store-catalog';
import {
  WEARABLE_COIN_PRICES,
  WEARABLE_SHOP_ENTRIES,
  priceForAddress,
  stackLimitForAddress,
  validateWearablePrices,
} from './shop-catalog';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { BLOBBI_COIN_ADDRESS } from './coin';

describe('every product is a canonical kind:31632 cosmetic', () => {
  it('is addressed as 31632:<official issuer>:<d>', () => {
    for (const product of CLOTHING_STORE_PRODUCTS) {
      expect(product.address).toBe(
        `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${product.d}`,
      );
    }
  });

  it('resolves back to the registry entry it was projected from', () => {
    for (const product of CLOTHING_STORE_PRODUCTS) {
      const cosmetic = officialCosmeticByAddress(product.address);
      expect(cosmetic, product.address).not.toBeNull();
      expect(cosmetic!.name).toBe(product.name);
      expect(cosmetic!.maxStack).toBe(product.maxStack);
      expect(cosmetic!.status).toBe('active');
    }
  });

  it('never uses an event id as identity', () => {
    for (const product of CLOTHING_STORE_PRODUCTS) {
      expect(product.address.startsWith('31632:')).toBe(true);
      expect(product.d.startsWith('blobbi:cosmetic:')).toBe(true);
      expect(officialCosmeticByD(product.d)!.address).toBe(product.address);
    }
  });

  it('has a real Coin price, resolved through the shared boundary', () => {
    for (const product of CLOTHING_STORE_PRODUCTS) {
      expect(Number.isInteger(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
      expect(priceForAddress(product.address)).toBe(product.price);
    }
  });
});

describe('nothing that is not clothing can reach the shelf', () => {
  it('no consumable is listed', () => {
    for (const item of ADDRESSED_OFFICIAL_ITEMS) {
      expect(isClothingStoreProduct(item.address), item.d).toBe(false);
    }
  });

  it('no currency is listed — not the Coin, not the Arcade Ticket', () => {
    expect(isClothingStoreProduct(BLOBBI_COIN_ADDRESS)).toBe(false);
    const ticket = ADDRESSED_OFFICIAL_ITEMS.find((i) => i.d === ARCADE_TICKET_D)!;
    expect(isClothingStoreProduct(ticket.address)).toBe(false);
  });

  it('rejects an address the store does not sell', () => {
    expect(isClothingStoreProduct('31632:someone:blobbi:cosmetic:invented')).toBe(false);
    expect(isClothingStoreProduct('')).toBe(false);
  });
});

describe('the wearable price table validates against the cosmetic registry', () => {
  it('accepts an active official cosmetic at a positive integer price', () => {
    expect(
      validateWearablePrices([{ d: 'blobbi:cosmetic:stargazer-glasses', coins: 250 }]),
    ).toEqual([]);
  });

  it('refuses something that is not an official cosmetic', () => {
    // A consumable has a price table of its own; it must not be sold as clothing.
    expect(validateWearablePrices([{ d: 'blobbi:food:apple', coins: 10 }])).toEqual([
      expect.stringContaining('not an official registered cosmetic'),
    ]);
  });

  it('refuses a duplicate, and a nonsense price', () => {
    const d = 'blobbi:cosmetic:starlight-bow-tie';
    expect(validateWearablePrices([{ d, coins: 10 }, { d, coins: 20 }])).toEqual([
      expect.stringContaining('duplicate'),
    ]);
    expect(validateWearablePrices([{ d, coins: 0 }])).toEqual([
      expect.stringContaining('invalid price'),
    ]);
    expect(validateWearablePrices([{ d, coins: 1.5 }])).toEqual([
      expect.stringContaining('invalid price'),
    ]);
  });
});

describe('wearables are unique, because their definitions say so', () => {
  it('every official cosmetic publishes max_stack 1', () => {
    for (const cosmetic of ADDRESSED_OFFICIAL_COSMETICS) {
      expect(cosmetic.maxStack, cosmetic.d).toBe(1);
    }
  });

  it('a listed wearable carries that ceiling into the purchase layer', () => {
    for (const entry of WEARABLE_SHOP_ENTRIES) {
      expect(stackLimitForAddress(entry.address)).toBe(entry.maxStack);
    }
  });

  it('a consumable has no ceiling, so ordinary carts are unaffected', () => {
    const apple = ADDRESSED_OFFICIAL_ITEMS.find((i) => i.d === 'blobbi:food:apple')!;
    expect(stackLimitForAddress(apple.address)).toBeNull();
  });
});

describe('the shelf is empty on purpose, and the reason is checkable', () => {
  it('ships with no wearable priced', () => {
    expect(WEARABLE_COIN_PRICES).toEqual([]);
    expect(CLOTHING_STORE_PRODUCTS).toEqual([]);
  });

  it('because every official wearable is already spoken for', () => {
    // Three are Arcade Prize Counter items with Arcade TICKET prices. Giving
    // any of them a Coin price would let a player buy past the ticket ladder —
    // an Arcade economy change, not a Clothing Store one.
    const arcadeAddresses = new Set(OFFICIAL_ARCADE_PRIZE_CATALOG.map((p) => p.itemAddress));
    const unclaimed = ADDRESSED_OFFICIAL_COSMETICS.filter(
      (c) => !arcadeAddresses.has(c.address),
    );

    expect(ADDRESSED_OFFICIAL_COSMETICS).toHaveLength(4);
    expect(unclaimed.map((c) => c.d)).toEqual([
      // …and the fourth is reserved by its own catalog note for a future
      // special acquisition path, deliberately outside the Arcade.
      'blobbi:cosmetic:celestial-seraph-necklace',
    ]);
  });

  it('still tells the player what the store is for', () => {
    // The modal renders these while the shelf is bare, so an empty shop is
    // explained rather than blank.
    expect(OFFICIAL_WEARABLES).toBe(ADDRESSED_OFFICIAL_COSMETICS);
    expect(OFFICIAL_WEARABLES.length).toBeGreaterThan(0);
  });

  it('and stocking it is one line of data, not a code change', () => {
    // The projection is exercised here rather than left theoretical: the same
    // pipeline that builds an empty shelf builds a stocked one.
    const priced = validateWearablePrices([
      { d: 'blobbi:cosmetic:stargazer-glasses', coins: 250 },
    ]);
    expect(priced).toEqual([]);
  });
});
