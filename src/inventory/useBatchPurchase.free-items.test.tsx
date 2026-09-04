/**
 * A CANONICALLY free cart still buys, without touching the Coin wallet.
 *
 * The shipped catalog has no free item (`validateCoinPrices` requires every
 * listed price to be a positive integer), so this branch is unreachable in
 * production today. It is tested against a stubbed catalog because the rule
 * that matters is a distinction, not a price: a canonical **0** skips the
 * wallet and grants through the shared inventory transaction, while an
 * **unpriced** item is rejected outright. Collapsing those two, treating
 * "unknown" as "free": would turn the shop into a free-grant API, which is
 * exactly what F-05 exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TEST_PUBKEY = 'd'.repeat(64);
const FREE_ADDRESS = `31632:${'a'.repeat(64)}:blobbi:promo:free-sample`;
const UNPRICED_ADDRESS = `31632:${'a'.repeat(64)}:blobbi:promo:not-listed`;

const inventoryMutate = vi.fn();
const spendCoins = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY } }),
}));

vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return { ...actual, useInventoryMutation: () => ({ mutateAsync: inventoryMutate }) };
});

vi.mock('./useCoinWallet', () => ({
  useCoinWallet: () => ({ spendCoins, grantCoins: vi.fn(), wallet: null }),
}));

// A catalog with exactly one free item and nothing else listed.
vi.mock('./shop-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shop-catalog')>();
  return {
    ...actual,
    priceForAddress: (address: string) => (address === FREE_ADDRESS ? 0 : null),
  };
});

import { useBatchPurchase } from './useBatchPurchase';
import { clearSpendIntents, openSpendIntentsFor } from '@/lib/coin-spend-intent';

function renderBatch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useBatchPurchase(), { wrapper });
}

beforeEach(() => {
  inventoryMutate.mockReset();
  spendCoins.mockReset();
  inventoryMutate.mockResolvedValue(undefined);
  clearSpendIntents();
});

describe('a canonically free cart', () => {
  it('grants through the shared inventory transaction and moves no Coins', async () => {
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: FREE_ADDRESS, quantity: 2 }],
      });
    });

    expect(spendCoins).not.toHaveBeenCalled();
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(inventoryMutate.mock.calls[0][0]).toMatchObject({
      type: 'batch',
      lines: [{ address: FREE_ADDRESS, amount: 2 }],
    });
    expect(outcome).toMatchObject({
      totalCost: 0,
      outcome: 'applied',
      lines: [{ address: FREE_ADDRESS, quantity: 2, unitPrice: 0, lineCost: 0 }],
    });
    // No coin movement means no spend intent to track.
    expect(openSpendIntentsFor(TEST_PUBKEY, 'shop-purchase')).toEqual([]);
  });

  it('reports an unconfirmed free grant as ambiguous, never as success', async () => {
    // F-03 semantics survive the free path: a timeout is not a purchase.
    const { InventoryTransactionError } = await import('./inventory-transaction');
    inventoryMutate.mockRejectedValue(
      new InventoryTransactionError('timed out', 'publish-timeout'),
    );
    const { result } = renderBatch();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        lines: [{ address: FREE_ADDRESS, quantity: 1 }],
      });
    });
    expect(outcome).toMatchObject({ outcome: 'ambiguous' });
  });

  it('an UNPRICED item is not free; it is rejected before any grant', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await expect(
        result.current.mutateAsync({ lines: [{ address: UNPRICED_ADDRESS, quantity: 1 }] }),
      ).rejects.toThrow(/not for sale/i);
    });
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(spendCoins).not.toHaveBeenCalled();
  });
});
