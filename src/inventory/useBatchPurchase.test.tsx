/**
 * Tests for the multi-item batch purchase flow (`useBatchPurchase`).
 *
 * Since the Coin cutover a paid cart is ONE canonical wallet operation: the
 * total Coin deduction and every item grant land in the SAME kind:31633
 * replacement event (`spendCoins({ amount, grantLines })`). The old two-event
 * flow: and its documented "items granted but coins not charged" partial
 * failure: no longer exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TEST_PUBKEY = 'c'.repeat(64);

// ─── Shared mocks ──────────────────────────────────────────────────────────
const inventoryMutate = vi.fn();
const spendCoins = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY } }),
}));

vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return {
    ...actual,
    useInventoryMutation: () => ({ mutateAsync: inventoryMutate }),
  };
});

vi.mock('./useCoinWallet', () => ({
  useCoinWallet: () => ({ spendCoins, grantCoins: vi.fn(), wallet: null }),
}));

import { useBatchPurchase } from './useBatchPurchase';
import { itemIdToAddress } from './registry';
import { clearSpendIntents, openSpendIntentsFor } from '@/lib/coin-spend-intent';

const APPLE = itemIdToAddress('food_apple')!; // 10
const BLOCKS = itemIdToAddress('toy_blocks')!; // 40

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderBatch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useBatchPurchase(), { wrapper: makeWrapper(client) });
}

describe('useBatchPurchase: one atomic wallet operation per cart', () => {
  beforeEach(() => {
    inventoryMutate.mockReset();
    spendCoins.mockReset();
    inventoryMutate.mockResolvedValue(undefined);
    spendCoins.mockResolvedValue({ status: 'applied', balance: 900, verified: true });
    clearSpendIntents();
  });

  it('a paid cart is ONE wallet spend carrying the total and every grant line', async () => {
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [
          { address: BLOCKS, quantity: 10 }, // 10 x 40 = 400
          { address: APPLE, quantity: 2 }, //  2 x 10 =  20
        ],
      });
    });

    expect(spendCoins).toHaveBeenCalledTimes(1);
    const op = spendCoins.mock.calls[0][0];
    expect(op.amount).toBe(420);
    expect(op.label).toBe('shop-purchase');
    expect(op.opId).toMatch(/^shop-purchase:/);
    expect(op.grantLines).toEqual([
      { address: BLOCKS, amount: 10 },
      { address: APPLE, amount: 2 },
    ]);
    // The generic inventory mutation is NOT used for a paid cart.
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ totalCost: 420, outcome: 'applied' });
  });

  it('duplicate input lines are merged into one grant line', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [
          { address: APPLE, quantity: 2 },
          { address: APPLE, quantity: 3 },
        ],
      });
    });
    const op = spendCoins.mock.calls[0][0];
    expect(op.grantLines).toEqual([{ address: APPLE, amount: 5 }]);
    expect(op.amount).toBe(50);
  });

  it('insufficient funds reject inside the wallet; nothing is granted', async () => {
    spendCoins.mockRejectedValue(
      Object.assign(new Error('Insufficient coins'), { reason: 'insufficient-funds' }),
    );
    const { result } = renderBatch();
    await act(async () => {
        await expect(
          result.current.mutateAsync({
          lines: [{ address: APPLE, quantity: 2 }],
        }),
        ).rejects.toThrow('Insufficient coins');
      });
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('an ambiguous publish surfaces as an ambiguous cart outcome; no retry', async () => {
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 1 }],
      });
    });
    expect(outcome).toMatchObject({ outcome: 'ambiguous' });
    expect(spendCoins).toHaveBeenCalledTimes(1);
  });

  it('re-confirming the SAME cart after an ambiguous outcome reuses the SAME opId', async () => {
    const cart = { lines: [{ address: APPLE, quantity: 1 }] };
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync(cart);
    });
    spendCoins.mockResolvedValue({ status: 'already-applied' });
    let retried;
    await act(async () => {
      retried = await result.current.mutateAsync(cart);
    });

    expect(spendCoins).toHaveBeenCalledTimes(2);
    expect(spendCoins.mock.calls[1][0].opId).toBe(spendCoins.mock.calls[0][0].opId);
    expect(retried).toMatchObject({ outcome: 'applied' });
  });

  it('a still-unresolved previous attempt surfaces as blocked', async () => {
    spendCoins.mockResolvedValue({ status: 'blocked', blockedBy: 'ambiguous' });
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 1 }],
      });
    });
    expect(outcome).toMatchObject({ outcome: 'blocked' });
  });

  it('a completed cart releases its identity: the same cart later is a new operation', async () => {
    const cart = { lines: [{ address: APPLE, quantity: 2 }] };
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync(cart);
    });
    await act(async () => {
      await result.current.mutateAsync(cart);
    });
    expect(spendCoins).toHaveBeenCalledTimes(2);
    expect(spendCoins.mock.calls[1][0].opId).not.toBe(spendCoins.mock.calls[0][0].opId);
  });

  it('invalid line quantities reject before any wallet call', async () => {
    const { result } = renderBatch();
    for (const quantity of [0, -1, 2.5]) {
      await act(async () => {
        await expect(
          result.current.mutateAsync({
            lines: [{ address: APPLE, quantity }],
          }),
        ).rejects.toThrow();
      });
    }
    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('an empty address rejects before any wallet call', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await expect(
        result.current.mutateAsync({ lines: [{ address: '', quantity: 1 }] }),
      ).rejects.toThrow(/missing an item address/i);
    });
    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('an empty cart rejects', async () => {
    const { result } = renderBatch();
    await act(async () => {
        await expect(
          result.current.mutateAsync({ lines: [] }),
        ).rejects.toThrow(
      /empty cart/i,
    );
      });
  });

  it('quantity overflow rejects before any wallet call', async () => {
    const { result } = renderBatch();
    await act(async () => {
        await expect(
          result.current.mutateAsync({
          lines: [
            { address: APPLE, quantity: Number.MAX_SAFE_INTEGER },
          ],
        }),
        ).rejects.toThrow();
      });
    expect(spendCoins).not.toHaveBeenCalled();
  });
});

/**
 * F-05: the price charged is a fact about the ITEM, resolved inside the hook.
 * The hook used to charge whatever `unitPrice` the caller handed it; the shop
 * passed canonical values so nothing was ever mispriced in production, but a
 * presentation-layer number must never be able to move real money, nor, since
 * the spend intent keys on the total, the identity that makes a retry
 * idempotent.
 */
