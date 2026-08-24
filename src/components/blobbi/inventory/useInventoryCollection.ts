/**
 * One collection, two kinds of thing.
 *
 * The Inventory tab used to be two stacked panels with two headers, two empty
 * states and two vocabularies — wearables above, carried items below — because
 * they came from two different windows and were merely moved into the same tab.
 * They are still two different FACTS (a cosmetic is worn, a sandwich is eaten)
 * but they are one COLLECTION, and a player browsing their things should not
 * have to know which subsystem answered.
 *
 * This hook is that merge. It reads:
 *
 * ```
 *   what can be worn  → useEquippableCosmetics (31632 catalog ∩ 31633 owned)
 *   what is worn      → usePlacementState (the 31634 document)
 *   what is carried   → useIslandInventory + useItemCatalog (31633 + 31632)
 * ```
 *
 * and produces a flat, sorted list of {@link CollectionEntry}. It decides
 * nothing about policy: which cosmetics are equippable is
 * `useEquippableCosmetics`' answer, which is `placement/policy.ts`' answer, and
 * neither is second-guessed here. What this adds is a single presentation model
 * — a category, an action verb, and an equipped flag — so the UI can render one
 * grid instead of two lists.
 */

import { useMemo } from 'react';
import type { AccessorySlot } from '@blobbi/react';

import {
  useIslandInventory,
  useItemCatalog,
  toIslandEntries,
  type IslandInventoryEntry,
} from '@/inventory';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import { getLastEquippedPlacementBySlot } from '@/inventory/package';
import type { GameItemPlacementEntry } from '@/inventory/package';
import { usePlacementState } from '@/placement/usePlacementState';
import { useEquippableCosmetics } from '@/placement/useEquippableCosmetics';
import type { UnavailableCosmetic } from '@/placement/useEquippableCosmetics';

/**
 * The filter chips over the grid.
 *
 * Six, not the seven sections the old panel stacked: `medicine`, `hygiene` and
 * `energy` are one idea to a player — things that fix a Blobbi — and three
 * chips for three items each is category overload, which the reference study
 * flagged as the failure mode of an over-sectioned inventory. The underlying
 * item categories are untouched; only the chip groups them.
 */
export type CollectionCategory = 'wearable' | 'food' | 'toy' | 'care' | 'currency';

/** What pressing the primary action on an entry does. */
export type CollectionAction =
  /** A cosmetic that can go on the Blobbi. */
  | 'wear'
  /** A cosmetic already on the Blobbi. */
  | 'take-off'
  /** A consumable that can be used on the Blobbi. */
  | 'use'
  /** A balance. Nothing to press. */
  | 'none';

export interface CollectionEntry {
  /** Canonical `31632:<issuer>:<d>` address. Stable identity, and the React key. */
  address: string;
  definition: ResolvedBlobbiItemDefinition;
  quantity: number;
  category: CollectionCategory;
  action: CollectionAction;
  /** The slot a wearable occupies. `undefined` for everything else. */
  slot?: AccessorySlot;
  /** True when this exact item is in the kind:31634 document. */
  equipped: boolean;
  /** The placement entry, for the transform editor. Only when equipped. */
  placement?: GameItemPlacementEntry;
  /** The consumable entry, for the use flow. Only for consumables and currency. */
  islandEntry?: IslandInventoryEntry;
}

export interface InventoryCollection {
  entries: CollectionEntry[];
  /** Categories that actually have something in them, in chip order. */
  categories: CollectionCategory[];
  /** Official cosmetics that exist but cannot be worn, with reasons. */
  unavailable: UnavailableCosmetic[];
  /** Parser warnings from the kind:31634 document. */
  warnings: { code: string; message: string }[];
  /** `true` when the trusted issuer has published no cosmetics at all. */
  catalogIsEmpty: boolean;
  isLoading: boolean;
}

/** Chip order. Wearables first: this is a customization window. */
export const CATEGORY_ORDER: readonly CollectionCategory[] = [
  'wearable',
  'food',
  'toy',
  'care',
  'currency',
];

export const CATEGORY_LABELS: Readonly<Record<CollectionCategory, string>> = {
  wearable: 'Wearables',
  food: 'Food',
  toy: 'Toys',
  care: 'Care',
  currency: 'Coins',
};

