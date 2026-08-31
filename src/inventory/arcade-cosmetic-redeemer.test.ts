/**
 * Atomic cosmetic-redemption tests.
 *
 * The property under test is the one the whole design exists for: a redeemed
 * cosmetic's TICKET DEBIT and ITEM GRANT are the same kind:31633 replacement
 * event. Everything else here is the surrounding safety — the pre-publish
 * refusals, the untouched neighbours, the never-fabricated empty read, and the
 * delivery adapter that verifies instead of writing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  createArcadeCosmeticRedeemer,
  inventoryPrizeAddress,
  type ArcadeCosmeticRedeemerNostr,
} from './arcade-cosmetic-redeemer';
import { ArcadePrizeSpendError } from './arcade-prize-spend-writer';
import { clearConfirmedInventories } from './confirmed-inventory';
import { ISLAND_INVENTORY_D, KIND_GAME_INVENTORY } from './package';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';
import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import {
  OFFICIAL_ARCADE_PRIZE_CATALOG,
  officialArcadePrizeAsRedeemable,
} from '@/arcade/prizes/official-prize-catalog';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

const PUBKEY = 'f'.repeat(64);
const STRANGER = 'a'.repeat(64);
const TICKETS = officialItemAddress(ARCADE_TICKET_D);
const APPLE = officialItemAddress('blobbi:food:apple');

/** The Block Builder Cap — 200 tickets, the cheapest real prize. */
const CAP = OFFICIAL_ARCADE_PRIZE_CATALOG.find(
  (p) => p.d === 'blobbi:cosmetic:block-builder-cap',
)!;
const CAP_PRIZE: ArcadePrize = officialArcadePrizeAsRedeemable(CAP);
const CAP_ADDRESS = CAP.itemAddress;

function inventoryEvent(
  items: readonly [address: string, quantity: number][],
  createdAt = 1000,
  pubkey = PUBKEY,
): NostrEvent {
  return {
    id: `inv-${createdAt}`,
    pubkey,
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

function redemption(price = CAP.tickets, prizeId = CAP_PRIZE.id): ArcadePrizeRedemption {
  return {
    redemptionId: `${prizeId}:attempt-1`,
    prizeId,
    attemptId: 'attempt-1',
    price,
    catalogueVersion: 'official-v2-inventory',
    status: 'spending',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attempts: 1,
    failure: null,
    quantityBefore: 500,
    reconcileAttempts: 0,
  };
}

function harness(
  options: {
    events?: NostrEvent[];
    publishError?: unknown;
    signError?: unknown;
    readError?: unknown;
    prize?: ArcadePrize;
    pubkey?: string;
  } = {},
) {
  const published: NostrEvent[] = [];
  const seenFilters: { authors?: string[]; kinds?: number[] }[] = [];
  let queries = 0;
  const nostr: ArcadeCosmeticRedeemerNostr = {
    query: async (filters) => {
      queries += 1;
      seenFilters.push(...(filters as { authors?: string[]; kinds?: number[] }[]));
      if (options.readError) throw options.readError;
      return options.events ?? [];
    },
    event: async (event) => {
      if (options.publishError) throw options.publishError;
      published.push(event);
    },
  };
  const pubkey = options.pubkey ?? PUBKEY;
  const user = {
    pubkey,
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
        if (options.signError) throw options.signError;
        return { ...template, id: 'signed', pubkey, sig: 'sig' } as NostrEvent;
      },
    },
  };
  const redeemer = createArcadeCosmeticRedeemer({
    nostr,
    user: user as unknown as Parameters<typeof createArcadeCosmeticRedeemer>[0]['user'],
    prize: options.prize ?? CAP_PRIZE,
  });
  return {
    ...redeemer,
    published,
    pubkey,
    queryCount: () => queries,
    filters: () => seenFilters,
  };
}

function itemsOf(event: NostrEvent): Record<string, number> {
  return Object.fromEntries(
    event.tags.filter(([name]) => name === 'a').map((tag) => [tag[1], Number(tag[3])]),
  );
}

beforeEach(() => {
  clearConfirmedInventories();
});