describe('prices come from the catalog, never from the caller', () => {
  beforeEach(() => {
    inventoryMutate.mockReset();
    spendCoins.mockReset();
    inventoryMutate.mockResolvedValue(undefined);
    spendCoins.mockResolvedValue({ status: 'applied', balance: 900, verified: true });
    clearSpendIntents();
  });

  it('charges the canonical price for a single item', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({ lines: [{ address: APPLE, quantity: 3 }] });
    });
    // The apple's catalog price is 10.
    expect(spendCoins.mock.calls[0][0].amount).toBe(30);
  });

  it('charges canonical prices across a mixed cart', async () => {
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [
          { address: APPLE, quantity: 4 }, // 4 x 10
          { address: BLOCKS, quantity: 1 }, // 1 x 40
        ],
      });
    });
    expect(spendCoins.mock.calls[0][0].amount).toBe(80);
    expect(outcome).toMatchObject({
      totalCost: 80,
      lines: [
        { address: APPLE, quantity: 4, unitPrice: 10, lineCost: 40 },
        { address: BLOCKS, quantity: 1, unitPrice: 40, lineCost: 40 },
      ],
    });
  });

  it('a caller trying to UNDERCHARGE is ignored, the canonical price is used', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        // The old defect: 1 coin per apple instead of 10.
        lines: [{ address: APPLE, quantity: 5, unitPrice: 1 }] as never,
      });
    });
    expect(spendCoins.mock.calls[0][0].amount).toBe(50);
  });

  it('a caller trying to OVERCHARGE is ignored, the canonical price is used', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 5, unitPrice: 9_999 }] as never,
      });
    });
    expect(spendCoins.mock.calls[0][0].amount).toBe(50);
  });

  it('a fake price cannot change the spend-intent identity', async () => {
    // The same basket priced two different ways by the caller is still ONE
    // logical purchase, so the second confirm reconciles the first operation.
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({ lines: [{ address: APPLE, quantity: 2 }] });
    });
    await act(async () => {
      await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 2, unitPrice: 1 }] as never,
      });
    });
    expect(spendCoins).toHaveBeenCalledTimes(2);
    expect(spendCoins.mock.calls[1][0].opId).toBe(spendCoins.mock.calls[0][0].opId);
    expect(spendCoins.mock.calls[1][0].amount).toBe(20);
  });

  it('an unlisted item is rejected before ANY wallet, grant or intent work', async () => {
    const { result } = renderBatch();
    // A structurally valid, officially-issued address that the shop does not
    // sell: the Arcade Ticket is earned, never bought.
    const TICKET = itemIdToAddress('cur_arcade_ticket')!;
    await act(async () => {
      await expect(
        result.current.mutateAsync({ lines: [{ address: TICKET, quantity: 1 }] }),
      ).rejects.toThrow(/not for sale/i);
    });

    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
    // No durable trace: an invalid cart never opens a spend intent.
    expect(openSpendIntentsFor(TEST_PUBKEY, 'shop-purchase')).toEqual([]);
  });

  it('an unknown address is rejected, and is never treated as free', async () => {
    const { result } = renderBatch();
    const UNKNOWN = `31632:${'9'.repeat(64)}:blobbi:food:not-a-real-item`;
    await act(async () => {
      await expect(
        result.current.mutateAsync({ lines: [{ address: UNKNOWN, quantity: 1 }] }),
      ).rejects.toThrow(/not for sale/i);
    });
    // The dangerous failure mode would be "unknown price ⇒ 0 ⇒ free grant".
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(spendCoins).not.toHaveBeenCalled();
    expect(openSpendIntentsFor(TEST_PUBKEY, 'shop-purchase')).toEqual([]);
  });

  it('one unlisted line poisons the whole cart; nothing is bought', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          lines: [
            { address: APPLE, quantity: 1 },
            { address: 'not-an-address', quantity: 1 },
          ],
        }),
      ).rejects.toThrow(/not for sale/i);
    });
    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });
});
