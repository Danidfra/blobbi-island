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
 *   what is elsewhere → useExternalInventories + useExternalItemCatalog
 * ```
 *
 * and produces a flat, sorted list of {@link CollectionEntry}. It decides
 * nothing about policy: which cosmetics are equippable is
 * `useEquippableCosmetics`' answer, which is `placement/policy.ts`' answer, and
 * neither is second-guessed here. What this adds is a single presentation model
 * — a category, an action verb, and an equipped flag — so the UI can render one
 * grid instead of two lists.
 *
 * ## Several inventories, one collection, no merging
 *
 * A player's things are not all in Blobbi's inventory. kind:31633 is scoped by
 * a `d`, and another game credits its own context under the same player key —
 * so `useExternalInventories` finds those, and their items join this list.
 *
 * They JOIN it; they are not folded into it. Every entry records the inventory
 * it came from ({@link CollectionEntry.sourceInventoryId}) and keeps its own
 * row, so the same item address owned in two contexts produces two entries
 * rather than one summed number that belongs to neither. Nothing here writes,
 * combines, or reconciles ownership state — this is a view, and the ownership
 * stays exactly where its owner put it.
 */

import { useMemo } from 'react';
import type { AccessorySlot } from '@blobbi/react';

import {
  ISLAND_INVENTORY_D,
  applyExternalCompatibility,
  getTrustedItemIssuer,
  referencedItemAddresses,
  resolveExternalItemCompatibility,
  useExternalInventories,
  useExternalInventoryStates,
  useExternalItemCatalog,
  useIslandInventory,
  useItemCatalog,
  toIslandEntries,
  type DiscoveredInventory,
  type ExternalItemCompatibility,
  type IslandInventoryEntry,
} from '@/inventory';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';
import {
  getInventoryItemQuantity,
  getLastEquippedPlacementBySlot,
  parseGameItemAddress,
} from '@/inventory/package';
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

/**
 * Where an entry's ownership actually lives.
 *
 * - `'island'` — Blobbi's own kind:31633 (`blobbi:island`). The one inventory
 *   this game reads AND writes.
 * - `'external'` — another game's inventory, discovered author-wide. Read only:
 *   Blobbi never publishes a replacement for a context it does not own.
 *
 * This is the property the actionability rule keys on. It is deliberately about
 * the SOURCE and not about the issuer: "items in inventories we do not write
 * cannot be spent yet" is a true and durable statement, whereas "Farm items
 * cannot be used" would be a rule about a particular partner that stops being
 * true the moment consumption is designed.
 */
export type CollectionSource = 'island' | 'external';

/**
 * Whether an entry's quantity is the CURRENT balance.
 *
 * - `'ready'` — the balance is derived and current: for Island rows, the
 *   inventory this game writes; for external rows, the snapshot with every
 *   pending kind:1416 spend applied through the kind:1417 fold chain.
 * - `'loading'` — the external inventory's spends/folds have not answered
 *   yet. The quantity shown is the owner's last consolidated statement.
 * - `'unresolved'` — the snapshot references a fold chain that could not be
 *   verified (or could not be read). There IS no balance. The quantity shown
 *   is the last consolidated statement, labelled as such, and nothing may be
 *   spent against it.
 *
 * Only a `'ready'` entry is ever actionable.
 */
export type CollectionAvailability = 'ready' | 'loading' | 'unresolved';

export interface CollectionEntry {
  /**
   * Stable identity for React and for selection: `<sourceInventoryId>|<address>`.
   *
   * The address alone is NOT unique across a multi-inventory collection — the
   * same item can be owned in two contexts — so keying on it would collide two
   * real rows into one and make the detail panel describe the wrong one.
   */
  key: string;
  /** Canonical `31632:<issuer>:<d>` address. The item's protocol identity. */
  address: string;
  /** Which kind:31633 context holds this. `blobbi:island` for own items. */
  sourceInventoryId: string;
  source: CollectionSource;
  /**
   * A short player-facing name for where an external item came from — "Farm".
   * `undefined` for this game's own items, which need no provenance label.
   */
  sourceLabel?: string;
  /**
   * The full `31633:<owner>:<d>` address of the inventory this row came from.
   * A spend must name exactly this, never a `d`.
   */
  inventoryAddress?: string;
  /** The discovered inventory itself, for external rows. Consumption targets it. */
  inventory?: DiscoveredInventory;
  /** The `a` tag's relay hint for the item in that inventory, or `''`. */
  itemRelay?: string;
  availability: CollectionAvailability;
  /**
   * Island's interpretation of an external item, when the compatibility
   * policy grants one. Present ⇒ the row may be used on a Blobbi through the
   * external (kind:1416) path. Absent ⇒ display-only.
   */
  compatibility?: ExternalItemCompatibility;
  /**
   * For an external row with a `compatibility`, this is the issuer's
   * definition WITH Island's action/effects/stages applied — what the consume
   * dialog shows and what the gameplay effect uses.
   */
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

/**
 * The composite identity of a collection row.
 *
 * `<sourceInventoryId>|<fullAddress>`. The separator is `|` because neither
 * half can contain one: an inventory id is a `d` tag and an address is
 * `31632:<hex>:<d>`, both of which use `:` as their separator.
 */
export function entryKey(sourceInventoryId: string, address: string): string {
  return `${sourceInventoryId}|${address}`;
}

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
  const externalQuery = useExternalInventories();

  const placement = placementQuery.data;
  const inventory = inventoryQuery.data;
  const catalog = catalogQuery.data;
  const external = externalQuery.data;

  // Every item reference across every discovered inventory, deduped. The
  // catalog hook decides which of them belong to a trusted issuer; passing all
  // of them keeps that decision in one place instead of two.
  const externalRefs = useMemo(
    () => referencedItemAddresses(external ?? []),
    [external],
  );
  const externalCatalog = useExternalItemCatalog(externalRefs).data;
  // Spend-aware state per discovered inventory: the snapshot with pending
  // kind:1416 spends applied, or an explicit loading/unresolved state.
  const externalStates = useExternalInventoryStates(external);

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
        key: entryKey(ISLAND_INVENTORY_D, cosmetic.address),
        address: cosmetic.address,
        sourceInventoryId: ISLAND_INVENTORY_D,
        source: 'island',
        availability: 'ready',
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
        key: entryKey(ISLAND_INVENTORY_D, entry.address),
        address: entry.address,
        sourceInventoryId: ISLAND_INVENTORY_D,
        source: 'island',
        availability: 'ready',
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

    // ── items owned in inventories this game does not write ─────────────
    //
    // FAIL CLOSED at every step. An address that does not resolve to a
    // definition from a trusted issuer produces no entry at all: a tile with a
    // placeholder name would be Island asserting something about an item it
    // cannot describe, and an unresolved address is exactly the case where it
    // must not.
    //
    // QUANTITIES come from the spend-aware derivation, never from the raw
    // snapshot alone: a kind:1416 spend another game (or this one) published
    // may already have debited the owner's last consolidated numbers. While
    // that derivation is loading, or when the fold chain cannot be verified,
    // the raw quantity is shown as "the last consolidated statement" with the
    // row marked accordingly — visible, counted, never actionable.
    for (const source of external ?? []) {
      const state = externalStates.get(source.address);
      const availability: CollectionAvailability =
        state?.status === 'ready'
          ? 'ready'
          : state?.status === 'loading' || state === undefined
            ? 'loading'
            : 'unresolved';

      for (const item of source.items) {
        const definition =
          externalCatalog?.byAddress.get(item.address) ??
          // An address issued by THIS game, held in another game's inventory,
          // is already described by the official catalog. No second fetch.
          catalog?.byAddress.get(item.address);
        if (!definition) continue;

        const category = chipFor(definition.category);
        if (!category) continue;

        // The EFFECTIVE quantity when the state is ready; the snapshot's own
        // number otherwise (labelled by `availability`).
        const quantity =
          availability === 'ready' && state?.effective
            ? getInventoryItemQuantity(state.effective, item.address)
            : item.quantity;
        // A snapshot item fully consumed by pending spends has no row: the
        // player does not have it any more.
        if (quantity <= 0) continue;

        const issuer = parseGameItemAddress(item.address)?.pubkey;

        // Island's interpretation, if the compatibility policy grants one.
        // Everything about what the item DOES lives there; this loop only
        // decides whether the row can be pressed right now.
        const compatibility = resolveExternalItemCompatibility({
          definition,
          sourceInventoryId: source.id,
        });
        const usable = compatibility !== null && availability === 'ready';

        entries.push({
          key: entryKey(source.id, item.address),
          address: item.address,
          sourceInventoryId: source.id,
          inventoryAddress: source.address,
          inventory: source,
          itemRelay: item.relay,
          source: 'external',
          availability,
          // The issuer's own player-facing name. Never the `d`, never the
          // inventory id, never a pubkey — a player is owed "Farm", not
          // `farm:main` and certainly not hex.
          sourceLabel: getTrustedItemIssuer(issuer)?.label,
          ...(compatibility ? { compatibility } : {}),
          definition: compatibility
            ? applyExternalCompatibility(definition, compatibility)
            : definition,
          quantity,
          category,
          /*
            Actionable only when BOTH hold: Island has an interpretation for
            the item (compatibility policy) AND the source inventory's balance
            is current. A compatible item in an unresolved inventory is not
            pressable — Blobbi must never spend against a balance it cannot
            verify. Everything else is `'none'`, the same representation
            currency uses: no click handler, no consume dialog, no debit.

            Spending an external row never touches the owner's kind:31633; it
            publishes a player-signed kind:1416 (`useConsumeExternalItem`).
          */
          action: usable ? 'use' : 'none',
          equipped: false,
        });
      }
    }

    // Stable order: chip order, then equipped first inside wearables, then name.
    // Equipped-first matters — what the Blobbi is wearing is what the player
    // came to look at. The key breaks remaining ties so two same-named items
    // from different inventories never swap places between renders.
    entries.sort((a, b) => {
      const byCategory =
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (byCategory !== 0) return byCategory;
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      const byName = a.definition.name.localeCompare(b.definition.name);
      if (byName !== 0) return byName;
      return a.key.localeCompare(b.key);
    });

    const present = new Set(entries.map((e) => e.category));
    return {
      entries,
      categories: CATEGORY_ORDER.filter((c) => present.has(c)),
      unavailable: cosmetics.unavailable,
      warnings: placement?.warnings ?? [],
      catalogIsEmpty: cosmetics.catalogIsEmpty,
      /*
        The two reads that answer "does this player have things": the carried
        Island items and the author-wide discovery of other games' inventories.
        Without the second, a player whose only items are Farm produce saw an
        "empty bag" flash before the discovery answered. Both reads throw on an
        unusable relay answer (bounded timeouts) rather than pending forever,
        so neither can leave a permanent spinner.

        The catalog and the placement document are deliberately NOT gated on:
        they only add wearables to a grid that can already render. Nor are the
        per-inventory spend/fold reads: their rows appear at once with a
        `loading` availability and become actionable when the derivation
        settles. A grid that fills in late is strictly better than a grid that
        never arrives.
      */
      isLoading: inventoryQuery.isLoading || externalQuery.isLoading,
    };
  }, [
    cosmetics.available,
    cosmetics.unavailable,
    cosmetics.catalogIsEmpty,
    placement,
    inventory,
    inventoryQuery.isLoading,
    externalQuery.isLoading,
    catalog,
    external,
    externalCatalog,
    externalStates,
  ]);
}