describe('the debit and the grant are ONE event', () => {
  it('publishes exactly one event carrying both halves', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
    });
    await writer.spendTickets(redemption());

    // THE invariant. Not "a spend event then a grant event" — one event.
    expect(published).toHaveLength(1);
    expect(itemsOf(published[0])).toEqual({ [TICKETS]: 300, [CAP_ADDRESS]: 1 });
    expect(published[0].kind).toBe(KIND_GAME_INVENTORY);
  });

  it('grants quantity 1 — a prize is one prize, never a stack', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 200]])],
    });
    await writer.spendTickets(redemption());
    expect(itemsOf(published[0])[CAP_ADDRESS]).toBe(1);
  });

  it('preserves every unrelated inventory entry', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 500], [APPLE, 9]])],
    });
    await writer.spendTickets(redemption());
    expect(itemsOf(published[0])).toEqual({
      [TICKETS]: 300,
      [APPLE]: 9,
      [CAP_ADDRESS]: 1,
    });
  });

  it('spending the exact balance omits the zeroed ticket entry, prize still granted', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 200]])] });
    await writer.spendTickets(redemption());
    expect(itemsOf(published[0])).toEqual({ [CAP_ADDRESS]: 1 });
  });

  it('builds on the NEWEST relay event, not an older one', async () => {
    const { writer, published } = harness({
      events: [
        inventoryEvent([[TICKETS, 210]], 500),
        inventoryEvent([[TICKETS, 500], [APPLE, 2]], 2000),
      ],
    });
    await writer.spendTickets(redemption());
    expect(itemsOf(published[0])).toEqual({
      [TICKETS]: 300,
      [APPLE]: 2,
      [CAP_ADDRESS]: 1,
    });
  });

  it('reads and writes only the signed-in owner', async () => {
    const { writer, published, filters } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
    });
    await writer.spendTickets(redemption());

    expect(published).toHaveLength(1);
    expect(published[0].pubkey).toBe(PUBKEY);
    // Every read this redemption makes is scoped to the player's own author
    // and their own inventory `d`. Nobody else's kind:31633 is read, and — a
    // replaceable event being addressed by author + kind + `d` — nobody
    // else's can be replaced by what is published here.
    expect(filters().length).toBeGreaterThan(0);
    for (const filter of filters()) {
      expect(filter.authors).toEqual([PUBKEY]);
      expect(filter.authors).not.toContain(STRANGER);
      expect(filter.kinds).toEqual([KIND_GAME_INVENTORY]);
    }
  });

  it('grants the address the CATALOG names, for every one of the six prizes', async () => {
    for (const entry of OFFICIAL_ARCADE_PRIZE_CATALOG) {
      const prize = officialArcadePrizeAsRedeemable(entry);
      const { writer, published } = harness({
        prize,
        events: [inventoryEvent([[TICKETS, 5000]])],
      });
      await writer.spendTickets(redemption(entry.tickets, prize.id));
      expect(itemsOf(published[0])).toEqual({
        [TICKETS]: 5000 - entry.tickets,
        [entry.itemAddress]: 1,
      });
    }
  });
});

describe('refusals happen BEFORE any publish', () => {
  it('refuses an already-owned prize and spends nothing', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 500], [CAP_ADDRESS, 1]])],
    });
    await expect(writer.spendTickets(redemption())).rejects.toMatchObject({
      name: 'ArcadePrizeSpendError',
      reason: 'already-owned',
    });
    expect(published).toEqual([]);
  });

  it('refuses when the balance is short and spends nothing', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 199]])] });
    await expect(writer.spendTickets(redemption())).rejects.toMatchObject({
      reason: 'insufficient-tickets',
    });
    expect(published).toEqual([]);
  });

  it('checks ownership against the AUTHORITATIVE base, not the caller', async () => {
    // The player's screen may say "not owned" — another tab redeemed a second
    // ago. The refusal is decided inside the write lock, on the newest event.
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 500], [CAP_ADDRESS, 1]], 4000)],
    });
    await expect(writer.spendTickets(redemption())).rejects.toBeInstanceOf(
      ArcadePrizeSpendError,
    );
    expect(published).toEqual([]);
  });

  it('refuses a redemption record for a different prize', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 500]])] });
    await expect(
      writer.spendTickets(redemption(200, 'blobbi:effect:celestial-aura')),
    ).rejects.toMatchObject({ reason: 'invalid-price' });
    expect(published).toEqual([]);
  });

  it('refuses a non-positive price', async () => {
    const { writer, published } = harness({ events: [inventoryEvent([[TICKETS, 500]])] });
    await expect(writer.spendTickets(redemption(0))).rejects.toMatchObject({
      reason: 'invalid-price',
    });
    expect(published).toEqual([]);
  });

  it('reports a refusing signer as sign-failed — provably nothing was sent', async () => {
    const { writer, published } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
      signError: new Error('user declined'),
    });
    await expect(writer.spendTickets(redemption())).rejects.toMatchObject({
      reason: 'sign-failed',
    });
    expect(published).toEqual([]);
  });
});

describe('a timeout is not a success', () => {
  it('rethrows the RAW publish error so the machine can classify it', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { writer } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
      publishError: timeout,
    });
    // NOT an ArcadePrizeSpendError: the writer must not claim to know whether
    // the event crossed the publish boundary.
    await expect(writer.spendTickets(redemption())).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('records nothing as confirmed, so a later read is pure relay state', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { writer, ownership } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
      publishError: timeout,
    });
    await expect(writer.spendTickets(redemption())).rejects.toThrow();
    // The ambiguous path must reconcile against what a relay actually says.
    expect(await writer.readTicketQuantity()).toBe(500);
    expect(await ownership.hasPrize(PUBKEY, CAP_PRIZE.id)).toBe(false);
  });
});

