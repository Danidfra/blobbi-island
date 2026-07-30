/**
 * Definition selection and cache reconciliation.
 *
 * `selectNewestDefinitions` is the tools' answer to the same question
 * `selectNewestValidDefinitions` answers for the catalog, and it must get the
 * same thing right: PARSE FIRST, then compare. A newer malformed event must not
 * be able to hide an older good one — that is how a broken publication would
 * otherwise make a working item vanish from the browser.
 */

import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { KIND_GAME_ITEM_DEFINITION } from '@/inventory/package';
import type { RelayQueryOutcome } from '@/inventory/relay-fan-out';

import {
  definitionsByAddressQueryKey,
  definitionsByAuthorQueryKey,
  selectNewestDefinitions,
  toDefinitionRecord,
  upsertDefinitionRecord,
  type PublishedDefinitionRecord,
} from './useItemDefinitions';

const AUTHOR = 'a'.repeat(64);
const ADDRESS = `31632:${AUTHOR}:blobbi:accessory:hat`;

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: AUTHOR,
    created_at: 1_000,
    kind: KIND_GAME_ITEM_DEFINITION,
    tags: [
      ['d', 'blobbi:accessory:hat'],
      ['name', 'Hat'],
      ['type', 'cosmetic'],
    ],
    content: '',
    sig: 'f'.repeat(128),
    ...overrides,
  };
}

function outcome(relay: string, events: NostrEvent[]): RelayQueryOutcome {
  return { relay, events };
}

describe('selectNewestDefinitions', () => {
  it('keeps the newest event for an address', () => {
    const older = event({ id: 'o'.repeat(64), created_at: 1_000 });
    const newer = event({
      id: 'n'.repeat(64),
      created_at: 2_000,
      tags: [
        ['d', 'blobbi:accessory:hat'],
        ['name', 'Newer Hat'],
        ['type', 'cosmetic'],
      ],
    });

    const selected = selectNewestDefinitions([outcome('wss://a', [older, newer])]);
    expect(selected.get(ADDRESS)?.definition.name).toBe('Newer Hat');
  });

  it('is insensitive to the order relays return events in', () => {
    const older = event({ id: 'o'.repeat(64), created_at: 1_000 });
    const newer = event({ id: 'n'.repeat(64), created_at: 2_000 });

    expect(
      selectNewestDefinitions([outcome('wss://a', [newer, older])]).get(ADDRESS)?.event.id,
    ).toBe('n'.repeat(64));
  });

  it('never lets a newer INVALID event hide an older valid one', () => {
    const valid = event({ id: 'v'.repeat(64), created_at: 1_000 });
    // Missing `name` → the package rejects it as a definition.
    const brokenButNewer = event({
      id: 'b'.repeat(64),
      created_at: 9_000,
      tags: [['d', 'blobbi:accessory:hat']],
    });

    const selected = selectNewestDefinitions([
      outcome('wss://a', [brokenButNewer, valid]),
    ]);
    expect(selected.size).toBe(1);
    expect(selected.get(ADDRESS)?.event.id).toBe('v'.repeat(64));
  });

  it('records every relay that served the same event', () => {
    const shared = event();
    const selected = selectNewestDefinitions([
      outcome('wss://a', [shared]),
      outcome('wss://b', [shared]),
    ]);
    expect(selected.get(ADDRESS)?.relays).toEqual(['wss://a', 'wss://b']);
  });

  it('tolerates a relay that returned an error and no events', () => {
    const selected = selectNewestDefinitions([
      { relay: 'wss://down', events: [], error: 'Timed out' },
      outcome('wss://up', [event()]),
    ]);
    expect(selected.size).toBe(1);
  });

  it('keeps two issuers of the same d as two addresses', () => {
    const other = 'c'.repeat(64);
    const selected = selectNewestDefinitions([
      outcome('wss://a', [event(), event({ pubkey: other, id: 'x'.repeat(64) })]),
    ]);
    expect(selected.size).toBe(2);
  });
});