/** Which chip an item category belongs under. */
function chipFor(category: string): CollectionCategory | null {
  switch (category) {
    case 'food':
      return 'food';
    case 'toy':
      return 'toy';
    case 'medicine':
    case 'hygiene':
    case 'energy':
      return 'care';
    case 'currency':
      return 'currency';
    default:
      return null;
  }
}

export function useInventoryCollection(options: {
  characterId: string | undefined;
  /** Current Blobbi form; gates form-restricted cosmetics. */
  form: string | undefined;
}): InventoryCollection {
  const cosmetics = useEquippableCosmetics(options.form);
  const placementQuery = usePlacementState(options.characterId);
  const inventoryQuery = useIslandInventory();
  const catalogQuery = useItemCatalog();

  const placement = placementQuery.data;
  const inventory = inventoryQuery.data;
  const catalog = catalogQuery.data;

  return useMemo((): InventoryCollection => {
    // ── what is worn ────────────────────────────────────────────────────────
    // Read per SLOT, using the same last-wins resolution the renderer uses, so
    // the grid and the Blobbi can never disagree about what is on.
    const wornBySlot = new Map<string, GameItemPlacementEntry>();
    if (placement) {
      for (const entry of placement.placement.placements) {
        if (entry.mode !== 'equip' || entry.slot === undefined) continue;
        const last = getLastEquippedPlacementBySlot(placement.placement, entry.slot);
        if (last) wornBySlot.set(entry.slot, last);
      }
    }
    const wornAddresses = new Set([...wornBySlot.values()].map((e) => e.item));

    const entries: CollectionEntry[] = [];

    // ── wearables ───────────────────────────────────────────────────────────
    for (const cosmetic of cosmetics.available) {
      const equipped = wornAddresses.has(cosmetic.address);
      entries.push({
        address: cosmetic.address,
        definition: cosmetic.definition,
        quantity: cosmetic.quantity,
        category: 'wearable',
        action: equipped ? 'take-off' : 'wear',
        slot: cosmetic.slot,
        equipped,
        placement: equipped ? wornBySlot.get(cosmetic.slot) : undefined,
      });
    }

    // ── carried items ───────────────────────────────────────────────────────
    for (const entry of toIslandEntries(inventory, catalog)) {
      if (entry.quantity <= 0) continue;
      const category = chipFor(entry.definition.category);
      if (!category) continue;
      entries.push({
        address: entry.address,
        definition: entry.definition,
        quantity: entry.quantity,
        category,
        // Currency has `action: null` on its definition and no gameplay verb.
        // Offering one would be a lie the use flow would then have to refuse.
        action: category === 'currency' ? 'none' : 'use',
        equipped: false,
        islandEntry: entry,
      });
    }

    // Stable order: chip order, then equipped first inside wearables, then name.
    // Equipped-first matters — what the Blobbi is wearing is what the player
    // came to look at.
    entries.sort((a, b) => {
      const byCategory =
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (byCategory !== 0) return byCategory;
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      return a.definition.name.localeCompare(b.definition.name);
    });

    const present = new Set(entries.map((e) => e.category));
    return {
      entries,
      categories: CATEGORY_ORDER.filter((c) => present.has(c)),
      unavailable: cosmetics.unavailable,
      warnings: placement?.warnings ?? [],
      catalogIsEmpty: cosmetics.catalogIsEmpty,
      /*
        Deliberately the CARRIED-items read alone, not all three.

        That read is the one that answers "does this player have things"; the
        catalog and the placement document only add wearables to a grid that can
        already render. Gating on all three means one pending query — a relay
        that never answers, which is a state this app is built to survive
        everywhere else — leaves a permanent spinner where an inventory should
        be. A grid that fills in late is strictly better than a grid that never
        arrives.
      */
      isLoading: inventoryQuery.isLoading,
    };
  }, [
    cosmetics.available,
    cosmetics.unavailable,
    cosmetics.catalogIsEmpty,
    cosmetics.isLoading,
    placement,
    placementQuery.isLoading,
    inventory,
    inventoryQuery.isLoading,
    catalog,
  ]);
}