describe('reads never fabricate an empty inventory', () => {
  it('returns null for the balance when the read fails', async () => {
    const { writer } = harness({ readError: new Error('relay down') });
    expect(await writer.readTicketQuantity()).toBeNull();
  });

  it('reports no ownership rather than a guess when the read fails', async () => {
    const { ownership } = harness({ readError: new Error('relay down') });
    expect(await ownership.hasPrize(PUBKEY, CAP_PRIZE.id)).toBe(false);
    expect(await ownership.listOwnedPrizes(PUBKEY)).toEqual([]);
  });

  it('refuses to confirm delivery on an unreadable inventory', async () => {
    const { ownership } = harness({ readError: new Error('relay down') });
    await expect(ownership.grantPrize(PUBKEY, CAP_PRIZE, 'r-1')).rejects.toThrow(
      /could not be read/i,
    );
  });
});

describe('the delivery adapter verifies, it does not write', () => {
  it('sees the prize the moment the spend event is accepted, with no relay round trip', async () => {
    // The relay keeps answering with the PREVIOUS event — the normal
    // propagation race. The confirmed event this tab published wins anyway.
    const { writer, ownership, published } = harness({
      events: [inventoryEvent([[TICKETS, 500]])],
    });
    await writer.spendTickets(redemption());

    expect(await ownership.hasPrize(PUBKEY, CAP_PRIZE.id)).toBe(true);
    expect(await writer.readTicketQuantity()).toBe(300);
    // grantPrize is pure verification: no second event is ever published.
    await expect(ownership.grantPrize(PUBKEY, CAP_PRIZE, 'r-1')).resolves.toBeUndefined();
    expect(published).toHaveLength(1);
  });

  it('answers hasDelivery from the prize, for ANY redemption id', async () => {
    const { writer, ownership } = harness({ events: [inventoryEvent([[TICKETS, 500]])] });
    await writer.spendTickets(redemption());
    // The grant rode on the spend's own event; kind:31633 records quantities,
    // not the operation that produced them, so presence is the whole proof.
    expect(await ownership.hasDelivery(PUBKEY, CAP_PRIZE.id, 'anything')).toBe(true);
  });

  it('throws rather than confirming when the prize is not there', async () => {
    const { ownership, published } = harness({ events: [inventoryEvent([[TICKETS, 500]])] });
    await expect(ownership.grantPrize(PUBKEY, CAP_PRIZE, 'r-1')).rejects.toThrow(
      /not in your inventory/i,
    );
    expect(published).toEqual([]);
  });

  it('refuses to deliver a prize it was not built for', async () => {
    const other = officialArcadePrizeAsRedeemable(
      OFFICIAL_ARCADE_PRIZE_CATALOG.find((p) => p.d === 'blobbi:effect:mystic-fog')!,
    );
    const { ownership } = harness({ events: [inventoryEvent([[TICKETS, 500]])] });
    await expect(ownership.grantPrize(PUBKEY, other, 'r-1')).rejects.toThrow();
    expect(await ownership.hasPrize(PUBKEY, other.id)).toBe(false);
  });

  it('declares itself atomic, which is what selects the stronger reconciliation', () => {
    const { ownership } = harness();
    expect(ownership.atomicWithSpend).toBe(true);
  });

  it('lists the owned prize once the inventory holds it', async () => {
    const { ownership } = harness({
      events: [inventoryEvent([[TICKETS, 10], [CAP_ADDRESS, 1]])],
    });
    expect(await ownership.listOwnedPrizes(PUBKEY)).toEqual([
      {
        prizeId: CAP_PRIZE.id,
        count: 1,
        firstGrantedAt: 0,
        deliveredRedemptionIds: [],
      },
    ]);
  });
});

describe('construction', () => {
  it('refuses a prize that does not deliver into the inventory', () => {
    const notAnItem: ArcadePrize = {
      ...CAP_PRIZE,
      delivery: { type: 'mock-ownership' },
    };
    expect(() =>
      createArcadeCosmeticRedeemer({
        nostr: { query: async () => [], event: async () => {} },
        user: { pubkey: PUBKEY } as never,
        prize: notAnItem,
      }),
    ).toThrow(/does not deliver into the inventory/);
  });

  it('exposes the canonical address it grants', () => {
    expect(inventoryPrizeAddress(CAP_PRIZE)).toBe(CAP_ADDRESS);
    expect(harness().itemAddress).toBe(CAP_ADDRESS);
  });
});
