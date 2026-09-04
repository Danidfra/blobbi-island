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
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const ROOT = resolve(__dirname, '../../../..');

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

    // No prompt, no master-detail chrome, chips, grid, pager, done. The
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
      A listbox promises a selection model. The bag has none, a tile's click
      IS its action: so the grid is a labelled group and tiles carry no
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
  /*
    THE regression: on a real screen, "Ball" rendered a visibly smaller card
    than "Calcium Supplement" even though their class strings were identical,
    the geometry was implicit (content-sized zones, a `height: 100%` resolving
    through a class-less wrapper), so it was at the mercy of engine layout
    subtleties jsdom cannot see. These tests assert the EXPLICIT contract that
    replaced it: every dimension pinned by a class, so no engine has a decision
    left to make.
  */
  const BALL = itemIdToAddress('toy_ball')!;
  const CALCIUM = itemIdToAddress('med_calcium')!;

  it('renders Ball and Calcium Supplement with the identical pinned geometry', async () => {
    withItems([[BALL, 1], [CALCIUM, 2]]);
    await screen.findByText('Ball');

    const ball = screen.getByTestId(`item-${BALL}`);
    const calcium = screen.getByTestId(`item-${CALCIUM}`);

    // The shells carry the same class string; nothing per-item.
    expect(ball.className).toBe(calcium.className);

    for (const tile of [ball, calcium]) {
      // Fixed art zone: h-16, cannot shrink, cannot grow, clips overflow.
      const art = tile.querySelector('[data-item-art]')!;
      expect(art.className).toContain('h-16');
      expect(art.className).toContain('shrink-0');
      expect(art.className).toContain('grow-0');
      expect(art.className).toContain('overflow-hidden');

      // Fixed TWO-LINE title zone: h-8 reserved whether the name uses one
      // line (Ball) or two (Calcium Supplement), clamped so a third cannot
      // exist. A one-word name does not collapse it; a long one cannot grow it.
      const titleZone = tile.querySelector('[data-tile-title]')!;
      expect(titleZone.className).toContain('h-8');
      expect(titleZone.className).toContain('shrink-0');
      expect(titleZone.className).toContain('grow-0');
      expect(titleZone.className).toContain('overflow-hidden');
      expect(titleZone.firstElementChild!.className).toContain('line-clamp-2');
      expect(titleZone.firstElementChild!.className).toContain('leading-4');

      // Only those two zones are in flow; badges and pills are overlays.
      const flowChildren = Array.from(tile.children).filter(
        (child) => !child.className.includes('absolute'),
      );
      expect(flowChildren).toHaveLength(2);
    }
  });

  it('keeps the quantity as an overlay badge, never a flow row', async () => {
    withItems([[BALL, 3]]);
    await screen.findByText('Ball');

    const badge = screen.getByTestId(`item-${BALL}`).querySelector('.absolute')!;
    expect(badge.textContent).toContain('3');
  });

  it('stretches every tile to its grid cell without percentage heights', async () => {
    /*
      The wrapper is `display: grid`, so the tile fills the cell by grid
      STRETCH: default alignment, rather than by `height: 100%` resolving
      against a stretch-derived height, which is the circular case engines
      settle differently. The rows themselves are equalised by `auto-rows-fr`.
    */
    withItems([[BALL, 1], [CALCIUM, 2]]);
    await screen.findByText('Ball');

    const grid = screen.getByTestId('collection-grid');
    expect(grid.className).toContain('auto-rows-fr');
    for (const tile of [BALL, CALCIUM]) {
      const wrapper = screen.getByTestId(`item-${tile}`).parentElement!;
      expect(wrapper.className).toContain('grid');
      expect(screen.getByTestId(`item-${tile}`).className).not.toContain('h-full');
    }
  });

  it('pins the contract in the source: no content-driven height channel', () => {
    // A source assertion, so the contract cannot erode one class at a time.
    const tile = readFileSync(
      join(ROOT, 'src/components/blobbi/inventory/CollectionTile.tsx'),
      'utf8',
    );
    expect(tile).toMatch(/h-16 w-full shrink-0 grow-0/);
    expect(tile).toMatch(/h-8 w-full shrink-0 grow-0/);
    expect(tile).toMatch(/line-clamp-2/);
    // No footnote, no price, no percentage height, the channels that made
    // height vary. Comments are stripped first (the docblock legitimately
    // EXPLAINS the removal), and `max-h-full` is exempt: it CLAMPS artwork
    // inside the fixed art zone, the opposite of a content-driven height.
    const code = tile.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/footnote|price|(?<!max-)h-full/);
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

    // Two items, one per category, the count is items, not quantities.
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
