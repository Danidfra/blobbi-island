/**
 * F-02: the Food Shop's SYNCHRONOUS submit guard.
 *
 * `isPending` only flips after a re-render, so two confirms landing in the
 * same tick both passed it and both started a purchase. The in-flight ref is
 * the immediate gate. It is first-line UI protection only: the financial
 * guarantee (one debit per logical purchase, retries reconcile the same
 * operation) is the F-01 spend intent inside `useBatchPurchase`, which these
 * tests deliberately leave in place unmocked-at-the-wallet-level tests cover.
 *
 * Every non-success outcome must still allow a LATER deliberate confirm,
 * that retry is exactly how the spend intent reconciles an unresolved
 * operation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { FoodShopModal } from './FoodShopModal';
import { bundledFallbackDefinition, itemIdToAddress } from '@/inventory';

const mockUseItemCatalog = vi.fn();
const purchaseBatch = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useItemCatalog: () => mockUseItemCatalog(),
    useBatchPurchase: () => ({ mutateAsync: purchaseBatch, isPending: false }),
  };
});

vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinWallet: () => ({ spendCoins: vi.fn(), grantCoins: vi.fn(), wallet: null }),
  useCoinBalance: () => ({
    balance: 500,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const toast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));

function renderShop(onClose: () => void = () => {}) {
  const APPLE = itemIdToAddress('food_apple')!;
  mockUseItemCatalog.mockReturnValue({
    data: {
      byAddress: new Map([[APPLE, bundledFallbackDefinition(APPLE)!]]),
      fetchedCount: 1,
      totalCount: 20,
    },
  });
  return render(
    <TestApp>
      <FoodShopModal isOpen={true} onClose={onClose} />
    </TestApp>,
  );
}

const addApple = async () =>
  fireEvent.click(
    await screen.findByRole('button', { name: /increase apple quantity/i }),
  );
const confirmButton = () =>
  screen.getByRole('button', { name: /confirm purchase|purchasing/i });

beforeEach(() => {
  purchaseBatch.mockReset();
  toast.mockReset();
});

describe('the synchronous submit guard', () => {
  it('two confirms in the same tick start exactly ONE purchase, with one basket', async () => {
    purchaseBatch.mockImplementation(() => new Promise(() => {})); // stays in flight
    renderShop();
    await addApple();

    const button = confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // The second and third confirms were stopped BEFORE the mutation; not by
    // React state, which has not re-rendered yet.
    expect(purchaseBatch).toHaveBeenCalledTimes(1);
    expect(purchaseBatch.mock.calls[0][0]).toEqual({
      lines: [expect.objectContaining({ quantity: 1 })],
    });
  });

  it('after an AMBIGUOUS outcome the basket is kept and a later deliberate confirm runs (the F-01 retry path)', async () => {
    purchaseBatch.mockResolvedValue({ lines: [], totalCost: 10, outcome: 'ambiguous' });
    renderShop();
    await addApple();

    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Purchase Not Confirmed' }),
      ),
    );

    // The retry is allowed, and it submits the SAME kept basket, which is
    // what lets useBatchPurchase reuse the same spend intent underneath.
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(purchaseBatch).toHaveBeenCalledTimes(2));
    expect(purchaseBatch.mock.calls[1][0]).toEqual(purchaseBatch.mock.calls[0][0]);
  });

  it('after a BLOCKED outcome the player can try again later', async () => {
    purchaseBatch.mockResolvedValue({ lines: [], totalCost: 10, outcome: 'blocked' });
    renderShop();
    await addApple();

    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Previous Purchase Still Unresolved' }),
      ),
    );

    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(purchaseBatch).toHaveBeenCalledTimes(2));
  });

  it('after a definite FAILURE a retry is possible', async () => {
    purchaseBatch.mockRejectedValue(new Error('Insufficient coins'));
    renderShop();
    await addApple();

    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Purchase Failed' }),
      ),
    );

    purchaseBatch.mockResolvedValue({ lines: [], totalCost: 10, outcome: 'applied' });
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(purchaseBatch).toHaveBeenCalledTimes(2));
  });

  it('a successful purchase still closes the shop exactly as before', async () => {
    purchaseBatch.mockResolvedValue({ lines: [], totalCost: 10, outcome: 'applied' });
    const onClose = vi.fn();
    renderShop(onClose);
    await addApple();

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(purchaseBatch).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Purchase Successful' }),
    );
  });
});

/**
 * F-05: what the shop is allowed to tell the purchase layer.
 *
 * The modal still computes a displayed total from the canonical catalog, but
 * the payload it submits carries WHAT and HOW MANY only. Price is a fact about
 * the item and is resolved inside `useBatchPurchase`; a rendered number must
 * never be able to move money.
 */
describe('the submitted basket', () => {
  it('carries address and quantity only; no price of any kind', async () => {
    purchaseBatch.mockResolvedValue({ lines: [], totalCost: 20, outcome: 'applied' });
    const APPLE = itemIdToAddress('food_apple')!;
    renderShop();
    await addApple();
    await addApple();

    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(purchaseBatch).toHaveBeenCalledTimes(1);
    expect(purchaseBatch.mock.calls[0][0]).toEqual({
      lines: [{ address: APPLE, quantity: 2 }],
    });
  });

  it('still shows the canonical price and total on screen', async () => {
    renderShop();
    await addApple();
    await addApple();
    // The apple is 10 Coins in the catalog, so the basket total is 20.
    await waitFor(() => {
      expect(screen.getAllByText('20').length).toBeGreaterThan(0);
    });
  });
});
