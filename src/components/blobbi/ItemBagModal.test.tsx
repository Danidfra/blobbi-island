/**
 * Reachable-UI test for the Item Bag (Q6/Q12 of the audit).
 *
 * Confirms that medicine, hygiene, and energy items — which have no dedicated
 * furniture — are visible and selectable through the shared Item Bag modal,
 * which opens the shared ConsumeItemModal for use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ItemBagModal } from './ItemBagModal';
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

describe('ItemBagModal reachable UI', () => {
  beforeEach(() => {
    mockUseItemCatalog.mockReturnValue({ data: undefined }); // bundled fallback
    mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOptimizedStatus.mockReturnValue({
      status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
    });
  });

  it('shows medicine, hygiene, and energy items owned in 31633', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('hyg_soap')!, 1);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('nrg_drink')!, 4);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(
      <TestApp>
        <ItemBagModal isOpen={true} onClose={() => {}} />
      </TestApp>,
    );

    expect(await screen.findByText('Medicine')).toBeInTheDocument();
    expect(screen.getByText('Hygiene')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('Vitamins')).toBeInTheDocument();
    expect(screen.getByText('Soap')).toBeInTheDocument();
    expect(screen.getByText('Energy Drink')).toBeInTheDocument();
  });

  it('opens the consume modal when an item is clicked', async () => {
    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(
      <TestApp>
        <ItemBagModal isOpen={true} onClose={() => {}} />
      </TestApp>,
    );

    const vitaminsButton = await screen.findByText('Vitamins');
    fireEvent.click(vitaminsButton);

    // The shared ConsumeItemModal header appears.
    expect(await screen.findByRole('heading', { name: 'Use Item' })).toBeInTheDocument();
  });

  it('shows an empty state when the bag has no items', async () => {
    mockUseIslandInventory.mockReturnValue({
      data: buildEmptyInventory('owner'),
      isLoading: false,
    });

    render(
      <TestApp>
        <ItemBagModal isOpen={true} onClose={() => {}} />
      </TestApp>,
    );

    expect(await screen.findByText(/your bag is empty/i)).toBeInTheDocument();
  });
});

/**
 * Currency section.
 *
 * A currency is held in the same kind:31633 inventory as consumables, so the
 * bag is the natural place to show it — but it must be visibly a BALANCE, not
 * something you can feed to a Blobbi. These tests pin the two properties that
 * matter: it is visible, and there is no path from it into the consume flow.
 */
describe('ItemBagModal currency section', () => {
  const TICKET = dTagToAddress(ARCADE_TICKET_D)!;

  beforeEach(() => {
    mockUseItemCatalog.mockReturnValue({ data: undefined }); // bundled fallback
    mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOptimizedStatus.mockReturnValue({
      status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
    });
  });

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
    return render(
      <TestApp>
        <ItemBagModal isOpen={true} onClose={() => {}} />
      </TestApp>,
    );
  }

  it('renders a Currency section showing the Arcade Ticket and its quantity', async () => {
    renderWithTickets(7);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    expect(screen.getByText('Arcade Ticket')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('offers NO consumable action for the ticket', async () => {
    renderWithTickets(7);

    const label = await screen.findByText('Arcade Ticket');
    // Display-only tile: not a button, and not inside one.
    expect(label.closest('button')).toBeNull();

    fireEvent.click(label);
    // The shared consume modal must not open.
    expect(screen.queryByRole('heading', { name: 'Use Item' })).toBeNull();
    expect(mockUseUseItem().mutate).not.toHaveBeenCalled();
  });

  it('places Currency above the consumable sections', async () => {
    const { container } = renderWithTickets(7, true);

    await screen.findByText('Currency');
    const sections = Array.from(
      document.querySelectorAll('[data-bag-section]'),
    ).map((el) => el.getAttribute('data-bag-section'));

    expect(sections[0]).toBe('currency');
    expect(container).toBeTruthy();
  });

  it('keeps all five consumable categories rendering and usable', async () => {
    renderWithTickets(7, true);

    for (const label of ['Food', 'Toys', 'Medicine', 'Hygiene', 'Energy']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }

    // A consumable is still a button that opens the consume modal.
    const apple = screen.getByText('Apple');
    expect(apple.closest('button')).not.toBeNull();
    fireEvent.click(apple);
    expect(
      await screen.findByRole('heading', { name: 'Use Item' }),
    ).toBeInTheDocument();
  });

  it('hides the Currency section at zero, matching the bag convention', async () => {
    renderWithTickets(0, true);

    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.queryByText('Currency')).toBeNull();
    expect(screen.queryByText('Arcade Ticket')).toBeNull();
  });

  it('renders the definition image, and emoji for items without one', async () => {
    renderWithTickets(7, true);

    await screen.findByText('Currency');
    const tile = document.querySelector('[data-readonly-item]')!;

    // The ticket has artwork, so the tile shows the image…
    const img = tile.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(
      'https://assets.blobbi.pet/items/arcade/arcade-ticket-v1.webp',
    );

    // …while the 19 consumables, which have no `image`, still render emoji.
    // This is the generic resolution order, not a ticket special case.
    const appleTile = screen.getByText('Apple').closest('button')!;
    expect(appleTile.querySelector('img')).toBeNull();
    expect(appleTile.textContent).toContain('🍎');
  });

  it('degrades a failed image to the emoji', async () => {
    renderWithTickets(7);

    await screen.findByText('Currency');
    const img = document.querySelector('[data-readonly-item] img')!;
    fireEvent.error(img);

    const tile = document.querySelector('[data-readonly-item]')!;
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.textContent).toContain('🎟️');
    // Still read-only after the fallback swap.
    expect(screen.getByText('Arcade Ticket').closest('button')).toBeNull();
  });

  it('renders identically from a relay definition and from the fallback', async () => {
    // Fallback path (catalog undefined) is covered above; now the fetched path.
    mockUseItemCatalog.mockReturnValue({
      data: {
        byAddress: new Map([
          [
            TICKET,
            {
              address: TICKET,
              itemId: 'cur_arcade_ticket',
              d: ARCADE_TICKET_D,
              name: 'Arcade Ticket',
              type: 'currency',
              category: 'currency' as const,
              effects: {},
              action: null,
              stages: ['egg', 'baby', 'adult'] as const,
              emoji: '🎟️',
              topics: ['currency', 'arcade'],
              source: 'definition' as const,
            },
          ],
        ]),
        fetchedCount: 1,
        totalCount: 20,
      },
    });

    renderWithTickets(3);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    expect(screen.getByText('Arcade Ticket')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Arcade Ticket').closest('button')).toBeNull();
  });
});
