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
import { buildEmptyInventory, itemIdToAddress } from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';

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
