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
    availableQuantity: 5,
    onUseItem: vi.fn(),
  };

  it('renders the modal with correct item information', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );

    // The window names itself; the item's own name and how many the player has
    // are content. "Available: 5" is what the player HAS, distinct from the
    // quantity they select for this one use, which starts at 1.
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('Use item');
    expect(screen.getByRole('heading', { name: 'Apple' })).toBeInTheDocument();
    expect(screen.getByText('Available: 5')).toBeInTheDocument();
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('1');
  });

  it('starts every operation at 1, even if the same instance stays mounted for another item', async () => {
    const burger = bundledFallbackDefinition(itemIdToAddress('food_burger')!)!;
    const { rerender } = render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );
    await screen.findByRole('dialog');
    const plus = screen.getByRole('button', { name: 'Increase quantity' });
    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('4');

    // Another item opens in the same mounted instance.
    rerender(
      <TestApp>
        <ConsumeItemModal {...mockProps} definition={burger} availableQuantity={10} />
      </TestApp>
    );
    expect(screen.getByText('Available: 10')).toBeInTheDocument();
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('1');
  });

  it('disables the action when nothing is available', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} availableQuantity={0} />
      </TestApp>
    );
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Feed Blobbi' })).toBeDisabled();
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

  it('names its action: feeding a Blobbi says so', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Feed Blobbi' })).toBeInTheDocument();
  });

  it('shows where an item from another game came from, in that game\'s name', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} provenance="Nostr Farm" />
      </TestApp>
    );
    await screen.findByRole('dialog');
    expect(screen.getByTestId('consume-provenance')).toHaveTextContent('From Nostr Farm');
  });

  it('shows no provenance for an Island item', async () => {
    render(
      <TestApp>
        <ConsumeItemModal {...mockProps} />
      </TestApp>
    );
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('consume-provenance')).toBeNull();
    expect(screen.getByRole('dialog').textContent).not.toContain('From ');
  });
});
