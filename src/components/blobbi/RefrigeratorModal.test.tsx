import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { RefrigeratorModal } from './RefrigeratorModal';
import { buildEmptyInventory, itemIdToAddress } from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';

// Mock the new inventory + status hooks
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

describe('RefrigeratorModal', () => {
  beforeEach(() => {
    mockUseOptimizedStatus.mockReturnValue({
      status: {
        currentPet: {
          id: 'test-pet',
          name: 'Test Pet',
          hunger: 50,
          energy: 50,
          hygiene: 50,
          happiness: 50,
          health: 50,
        },
        owner: null,
        allPets: [],
      },
      applyOptimisticUpdate: vi.fn(),
    });

    // Catalog undefined -> component falls back to bundled definitions.
    mockUseItemCatalog.mockReturnValue({ data: undefined });

    mockUseUseItem.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it('displays food items from the 31633 inventory', async () => {
    let inv = buildEmptyInventory('owner-pubkey');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 5);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_pizza')!, 2);

    mockUseIslandInventory.mockReturnValue({
      data: inv,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(
      <TestApp>
        <RefrigeratorModal isOpen={true} onClose={() => {}} />
      </TestApp>
    );

    expect(await screen.findByAltText('Refrigerator open')).toBeInTheDocument();
  });

  it('shows empty state when no food items in inventory', async () => {
    mockUseIslandInventory.mockReturnValue({
      data: buildEmptyInventory('owner-pubkey'),
      isLoading: false,
      refetch: vi.fn(),
    });

    render(
      <TestApp>
        <RefrigeratorModal isOpen={true} onClose={() => {}} />
      </TestApp>
    );

    expect(await screen.findByText('Your fridge is empty!')).toBeInTheDocument();
    expect(screen.getByText('Get some food from the shop')).toBeInTheDocument();
  });
});
