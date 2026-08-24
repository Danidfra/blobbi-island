/**
 * The selection→detail pattern, which is what the redesign actually IS.
 *
 * The old inventory put a name, a slot, a count, a badge and a button on every
 * tile. The new one puts artwork on the tile and everything else in a detail
 * panel that appears when something is chosen. These are the behaviours that
 * makes that a feature rather than a hidden control:
 *
 *   - nothing is selected until the player picks something;
 *   - picking reveals exactly one verb, named for what it does;
 *   - picking again puts it away;
 *   - a selection that stops existing does not linger.
 *
 * The consumable fixtures come from the bundled fallback catalog, so no relay
 * and no publish is involved anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { InventoryBrowser } from './InventoryBrowser';
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

const APPLE = itemIdToAddress('food_apple')!;
const VITAMINS = itemIdToAddress('med_vitamins')!;

function withItems(items: [string, number][]) {
  let inv = buildEmptyInventory('owner');
  for (const [address, quantity] of items) {
    inv = addInventoryItemQuantity(inv, address, quantity);
  }
  mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
  return render(
    <TestApp>
      <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
    </TestApp>,
  );
}

beforeEach(() => {
  mockUseItemCatalog.mockReturnValue({ data: undefined });
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
  });
});

describe('selection reveals detail', () => {
  it('shows a prompt, not a panel, until something is picked', async () => {
    withItems([[APPLE, 3]]);
    await screen.findByText('Apple');

    expect(screen.queryByTestId('item-detail')).toBeNull();
    expect(screen.getByText(/pick something to see what it does/i)).toBeInTheDocument();
  });

  it('reveals the item\'s detail and its one verb', async () => {
    withItems([[APPLE, 3]]);
    fireEvent.click(await screen.findByTestId(`item-${APPLE}`));

    const detail = screen.getByTestId('item-detail');
    expect(detail).toHaveTextContent('Apple');
    expect(detail).toHaveTextContent(/3 owned/);
    // Exactly one action, and it says what it does.
    expect(screen.getByTestId(`use-${APPLE}`)).toHaveTextContent(/use it/i);
  });

  it('puts the detail away when the same item is picked again', async () => {
    withItems([[APPLE, 3]]);
    const tile = await screen.findByTestId(`item-${APPLE}`);

    fireEvent.click(tile);
    expect(screen.getByTestId('item-detail')).toBeInTheDocument();
    fireEvent.click(tile);
    expect(screen.queryByTestId('item-detail')).toBeNull();
  });

  it('marks the chosen tile for assistive tech, not just visually', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    const apple = await screen.findByTestId(`item-${APPLE}`);

    expect(apple).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(apple);
    expect(apple).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId(`item-${VITAMINS}`)).toHaveAttribute('aria-selected', 'false');
  });

  it('drops a selection whose item leaves the collection', async () => {
    const { rerender } = withItems([[APPLE, 1]]);
    fireEvent.click(await screen.findByTestId(`item-${APPLE}`));
    expect(screen.getByTestId('item-detail')).toBeInTheDocument();

    // The last one is used up.
    mockUseIslandInventory.mockReturnValue({
      data: buildEmptyInventory('owner'),
      isLoading: false,
    });
    rerender(
      <TestApp>
        <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
      </TestApp>,
    );

    // A stale panel describing something the player no longer has would be
    // worse than no panel.
    await waitFor(() => expect(screen.queryByTestId('item-detail')).toBeNull());
  });

  it('drops a selection the category filter hides', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    fireEvent.click(await screen.findByTestId(`item-${VITAMINS}`));
    expect(screen.getByTestId('item-detail')).toHaveTextContent('Vitamins');

    fireEvent.click(screen.getByRole('tab', { name: /Food/ }));
    await waitFor(() => expect(screen.queryByTestId('item-detail')).toBeNull());
  });
});

describe('the category strip', () => {
  it('is a tablist with one selected chip', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    await screen.findByText('Apple');

    const chips = screen.getAllByRole('tab');
    expect(chips.filter((c) => c.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('counts what is behind each chip', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    await screen.findByText('Apple');

    // Two items, one per category — the count is items, not quantities.
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Food/ })).toHaveTextContent('1');
  });
});
