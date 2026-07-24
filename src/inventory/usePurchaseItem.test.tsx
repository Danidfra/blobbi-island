/**
 * Partial-failure tests for the two-event purchase flow (Q7 of the audit).
 *
 * A purchase is: (1) grant item to kind:31633, then (2) deduct coins in
 * kind:11125. These are independent events and NOT atomic. We assert:
 *  - both-succeed → coinsCharged true;
 *  - step 1 (grant) fails → the whole purchase rejects and coins are NOT touched;
 *  - step 1 succeeds but step 2 (coins) fails → item stays granted, a WARNING is
 *    returned (favor-the-user), and the purchase does not throw;
 *  - insufficient coins → rejects before granting anything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TEST_PUBKEY = 'd'.repeat(64);

const inventoryMutate = vi.fn();
const coinsMutate = vi.fn();

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

vi.mock('./useCoinsMutation', () => ({
  useCoinsMutation: () => ({ mutateAsync: coinsMutate }),
}));

import { usePurchaseItem } from './usePurchaseItem';
import { itemIdToAddress } from './registry';

const APPLE = itemIdToAddress('food_apple')!; // price 10

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function renderPurchase() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => usePurchaseItem(), { wrapper: makeWrapper(client) });
}

describe('usePurchaseItem partial failures', () => {
  beforeEach(() => {
    inventoryMutate.mockReset();
    coinsMutate.mockReset();
  });

  it('both events succeed → coinsCharged true', async () => {
    inventoryMutate.mockResolvedValue(undefined);
    coinsMutate.mockResolvedValue({ previousCoins: 100, newCoins: 90 });

    const { result } = renderPurchase();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ address: APPLE, units: 1, currentCoins: 100 });
    });

    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).toHaveBeenCalledWith(-10);
    expect(res!.coinsCharged).toBe(true);
    expect(res!.warning).toBeUndefined();
  });

  it('grant (step 1) failure rejects the purchase and does NOT deduct coins', async () => {
    inventoryMutate.mockRejectedValue(new Error('relay down'));

    const { result } = renderPurchase();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ address: APPLE, units: 1, currentCoins: 100 });
      } catch (e) {
        error = e as Error;
      }
    });

    expect(error?.message).toMatch(/relay down/);
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).not.toHaveBeenCalled();
  });

  it('coins (step 2) failure keeps the item and returns a warning (no throw)', async () => {
    inventoryMutate.mockResolvedValue(undefined);
    coinsMutate.mockRejectedValue(new Error('sign failed'));

    const { result } = renderPurchase();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ address: APPLE, units: 1, currentCoins: 100 });
    });

    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).toHaveBeenCalledTimes(1);
    expect(res!.coinsCharged).toBe(false);
    expect(res!.warning).toMatch(/coins were not charged/i);
  });

  it('insufficient coins rejects before granting anything', async () => {
    const { result } = renderPurchase();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ address: APPLE, units: 5, currentCoins: 10 });
      } catch (e) {
        error = e as Error;
      }
    });

    expect(error?.message).toMatch(/Insufficient coins/);
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(coinsMutate).not.toHaveBeenCalled();
  });
});
