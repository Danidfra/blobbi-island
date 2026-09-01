/**
 * What the Care Store is allowed to sell, and what it is allowed to call it.
 *
 * The shelf is derived rather than declared, so the risk this file guards is not
 * "did someone typo a price" — it is that the derivation drifts from the
 * canonical registry, or that something reaches the shelf that has no business
 * being bought with Coins. In particular: the Arcade currencies.
 */

import { describe, it, expect } from 'vitest';

import {
  ADDRESSED_OFFICIAL_ITEMS,
  ARCADE_TICKET_D,
  CONSUMABLE_ITEM_CATEGORIES,
  officialItemByAddress,
  officialItemByD,
} from '@/protocol/event-registry';

import {
  CARE_STORE_CATEGORIES,
  CARE_STORE_CATEGORY_BLURBS,
  CARE_STORE_CATEGORY_LABELS,
  CARE_STORE_PRODUCTS,
  careStoreProductsFor,
  careStoreStackLimit,
  isCareStoreProduct,
} from './care-store-catalog';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { priceForAddress } from './shop-catalog';
import { BLOBBI_COIN_ADDRESS } from './coin';

describe('every product is a canonical kind:31632 item', () => {
  it('is addressed as 31632:<official issuer>:<d>', () => {
    expect(CARE_STORE_PRODUCTS.length).toBeGreaterThan(0);
    for (const product of CARE_STORE_PRODUCTS) {
      expect(product.address).toBe(
        `31632:${OFFICIAL_ITEM_ISSUER_PUBKEY}:${product.d}`,
      );
    }
  });

  it('resolves back to the registry entry it was projected from', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      const official = officialItemByAddress(product.address);
      expect(official, product.address).not.toBeNull();
      expect(official!.d).toBe(product.d);
      expect(official!.itemId).toBe(product.itemId);
      expect(official!.name).toBe(product.name);
      expect(official!.category).toBe(product.category);
    }
  });

  it('never uses an event id — or a name — as identity', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      // A 64-hex event id would parse as neither of these.
      expect(product.address.startsWith('31632:')).toBe(true);
      expect(product.address.split(':').length).toBeGreaterThanOrEqual(3);
      expect(product.d.startsWith('blobbi:')).toBe(true);
      // The lookup that the shop and the purchase layer both use is by address.
      expect(officialItemByD(product.d)!.address).toBe(product.address);
    }
  });

  it('has no duplicate entries', () => {
    const addresses = CARE_STORE_PRODUCTS.map((p) => p.address);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

describe('the shelf holds exactly the official care items', () => {
  it('lists all four hygiene items', () => {
    expect(careStoreProductsFor('hygiene').map((p) => p.d)).toEqual([
      'blobbi:hygiene:soap',
      'blobbi:hygiene:shampoo',
      'blobbi:hygiene:bubble-bath',
      'blobbi:hygiene:soft-towel',
    ]);
  });

  it('lists all six medicine items', () => {
    expect(careStoreProductsFor('medicine').map((p) => p.d)).toEqual([
      'blobbi:medicine:vitamins',
      'blobbi:medicine:super',
      'blobbi:medicine:bandage',
      'blobbi:medicine:health-elixir',
      'blobbi:medicine:shell-repair-kit',
      'blobbi:medicine:calcium',
    ]);
  });

  it('lists all three toys', () => {
    expect(careStoreProductsFor('toy').map((p) => p.d)).toEqual([
      'blobbi:toy:ball',
      'blobbi:toy:teddy',
      'blobbi:toy:blocks',
    ]);
  });

  it('prices the toys at their established Island prices, not new ones', () => {
    // The Care Store is a second shop front onto ONE price table — a toy must
    // not cost one thing at the mall kiosk and another here.
    expect(
      Object.fromEntries(careStoreProductsFor('toy').map((p) => [p.d, p.price])),
    ).toEqual({
      'blobbi:toy:ball': 30,
      'blobbi:toy:teddy': 60,
      'blobbi:toy:blocks': 40,
    });
  });

  it('keeps every toy on its existing play behaviour', () => {
    // Buying a toy here must put the SAME item into the inventory that the
    // existing use/play flow already knows how to consume.
    for (const product of careStoreProductsFor('toy')) {
      const official = officialItemByAddress(product.address)!;
      expect(official.action).toBe('play');
      expect(official.type).toBe('consumable');
      expect(official.status).toBe('active');
    }
  });

  it('is every official item in a Care Store category that has a coin price — no more, no fewer', () => {
    const expected = ADDRESSED_OFFICIAL_ITEMS.filter(
      (item) =>
        (CARE_STORE_CATEGORIES as readonly string[]).includes(item.category) &&
        priceForAddress(item.address) !== null,
    ).map((item) => item.address);

    expect([...CARE_STORE_PRODUCTS.map((p) => p.address)].sort()).toEqual(
      [...expected].sort(),
    );
  });

  it('sells nothing outside the Care Store categories', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      expect(CARE_STORE_CATEGORIES).toContain(product.category);
    }
  });

  it('labels and blurbs every shelf', () => {
    for (const category of CARE_STORE_CATEGORIES) {
      expect(CARE_STORE_CATEGORY_LABELS[category]).toBeTruthy();
      expect(CARE_STORE_CATEGORY_BLURBS[category]).toBeTruthy();
    }
  });
});

