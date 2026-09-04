/**
 * The inventory read model, including the distinction the whole panel exists
 * for: a published definition and a bundled fallback must never be reported as
 * the same thing.
 *
 * Also asserted here, structurally rather than by inspection, is that
 * building rows is a PURE join over data already in hand. `buildInspectorRows`
 * takes an inventory and a map; there is no way to hand it a fetcher, which is
 * what makes the N+1 shape impossible rather than merely absent today.
 */

import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  KIND_GAME_INVENTORY,
  KIND_GAME_ITEM_DEFINITION,
  parseGameInventory,
  parseGameItemDefinitionResult,
} from '@/inventory/package';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';
import { OFFICIAL_ITEM_ADDRESSES } from '@/inventory/registry';

import {
  buildInspectorRows,
  filterInspectorRows,
  summarizeRows,
} from './inventory-inspection';
import type { PublishedDefinitionRecord } from './useItemDefinitions';

const OWNER = 'a'.repeat(64);
const STRANGER = 'c'.repeat(64);
const OFFICIAL_ADDRESS = OFFICIAL_ITEM_ADDRESSES[0];
const UNKNOWN_ADDRESS = `31632:${STRANGER}:some:unknown:item`;

function inventoryEvent(items: { address: string; relay?: string; qty: number }[]) {
  const event: NostrEvent = {
    id: 'i'.repeat(64),
    pubkey: OWNER,
    created_at: 1_700_000_000,
    kind: KIND_GAME_INVENTORY,
    tags: [
      ['d', 'blobbi:island'],
      ...items.map((item) => ['a', item.address, item.relay ?? '', String(item.qty)]),
    ],
    content: '',
    sig: 'f'.repeat(128),
  };
  const parsed = parseGameInventory(event);
  if (!parsed) throw new Error('fixture inventory did not parse');
  return parsed;
}

function definitionRecord(
  address: string,
  overrides: { name?: string; type?: string; image?: string } = {},
): PublishedDefinitionRecord {
  const [, pubkey, ...rest] = address.split(':');
  const event: NostrEvent = {
    id: 'e'.repeat(64),
    pubkey,
    created_at: 1_700_000_100,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', rest.join(':')],
      ['name', overrides.name ?? 'Published Name'],
      ['type', overrides.type ?? 'consumable'],
      ...(overrides.image ? [['image', overrides.image]] : []),
    ],
    content: '',
    sig: 'f'.repeat(128),
  };
  const parsed = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!parsed.ok) throw new Error('fixture definition did not parse');
  return {
    address,
    event,
    definition: parsed.value,
    warnings: parsed.warnings,
    relays: ['wss://relay.example'],
  };
}

