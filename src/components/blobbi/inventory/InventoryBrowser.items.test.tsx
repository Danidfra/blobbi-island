/**
 * The CARRIED half of the inventory: consumables and currency.
 *
 * Confirms that medicine, hygiene and energy items — which have no dedicated
 * furniture — are visible and usable through the canonical `InventoryBrowser`,
 * which opens the shared `ConsumeItemModal`.
 *
 * Migrated from `InventoryPanel.test.tsx` when the two stacked panels became one
 * browser. The invariants are unchanged; the shape they are asserted against is
 * not. Where the old panel stacked a headed section per item category, the new
 * one filters one grid with category chips, so `Medicine`/`Hygiene`/`Energy`
 * headings are now a single `Care` chip and `Currency` is `Coins`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { InventoryBrowser } from './InventoryBrowser';
import { buildEmptyInventory, dTagToAddress, itemIdToAddress } from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';
import { ARCADE_TICKET_D } from '@/protocol/event-registry';

const mockUseIslandInventory = vi.fn();
const mockUseItemCatalog = vi.fn();
const mockUseOptimizedStatus = vi.fn();
const mockUseUseItem = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useIslandInventory: () => mockUseIslandInventory(),
    useItemCatalog: () => mockUseItemCatalog(),
    useUseItem: () => mockUseUseItem(),
  };
});

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => mockUseOptimizedStatus(),
}));

const TICKET = dTagToAddress(ARCADE_TICKET_D)!;

function browser() {
  return (
    <TestApp>
      <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
    </TestApp>
  );
}

/** Select a tile by its visible name, revealing its detail panel. */
function select(name: string) {
  fireEvent.click(screen.getByText(name).closest('button')!);
}

beforeEach(() => {
  mockUseItemCatalog.mockReturnValue({ data: undefined }); // bundled fallback
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
  });
});

describe('carried items are reachable', () => {
  it('shows medicine, hygiene and energy items owned in 31633', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('hyg_soap')!, 1);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('nrg_drink')!, 4);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(browser());

    // All three appear in ONE grid. The three separate headed sections they
    // used to sit under are now the single `Care` chip.
    expect(await screen.findByText('Vitamins')).toBeInTheDocument();
    expect(screen.getByText('Soap')).toBeInTheDocument();
    expect(screen.getByText('Energy Drink')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Care/ })).toBeInTheDocument();
  });

  it('opens the consume modal from the selected item', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(browser());

    // Selection reveals detail; the verb lives there, not on every tile.
    select(await screen.findByText('Vitamins').then(() => 'Vitamins'));
    fireEvent.click(screen.getByTestId(`use-${itemIdToAddress('med_vitamins')}`));

    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
  });

  it('shows an empty state when the bag has no items', async () => {
    mockUseIslandInventory.mockReturnValue({
      data: buildEmptyInventory('owner'),
      isLoading: false,
    });

    render(browser());

    expect(await screen.findByText(/your bag is empty/i)).toBeInTheDocument();
  });

  it('filters the grid by category', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 3);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(browser());
    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Vitamins')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Food/ }));
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('Vitamins')).toBeNull();

    // A category with nothing in it is never offered.
    expect(screen.queryByRole('tab', { name: /Toys/ })).toBeNull();
  });
});

/**
 * Currency.
 *
 * A currency is held in the same kind:31633 inventory as consumables, so the
 * collection is the natural place to show it — but it must be visibly a
 * BALANCE, not something you can feed to a Blobbi. The property that matters is
 * unchanged by the redesign: there is NO path from currency into the consume
 * flow. What changed is that a currency tile is now selectable like every other
 * tile — selecting it explains what it is for, and offers no verb.
 */
describe('currency', () => {
  function renderWithTickets(quantity: number, alsoConsumables = false) {
    let inv = buildEmptyInventory('owner');
    if (quantity > 0) inv = addInventoryItemQuantity(inv, TICKET, quantity);
    if (alsoConsumables) {
      inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 3);
      inv = addInventoryItemQuantity(inv, itemIdToAddress('toy_ball')!, 1);
      inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
      inv = addInventoryItemQuantity(inv, itemIdToAddress('hyg_soap')!, 1);
      inv = addInventoryItemQuantity(inv, itemIdToAddress('nrg_drink')!, 4);
    }
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
    return render(browser());
  }

  it('shows the Arcade Ticket and its quantity', async () => {
    renderWithTickets(7);
    expect(await screen.findByText('Arcade Ticket')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Coins/ })).toBeInTheDocument();
  });

  it('offers NO consumable action for the ticket', async () => {
    renderWithTickets(7);

    select(await screen.findByText('Arcade Ticket').then(() => 'Arcade Ticket'));

    // No verb, and an explanation instead.
    expect(screen.queryByTestId(`use-${TICKET}`)).toBeNull();
    expect(screen.getByTestId('item-detail')).toHaveTextContent(/spend it in the shop/i);
    // And no way into the consume flow, which is the invariant that matters.
    expect(screen.queryByRole('dialog', { name: 'Use item' })).toBeNull();
    expect(mockUseUseItem().mutate).not.toHaveBeenCalled();
  });

  it('sorts currency last, after the things you can actually use', async () => {
    renderWithTickets(7, true);
    await screen.findByText('Apple');

    const names = Array.from(
      screen.getByTestId('inventory-grid').querySelectorAll('[data-testid^="item-"]'),
    ).map((el) => el.textContent ?? '');

    // Wearables first (none here), then food, toys, care, and coins last: a
    // balance is not the first thing you rummage past to find a sandwich.
    expect(names[names.length - 1]).toContain('Arcade Ticket');
  });

  it('keeps every consumable category usable', async () => {
    renderWithTickets(7, true);

    for (const name of ['Apple', 'Ball', 'Vitamins', 'Soap', 'Energy Drink']) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }

    select('Apple');
    fireEvent.click(screen.getByTestId(`use-${itemIdToAddress('food_apple')}`));
    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
  });

  it('hides currency at zero, matching the bag convention', async () => {
    renderWithTickets(0, true);
    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('Arcade Ticket')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Coins/ })).toBeNull();
  });
});