describe('what is bought here is usable by the existing item systems', () => {
  it('every product is a consumable with a real gameplay action', () => {
    // `useUseItem` REJECTS a null action, and the inventory browser only offers
    // "use" for a consumable category. Anything sold here that failed this
    // would be an item a player can own and never do anything with.
    for (const product of CARE_STORE_PRODUCTS) {
      const official = officialItemByAddress(product.address)!;
      expect(CONSUMABLE_ITEM_CATEGORIES).toContain(official.category);
      expect(official.action).not.toBeNull();
      expect(official.type).toBe('consumable');
    }
  });

  it('every product is published and live, not merely reserved', () => {
    // A `reserved` item has no issuer-signed definition yet; selling one would
    // put something in a player's inventory that no client can resolve.
    for (const product of CARE_STORE_PRODUCTS) {
      expect(officialItemByAddress(product.address)!.status).toBe('active');
    }
  });

  it('the actions are the three the Care Store is about', () => {
    const actions = new Set(
      CARE_STORE_PRODUCTS.map((p) => officialItemByAddress(p.address)!.action),
    );
    expect([...actions].sort()).toEqual(['clean', 'medicine', 'play']);
  });
});

describe('the Arcade currencies can never be mistaken for a Care Store product', () => {
  it('the Arcade Ticket is not on the shelf', () => {
    const ticket = officialItemByD(ARCADE_TICKET_D)!;
    expect(isCareStoreProduct(ticket.address)).toBe(false);
    expect(CARE_STORE_PRODUCTS.some((p) => p.d === ARCADE_TICKET_D)).toBe(false);
    // And it has no coin price at all — the rule the shop derivation relies on.
    expect(priceForAddress(ticket.address)).toBeNull();
  });

  it('the Blobbi Coin itself is not on the shelf', () => {
    expect(isCareStoreProduct(BLOBBI_COIN_ADDRESS)).toBe(false);
  });

  it('no currency-category item reaches the shelf', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      expect(officialItemByAddress(product.address)!.category).not.toBe('currency');
    }
  });

  it('rejects an address the store does not sell', () => {
    expect(isCareStoreProduct('31632:deadbeef:blobbi:food:apple')).toBe(false);
    expect(isCareStoreProduct('')).toBe(false);
  });
});

describe('prices come from the one shared price table', () => {
  it('matches `priceForAddress` for every product', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      expect(product.price).toBe(priceForAddress(product.address));
    }
  });

  it('is always a positive integer', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      expect(Number.isInteger(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
    }
  });
});

describe('the stack policy is read, never guessed', () => {
  it('a stackable item with no published max_stack has NO cap — toys included', () => {
    for (const product of CARE_STORE_PRODUCTS) {
      expect(officialItemByAddress(product.address)!.stackable).toBe(true);
      expect(product.stackLimit).toBeNull();
    }
  });

  it('a non-stackable item would be capped at one', () => {
    const soap = officialItemByD('blobbi:hygiene:soap')!;
    expect(careStoreStackLimit({ ...soap, stackable: false })).toBe(1);
    expect(careStoreStackLimit({ ...soap, stackable: true })).toBeNull();
  });
});
