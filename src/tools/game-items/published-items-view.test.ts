/**
 * Browser view logic, with one assertion carrying most of the weight:
 * two issuers publishing the same `d` must never collapse into one row, and
 * only the official pubkey may earn the `official` bucket.
 */

import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  KIND_GAME_ITEM_DEFINITION,
  parseGameItemDefinitionResult,
} from '@/inventory/package';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from '@/inventory/constants';

import { filterAndSortRecords, issuerBucket } from './published-items-view';
import type { PublishedDefinitionRecord } from './useItemDefinitions';

const SIGNER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

function record(
  pubkey: string,
  options: {
    d?: string;
    name?: string;
    type?: string;
    category?: string;
    images?: string[][];
    createdAt?: number;
  } = {},
): PublishedDefinitionRecord {
  const event: NostrEvent = {
    id: `${pubkey.slice(0, 4)}-${options.d ?? 'x'}`.padEnd(64, '0'),
    pubkey,
    created_at: options.createdAt ?? 1_700_000_000,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', options.d ?? 'blobbi:accessory:hat'],
      ['name', options.name ?? 'Hat'],
      ['type', options.type ?? 'cosmetic'],
      ...(options.category ? [['category', options.category]] : []),
      ...(options.images ?? []),
    ],
    content: '',
    sig: 'f'.repeat(128),
  };
  const parsed = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!parsed.ok) throw new Error('fixture is not a valid definition');
  return {
    address: parsed.value.address,
    event,
    definition: parsed.value,
    warnings: parsed.warnings,
    relays: [],
  };
}

const defaultOptions = {
  search: '',
  issuer: 'all' as const,
  type: 'all',
  category: 'all',
  marker: 'all',
  missingPrimaryOnly: false,
  sort: 'updated' as const,
  signerPubkey: SIGNER,
};

describe('issuerBucket', () => {
  it('labels the official issuer official', () => {
    expect(issuerBucket(record(OFFICIAL_ITEM_ISSUER_PUBKEY), SIGNER)).toBe('official');
  });

  it('labels the active signer as mine', () => {
    expect(issuerBucket(record(SIGNER), SIGNER)).toBe('mine');
  });

  it('labels everyone else third-party', () => {
    expect(issuerBucket(record(STRANGER), SIGNER)).toBe('third-party');
    expect(issuerBucket(record(STRANGER), null)).toBe('third-party');
  });

  it('never promotes a stranger who copied the official d tag', () => {
    const impostor = record(STRANGER, { d: 'blobbi:food:apple', name: 'Apple' });
    expect(issuerBucket(impostor, SIGNER)).toBe('third-party');
  });
});

describe('address identity', () => {
  it('keeps two issuers of the same d as two distinct rows', () => {
    const rows = filterAndSortRecords(
      [
        record(OFFICIAL_ITEM_ISSUER_PUBKEY, { d: 'blobbi:accessory:hat' }),
        record(STRANGER, { d: 'blobbi:accessory:hat' }),
      ],
      defaultOptions,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.address)).size).toBe(2);
  });
});

describe('search, filter, sort', () => {
  const records = [
    record(OFFICIAL_ITEM_ISSUER_PUBKEY, {
      d: 'blobbi:food:apple',
      name: 'Apple',
      type: 'consumable',
      category: 'food',
      createdAt: 300,
      images: [['image', 'https://a/apple.png']],
    }),
    record(SIGNER, {
      d: 'blobbi:accessory:hat',
      name: 'Party Hat',
      type: 'cosmetic',
      category: 'headwear',
      createdAt: 200,
      images: [['image', 'https://a/hat-front.png', 'front']],
    }),
    record(STRANGER, {
      d: 'other:thing',
      name: 'Zebra',
      type: 'misc',
      createdAt: 100,
    }),
  ];

  it('searches name, d and address', () => {
    expect(
      filterAndSortRecords(records, { ...defaultOptions, search: 'party' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, search: 'blobbi:food' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, search: '31632:' }),
    ).toHaveLength(3);
  });

  it('filters by issuer bucket', () => {
    expect(
      filterAndSortRecords(records, { ...defaultOptions, issuer: 'official' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, issuer: 'mine' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, issuer: 'third-party' }),
    ).toHaveLength(1);
  });

  it('filters by type and category', () => {
    expect(
      filterAndSortRecords(records, { ...defaultOptions, type: 'cosmetic' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, category: 'food' }),
    ).toHaveLength(1);
  });

  it('filters by marker availability, treating "primary" as unmarked', () => {
    expect(
      filterAndSortRecords(records, { ...defaultOptions, marker: 'front' }),
    ).toHaveLength(1);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, marker: 'primary' }),
    ).toHaveLength(1);
  });

  it('filters to items with no unmarked primary image', () => {
    const rows = filterAndSortRecords(records, {
      ...defaultOptions,
      missingPrimaryOnly: true,
    });
    expect(rows.map((r) => r.definition.name).sort()).toEqual(['Party Hat', 'Zebra']);
  });

  it('sorts by updated, name and d', () => {
    expect(
      filterAndSortRecords(records, { ...defaultOptions, sort: 'updated' }).map(
        (r) => r.definition.name,
      ),
    ).toEqual(['Apple', 'Party Hat', 'Zebra']);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, sort: 'name' }).map(
        (r) => r.definition.name,
      ),
    ).toEqual(['Apple', 'Party Hat', 'Zebra']);
    expect(
      filterAndSortRecords(records, { ...defaultOptions, sort: 'd' }).map(
        (r) => r.definition.id,
      ),
    ).toEqual(['blobbi:accessory:hat', 'blobbi:food:apple', 'other:thing']);
  });
});
