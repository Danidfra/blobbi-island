/**
 * What the Care Store sells.
 *
 * ## Derived, never declared
 *
 * There is no list of Care Store items in this file. The shelf is a PROJECTION
 * of two things that already exist:
 *
 *   1. `ADDRESSED_OFFICIAL_ITEMS`: the canonical kind:31632 registry, which
 *      already carries every hygiene, medicine and toy definition with its name,
 *      emoji, effects, action, stages and stackability;
 *   2. `shop-catalog.ts`: the Island coin price table, which already prices all
 *      thirteen of them.
 *
 * So the store cannot list an item that is not official, cannot list one that is
 * not for sale, and cannot disagree with the mall kiosk about what anything
 * costs. Adding a care item to the registry and pricing it puts it on this shelf
 * with no edit here; removing its price takes it off. A hand-written list would
 * have been a fourth copy of facts that already have one home.
 *
 * ## Identity
 *
 * A product IS its canonical kind:31632 address (`31632:<issuer>:<d>`). The
 * legacy `itemId` is kept for UI/test convenience only, and an event id is never
 * identity anywhere in this file; nothing here even reads an event.
 *
 * ## Which categories
 *
 * `hygiene`, `medicine` and `toy`: the three things you keep a Blobbi well
 * with, and the three the shop's own artwork is full of (the shelves of bottles,
 * the first-aid box, the toy chest by the door).
 *
 * Deliberately NOT `energy`: the Energy Drink is a `boost`, not care, and it
 * keeps its existing home at the mall's kiosk. And not `currency`,
 * `validateCoinPrices` already makes pricing currency a hard error, so the
 * Arcade Ticket can never reach this shelf even by accident.
 */

import {
  ADDRESSED_OFFICIAL_ITEMS,
  type AddressedOfficialItem,
  type ItemCategoryName,
} from '@/protocol/event-registry';

import { priceForAddress } from './shop-catalog';

/** The shelves of the Care Store, in display order. */
export const CARE_STORE_CATEGORIES = ['hygiene', 'medicine', 'toy'] as const;

export type CareStoreCategory = (typeof CARE_STORE_CATEGORIES)[number];

/** Section headings. */
export const CARE_STORE_CATEGORY_LABELS: Record<CareStoreCategory, string> = {
  hygiene: 'Care & Hygiene',
  medicine: 'Medicine',
  toy: 'Toys',
};

/** One line under each heading, so a shelf says what it is for. */
export const CARE_STORE_CATEGORY_BLURBS: Record<CareStoreCategory, string> = {
  hygiene: 'Keep your Blobbi clean and comfortable.',
  medicine: 'Patch scrapes up and get health back.',
  toy: 'Something to play with, happiness, at the cost of a nap.',
};

export interface CareStoreProduct {
  /** Canonical kind:31632 address, the item's identity. */
  readonly address: string;
  /** The definition's `d` tag. */
  readonly d: string;
  /** Legacy/UI identifier. Never protocol identity. */
  readonly itemId: string;
  readonly name: string;
  readonly category: CareStoreCategory;
  /** Canonical coin price, from the shared Island price table. */
  readonly price: number;
  /**
   * How many of this item one player may hold, or `null` for no declared cap.
   *
   * Today every Care Store item, hygiene, medicine and toy alike, is a
   * `stackable` consumable whose published definition declares no `max_stack`,
   * so this is `null` for all thirteen and the shop imposes no ceiling. The field is not decoration: it is the ONE place
   * the policy is decided, so an item published later as non-stackable (or with
   * a real cap) is honoured by the shop without touching the UI. See
   * {@link careStoreStackLimit}.
   */
  readonly stackLimit: number | null;
}

/**
 * The stack ceiling for an official item.
 *
 * `stackable: false` means one and only one. Otherwise the registry declares no
 * `max_stack` for consumables, and an absent cap is NO cap; never a guessed
 * one. Cosmetics, which do carry `maxStack: 1`, are not sold here at all.
 */
export function careStoreStackLimit(item: AddressedOfficialItem): number | null {
  return item.stackable ? null : 1;
}

function isCareStoreCategory(
  category: ItemCategoryName,
): category is CareStoreCategory {
  return (CARE_STORE_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Every item the Care Store sells, in canonical registry order grouped by
 * shelf.
 *
 * Built by filtering the registry, so the ONLY way onto this list is to be an
 * official item in one of {@link CARE_STORE_CATEGORIES} that has a coin price.
 */
export const CARE_STORE_PRODUCTS: readonly CareStoreProduct[] =
  CARE_STORE_CATEGORIES.flatMap((category) =>
    ADDRESSED_OFFICIAL_ITEMS.flatMap((item) => {
      if (!isCareStoreCategory(item.category) || item.category !== category) {
        return [];
      }
      const price = priceForAddress(item.address);
      // Unpriced means NOT FOR SALE, the same rule the purchase layer enforces
      // at the pricing boundary. An item with no price is left off the shelf
      // rather than shown at zero.
      if (price === null) return [];
      return [
        {
          address: item.address,
          d: item.d,
          itemId: item.itemId,
          name: item.name,
          category,
          price,
          stackLimit: careStoreStackLimit(item),
        },
      ];
    }),
  );

/** The products on one shelf. */
export function careStoreProductsFor(
  category: CareStoreCategory,
): readonly CareStoreProduct[] {
  return CARE_STORE_PRODUCTS.filter((p) => p.category === category);
}

/** Is this address something the Care Store sells? */
export function isCareStoreProduct(address: string): boolean {
  return CARE_STORE_PRODUCTS.some((p) => p.address === address);
}
