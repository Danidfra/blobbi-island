/**
 * The Inventory Inspector's read model: joining a kind:31633 inventory to the
 * kind:31632 definitions its addresses point at.
 *
 * Pure and synchronous. It takes an already-parsed inventory and an
 * already-fetched definition map and produces rows; no fetching, no hooks, no
 * per-row anything. That shape is what makes the N+1 problem structurally
 * impossible rather than merely avoided: there is nowhere in this file to put a
 * query.
 *
 * ## Three sources, and the difference matters
 *
 *   published  a real kind:31632 event was found for this address
 *   bundled    no event; Island ships fallback metadata for this official item
 *   unknown    no event and no fallback, the inventory references something
 *              this client has never heard of
 *
 * `bundled` is not a failure state. Blobbi Island deliberately ships metadata
 * for the official items so the game works when relays are down. But a tool
 * whose job is to verify what is actually published must never let bundled data
 * masquerade as a publication, which is exactly the confusion this field exists
 * to prevent.
 *
 * ## Trust
 *
 * `isOfficialIssuer` is computed from the address's pubkey against
 * `OFFICIAL_ITEM_ISSUER_PUBKEY`. The inspector will happily show a definition
 * signed by anybody, that is inspection, but it always says who signed it,
 * and the game's own resolution path is unaffected by anything here.
 */

import {
  type GameInventory,
  getInventoryItems,
  parseGameItemAddress,
} from '@/inventory/package';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import {
  type ResolvedBlobbiItemDefinition,
  bundledFallbackDefinition,
} from '@/inventory/catalog-fallback';
import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import { addressToItemId } from '@/inventory/registry';

import type { PublishedDefinitionRecord } from './useItemDefinitions';

export type DefinitionSource = 'published' | 'bundled' | 'unknown';

export interface InventoryInspectorRow {
  address: string;
  /** Legacy Island id, when the address is an official one. */
  itemId: string | null;
  quantity: number;
  /** Relay hint carried on the inventory tag, or `''`. */
  relayHint: string;
  /** The `d` portion of the address. */
  d: string;
  /** The address's author pubkey. */
  issuer: string;
  isOfficialIssuer: boolean;
  source: DefinitionSource;
  name: string;
  type: string;
  category: string;
  rarity: string;
  emoji: string;
  imageUrl?: string;
  /** Parser warnings on the published definition, when there is one. */
  warningCount: number;
  /** The published record, when one was found. */
  record?: PublishedDefinitionRecord;
  /** The bundled fallback, when one exists. */
  fallback?: ResolvedBlobbiItemDefinition;
  /** The inventory's own `a` tag for this item, verbatim. */
  rawTag: string[];
}

/** Find the inventory tag that produced this item, for raw inspection. */
function rawTagFor(inventory: GameInventory, address: string): string[] {
  const tag = inventory.event.tags.find(
    (candidate) => candidate[0] === 'a' && candidate[1] === address,
  );
  return tag ? [...tag] : [];
}

/**
 * Join inventory entries to definitions.
 *
 * Order follows the inventory's own tag order, which is what the package
 * preserves and what makes two inspections of the same event comparable.
 */
export function buildInspectorRows(
  inventory: GameInventory | null | undefined,
  definitions: ReadonlyMap<string, PublishedDefinitionRecord> | undefined,
): InventoryInspectorRow[] {
  if (!inventory) return [];

  return getInventoryItems(inventory).map((item) => {
    const record = definitions?.get(item.address);
    const fallback = bundledFallbackDefinition(item.address) ?? undefined;
    const parsed = parseGameItemAddress(item.address);
    const issuer = parsed?.pubkey ?? '';
    const d = parsed?.itemId ?? '';

    const source: DefinitionSource = record
      ? 'published'
      : fallback
        ? 'bundled'
        : 'unknown';

    const imageUrl = record
      ? primaryItemImageUrl(record.definition)
      : primaryItemImageUrl(fallback);

    return {
      address: item.address,
      itemId: addressToItemId(item.address),
      quantity: item.quantity,
      relayHint: item.relay,
      d,
      issuer,
      isOfficialIssuer: issuer === OFFICIAL_ITEM_ISSUER_PUBKEY,
      source,
      name: record?.definition.name ?? fallback?.name ?? d ?? item.address,
      type: record?.definition.type ?? fallback?.type ?? '',
      category: record?.definition.category ?? fallback?.category ?? '',
      rarity: record?.definition.rarity ?? '',
      emoji: fallback?.emoji ?? '📦',
      imageUrl,
      warningCount: record?.warnings.length ?? 0,
      record,
      fallback,
      rawTag: rawTagFor(inventory, item.address),
    };
  });
}

export type InventorySortKey = 'name' | 'quantity' | 'address';

/** Search, filter and sort inspector rows. Pure, for tests. */
export function filterInspectorRows(
  rows: readonly InventoryInspectorRow[],
  options: {
    search: string;
    source: DefinitionSource | 'all';
    type: string;
    sort: InventorySortKey;
  },
): InventoryInspectorRow[] {
  const needle = options.search.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (needle !== '') {
      const haystack = `${row.name} ${row.d} ${row.address}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (options.source !== 'all' && row.source !== options.source) return false;
    if (options.type !== 'all' && row.type !== options.type) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    switch (options.sort) {
      case 'quantity':
        return b.quantity - a.quantity;
      case 'address':
        return a.address.localeCompare(b.address);
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

/** Totals for the inventory summary strip. */
export function summarizeRows(rows: readonly InventoryInspectorRow[]) {
  return {
    itemCount: rows.length,
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    unresolvedCount: rows.filter((row) => row.source === 'unknown').length,
    bundledCount: rows.filter((row) => row.source === 'bundled').length,
    warningCount: rows.reduce((sum, row) => sum + row.warningCount, 0),
  };
}
