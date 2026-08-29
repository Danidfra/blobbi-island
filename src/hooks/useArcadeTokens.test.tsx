/**
 * Buying Arcade Tokens with Blobbi Coins.
 *
 * A Token purchase is a shop purchase in every respect that matters, so it
 * reuses the shop's machinery rather than growing its own: one canonical
 * kind:31633 event carrying both sides, a durable spend intent for retry
 * identity, and the wallet's fresh authoritative balance read. These pin that
 * it really does behave that way — including that a failed or unconfirmed
 * purchase never looks like a successful one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const PUBKEY = 'e'.repeat(64);

const spendCoins = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));
vi.mock('@/inventory/useCoinWallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory/useCoinWallet')>();
  return { ...actual, useCoinWallet: () => ({ spendCoins, grantCoins: vi.fn(), wallet: null }) };
});

import { clearSpendIntents, openSpendIntentsFor } from '@/lib/coin-spend-intent';
import { ARCADE_TOKEN_ADDRESS } from '@/arcade/tokens/arcade-token';
import { ARCADE_TOKEN_COIN_PRICE } from '@/arcade/tokens/token-store';
import { useBuyArcadeTokens } from './useArcadeTokens';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

function renderBuy() {
  return renderHook(() => useBuyArcadeTokens(), { wrapper });
}

beforeEach(() => {
  spendCoins.mockReset();
  spendCoins.mockResolvedValue({ status: 'applied', balance: 0, verified: true });
  clearSpendIntents();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe('a Token purchase is one atomic operation', () => {
  it('spends Coins and grants Tokens in the SAME event', async () => {
    const { result } = renderBuy();
    await act(async () => {
      await result.current.mutateAsync({ quantity: 5 });
    });

    expect(spendCoins).toHaveBeenCalledTimes(1);
    const op = spendCoins.mock.calls[0][0];
    expect(op.amount).toBe(5 * ARCADE_TOKEN_COIN_PRICE);
    // One operation carrying both halves — never a spend then a separate grant.
    expect(op.grantLines).toEqual([{ address: ARCADE_TOKEN_ADDRESS, amount: 5 }]);
    expect(op.label).toBe('arcade-token');
  });

  it('prices from policy, not from the caller', async () => {
    const { result } = renderBuy();
    await act(async () => {
      // A caller cannot express a price: the input is a quantity.
      await result.current.mutateAsync({ quantity: 1 });
    });
    expect(spendCoins.mock.calls[0][0].amount).toBe(ARCADE_TOKEN_COIN_PRICE);
  });

  it('insufficient Coins publishes nothing and surfaces the wallet error', async () => {
    spendCoins.mockRejectedValue(
      Object.assign(new Error('Insufficient coins'), { reason: 'insufficient-funds' }),
    );
    const { result } = renderBuy();
    await act(async () => {
      await expect(result.current.mutateAsync({ quantity: 3 })).rejects.toThrow(
        /insufficient coins/i,
      );
    });
  });

  it('an ambiguous publish does not pretend success', async () => {
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBuy();
    let outcome;
    await act(async () => {
      outcome = await result.current.mutateAsync({ quantity: 1 });
    });
    expect(outcome).toMatchObject({ outcome: 'ambiguous' });
  });

  it('re-buying the same quantity after ambiguity reuses the SAME operation', async () => {
    spendCoins.mockResolvedValue({ status: 'ambiguous', reason: 'publish-timeout' });
    const { result } = renderBuy();
    await act(async () => {
      await result.current.mutateAsync({ quantity: 2 });
    });
    spendCoins.mockResolvedValue({ status: 'already-applied' });
    await act(async () => {
      await result.current.mutateAsync({ quantity: 2 });
    });

    expect(spendCoins).toHaveBeenCalledTimes(2);
    expect(spendCoins.mock.calls[1][0].opId).toBe(spendCoins.mock.calls[0][0].opId);
  });

  it('a completed purchase releases its identity for the next one', async () => {
    const { result } = renderBuy();
    await act(async () => {
      await result.current.mutateAsync({ quantity: 1 });
    });
    expect(openSpendIntentsFor(PUBKEY, 'shop-purchase')).toEqual([]);

    await act(async () => {
      await result.current.mutateAsync({ quantity: 1 });
    });
    expect(spendCoins.mock.calls[1][0].opId).not.toBe(spendCoins.mock.calls[0][0].opId);
  });

  it('an invalid quantity is refused before any wallet call', async () => {
    const { result } = renderBuy();
    for (const quantity of [0, -2, 1.5]) {
      await act(async () => {
        await expect(result.current.mutateAsync({ quantity })).rejects.toThrow();
      });
    }
    expect(spendCoins).not.toHaveBeenCalled();
  });
});
