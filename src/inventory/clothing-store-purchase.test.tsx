/**
 * Buying clothing, end to end, against the REAL machinery.
 *
 * The Clothing Store's shelf ships EMPTY; no official wearable has a Coin price
 * yet (see `WEARABLE_COIN_PRICES`). That is a data decision, and it must not
 * leave the purchase path unproven: everything downstream of a price is built,
 * and everything downstream of a price is exercised here by stocking the shelf
 * with a fixture price and running the real pipeline over it.
 *
 * Only two things are doubles: the relay socket, and the price table. The
 * normalization, the pricing boundary, the stack precondition, the wallet's
 * in-lock authoritative read and the canonical inventory builder are all real,
 * so what lands in the fake relay is the exact kind:31633 event production would
 * publish.
 *
 * The claims:
 *
 *   - the Coin debit and the wearable grant are ONE event;
 *   - a wearable is UNIQUE, buying an owned one charges nothing, and the guard
 *     that says so lives in the mutation layer, not in a button;
 *   - unrelated holdings, Arcade Tickets included, are untouched;
 *   - buying does not equip: only kind:31633 is written, never kind:31634.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { clearCoinOps } from '@/lib/coin-op-ledger';
import { clearSpendIntents } from '@/lib/coin-spend-intent';
import { officialCosmeticByD } from '@/protocol/event-registry';

import { createCoinWallet, type CoinWalletNostr } from './coin-wallet';
import { BLOBBI_COIN_ADDRESS } from './coin';
import { ARCADE_TICKET_ADDRESS } from './arcade-reward-writer';
import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';
import { ISLAND_ALLOCATION_MARKER } from './economy-entry';
import { KIND_GAME_INVENTORY } from './package';

const PUBKEY = 'd'.repeat(64);

/** A real official wearable, priced for this test and nowhere else. */
const GLASSES = officialCosmeticByD('blobbi:cosmetic:stargazer-glasses')!;
const CAP = officialCosmeticByD('blobbi:cosmetic:block-builder-cap')!;
const GLASSES_PRICE = 250;

/**
 * The price table, stocked.
 *
 * Only `priceForAddress` and `stackLimitForAddress` are replaced; everything
 * else in the module (the consumable table, both validators) stays real, so a
 * consumable still prices exactly as it does in production and the wearable
 * ceiling still comes from the published `max_stack`.
 */
vi.mock('./shop-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shop-catalog')>();
  return {
    ...actual,
    priceForAddress: (address: string) =>
      address === GLASSES.address ? GLASSES_PRICE : actual.priceForAddress(address),
    stackLimitForAddress: (address: string) =>
      address === GLASSES.address
        ? GLASSES.maxStack
        : actual.stackLimitForAddress(address),
  };
});

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
          signEvent: vi.fn(async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
            ...t,
            id: `signed-${t.created_at}`,
            pubkey: PUBKEY,
            sig: 'sig',
          })),
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

/** What one Clothing Store Buy click hands the purchase layer. */
async function buy(address: string) {
  const { result } = renderHook(() => useBatchPurchase(), { wrapper });
  let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
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
  inventoryMutate.mockReset();
});
afterEach(() => {
  clearCoinOps();
  clearSpendIntents();
  vi.restoreAllMocks();
});