describe('toDefinitionRecord', () => {
  it('returns null for an event that is not a definition', () => {
    expect(toDefinitionRecord(event({ tags: [['d', 'x']] }))).toBeNull();
  });

  it('carries the relays it was accepted by', () => {
    const record = toDefinitionRecord(event(), ['wss://a']);
    expect(record?.relays).toEqual(['wss://a']);
    expect(record?.address).toBe(ADDRESS);
  });
});

describe('upsertDefinitionRecord', () => {
  function record(createdAt: number, id: string): PublishedDefinitionRecord {
    const built = toDefinitionRecord(event({ created_at: createdAt, id }));
    if (!built) throw new Error('fixture did not parse');
    return built;
  }

  it('prepends into an existing by-author list', () => {
    const client = new QueryClient();
    const key = definitionsByAuthorQueryKey([AUTHOR]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, []);

    upsertDefinitionRecord(client, record(2_000, 'n'.repeat(64)));
    expect(client.getQueryData<PublishedDefinitionRecord[]>(key)).toHaveLength(1);
  });

  it('replaces the entry for an address instead of duplicating it', () => {
    const client = new QueryClient();
    const key = definitionsByAuthorQueryKey([AUTHOR]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, [record(1_000, 'o'.repeat(64))]);

    upsertDefinitionRecord(client, record(2_000, 'n'.repeat(64)));
    const cached = client.getQueryData<PublishedDefinitionRecord[]>(key);
    expect(cached).toHaveLength(1);
    expect(cached?.[0].event.id).toBe('n'.repeat(64));
  });

  it('refuses to demote a newer cached record with an older one', () => {
    const client = new QueryClient();
    const key = definitionsByAuthorQueryKey([AUTHOR]);
    client.setQueryData<PublishedDefinitionRecord[]>(key, [record(5_000, 'n'.repeat(64))]);

    upsertDefinitionRecord(client, record(1_000, 'o'.repeat(64)));
    expect(client.getQueryData<PublishedDefinitionRecord[]>(key)?.[0].event.id).toBe(
      'n'.repeat(64),
    );
  });

  it('updates a by-address map that already tracks the address', () => {
    const client = new QueryClient();
    const key = definitionsByAddressQueryKey([ADDRESS]);
    client.setQueryData<Map<string, PublishedDefinitionRecord>>(
      key,
      new Map([[ADDRESS, record(1_000, 'o'.repeat(64))]]),
    );

    upsertDefinitionRecord(client, record(2_000, 'n'.repeat(64)));
    expect(
      client.getQueryData<Map<string, PublishedDefinitionRecord>>(key)?.get(ADDRESS)?.event.id,
    ).toBe('n'.repeat(64));
  });

  it('does not inject an address into a map that was not tracking it', () => {
    const client = new QueryClient();
    const other = `31632:${AUTHOR}:something:else`;
    const key = definitionsByAddressQueryKey([other]);
    client.setQueryData<Map<string, PublishedDefinitionRecord>>(key, new Map());

    upsertDefinitionRecord(client, record(2_000, 'n'.repeat(64)));
    expect(client.getQueryData<Map<string, PublishedDefinitionRecord>>(key)?.size).toBe(0);
  });

  it('leaves an uninitialized query alone rather than seeding it', () => {
    const client = new QueryClient();
    const key = definitionsByAuthorQueryKey([AUTHOR]);
    upsertDefinitionRecord(client, record(2_000, 'n'.repeat(64)));
    expect(client.getQueryData(key)).toBeUndefined();
  });
});

describe('query keys', () => {
  it('are order-insensitive, so the same set is one cache entry', () => {
    expect(definitionsByAuthorQueryKey(['b', 'a'])).toEqual(
      definitionsByAuthorQueryKey(['a', 'b']),
    );
    expect(definitionsByAddressQueryKey(['y', 'x'])).toEqual(
      definitionsByAddressQueryKey(['x', 'y']),
    );
  });
});
