import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ConsumeItemModal } from './ConsumeItemModal';

describe('ConsumeItemModal', () => {
  const mockProps = {
    isOpen: true,
    onClose: vi.fn(),
    itemId: 'apple',
    maxQuantity: 5,
    onUseItem: vi.fn(),
  };

  it('renders the modal with correct item information', () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );

    expect(screen.getByRole('heading', { name: 'Use Item' })).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Max: 5')).toBeInTheDocument();
  });

  it('allows quantity adjustment within limits', () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );

    const quantityInput = screen.getByRole('spinbutton');

    // Initial quantity should be 1
    expect(quantityInput).toHaveValue(1);

    // Change quantity directly via input
    fireEvent.change(quantityInput, { target: { value: '3' } });
    expect(quantityInput).toHaveValue(3);
  });
});