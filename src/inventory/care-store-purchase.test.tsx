/**
 * Buying from the Care Store, end to end, against the REAL machinery.
 *
 * Nothing about the money is faked here except the relay. The purchase runs
 * through the real `useBatchPurchase` (its normalization and its pricing
 * boundary), the real `createCoinWallet` (its fresh authoritative read, its
 * balance check and its operation ledger), and the real canonical inventory
 * builder — so what lands in the fake relay is the exact kind:31633 event
 * production would publish.
 *
 * That matters because the guarantees under test are not arithmetic, they are
 * about the SHAPE of the write:
 *
 *   - the Coin debit and the item grant are ONE event, not two;
 *   - everything the player already owned is still in it;
 *   - the Arcade Ticket is not touched, in either direction;
 *   - an unaffordable purchase writes nothing at all.
 *
 * A test that asserted on a mocked `spendCoins` call would pass through every
 * one of those failures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { clearCoinOps } from '@/lib/coin-op-ledger';
import { clearSpendIntents } from '@/lib/coin-spend-intent';

import { createCoinWallet, type CoinWalletNostr } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { ISLAND_ALLOCATION_MARKER } from './economy-entry';
import { CARE_STORE_PRODUCTS } from './care-store-catalog';

const PUBKEY = 'b'.repeat(64);

const SOAP = CARE_STORE_PRODUCTS.find((p) => p.d === 'blobbi:hygiene:soap')!; // 15
const ELIXIR = CARE_STORE_PRODUCTS.find(
  (p) => p.d === 'blobbi:medicine:health-elixir',
)!; // 150
const TEDDY = CARE_STORE_PRODUCTS.find((p) => p.d === 'blobbi:toy:teddy')!; // 60

/** A REAL canonical inventory event, exactly as production publishes one. */
function realInventoryEvent(
  entries: readonly { address: string; amount: number }[],
  createdAt: number,
): NostrEvent {
  let inventory = buildEmptyInventory(PUBKEY);
  for (const entry of entries) {
    inventory = applyMutation(inventory, {
      type: 'add',
      address: entry.address,
      amount: entry.amount,
    });
  }
  const template = buildInventoryTemplate(inventory, {
    extraTags: [ISLAND_ALLOCATION_MARKER],
  });
  return {
    ...template,
    content: template.content ?? '',
    id: `evt-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    sig: 'sig',
  } as NostrEvent;
}

function makeRelay(initial: NostrEvent | null) {
  let stored = initial;
  const published: NostrEvent[] = [];
  const nostr: CoinWalletNostr = {
    query: async () => (stored ? [stored] : []),
    event: async (event) => {
      published.push(event);
      if (!stored || event.created_at >= stored.created_at) stored = event;
    },
  };
  return { nostr, published, getStored: () => stored };
}

let relay: ReturnType<typeof makeRelay>;

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

/*
  `useBatchPurchase` also holds a generic inventory mutation, for the zero-cost
  cart branch that the shipped price table makes unreachable. Only the HOOK is
  replaced — every pure helper in the module (the canonical builder, the
  quantity reader, `applyMutation`) stays real, because the assertions below are
  made against events those helpers produce.
*/
const inventoryMutate = vi.fn();
vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return { ...actual, useInventoryMutation: () => ({ mutateAsync: inventoryMutate }) };
});

// The REAL wallet, bound to the fake relay above. Only the socket is a double.
vi.mock('./useCoinWallet', () => ({
  useCoinWallet: () => {
    const wallet = createCoinWallet({
      nostr: relay.nostr,
      user: {
        pubkey: PUBKEY,
        signer: {
          signEvent: vi.fn(
            async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
              ...t,
              id: `signed-${t.created_at}`,
              pubkey: PUBKEY,
              sig: 'sig',
            }),
          ),
        },
      } as never,
      now: () => 1_700_000_000_000,
    });
    return { wallet, spendCoins: wallet.spendCoins, grantCoins: wallet.grantCoins };
  },
}));

import { useBatchPurchase } from './useBatchPurchase';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** What one Care Store Buy click hands the purchase layer. */
async function buy(address: string) {
  const { result } = renderHook(() => useBatchPurchase(), { wrapper });
  let outcome;
  let error: unknown = null;
  await act(async () => {
    try {
      outcome = await result.current.mutateAsync({ lines: [{ address, quantity: 1 }] });
    } catch (err) {
      error = err;
    }
  });
  return { outcome, error };
}

function heldIn(event: NostrEvent | null, address: string): number {
  if (!event) return -1;
  const parsed = parseInventoryEvent(event);
  return parsed ? getQuantity(parsed, address) : -1;
}

beforeEach(() => {
  clearCoinOps();
  clearSpendIntents();
});
afterEach(() => {
  clearCoinOps();
  clearSpendIntents();
  vi.restoreAllMocks();
});

describe('a Care Store purchase is one atomic inventory write', () => {
  it('debits the exact price and grants the exact item, in the SAME event', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 200 }], 1_000),
    );

    const { outcome } = await buy(SOAP.address);
    expect(outcome).toMatchObject({ outcome: 'applied', totalCost: SOAP.price });

    // ONE publish, carrying both halves.
    expect(relay.published).toHaveLength(1);
    const written = relay.published[0];
    expect(heldIn(written, BLOBBI_COIN_ADDRESS)).toBe(200 - SOAP.price);
    expect(heldIn(written, SOAP.address)).toBe(1);
  });

  it('charges the canonical price, not one the caller supplies', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 1_000 }], 1_000),
    );
    await buy(ELIXIR.address);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(1_000 - ELIXIR.price);
  });

  it('buys a toy exactly the same way', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 300 }], 1_000),
    );

    const { outcome } = await buy(TEDDY.address);

    expect(outcome).toMatchObject({ outcome: 'applied', totalCost: TEDDY.price });
    expect(relay.published).toHaveLength(1);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(300 - TEDDY.price);
    expect(heldIn(relay.getStored(), TEDDY.address)).toBe(1);
  });

  it('preserves everything else the player owns', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 500 },
          { address: ARCADE_TICKET_ADDRESS, amount: 42 },
          { address: ELIXIR.address, amount: 3 },
        ],
        1_000,
      ),
    );

    await buy(TEDDY.address);
    const stored = relay.getStored();

    expect(heldIn(stored, ELIXIR.address)).toBe(3);
    expect(heldIn(stored, ARCADE_TICKET_ADDRESS)).toBe(42);
    expect(heldIn(stored, TEDDY.address)).toBe(1);
    expect(heldIn(stored, BLOBBI_COIN_ADDRESS)).toBe(500 - TEDDY.price);
  });

  it('never spends an Arcade currency — Coins, and only Coins', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 500 },
          { address: ARCADE_TICKET_ADDRESS, amount: 7 },
        ],
        1_000,
      ),
    );

    await buy(SOAP.address);

    // The ticket count is untouched in BOTH directions.
    expect(heldIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(7);
  });

  it('is refused, with no write at all, when the Coins are not there', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 5 }], 1_000),
    );

    const { outcome, error } = await buy(SOAP.address); // costs 15

    expect(outcome).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(relay.published).toHaveLength(0);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(5);
    expect(heldIn(relay.getStored(), SOAP.address)).toBe(0);
  });

  it('cannot drive a balance negative', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 15 }], 1_000),
    );
    await buy(SOAP.address);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(0);

    // The next one has nothing to spend.
    const { error } = await buy(SOAP.address);
    expect(error).toBeInstanceOf(Error);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(0);
  });
});

describe('stacking follows the published definition', () => {
  it('repeated purchases of a stackable item accumulate', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 500 }], 1_000),
    );

    await buy(TEDDY.address);
    await buy(TEDDY.address);
    await buy(TEDDY.address);

    expect(heldIn(relay.getStored(), TEDDY.address)).toBe(3);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(500 - TEDDY.price * 3);
  });

  it('every Care Store product is stackable today, so none has a ceiling to hit', () => {
    // The shop's cap comes from the definition, never from a guess. When one of
    // these publishes a real `max_stack`, `careStoreStackLimit` reports it and
    // the shop's `at-limit` state starts firing without a UI change.
    expect(CARE_STORE_PRODUCTS.every((p) => p.stackLimit === null)).toBe(true);
  });

  it('adds to a stack the player already had', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 500 },
          { address: SOAP.address, amount: 9 },
        ],
        1_000,
      ),
    );

    await buy(SOAP.address);
    expect(heldIn(relay.getStored(), SOAP.address)).toBe(10);
  });
});

describe('the shop cannot buy what is not for sale', () => {
  it('refuses the Arcade Ticket even though it is an official item', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 500 }], 1_000),
    );

    const { error } = await buy(ARCADE_TICKET_ADDRESS);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/not for sale/i);
    expect(relay.published).toHaveLength(0);
  });

  it('refuses an address that is not an item at all', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 500 }], 1_000),
    );

    const { error } = await buy('31632:someone-else:blobbi:hygiene:soap');

    expect(error).toBeInstanceOf(Error);
    expect(relay.published).toHaveLength(0);
  });
});
