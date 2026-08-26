/**
 * Tests for the multi-item batch purchase flow (`useBatchPurchase`).
 *
 * Since the Coin cutover a paid cart is ONE canonical wallet operation: the
 * total Coin deduction and every item grant land in the SAME kind:31633
 * replacement event (`spendCoins({ amount, grantLines })`). The old two-event
 * flow — and its documented "items granted but coins not charged" partial
 * failure — no longer exists.
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
import { clearSpendIntents } from '@/lib/coin-spend-intent';

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

describe('useBatchPurchase — one atomic wallet operation per cart', () => {
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
          { address: BLOCKS, quantity: 10, unitPrice: 40 }, // 400
          { address: APPLE, quantity: 2, unitPrice: 10 }, // 20
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
          { address: APPLE, quantity: 2, unitPrice: 10 },
          { address: APPLE, quantity: 3, unitPrice: 10 },
        ],
      });
    });
    const op = spendCoins.mock.calls[0][0];
    expect(op.grantLines).toEqual([{ address: APPLE, amount: 5 }]);
    expect(op.amount).toBe(50);
  });

  it('insufficient funds reject inside the wallet — nothing is granted', async () => {
    spendCoins.mockRejectedValue(
      Object.assign(new Error('Insufficient coins'), { reason: 'insufficient-funds' }),
    );
    const { result } = renderBatch();
    await act(async () => {
        await expect(
          result.current.mutateAsync({
          lines: [{ address: APPLE, quantity: 2, unitPrice: 10 }],
        }),
        ).rejects.toThrow('Insufficient coins');
      });
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('an ambiguous publish surfaces as an ambiguous cart outcome — no retry', async () => {
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 1, unitPrice: 10 }],
      });
    });
    expect(outcome).toMatchObject({ outcome: 'ambiguous' });
    expect(spendCoins).toHaveBeenCalledTimes(1);
  });

  it('re-confirming the SAME cart after an ambiguous outcome reuses the SAME opId', async () => {
    const cart = { lines: [{ address: APPLE, quantity: 1, unitPrice: 10 }] };
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
        lines: [{ address: APPLE, quantity: 1, unitPrice: 10 }],
      });
    });
    expect(outcome).toMatchObject({ outcome: 'blocked' });
  });

  it('a completed cart releases its identity: the same cart later is a new operation', async () => {
    const cart = { lines: [{ address: APPLE, quantity: 2, unitPrice: 10 }] };
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
            lines: [{ address: APPLE, quantity, unitPrice: 10 }],
          }),
        ).rejects.toThrow();
      });
    }
    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('a negative or fractional unit price rejects before any wallet call', async () => {
    const { result } = renderBatch();
    for (const unitPrice of [-5, 1.25]) {
      await act(async () => {
        await expect(
          result.current.mutateAsync({
            lines: [{ address: APPLE, quantity: 1, unitPrice }],
          }),
        ).rejects.toThrow();
      });
    }
    expect(spendCoins).not.toHaveBeenCalled();
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

  it('a zero-cost cart grants through the plain inventory mutation (no coin op)', async () => {
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: APPLE, quantity: 2, unitPrice: 0 }],
      });
    });
    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(inventoryMutate.mock.calls[0][0]).toMatchObject({ type: 'batch' });
    expect(outcome).toMatchObject({ totalCost: 0, outcome: 'applied' });
  });

  it('quantity overflow rejects before any wallet call', async () => {
    const { result } = renderBatch();
    await act(async () => {
        await expect(
          result.current.mutateAsync({
          lines: [
            { address: APPLE, quantity: Number.MAX_SAFE_INTEGER, unitPrice: 10 },
          ],
        }),
        ).rejects.toThrow();
      });
    expect(spendCoins).not.toHaveBeenCalled();
  });
});
