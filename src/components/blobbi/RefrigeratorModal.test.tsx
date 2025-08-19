import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { RefrigeratorModal } from './RefrigeratorModal';

// Mock the hooks
const mockUseBlobbonautInventory = vi.fn();
const mockUseOptimizedStatus = vi.fn();

vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautInventory: () => mockUseBlobbonautInventory(),
}));

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => mockUseOptimizedStatus(),
}));

describe('RefrigeratorModal', () => {
  beforeEach(() => {
    // Default mocks
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
      },
      updatePetStats: vi.fn(),
    });
  });

  it('displays food items from user inventory', () => {
    mockUseBlobbonautInventory.mockReturnValue({
      data: [
        { itemId: 'apple', quantity: 5 },
        { itemId: 'pizza', quantity: 2 },
        { itemId: 'burger', quantity: 1 },
      ],
      isLoading: false,
    });

    render(
      <TestApp>
        <RefrigeratorModal isOpen={true} onClose={() => {}} />
      </TestApp>
    );

    // The modal should be open and display the refrigerator
    expect(screen.getByAltText('Refrigerator open')).toBeInTheDocument();
  });

  it('displays food items with food_ prefix from user inventory', () => {
    mockUseBlobbonautInventory.mockReturnValue({
      data: [
        { itemId: 'food_burger', quantity: 4 },
        { itemId: 'food_cake', quantity: 23 },
      ],
      isLoading: false,
    });

    render(
      <TestApp>
        <RefrigeratorModal isOpen={true} onClose={() => {}} />
      </TestApp>
    );

    // The modal should be open and display the refrigerator
    expect(screen.getByAltText('Refrigerator open')).toBeInTheDocument();
  });

  it('shows empty state when no food items in inventory', () => {
    mockUseBlobbonautInventory.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(
      <TestApp>
        <RefrigeratorModal isOpen={true} onClose={() => {}} />
      </TestApp>
    );

    expect(screen.getByText('Your fridge is empty!')).toBeInTheDocument();
    expect(screen.getByText('Get some food from the shop')).toBeInTheDocument();
  });
});