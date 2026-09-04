/**
 * `<CareStoreModal>`: what the shop shows, and what a Buy click is allowed to
 * ask the purchase layer for.
 *
 * The purchase hook itself is faked here on purpose. What it does with a cart,
 * one atomic kind:31633 event carrying the Coin debit and every grant, behind a
 * durable spend intent, is proven against the real wallet in
 * `useBatchPurchase.test.tsx` and `care-store-purchase.test.ts`. What this file
 * proves is the CONTRACT the shop hands it:
 *
 *   - exactly one line, quantity one, identified by canonical ADDRESS;
 *   - never a price (the shop does not get to say what things cost);
 *   - never twice for one click, and never twice in one tick;
 *   - never at all when the player cannot or should not buy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import {
  CARE_STORE_CATEGORY_LABELS,
  CARE_STORE_PRODUCTS,
  careStoreProductsFor,
  bundledFallbackDefinition,
} from '@/inventory';

const TEST_PUBKEY = 'a'.repeat(64);

const purchase = vi.fn();
const currentUser = { value: { pubkey: TEST_PUBKEY } as { pubkey: string } | undefined };
const coinBalance = { value: 500 as number | null };
const owned = new Map<string, number>();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser.value }),
}));

vi.mock('@/inventory/useCoinWallet', () => ({
  useCoinWallet: () => ({ spendCoins: vi.fn(), grantCoins: vi.fn(), wallet: null }),
  useCoinBalance: () => ({
    balance: coinBalance.value,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    // The whole official catalog, resolved from the bundled fallback so the
    // shop renders real names, emoji and effects without a relay.
    useItemCatalog: () => ({
      data: {
        byAddress: new Map(
          actual.CARE_STORE_PRODUCTS.map((p) => [
            p.address,
            actual.bundledFallbackDefinition(p.address)!,
          ]),
        ),
        fetchedCount: 0,
        totalCount: actual.CARE_STORE_PRODUCTS.length,
      },
    }),
    useIslandInventory: () => ({ data: { owner: TEST_PUBKEY } }),
    getQuantity: (_inv: unknown, address: string) => owned.get(address) ?? 0,
    useBatchPurchase: () => ({ mutateAsync: purchase, isPending: false }),
  };
});

import { CareStoreModal } from './CareStoreModal';

const SOAP = CARE_STORE_PRODUCTS.find((p) => p.d === 'blobbi:hygiene:soap')!;
const TEDDY = CARE_STORE_PRODUCTS.find((p) => p.d === 'blobbi:toy:teddy')!;

async function renderShop(onClose = () => {}) {
  const result = render(
    <TestApp>
      <CareStoreModal isOpen onClose={onClose} />
    </TestApp>,
  );
  // `TestApp`'s login provider hydrates asynchronously.
  await screen.findByText('Care Store');
  return result;
}

const buyButton = (address: string) =>
  document.querySelector(`[data-care-store-buy="${address}"]`) as HTMLButtonElement;

const shelfTab = (category: string) =>
  document.querySelector(`[data-care-store-shelf-tab="${category}"]`) as HTMLButtonElement;

beforeEach(() => {
  purchase.mockReset();
  purchase.mockResolvedValue({ lines: [], totalCost: 0, outcome: 'applied' });
  currentUser.value = { pubkey: TEST_PUBKEY };
  coinBalance.value = 500;
  owned.clear();
});

describe('what the shop shows', () => {
  it('shows the real Coin balance, not a made-up one', async () => {
    coinBalance.value = 417;
    await renderShop();
    expect(screen.getByText('417')).toBeInTheDocument();
  });

  it('renders an unknown balance as unavailable, never as a zero', async () => {
    coinBalance.value = null;
    await renderShop();
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument();
  });

  it('offers all three shelves', async () => {
    await renderShop();
    for (const [key, label] of Object.entries(CARE_STORE_CATEGORY_LABELS)) {
      expect(shelfTab(key)).toBeTruthy();
      expect(shelfTab(key).textContent).toBe(label);
    }
  });

  it.each([['hygiene'], ['medicine'], ['toy']])(
    'the %s shelf lists exactly its canonical products',
    async (category) => {
      await renderShop();
      fireEvent.click(shelfTab(category));

      const shown = [...document.querySelectorAll('[data-care-store-item]')].map(
        (el) => (el as HTMLElement).dataset.careStoreItem,
      );
      expect(shown).toEqual(
        careStoreProductsFor(category as 'toy').map((p) => p.address),
      );
    },
  );

  it('shows each item its name, price, purpose and Buy control', async () => {
    await renderShop();
    fireEvent.click(shelfTab('toy'));

    const definition = bundledFallbackDefinition(TEDDY.address)!;
    expect(screen.getByText(definition.name)).toBeInTheDocument();
    expect(screen.getByText(String(TEDDY.price))).toBeInTheDocument();
    // The purpose line is derived from the definition's own effects.
    expect(screen.getByText(/Happiness \+45/)).toBeInTheDocument();
    expect(buyButton(TEDDY.address).textContent).toBe(`Buy for ${TEDDY.price}`);
  });

  it('shows how many you already own', async () => {
    owned.set(TEDDY.address, 3);
    await renderShop();
    fireEvent.click(shelfTab('toy'));
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opening the shop purchases nothing', async () => {
    await renderShop();
    fireEvent.click(shelfTab('toy'));
    fireEvent.click(shelfTab('medicine'));
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('buying', () => {
  it('asks for exactly one unit, by canonical address, with no price', async () => {
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledWith({
      lines: [{ address: SOAP.address, quantity: 1 }],
    });
    // The shop is not allowed to quote a price to the money layer.
    expect(JSON.stringify(purchase.mock.calls[0][0])).not.toContain('Price');
    expect(JSON.stringify(purchase.mock.calls[0][0])).not.toContain(
      String(SOAP.price),
    );
  });

  it('buys a toy through the same one path as a bandage', async () => {
    await renderShop();
    fireEvent.click(shelfTab('toy'));
    await act(async () => {
      fireEvent.click(buyButton(TEDDY.address));
    });

    expect(purchase).toHaveBeenCalledExactlyOnceWith({
      lines: [{ address: TEDDY.address, quantity: 1 }],
    });
  });

  it('confirms the purchase on the card that was bought', async () => {
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });
    await waitFor(() =>
      expect(buyButton(SOAP.address).dataset.state).toBe('purchased'),
    );
  });

  it('two clicks in the same tick buy one thing, not two', async () => {
    purchase.mockImplementation(() => new Promise(() => {})); // stays in flight
    await renderShop();

    const button = buyButton(SOAP.address);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // Stopped BEFORE the mutation by the synchronous ref, not by a re-render.
    expect(purchase).toHaveBeenCalledTimes(1);
  });

  it('no Buy button stays live while a purchase is in flight', async () => {
    purchase.mockImplementation(() => new Promise(() => {}));
    await renderShop();
    fireEvent.click(buyButton(SOAP.address));

    await waitFor(() =>
      expect(buyButton(SOAP.address).dataset.state).toBe('purchasing'),
    );
    for (const product of careStoreProductsFor('hygiene')) {
      expect(buyButton(product.address).disabled).toBe(true);
    }
  });

  it('surfaces an unresolved outcome instead of claiming success', async () => {
    purchase.mockResolvedValue({ lines: [], totalCost: 15, outcome: 'ambiguous' });
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });

    await waitFor(() =>
      expect(document.querySelector('[data-care-store-error]')).toBeTruthy(),
    );
    expect(buyButton(SOAP.address).dataset.state).not.toBe('purchased');
  });

  it('allows a deliberate retry after an unresolved outcome', async () => {
    purchase.mockResolvedValue({ lines: [], totalCost: 15, outcome: 'ambiguous' });
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });
    // The retry is what lets the purchase layer reconcile the SAME operation
    // rather than debiting a second time.
    expect(purchase).toHaveBeenCalledTimes(2);
  });
});

describe('the shared inventory stays the UI boundary', () => {
  it('the shop never patches its own balance after a purchase', async () => {
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });
    await waitFor(() =>
      expect(buyButton(SOAP.address).dataset.state).toBe('purchased'),
    );

    // The number on screen is still exactly what the SHARED balance hook says.
    // A component that decremented locally would show 485 here and then fight
    // the cache when the confirmed inventory landed.
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('renders whatever the shared inventory reports, purchase or not', async () => {
    // The freshness guarantee itself belongs to the confirmed-inventory cache
    // (`inventory-cache-freshness.test.tsx`). What the shop owes that machinery
    // is simply to READ from it, so a changed shared value must show up here
    // with no local state involved.
    coinBalance.value = 500;
    owned.set(SOAP.address, 0);
    const { rerender } = await renderShop();

    coinBalance.value = 485;
    owned.set(SOAP.address, 1);
    rerender(
      <TestApp>
        <CareStoreModal isOpen onClose={() => {}} />
      </TestApp>,
    );

    expect(await screen.findByText('485')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('when you cannot buy', () => {
  it('an unaffordable item cannot be bought and says so', async () => {
    coinBalance.value = 10; // Soap costs 15.
    await renderShop();

    const button = buyButton(SOAP.address);
    expect(button.dataset.state).toBe('unaffordable');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Not enough Coins');

    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a logged-out player is asked to sign in and buys nothing', async () => {
    currentUser.value = undefined;
    await renderShop();

    const button = buyButton(SOAP.address);
    expect(button.dataset.state).toBe('logged-out');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('an unknown balance still allows a purchase, the wallet is the real gate', async () => {
    coinBalance.value = null;
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(SOAP.address));
    });
    // A balance that could not be READ must not be treated as a balance of zero.
    expect(purchase).toHaveBeenCalledTimes(1);
  });
});

describe('closing', () => {
  it('closing buys nothing and reports the close', async () => {
    const onClose = vi.fn();
    await renderShop(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(purchase).not.toHaveBeenCalled();
  });
});
