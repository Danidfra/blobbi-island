/**
 * Reward-writer tests.
 *
 * These exercise the REAL mutation composition — the real fresh-read, the real
 * `applyMutation`, the real `buildInventoryTemplate` — against a fake relay and
 * a fake signer. Nothing here publishes: the pool is an object literal, and a
 * test that reached a network would have to construct one.
 *
 * What is being pinned is the set of properties a currency grant must have and
 * that are easy to break by writing a bespoke event builder instead of using the
 * canonical one: other items survive, the base is the newest relay event rather
 * than a cache, zero-quantity entries are omitted, and a timeout is a failure.
 */
import { describe, it, expect, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  ARCADE_TICKET_ADDRESS,
  ArcadeRewardWriterError,
  createArcadeTicketWriter,
  type RewardWriterNostr,
} from './arcade-reward-writer';
import type { ArcadeRewardClaim } from '@/arcade/arcade-reward-boundary';
import { KIND_GAME_INVENTORY, ISLAND_INVENTORY_D } from './package';
import { officialItemAddress } from '@/protocol/event-registry';

const PUBKEY = 'f'.repeat(64);
const APPLE = officialItemAddress('blobbi:food:apple');

function inventoryEvent(
  items: readonly [address: string, quantity: number][],
  extraTags: string[][] = [],
  createdAt = 1000,
): NostrEvent {
  return {
    id: 'inv',
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: KIND_GAME_INVENTORY,
    tags: [
      ['d', ISLAND_INVENTORY_D],
      ...items.map(([address, quantity]) => ['a', address, '', String(quantity)]),
      ...extraTags,
    ],
    content: '',
    sig: 'sig',
  };
}

function claim(tickets = 6): ArcadeRewardClaim {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    status: 'publishing',
    tickets,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attempts: 1,
    failure: null,
    quantityBefore: 0,
    reconcileAttempts: 0,
  };
}

interface Harness {
  writer: ReturnType<typeof createArcadeTicketWriter>;
  published: NostrEvent[];
  signed: unknown[];
}

function harness(
  options: {
    events?: NostrEvent[];
    publishError?: unknown;
    signError?: unknown;
    itemAddress?: string;
  } = {},
): Harness {
  const published: NostrEvent[] = [];
  const signed: unknown[] = [];

  const nostr: RewardWriterNostr = {
    query: async () => options.events ?? [],
    event: async (event) => {
      if (options.publishError) throw options.publishError;
      published.push(event);
    },
  };

  const user = {
    pubkey: PUBKEY,
    signer: {
      getPublicKey: async () => PUBKEY,
      signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
        if (options.signError) throw options.signError;
        signed.push(template);
        return { ...template, id: 'signed', pubkey: PUBKEY, sig: 'sig' } as NostrEvent;
      },
    },
  };

  return {
    writer: createArcadeTicketWriter({
      nostr,
      user: user as unknown as Parameters<typeof createArcadeTicketWriter>[0]['user'],
      itemAddress: options.itemAddress,
    }),
    published,
    signed,
  };
}

/** Item quantities from a published kind:31633 event. */
function itemsOf(event: NostrEvent): Record<string, number> {
  return Object.fromEntries(
    event.tags.filter(([name]) => name === 'a').map((tag) => [tag[1], Number(tag[3])]),
  );
}

describe('the canonical address', () => {
  it('is derived from the official issuer and the canonical d, never hardcoded', () => {
    expect(ARCADE_TICKET_ADDRESS).toBe(
      '31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket',
    );
  });
});

