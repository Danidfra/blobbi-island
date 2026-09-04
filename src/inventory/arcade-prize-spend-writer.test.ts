/**
 * Spend-writer tests.
 *
 * Same shape as `arcade-reward-writer.test.ts` and pinning the mirror-image
 * properties: unrelated items survive, the base is the newest relay event, the
 * balance can never go negative, a ticket-only inventory works, legacy kinds
 * are never touched, and a timeout is a failure; never a success.
 */
import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  createArcadePrizeSpendWriter,
  type PrizeSpendNostr,
} from './arcade-prize-spend-writer';
import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import { KIND_GAME_INVENTORY, ISLAND_INVENTORY_D } from './package';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const PUBKEY = 'f'.repeat(64);
const TICKETS = officialItemAddress(ARCADE_TICKET_D);
const APPLE = officialItemAddress('blobbi:food:apple');

function inventoryEvent(
  items: readonly [address: string, quantity: number][],
  createdAt = 1000,
): NostrEvent {
  return {
    id: `inv-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: KIND_GAME_INVENTORY,
    tags: [
      ['d', ISLAND_INVENTORY_D],
      ...items.map(([address, quantity]) => ['a', address, '', String(quantity)]),
    ],
    content: '',
    sig: 'sig',
  };
}

function redemption(price = 40): ArcadePrizeRedemption {
  return {
    redemptionId: `neon-star-glasses:attempt-1`,
    prizeId: 'neon-star-glasses',
    attemptId: 'attempt-1',
    price,
    catalogueVersion: 'temp-v1',
    status: 'spending',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attempts: 1,
    failure: null,
    quantityBefore: 100,
    reconcileAttempts: 0,
  };
}

function harness(
  options: { events?: NostrEvent[]; publishError?: unknown; signError?: unknown } = {},
) {
  const published: NostrEvent[] = [];
  const nostr: PrizeSpendNostr = {
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
        return { ...template, id: 'signed', pubkey: PUBKEY, sig: 'sig' } as NostrEvent;
      },
    },
  };
  return {
    writer: createArcadePrizeSpendWriter({
      nostr,
      user: user as unknown as Parameters<typeof createArcadePrizeSpendWriter>[0]['user'],
    }),
    published,
  };
}

function itemsOf(event: NostrEvent): Record<string, number> {
  return Object.fromEntries(
    event.tags.filter(([name]) => name === 'a').map((tag) => [tag[1], Number(tag[3])]),
  );
}

describe('spending', () => {
  it('subtracts exactly the price and preserves every unrelated item', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 100], [APPLE, 9]])],
    });
    await writer.spendTickets(redemption(40));

    expect(published).toHaveLength(1);
    expect(itemsOf(published[0])).toEqual({ [TICKETS]: 60, [APPLE]: 9 });
    expect(published[0].kind).toBe(KIND_GAME_INVENTORY);
  });

  it('works with a ticket-only inventory, and omits a zeroed entry', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 40]])] });
    await writer.spendTickets(redemption(40));
    // Spending the whole balance leaves no entry at all, the canonical
    // builder omits zero quantities rather than writing `0`.
    expect(itemsOf(published[0])).toEqual({});
  });

  it('spends against the NEWEST relay event, not an older one', async () => {
    const { writer, published } = harness({
      events: [
        inventoryEvent([[TICKETS, 10]], 500), // stale
        inventoryEvent([[TICKETS, 100], [APPLE, 2]], 2000), // newest
      ],
    });
    await writer.spendTickets(redemption(40));
    expect(itemsOf(published[0])).toEqual({ [TICKETS]: 60, [APPLE]: 2 });
  });

  it('REFUSES to publish when the freshest balance cannot cover the price', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 39]])] });
    await expect(writer.spendTickets(redemption(40))).rejects.toMatchObject({
      name: 'ArcadePrizeSpendError',
      reason: 'insufficient-tickets',
    });
    expect(published).toHaveLength(0);
  });

  it('refuses an empty inventory the same way; never a negative balance', async () => {
    const { writer, published } = harness({ events: [] });
    await expect(writer.spendTickets(redemption(40))).rejects.toMatchObject({
      reason: 'insufficient-tickets',
    });
    expect(published).toHaveLength(0);
  });

  it('refuses a nonsense price before reading anything', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 100]])] });
    for (const price of [0, -5, 4.5]) {
      await expect(writer.spendTickets(redemption(price))).rejects.toMatchObject({
        reason: 'invalid-price',
      });
    }
    expect(published).toHaveLength(0);
  });

  it('classifies a signer refusal as provably pre-publish', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 100]])],
      signError: new Error('nope'),
    });
    await expect(writer.spendTickets(redemption(40))).rejects.toMatchObject({
      name: 'ArcadePrizeSpendError',
      reason: 'sign-failed',
    });
    expect(published).toHaveLength(0);
  });

  it('lets a publish failure through RAW, the boundary classifies it, not the writer', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { writer } = harness({
      events: [inventoryEvent([[TICKETS, 100]])],
      publishError: timeout,
    });
    await expect(writer.spendTickets(redemption(40))).rejects.toBe(timeout);
  });

  it('never touches legacy kind:11125 and adds the client tag', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 100]])] });
    await writer.spendTickets(redemption(40));
    expect(published[0].kind).toBe(KIND_GAME_INVENTORY);
    expect(String(published[0].kind)).not.toContain('11125');
    expect(published[0].tags.some(([name, value]) => name === 'client' && value === 'blobbi')).toBe(
      true,
    );
  });
});

describe('reading the balance back', () => {
  it('reports the current quantity', async () => {
    const { writer } = harness({ events: [inventoryEvent([[TICKETS, 73]])] });
    expect(await writer.readTicketQuantity()).toBe(73);
  });

  it('reports 0: not null, for an empty inventory that read fine', async () => {
    const { writer } = harness({ events: [] });
    expect(await writer.readTicketQuantity()).toBe(0);
  });

  it('reports null when the read itself fails', async () => {
    const nostr: PrizeSpendNostr = {
      query: async () => {
        throw new Error('relay down');
      },
      event: async () => {},
    };
    const writer = createArcadePrizeSpendWriter({
      nostr,
      user: {
        pubkey: PUBKEY,
        signer: { getPublicKey: async () => PUBKEY, signEvent: async () => ({}) as NostrEvent },
      } as unknown as Parameters<typeof createArcadePrizeSpendWriter>[0]['user'],
    });
    expect(await writer.readTicketQuantity()).toBeNull();
  });
});
