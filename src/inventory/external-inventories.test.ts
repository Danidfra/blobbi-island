/**
 * Author-wide kind:31633 discovery, selection, exclusion, and containment.
 *
 * The read that finds a player's other inventories asks a deliberately open
 * question (`{kinds:[31633], authors:[player]}`), so the discipline has to live
 * in what is done with the answer. Three failures are possible and each has a
 * test here:
 *
 *   - one context's bad event corrupting another's         → per-`d` selection
 *   - a newer MALFORMED event hiding an older good one     → parse before compare
 *   - Blobbi's own inventory acquiring a second reader     → exclusion
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  referencedItemAddresses,
  selectNewestInventoryPerContext,
} from './external-inventories';
import { ISLAND_INVENTORY_D, KIND_GAME_INVENTORY } from './package';

const OWNER = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const CARROT = `31632:${FARM_ISSUER}:farm:produce:carrot`;

interface EventOptions {
  d: string;
  created_at: number;
  items?: [address: string, relay: string, quantity: string][];
  id?: string;
  pubkey?: string;
  extraTags?: string[][];
  /** Omit the `d` tag entirely, which makes the event unparseable. */
  malformed?: boolean;
}

function inventoryEvent(options: EventOptions): NostrEvent {
  const tags: string[][] = options.malformed
    ? []
    : [['d', options.d], ...(options.extraTags ?? [])];
  for (const [address, relay, quantity] of options.items ?? []) {
    tags.push(['a', address, relay, quantity]);
  }
  return {
    id: options.id ?? `${options.d}-${options.created_at}`,
    pubkey: options.pubkey ?? OWNER,
    created_at: options.created_at,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: '',
  };
}

describe('newest valid event per inventory context', () => {
  it('selects independently for each `d`', () => {
    const result = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 10, items: [[STRAWBERRY, '', '1']] }),
      inventoryEvent({ d: 'farm:main', created_at: 20, items: [[STRAWBERRY, '', '3']] }),
      inventoryEvent({ d: 'guild:chest', created_at: 5, items: [[CARROT, '', '7']] }),
    ]);

    expect(result.map((i) => i.id)).toEqual(['farm:main', 'guild:chest']);
    expect(result[0].items[0].quantity).toBe(3);
    expect(result[0].createdAt).toBe(20);
    expect(result[1].items[0].quantity).toBe(7);
  });

  it('does not let a NEWER malformed event hide an older valid one', () => {
    const result = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 10, items: [[STRAWBERRY, '', '3']] }),
      // Newer, but has no `d` tag, so it is not an inventory at any age.
      inventoryEvent({ d: 'farm:main', created_at: 99, malformed: true }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe(10);
    expect(result[0].items[0].quantity).toBe(3);
  });

  it("one context's malformed event cannot affect another context", () => {
    const result = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 99, malformed: true }),
      inventoryEvent({ d: 'guild:chest', created_at: 5, items: [[CARROT, '', '2']] }),
    ]);

    expect(result.map((i) => i.id)).toEqual(['guild:chest']);
  });

  it('breaks a created_at tie on the lowest event id, as NIP-01 does', () => {
    const result = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 7, id: 'ffff', items: [[STRAWBERRY, '', '1']] }),
      inventoryEvent({ d: 'farm:main', created_at: 7, id: 'aaaa', items: [[STRAWBERRY, '', '9']] }),
    ]);

    expect(result[0].items[0].quantity).toBe(9);
  });

  it('accepts events regardless of the order relays return them in', () => {
    const forwards = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 1, items: [[STRAWBERRY, '', '1']] }),
      inventoryEvent({ d: 'farm:main', created_at: 2, items: [[STRAWBERRY, '', '2']] }),
    ]);
    const backwards = selectNewestInventoryPerContext([
      inventoryEvent({ d: 'farm:main', created_at: 2, items: [[STRAWBERRY, '', '2']] }),
      inventoryEvent({ d: 'farm:main', created_at: 1, items: [[STRAWBERRY, '', '1']] }),
    ]);
    expect(forwards).toEqual(backwards);
  });
});

