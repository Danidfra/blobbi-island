/**
 * The CARRIED half of the inventory: consumables and currency.
 *
 * Confirms that medicine, hygiene and energy items, which have no dedicated
 * furniture: are visible and usable through the canonical `InventoryBrowser`,
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
      <InventoryBrowser
        characterId="blobbi-1"
        categories={['food', 'toy', 'care', 'currency']}
        onEquip={() => {}}
        onUnequip={() => {}}
      />
    </TestApp>
  );
}

/** Click a tile by its visible name. For a consumable, that IS the action. */
function clickTile(name: string) {
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
    // All three sit under one `Care` chip, but a surface showing a SINGLE
    // category offers no filter at all, so the strip is absent here.
    expect(screen.queryByRole('tablist', { name: 'Item categories' })).toBeNull();
  });

  it('opens the consume modal DIRECTLY from a click', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(browser());

    /*
      One click. The intermediate "select → read a card → press Use it" step is
      gone: a consumable has exactly one thing it can do, and the consume
      dialog already shows everything the card showed.
    */
    clickTile(await screen.findByText('Vitamins').then(() => 'Vitamins'));
    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
    // No intermediate detail card, and no "Use it" button anywhere.
    expect(screen.queryByTestId('item-detail')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
  });

  it('leaves no stale selection behind when the dialog closes', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 3);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(browser());
    clickTile(await screen.findByText('Apple').then(() => 'Apple'));
    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // A consumable is never "selected": its click is the action, so closing
    // the dialog must not leave a highlighted tile pretending otherwise.
    expect(screen.queryByRole('dialog', { name: 'Use item' })).toBeNull();
    const tile = screen.getByTestId(`item-${itemIdToAddress('food_apple')}`);
    expect(tile).not.toHaveAttribute('aria-selected');
    expect(tile).toHaveAttribute('aria-pressed', 'false');
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
 * collection is the natural place to show it, but it must be visibly a
 * BALANCE, not something you can feed to a Blobbi. The property that matters is
 * unchanged by the redesign: there is NO path from currency into the consume
 * flow. What changed is that a currency tile is now selectable like every other
 * tile: selecting it explains what it is for, and offers no verb.
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
  });

  it('offers NO consumable action for the ticket', async () => {
    renderWithTickets(7);

    // Currency is DISPLAY ONLY: not a button, so there is nothing to click and
    // no dead affordance pretending a coin does something.
    const label = await screen.findByText('Arcade Ticket');
    expect(label.closest('button')).toBeNull();

    fireEvent.click(label);
    expect(screen.queryByRole('dialog', { name: 'Use item' })).toBeNull();
    expect(mockUseUseItem().mutate).not.toHaveBeenCalled();
  });

  it('sorts currency last, after the things you can actually use', async () => {
    renderWithTickets(7, true);
    await screen.findByText('Apple');

    const names = Array.from(
      screen.getByTestId('collection-grid').querySelectorAll('[data-testid^="item-"]'),
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

    clickTile('Apple');
    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
  });

  it('hides currency at zero, matching the bag convention', async () => {
    renderWithTickets(0, true);
    expect(await screen.findByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('Arcade Ticket')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Coins/ })).toBeNull();
  });
});