describe('granting tickets', () => {
  it('adds tickets to an empty inventory', async () => {
    const h = harness();
    await h.writer.publishTicketGrant(claim(6));

    expect(h.published).toHaveLength(1);
    expect(h.published[0].kind).toBe(KIND_GAME_INVENTORY);
    expect(itemsOf(h.published[0])).toEqual({ [ARCADE_TICKET_ADDRESS]: 6 });
  });

  it('increments an existing ticket balance rather than replacing it', async () => {
    const h = harness({ events: [inventoryEvent([[ARCADE_TICKET_ADDRESS, 11]])] });
    await h.writer.publishTicketGrant(claim(4));
    expect(itemsOf(h.published[0])[ARCADE_TICKET_ADDRESS]).toBe(15);
  });

  it('preserves every unrelated item', async () => {
    const h = harness({
      events: [
        inventoryEvent([
          [APPLE, 3],
          [ARCADE_TICKET_ADDRESS, 1],
        ]),
      ],
    });
    await h.writer.publishTicketGrant(claim(2));
    expect(itemsOf(h.published[0])).toEqual({ [APPLE]: 3, [ARCADE_TICKET_ADDRESS]: 3 });
  });

  it('writes the canonical inventory d, so it replaces the right event', async () => {
    const h = harness();
    await h.writer.publishTicketGrant(claim());
    const d = h.published[0].tags.find(([name]) => name === 'd')?.[1];
    expect(d).toBe(ISLAND_INVENTORY_D);
  });

  it('adds the client tag exactly once', async () => {
    const h = harness();
    await h.writer.publishTicketGrant(claim());
    const clientTags = h.published[0].tags.filter(([name]) => name === 'client');
    expect(clientTags).toEqual([['client', 'blobbi']]);
  });

  it('uses the FRESH relay event as the base, not a cache', async () => {
    // Two events for the same address; the newest must win.
    const h = harness({
      events: [
        inventoryEvent([[ARCADE_TICKET_ADDRESS, 1]], [], 1000),
        inventoryEvent([[ARCADE_TICKET_ADDRESS, 40]], [], 2000),
      ],
    });
    await h.writer.publishTicketGrant(claim(2));
    expect(itemsOf(h.published[0])[ARCADE_TICKET_ADDRESS]).toBe(42);
  });

  it('omits a zero-quantity entry, following the inventory convention', async () => {
    const h = harness({ events: [inventoryEvent([[APPLE, 0]])] });
    await h.writer.publishTicketGrant(claim(1));
    expect(itemsOf(h.published[0])).toEqual({ [ARCADE_TICKET_ADDRESS]: 1 });
  });

  it('preserves an unknown ITEM address, quantity intact', async () => {
    const unknown = '31632:deadbeef:some:future:item';
    const h = harness({ events: [inventoryEvent([[unknown, 7]])] });
    await h.writer.publishTicketGrant(claim(1));
    expect(itemsOf(h.published[0])[unknown]).toBe(7);
  });

  it('drops unknown NON-item tags — exactly as every other inventory write does', async () => {
    // This is the canonical `buildInventoryTemplate` behaviour, not something
    // the arcade introduced: the builder reconstructs the event from the parsed
    // items plus the Island's own name/alt, so a tag it does not model is lost
    // on the next write by ANY caller (purchase, use, batch, or this one).
    // Pinned here so the limitation is visible rather than discovered, and
    // documented in `docs/blobbi-dance.md`. Fixing it belongs to the inventory
    // layer, not to a reward writer that must not diverge from it.
    const h = harness({
      events: [inventoryEvent([[APPLE, 2]], [['mystery', 'value']])],
    });
    await h.writer.publishTicketGrant(claim(1));
    expect(h.published[0].tags.some(([name]) => name === 'mystery')).toBe(false);
    // The thing that actually matters — the other balance — is intact.
    expect(itemsOf(h.published[0])[APPLE]).toBe(2);
  });

  it('never publishes a kind:11125 coin event', async () => {
    const h = harness();
    await h.writer.publishTicketGrant(claim());
    expect(h.published.every((e) => e.kind === KIND_GAME_INVENTORY)).toBe(true);
    expect(h.published.some((e) => e.kind === 11125)).toBe(false);
  });

  it('grants only the address it was told to, never a neighbouring one', async () => {
    const h = harness({ itemAddress: APPLE, events: [inventoryEvent([[ARCADE_TICKET_ADDRESS, 5]])] });
    await h.writer.publishTicketGrant(claim(2));
    expect(itemsOf(h.published[0])).toEqual({ [ARCADE_TICKET_ADDRESS]: 5, [APPLE]: 2 });
  });
});

describe('refusals', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses to grant %s tickets', async (tickets) => {
    const h = harness();
    await expect(h.writer.publishTicketGrant(claim(tickets))).rejects.toBeInstanceOf(
      ArcadeRewardWriterError,
    );
    expect(h.published).toHaveLength(0);
    expect(h.signed).toHaveLength(0);
  });

  it('refuses without a signed-in user', async () => {
    const writer = createArcadeTicketWriter({
      nostr: { query: async () => [], event: async () => {} },
      user: { pubkey: '', signer: undefined } as never,
    });
    await expect(writer.publishTicketGrant(claim())).rejects.toMatchObject({
      reason: 'not-logged-in',
    });
  });

  it('reports a refusing signer distinctly from a refusing relay', async () => {
    const h = harness({ signError: new Error('user rejected') });
    await expect(h.writer.publishTicketGrant(claim())).rejects.toMatchObject({
      reason: 'sign-failed',
    });
    expect(h.published).toHaveLength(0);
  });

  it('does NOT swallow a publish timeout — that is the whole point', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const h = harness({ publishError: timeout });
    await expect(h.writer.publishTicketGrant(claim())).rejects.toBe(timeout);
  });

  it('propagates an all-relays-rejected failure', async () => {
    const h = harness({ publishError: new Error('every relay said no') });
    await expect(h.writer.publishTicketGrant(claim())).rejects.toThrow(/every relay/);
  });
});

describe('reading back', () => {
  it('reports the current ticket quantity', async () => {
    const h = harness({
      events: [
        inventoryEvent([
          [APPLE, 3],
          [ARCADE_TICKET_ADDRESS, 9],
        ]),
      ],
    });
    await expect(h.writer.readTicketQuantity()).resolves.toBe(9);
  });

  it('reports zero for an inventory with no tickets', async () => {
    const h = harness({ events: [inventoryEvent([[APPLE, 3]])] });
    await expect(h.writer.readTicketQuantity()).resolves.toBe(0);
  });

  it('reports NULL when the read itself fails — a failed read is not a failed write', async () => {
    const writer = createArcadeTicketWriter({
      nostr: {
        query: async () => {
          throw new Error('relay unreachable');
        },
        event: async () => {},
      },
      user: {
        pubkey: PUBKEY,
        signer: { getPublicKey: async () => PUBKEY, signEvent: vi.fn() },
      } as never,
    });
    await expect(writer.readTicketQuantity()).resolves.toBeNull();
  });
});
