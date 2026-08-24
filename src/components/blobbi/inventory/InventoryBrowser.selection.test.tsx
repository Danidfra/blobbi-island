/**
 * The two interaction models, and the one tile contract underneath them.
 *
 * The corrective pass split what a click means by what the item IS:
 *
 *   consumable   click → the consume dialog, immediately
 *   wearable     click → select → detail panel (Wardrobe surfaces only)
 *   currency     display only
 *
 * and made every tile on a page the same fixed geometry. This suite pins the
 * split and the contract; the wardrobe's own selection flow is exercised
 * end-to-end in `InventoryBrowser.equipment.test.tsx` with the real placement
 * harness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
      <InventoryBrowser
        characterId="blobbi-1"
        categories={['food', 'toy', 'care', 'currency']}
        onEquip={() => {}}
        onUnequip={() => {}}
      />
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

describe('the Items surface is a pure game inventory', () => {
  it('has no detail column at all', async () => {
    withItems([[APPLE, 3]]);
    await screen.findByText('Apple');

    // No prompt, no master-detail chrome — chips, grid, pager, done. The
    // consume dialog carries everything the detail card used to.
    expect(screen.queryByTestId('item-detail')).toBeNull();
    expect(screen.queryByText(/pick something/i)).toBeNull();
  });

  it('opens the consume dialog on the first click', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    fireEvent.click(await screen.findByTestId(`item-${APPLE}`));

    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
  });

  it('is a group of action buttons, not a listbox', async () => {
    /*
      A listbox promises a selection model. The bag has none — a tile's click
      IS its action — so the grid is a labelled group and tiles carry no
      aria-selected that would announce a selection state that cannot exist.
    */
    withItems([[APPLE, 3]]);
    await screen.findByText('Apple');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('group', { name: 'your items' })).toBeInTheDocument();
    expect(screen.getByTestId(`item-${APPLE}`)).not.toHaveAttribute('aria-selected');
  });
});

describe('one tile geometry for every item on a page', () => {
  it('gives a long-named item the same structure as a short-named one', async () => {
    withItems([[APPLE, 3], [VITAMINS, 12]]);
    await screen.findByText('Apple');

    const apple = screen.getByTestId(`item-${APPLE}`);
    const vitamins = screen.getByTestId(`item-${VITAMINS}`);

    /*
      jsdom cannot measure height, so the contract is asserted structurally:
      the name is a single truncated line (cannot wrap into a second one), the
      quantity badge is absolutely positioned (out of flow), and neither tile
      carries a flow footnote row the other lacks.
    */
    for (const tile of [apple, vitamins]) {
      const name = tile.querySelector('span.truncate')!;
      expect(name.className).toContain('truncate');
      // Same flow children in the same order: art box, then name. Anything
      // else (badge, state pill) must be position:absolute.
      const flowChildren = Array.from(tile.children).filter(
        (child) => !child.className.includes('absolute'),
      );
      expect(flowChildren).toHaveLength(2);
      expect(flowChildren[0]).toHaveAttribute('data-item-art');
    }
  });

  it('keeps the quantity as an overlay badge, never a flow row', async () => {
    withItems([[APPLE, 3]]);
    await screen.findByText('Apple');

    const badge = screen.getByTestId(`item-${APPLE}`).querySelector('.absolute')!;
    expect(badge.textContent).toContain('3');
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

  it('filters the grid', async () => {
    withItems([[APPLE, 3], [VITAMINS, 1]]);
    await screen.findByText('Apple');

    fireEvent.click(screen.getByRole('tab', { name: /Food/ }));
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('Vitamins')).toBeNull();
  });
});