describe('a clothing purchase is one atomic inventory write', () => {
  it('debits the exact price and grants the wearable, in the SAME event', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 400 }], 1_000),
    );

    const { outcome } = await buy(GLASSES.address);
    expect(outcome).toMatchObject({ outcome: 'applied', totalCost: GLASSES_PRICE });

    expect(relay.published).toHaveLength(1);
    const written = relay.published[0];
    expect(heldIn(written, BLOBBI_COIN_ADDRESS)).toBe(400 - GLASSES_PRICE);
    expect(heldIn(written, GLASSES.address)).toBe(1);
  });

  it('writes ONLY the inventory kind, buying is not wearing', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 400 }], 1_000),
    );
    await buy(GLASSES.address);

    // Ownership is kind:31633 and equipment is kind:31634. A purchase touches
    // exactly the first. (That an owned cosmetic is then equippable through the
    // ordinary wardrobe is proven, once, in `arcade-prize-equipment.test.tsx`,
    // it asks only "does kind:31633 hold this?", so it cannot care how the item
    // got there.)
    expect(relay.published.map((e) => e.kind)).toEqual([KIND_GAME_INVENTORY]);
  });

  it('preserves everything else the player owns', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 600 },
          { address: ARCADE_TICKET_ADDRESS, amount: 320 },
          { address: CAP.address, amount: 1 },
        ],
        1_000,
      ),
    );

    await buy(GLASSES.address);
    const stored = relay.getStored();

    expect(heldIn(stored, GLASSES.address)).toBe(1);
    expect(heldIn(stored, CAP.address)).toBe(1);
    expect(heldIn(stored, ARCADE_TICKET_ADDRESS)).toBe(320);
    expect(heldIn(stored, BLOBBI_COIN_ADDRESS)).toBe(600 - GLASSES_PRICE);
  });

  it('never spends an Arcade currency: Coins, and only Coins', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 400 },
          { address: ARCADE_TICKET_ADDRESS, amount: 900 },
        ],
        1_000,
      ),
    );
    await buy(GLASSES.address);
    expect(heldIn(relay.getStored(), ARCADE_TICKET_ADDRESS)).toBe(900);
  });

  it('is refused, with no write at all, when the Coins are not there', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 100 }], 1_000),
    );

    const { outcome, error } = await buy(GLASSES.address); // costs 250

    expect(outcome).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(relay.published).toHaveLength(0);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(100);
    expect(heldIn(relay.getStored(), GLASSES.address)).toBe(0);
  });
});

describe('a wearable is unique, and the mutation layer is what enforces it', () => {
  it('an already-owned wearable cannot be bought again, and costs nothing to try', async () => {
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 900 },
          { address: GLASSES.address, amount: 1 },
        ],
        1_000,
      ),
    );

    const { outcome } = await buy(GLASSES.address);

    expect(outcome).toMatchObject({ outcome: 'stock-limit' });
    // Refused inside the wallet's lock, on the fresh authoritative base: no
    // publish at all, so no charge and no second copy.
    expect(relay.published).toHaveLength(0);
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(900);
    expect(heldIn(relay.getStored(), GLASSES.address)).toBe(1);
  });

  it('the refusal does not depend on the UI having noticed', async () => {
    // Buy it, then buy it again through a hook that never re-rendered, the
    // shape of a stale card, a second tab, or a lagging cache.
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 900 }], 1_000),
    );

    await buy(GLASSES.address);
    expect(heldIn(relay.getStored(), GLASSES.address)).toBe(1);
    const afterFirst = heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS);

    const { outcome } = await buy(GLASSES.address);

    expect(outcome).toMatchObject({ outcome: 'stock-limit' });
    expect(relay.published).toHaveLength(1); // still just the first purchase
    expect(heldIn(relay.getStored(), BLOBBI_COIN_ADDRESS)).toBe(afterFirst);
    expect(heldIn(relay.getStored(), GLASSES.address)).toBe(1);
  });

  it('a consumable is unaffected; no ceiling, so it still stacks', async () => {
    const { itemIdToAddress } = await import('./registry');
    const apple = itemIdToAddress('food_apple')!;
    relay = makeRelay(
      realInventoryEvent(
        [
          { address: BLOBBI_COIN_ADDRESS, amount: 500 },
          { address: apple, amount: 7 },
        ],
        1_000,
      ),
    );

    await buy(apple);
    expect(heldIn(relay.getStored(), apple)).toBe(8);
  });
});

describe('the shop cannot buy what is not for sale', () => {
  it('refuses a wearable that carries no price', async () => {
    relay = makeRelay(
      realInventoryEvent([{ address: BLOBBI_COIN_ADDRESS, amount: 900 }], 1_000),
    );

    // The cap is a real official cosmetic, and an Arcade prize. Without a Coin
    // price it is not for sale, and the pricing boundary says so before any
    // spend intent, ledger record or wallet call exists.
    const { error } = await buy(CAP.address);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/not for sale/i);
    expect(relay.published).toHaveLength(0);
  });
});
