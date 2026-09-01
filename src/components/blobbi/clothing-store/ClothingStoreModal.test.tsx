/**
 * `<ClothingStoreModal>` — what the shop shows, and what a Buy click is allowed
 * to ask the purchase layer for.
 *
 * The purchase hook is faked here. What it does with a cart — one atomic
 * kind:31633 event, a uniqueness precondition inside the wallet's lock — is
 * proven against the real wallet in `clothing-store-purchase.test.tsx`. What
 * this file proves is the CONTRACT the shop hands it, and the two states the
 * shop can be in: stocked, and honestly empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { officialCosmeticByD } from '@/protocol/event-registry';
import type { ClothingStoreProduct } from '@/inventory';

const TEST_PUBKEY = 'e'.repeat(64);

const GLASSES = officialCosmeticByD('blobbi:cosmetic:stargazer-glasses')!;
const BOW_TIE = officialCosmeticByD('blobbi:cosmetic:starlight-bow-tie')!;

/** A stocked shelf, for the states an empty one cannot show. */
const STOCKED: ClothingStoreProduct[] = [
  {
    address: GLASSES.address,
    d: GLASSES.d,
    name: GLASSES.name,
    symbol: GLASSES.symbol,
    primaryImage: GLASSES.primaryImage,
    price: 250,
    maxStack: GLASSES.maxStack,
  },
  {
    address: BOW_TIE.address,
    d: BOW_TIE.d,
    name: BOW_TIE.name,
    symbol: BOW_TIE.symbol,
    primaryImage: BOW_TIE.primaryImage,
    price: 900,
    maxStack: BOW_TIE.maxStack,
  },
];

/** Mutable so each test can choose stocked or shipped-empty. */
const products: ClothingStoreProduct[] = [];

const purchase = vi.fn();
const currentUser = { value: { pubkey: TEST_PUBKEY } as { pubkey: string } | undefined };
const coinBalance = { value: 1000 as number | null };
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
    get CLOTHING_STORE_PRODUCTS() {
      return products;
    },
    useItemCatalog: () => ({
      data: {
        byAddress: new Map(
          actual.OFFICIAL_WEARABLES.map((w) => [
            w.address,
            // Only the fields the modal reads: a resolvable definition with a
            // real equipment slot, as a fetched kind:31632 would carry.
            {
              address: w.address,
              name: w.name,
              slot: w.d.includes('glasses')
                ? 'eyewear'
                : w.d.includes('bow-tie')
                  ? 'neckwear'
                  : 'headwear',
              images: [],
            },
          ]),
        ),
        fetchedCount: 0,
        totalCount: 0,
      },
    }),
    useIslandInventory: () => ({ data: { owner: TEST_PUBKEY } }),
    getQuantity: (_inv: unknown, address: string) => owned.get(address) ?? 0,
    useBatchPurchase: () => ({ mutateAsync: purchase, isPending: false }),
  };
});

import { ClothingStoreModal } from './ClothingStoreModal';

async function renderShop(onClose = () => {}) {
  const result = render(
    <TestApp>
      <ClothingStoreModal isOpen onClose={onClose} />
    </TestApp>,
  );
  await screen.findByText('Clothing Store');
  return result;
}

const buyButton = (address: string) =>
  document.querySelector(`[data-clothing-store-buy="${address}"]`) as HTMLButtonElement;

function stock() {
  products.splice(0, products.length, ...STOCKED);
}

beforeEach(() => {
  purchase.mockReset();
  purchase.mockResolvedValue({ lines: [], totalCost: 0, outcome: 'applied' });
  currentUser.value = { pubkey: TEST_PUBKEY };
  coinBalance.value = 1000;
  owned.clear();
  products.length = 0;
});