describe('buildInspectorRows', () => {
  it('returns nothing for a missing inventory', () => {
    expect(buildInspectorRows(null, new Map())).toEqual([]);
    expect(buildInspectorRows(undefined, undefined)).toEqual([]);
  });

  it('reads quantities from the inventory', () => {
    const rows = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 7 }]),
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(7);
  });

  it('marks an entry resolved by a published definition', () => {
    const record = definitionRecord(OFFICIAL_ADDRESS, {
      name: 'From The Relay',
      image: 'https://cdn.example/apple.png',
    });
    const rows = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 1 }]),
      new Map([[OFFICIAL_ADDRESS, record]]),
    );
    expect(rows[0].source).toBe('published');
    expect(rows[0].name).toBe('From The Relay');
    expect(rows[0].imageUrl).toBe('https://cdn.example/apple.png');
    expect(rows[0].record).toBe(record);
  });

  it('falls back to bundled metadata, and says so', () => {
    const rows = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 1 }]),
      new Map(),
    );
    expect(rows[0].source).toBe('bundled');
    expect(rows[0].fallback).toBeDefined();
    expect(rows[0].name).not.toBe('');
  });

  it('reports an address with neither a definition nor a fallback as unresolved', () => {
    const rows = buildInspectorRows(
      inventoryEvent([{ address: UNKNOWN_ADDRESS, qty: 2 }]),
      new Map(),
    );
    expect(rows[0].source).toBe('unknown');
    expect(rows[0].record).toBeUndefined();
    expect(rows[0].fallback).toBeUndefined();
  });

  it('flags issuers against the official key', () => {
    const rows = buildInspectorRows(
      inventoryEvent([
        { address: OFFICIAL_ADDRESS, qty: 1 },
        { address: UNKNOWN_ADDRESS, qty: 1 },
      ]),
      new Map(),
    );
    expect(rows[0].issuer).toBe(OFFICIAL_ITEM_ISSUER_PUBKEY);
    expect(rows[0].isOfficialIssuer).toBe(true);
    expect(rows[1].isOfficialIssuer).toBe(false);
  });

  it('exposes the inventory’s own tag verbatim', () => {
    const rows = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, relay: 'wss://r', qty: 3 }]),
      new Map(),
    );
    expect(rows[0].rawTag).toEqual(['a', OFFICIAL_ADDRESS, 'wss://r', '3']);
    expect(rows[0].relayHint).toBe('wss://r');
  });

  it('re-resolves when a definition becomes available', () => {
    const inventory = inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 1 }]);
    const before = buildInspectorRows(inventory, new Map());
    expect(before[0].source).toBe('bundled');

    const after = buildInspectorRows(
      inventory,
      new Map([[OFFICIAL_ADDRESS, definitionRecord(OFFICIAL_ADDRESS, { name: 'Now Published' })]]),
    );
    expect(after[0].source).toBe('published');
    expect(after[0].name).toBe('Now Published');
  });

  it('reflects an updated inventory event in the quantities', () => {
    const first = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 1 }]),
      new Map(),
    );
    const second = buildInspectorRows(
      inventoryEvent([{ address: OFFICIAL_ADDRESS, qty: 9 }]),
      new Map(),
    );
    expect(first[0].quantity).toBe(1);
    expect(second[0].quantity).toBe(9);
  });
});

describe('summarizeRows', () => {
  it('totals items, quantities and unresolved entries', () => {
    const rows = buildInspectorRows(
      inventoryEvent([
        { address: OFFICIAL_ADDRESS, qty: 2 },
        { address: UNKNOWN_ADDRESS, qty: 5 },
      ]),
      new Map(),
    );
    expect(summarizeRows(rows)).toMatchObject({
      itemCount: 2,
      totalQuantity: 7,
      unresolvedCount: 1,
      bundledCount: 1,
    });
  });
});

describe('filterInspectorRows', () => {
  const rows = buildInspectorRows(
    inventoryEvent([
      { address: OFFICIAL_ADDRESS, qty: 2 },
      { address: UNKNOWN_ADDRESS, qty: 5 },
    ]),
    new Map([
      [OFFICIAL_ADDRESS, definitionRecord(OFFICIAL_ADDRESS, { name: 'Alpha', type: 'consumable' })],
    ]),
  );

  const base = { search: '', source: 'all' as const, type: 'all', sort: 'name' as const };

  it('filters by source', () => {
    expect(filterInspectorRows(rows, { ...base, source: 'published' })).toHaveLength(1);
    expect(filterInspectorRows(rows, { ...base, source: 'unknown' })).toHaveLength(1);
    expect(filterInspectorRows(rows, { ...base, source: 'bundled' })).toHaveLength(0);
  });

  it('filters by type and search', () => {
    expect(filterInspectorRows(rows, { ...base, type: 'consumable' })).toHaveLength(1);
    expect(filterInspectorRows(rows, { ...base, search: 'alpha' })).toHaveLength(1);
    expect(filterInspectorRows(rows, { ...base, search: 'nothing' })).toHaveLength(0);
  });

  it('sorts by quantity and address', () => {
    expect(
      filterInspectorRows(rows, { ...base, sort: 'quantity' }).map((r) => r.quantity),
    ).toEqual([5, 2]);
    const byAddress = filterInspectorRows(rows, { ...base, sort: 'address' });
    expect(byAddress.map((r) => r.address)).toEqual(
      [...byAddress.map((r) => r.address)].sort(),
    );
  });
});
