import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ConsumeItemModal } from './ConsumeItemModal';
import { bundledFallbackDefinition, itemIdToAddress } from '@/inventory';

describe('ConsumeItemModal', () => {
  const appleDefinition = bundledFallbackDefinition(itemIdToAddress('food_apple')!)!;

  const mockProps = {
    isOpen: true,
    onClose: vi.fn(),
    definition: appleDefinition,
    maxQuantity: 5,
    onUseItem: vi.fn(),
  };

  it('renders the modal with correct item information', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );

    // The window names itself; the item's own name and how many the player has
    // are content. "Max: 5" became "You have 5", which is the same fact said
    // the way a player would say it.
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Use item');
    expect(screen.getByRole('heading', { name: 'Apple' })).toBeInTheDocument();
    expect(screen.getByText('You have 5')).toBeInTheDocument();
  });

  it('allows quantity adjustment within limits', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );

    const quantityInput = await screen.findByRole('spinbutton');

    // Initial quantity should be 1
    expect(quantityInput).toHaveValue(1);

    // Change quantity directly via input
    fireEvent.change(quantityInput, { target: { value: '3' } });
    expect(quantityInput).toHaveValue(3);
  });
});