describe('the shipped, empty shelf', () => {
  it('says the store is not stocked rather than showing a blank box', async () => {
    await renderShop();
    expect(document.querySelector('[data-clothing-store-empty]')).toBeTruthy();
    expect(screen.getByText(/no clothing is on sale here yet/i)).toBeInTheDocument();
  });

  it('still shows the real wearables the store is about', async () => {
    await renderShop();
    for (const wearable of [GLASSES, BOW_TIE]) {
      expect(
        document.querySelector(`[data-clothing-store-preview="${wearable.address}"]`),
        wearable.d,
      ).toBeTruthy();
      expect(screen.getByText(wearable.name)).toBeInTheDocument();
    }
  });

  it('offers nothing to buy, and buys nothing', async () => {
    await renderShop();
    expect(document.querySelectorAll('[data-clothing-store-buy]')).toHaveLength(0);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('marks what the player already owns', async () => {
    owned.set(GLASSES.address, 1);
    await renderShop();
    expect(screen.getAllByText('Owned').length).toBeGreaterThan(0);
  });
});

describe('what the stocked shop shows', () => {
  it('shows the real Coin balance, not a made-up one', async () => {
    coinBalance.value = 731;
    stock();
    await renderShop();
    expect(screen.getByText('731')).toBeInTheDocument();
  });

  it('renders an unknown balance as unavailable, never as a zero', async () => {
    coinBalance.value = null;
    stock();
    await renderShop();
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument();
  });

  it('lists every product with its price and a Buy control', async () => {
    stock();
    await renderShop();
    for (const product of STOCKED) {
      expect(buyButton(product.address).textContent).toBe(`Buy — ${product.price}`);
    }
  });

  it('labels each item with the slot its DEFINITION declares', async () => {
    stock();
    await renderShop();
    // The slot appears on the card AND as its filter chip — both come from the
    // definition, and neither is written in the shop.
    const card = (address: string) =>
      document
        .querySelector(`[data-clothing-store-item="${address}"]`)!
        .textContent!;
    expect(card(GLASSES.address)).toContain('Eyewear');
    expect(card(BOW_TIE.address)).toContain('Neckwear');
  });

  it('filters by slot', async () => {
    stock();
    await renderShop();
    fireEvent.click(
      document.querySelector('[data-clothing-store-slot-tab="eyewear"]') as HTMLElement,
    );
    expect(buyButton(GLASSES.address)).toBeTruthy();
    expect(buyButton(BOW_TIE.address)).toBeNull();
  });

  it('opening the shop purchases nothing', async () => {
    stock();
    await renderShop();
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('buying', () => {
  it('asks for exactly one unit, by canonical address, with no price', async () => {
    stock();
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(GLASSES.address));
    });

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledWith({
      lines: [{ address: GLASSES.address, quantity: 1 }],
    });
  });

  it('two clicks in the same tick buy one thing, not two', async () => {
    purchase.mockImplementation(() => new Promise(() => {}));
    stock();
    await renderShop();

    const button = buyButton(GLASSES.address);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(purchase).toHaveBeenCalledTimes(1);
  });

  it('no Buy button stays live while a purchase is in flight', async () => {
    purchase.mockImplementation(() => new Promise(() => {}));
    stock();
    await renderShop();
    fireEvent.click(buyButton(GLASSES.address));

    await waitFor(() =>
      expect(buyButton(GLASSES.address).dataset.state).toBe('purchasing'),
    );
    expect(buyButton(BOW_TIE.address).disabled).toBe(true);
  });

  it('reports a refused repurchase as already-owned, not as a failure', async () => {
    purchase.mockResolvedValue({ lines: [], totalCost: 250, outcome: 'stock-limit' });
    stock();
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(GLASSES.address));
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-clothing-store-error]')?.textContent,
      ).toMatch(/already own/i),
    );
  });

  it('surfaces an unresolved outcome instead of claiming success', async () => {
    purchase.mockResolvedValue({ lines: [], totalCost: 250, outcome: 'ambiguous' });
    stock();
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(GLASSES.address));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-clothing-store-error]')).toBeTruthy(),
    );
  });
});

describe('when you cannot buy', () => {
  it('an owned wearable shows Owned and cannot be bought again', async () => {
    owned.set(GLASSES.address, 1);
    stock();
    await renderShop();

    const button = buyButton(GLASSES.address);
    expect(button.dataset.state).toBe('owned');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Owned');

    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('an unaffordable item cannot be bought and says so', async () => {
    coinBalance.value = 100; // glasses cost 250
    stock();
    await renderShop();

    const button = buyButton(GLASSES.address);
    expect(button.dataset.state).toBe('unaffordable');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('a logged-out player is asked to sign in and buys nothing', async () => {
    currentUser.value = undefined;
    stock();
    await renderShop();

    const button = buyButton(GLASSES.address);
    expect(button.dataset.state).toBe('logged-out');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(purchase).not.toHaveBeenCalled();
  });

  it('an unknown balance still allows a purchase — the wallet is the real gate', async () => {
    coinBalance.value = null;
    stock();
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(GLASSES.address));
    });
    expect(purchase).toHaveBeenCalledTimes(1);
  });
});

describe('the shared inventory stays the UI boundary', () => {
  it('the shop never patches its own balance after a purchase', async () => {
    stock();
    await renderShop();
    await act(async () => {
      fireEvent.click(buyButton(GLASSES.address));
    });
    // Still exactly what the SHARED balance hook says. A component that
    // decremented locally would show 750 and then fight the cache.
    expect(screen.getByText('1000')).toBeInTheDocument();
  });

  it('shows Owned the moment the shared inventory says so, with no reload', async () => {
    stock();
    const { rerender } = await renderShop();
    expect(buyButton(GLASSES.address).dataset.state).toBe('buy');

    // The confirmed-inventory cache landing is what re-renders this in
    // production (`inventory-cache-freshness.test.tsx` owns that guarantee);
    // what the shop owes it is to READ from it.
    owned.set(GLASSES.address, 1);
    coinBalance.value = 750;
    rerender(
      <TestApp>
        <ClothingStoreModal isOpen onClose={() => {}} />
      </TestApp>,
    );

    await waitFor(() =>
      expect(buyButton(GLASSES.address).dataset.state).toBe('owned'),
    );
    expect(screen.getByText('750')).toBeInTheDocument();
  });

  it('tells the player that buying is not wearing', async () => {
    stock();
    await renderShop();
    expect(screen.getByText(/Put it on from My Blobbi/i)).toBeInTheDocument();
  });
});

describe('closing', () => {
  it('closing buys nothing and reports the close', async () => {
    const onClose = vi.fn();
    stock();
    await renderShop(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(purchase).not.toHaveBeenCalled();
  });
});