describe('what is excluded', () => {
  it("leaves out Blobbi's own inventory; it has a canonical reader", () => {
    const result = selectNewestInventoryPerContext([
      inventoryEvent({ d: ISLAND_INVENTORY_D, created_at: 50, items: [[CARROT, '', '4']] }),
      inventoryEvent({ d: 'farm:main', created_at: 10, items: [[STRAWBERRY, '', '1']] }),
    ]);

    expect(result.map((i) => i.id)).toEqual(['farm:main']);
  });

  it('leaves out events authored by anybody else', () => {
    const result = selectNewestInventoryPerContext(
      [
        inventoryEvent({ d: 'farm:main', created_at: 10, pubkey: OTHER, items: [[STRAWBERRY, '', '1']] }),
      ],
      { owner: OWNER },
    );

    expect(result).toEqual([]);
  });

  it('leaves out other kinds', () => {
    const foreign: NostrEvent = {
      ...inventoryEvent({ d: 'farm:main', created_at: 10 }),
      kind: 31634,
    };
    expect(selectNewestInventoryPerContext([foreign])).toEqual([]);
  });
});

describe('what is preserved', () => {
  it('keeps the context id, contexts, full addresses, relay hints and quantities', () => {
    const [inventory] = selectNewestInventoryPerContext([
      inventoryEvent({
        d: 'farm:main',
        created_at: 10,
        extraTags: [['context', 'game:farm']],
        items: [[STRAWBERRY, 'wss://relay.primal.net', '3']],
      }),
    ]);

    expect(inventory.id).toBe('farm:main');
    expect(inventory.address).toBe(`31633:${OWNER}:farm:main`);
    expect(inventory.owner).toBe(OWNER);
    expect(inventory.contexts).toEqual(['game:farm']);
    expect(inventory.items).toEqual([
      { address: STRAWBERRY, relay: 'wss://relay.primal.net', quantity: 3 },
    ]);
  });

  it('does not interpret another application\'s unmanaged tags', () => {
    const [inventory] = selectNewestInventoryPerContext([
      inventoryEvent({
        d: 'farm:main',
        created_at: 10,
        extraTags: [
          ['revision', '2'],
          ['e', 'f'.repeat(64), '', 'farm-harvest'],
        ],
        items: [[STRAWBERRY, '', '1']],
      }),
    ]);

    // The read model exposes identity, contexts, items, and the parsed
    // package snapshot the spend-aware derivation is handed (which carries
    // the event verbatim, as the package requires). No other field surfaces,
    // nothing here re-reads a `revision` or a partner's harvest marker.
    expect(Object.keys(inventory).sort()).toEqual([
      'address',
      'contexts',
      'createdAt',
      'id',
      'items',
      'owner',
      'snapshot',
    ]);
    const { snapshot, ...readModel } = inventory;
    expect(JSON.stringify(readModel)).not.toContain('farm-harvest');
    expect(JSON.stringify(readModel)).not.toContain('revision');
    // The snapshot is the package's object, untouched: its revision is the
    // package's reading, not Island's.
    expect(snapshot.revision).toBe(2);
    expect(inventory.fold).toBeUndefined();
  });

  it('surfaces the fold reference the package parsed, and nothing about it is interpreted here', () => {
    const [inventory] = selectNewestInventoryPerContext([
      inventoryEvent({
        d: 'farm:main',
        created_at: 10,
        extraTags: [['e', 'a'.repeat(64), 'wss://relay.primal.net', 'fold']],
        items: [[STRAWBERRY, '', '1']],
      }),
    ]);
    expect(inventory.fold).toEqual({ eventId: 'a'.repeat(64), relay: 'wss://relay.primal.net' });
    // Still the raw snapshot quantity: resolution is the derivation's job.
    expect(inventory.items[0].quantity).toBe(1);
  });
});

describe('address collection', () => {
  it('dedupes across inventories and keeps a non-empty relay hint', () => {
    const inventories = selectNewestInventoryPerContext([
      inventoryEvent({
        d: 'farm:main',
        created_at: 10,
        items: [[STRAWBERRY, 'wss://relay.primal.net', '1']],
      }),
      inventoryEvent({
        d: 'guild:chest',
        created_at: 10,
        items: [
          [STRAWBERRY, '', '2'],
          [CARROT, '', '1'],
        ],
      }),
    ]);

    const refs = referencedItemAddresses(inventories);
    expect(refs).toHaveLength(2);
    expect(refs.find((r) => r.address === STRAWBERRY)?.relay).toBe(
      'wss://relay.primal.net',
    );
  });
});
