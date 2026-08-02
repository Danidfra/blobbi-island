/**
 * Tests for the single-item purchase flow (`usePurchaseItem`).
 *
 * Since the Coin cutover a paid purchase is ONE canonical wallet operation
 * (coin deduction + item grant in the same kind:31633 event), so the old
 * two-event partial-failure matrix no longer exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TEST_PUBKEY = 'd'.repeat(64);

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

import { usePurchaseItem } from './usePurchaseItem';
import { itemIdToAddress } from './registry';

const APPLE = itemIdToAddress('food_apple')!; // priced 10 in the shop catalog

function renderPurchase() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePurchaseItem(), { wrapper });
}

describe('usePurchaseItem — one atomic wallet operation', () => {
  beforeEach(() => {
    inventoryMutate.mockReset();
    spendCoins.mockReset();
    spendCoins.mockResolvedValue({ status: 'applied', balance: 90, verified: true });
  });

  it('spends the catalog price and grants the units in one operation', async () => {
    const { result } = renderPurchase();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({ address: APPLE, units: 3 });
    });
    expect(spendCoins).toHaveBeenCalledTimes(1);
    const op = spendCoins.mock.calls[0][0];
    expect(op.amount).toBe(30);
    expect(op.grantLines).toEqual([{ address: APPLE, amount: 3 }]);
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ totalCost: 30, outcome: 'applied' });
  });

  it('rejects non-positive/non-integer units before any wallet call', async () => {
    const { result } = renderPurchase();
    for (const units of [0, -2, 1.5]) {
      await act(async () => {
        await expect(
          result.current.mutateAsync({ address: APPLE, units }),
        ).rejects.toThrow(/positive integer/);
      });
    }
    expect(spendCoins).not.toHaveBeenCalled();
  });

  it('rejects an item that is not for sale', async () => {
    const { result } = renderPurchase();
    await act(async () => {
        await expect(
          result.current.mutateAsync({
          address: `31632:${'a'.repeat(64)}:blobbi:food:mystery`,
          units: 1,
        }),
        ).rejects.toThrow(/not for sale/);
      });
    expect(spendCoins).not.toHaveBeenCalled();
  });

  it('surfaces an ambiguous publish as an ambiguous outcome', async () => {
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderPurchase();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({ address: APPLE, units: 1 });
    });
    expect(outcome).toMatchObject({ outcome: 'ambiguous' });
  });

  it('propagates an insufficient-funds rejection from the wallet', async () => {
    spendCoins.mockRejectedValue(new Error('Insufficient coins'));
    const { result } = renderPurchase();
    await act(async () => {
        await expect(
          result.current.mutateAsync({ address: APPLE, units: 1 }),
        ).rejects.toThrow('Insufficient coins');
      });
  });
});
