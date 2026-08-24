/**
 * The window is a game screen, not a document.
 *
 * The claim under test: **the primary flow needs no vertical scrolling.** jsdom
 * has no layout engine, so nothing here can measure a pixel — a rendered
 * `h-[46%]` is zero and any height assertion would be theatre. What CAN be
 * pinned is the structural reason the old shape scrolled and the new one does
 * not:
 *
 *   - the finite Blobbi content is composed HORIZONTALLY, not stacked;
 *   - every collection is bounded and paged, so owning more cannot grow it;
 *   - the detail area is height-reserved, so selecting swaps rather than adds;
 *   - transform controls are disclosed, not permanently mounted;
 *   - diagnostics cost zero height when there is nothing wrong.
 *
 * The scroll POLICY itself is documented in `docs/blobbi-inventory-design.md`;
 * this file is what stops the code drifting away from it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { BlobbiInfoModal } from './BlobbiInfoModal';
import { InventoryBrowser } from './inventory/InventoryBrowser';
import { COLLECTION_PAGE_SIZE } from './inventory/CollectionGrid';
import { buildEmptyInventory, itemIdToAddress } from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const modal = read('src/components/blobbi/BlobbiInfoModal.tsx');
const browser = read('src/components/blobbi/inventory/InventoryBrowser.tsx');

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
  // The window reads the current pet through this too; the read-only cases
  // below supply their Blobbi as external data instead.
  useCurrentPet: () => undefined,
}));

beforeEach(() => {
  mockUseItemCatalog.mockReturnValue({ data: undefined });
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
  });
  mockUseIslandInventory.mockReturnValue({
    data: buildEmptyInventory('owner'),
    isLoading: false,
  });
});

describe('the Blobbi tab fits, and reads as a hierarchy', () => {
  it('orders the four levels: mood, needs, progression, utilities', () => {
    /*
      The density pass proved the content fits (~360px in a ~525px budget) and
      then squandered the win by packing it into side-by-side blocks that read
      as six equally loud widgets. The corrective pass keeps the fit and adds
      the order: one column, loudest first, quietest last — and the utility
      strip is the ONLY two-column row left, because coins and the scene picker
      genuinely are peers.
    */
    const primary = modal.slice(
      modal.indexOf('value="primary"'),
      modal.indexOf('Wardrobe — everything'),
    );
    const order = ['<MoodHero', '<NeedMeters', '<ProgressionStrip', '<TraitChips', 'data-coin-hud']
      .map((marker) => primary.indexOf(marker));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);

    // Coins and the stage background share the one footer row.
    expect(primary).toMatch(/grid grid-cols-2 gap-2\.5/);
    expect(primary).toMatch(/data-testid="open-stage-background-picker"/);
    expect(modal).not.toMatch(/TabsContent value="primary"[^>]*space-y-4/);
  });

  it('still shows every piece of care state at once, with no extra click', async () => {
    render(
      <TestApp>
        <BlobbiInfoModal
          isOpen
          readOnly
          onClose={() => {}}
          externalBlobbiData={{
            name: 'Luna', stage: 'adult', hunger: 70, energy: 40, happiness: 90,
            health: 80, hygiene: 20, experience: 1200, careStreak: 3, generation: 2,
            personality: 'Curious',
          }}
        />
      </TestApp>,
    );

    // Compacting must never become hiding: the brief's one hard constraint.
    expect(await screen.findByTestId('mood-hero')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
    expect(screen.getByTestId('progression')).toBeInTheDocument();
    expect(screen.getByTestId('trait-chips')).toBeInTheDocument();

    // No disclosure stands between the player and their pet's state.
    const petCard = screen.getByTestId('mood-hero').closest('[role="tabpanel"]')!;
    expect(petCard.querySelectorAll('details')).toHaveLength(0);
  });
});

describe('collections are bounded, so the window cannot grow', () => {
  it('pages the grid rather than listing everything', () => {
    expect(browser).toMatch(/<CollectionGrid/);
    // The old unbounded grid is gone: no surface renders every tile at once.
    expect(browser).not.toMatch(/visible\.map\(\(entry\) => \(/);
  });

  it('shows one page of a large inventory', async () => {
    let inv = buildEmptyInventory('owner');
    for (const id of ['food_apple', 'food_bread', 'food_cake', 'toy_ball']) {
      const address = itemIdToAddress(id);
      if (address) inv = addInventoryItemQuantity(inv, address, 2);
    }
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(
      <TestApp>
        <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
      </TestApp>,
    );

    await screen.findByTestId('collection-grid');
    const shown = screen
      .getByTestId('collection-grid')
      .querySelectorAll('[data-testid^="item-"]');
    expect(shown.length).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE);
  });

  it('reserves the wardrobe detail area, and gives Items none at all', async () => {
    /*
      The detail box is reserved height on WEARABLE surfaces (the prompt and
      the panel share one box, so selecting swaps rather than adds) and absent
      on the Items surface, where a consumable's click opens the consume dialog
      directly and a master-detail column would be dead chrome.
    */
    expect(browser).toMatch(/min-h-\[7\.5rem\] shrink-0 lg:min-h-0/);
    expect(browser).toMatch(/\{selectable && \(/);

    let inv = buildEmptyInventory('owner');
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 3);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

    render(
      <TestApp>
        <InventoryBrowser
          characterId="blobbi-1"
          categories={['food', 'toy', 'care', 'currency']}
          onEquip={() => {}}
          onUnequip={() => {}}
        />
      </TestApp>,
    );

    await screen.findByText('Apple');
    expect(screen.queryByText(/pick something/i)).toBeNull();
    // Clicking a consumable opens the dialog — it does not grow the tab with a
    // detail card first.
    fireEvent.click(screen.getByTestId(`item-${itemIdToAddress('food_apple')}`));
    expect(await screen.findByRole('dialog', { name: 'Use item' })).toBeInTheDocument();
    expect(screen.queryByTestId('item-detail')).toBeNull();
  });
});

describe('height is spent only when it is asked for', () => {
  it('discloses the transform controls instead of mounting them', () => {
    // Three controls and a paragraph, ~120px, for a player who is not adjusting
    // anything. Selecting a worn item now offers "Adjust"; only that opens them.
    expect(browser).toMatch(/data-testid=\{`adjust-\$\{entry\.slot\}`\}/);
    expect(browser).toMatch(/data-testid="done-adjusting"/);
    expect(browser).toMatch(/adjusting && \(/);
    // And selecting no longer arms the slot by itself.
    expect(browser).toMatch(/const select = \(entry: CollectionEntry\) => \{[\s\S]*?onSelectSlot\?\.\(null\);/);
  });

  it('costs nothing for diagnostics when there is nothing wrong', async () => {
    render(
      <TestApp>
        <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
      </TestApp>,
    );
    // One compact disclosure when there IS something, and absent otherwise.
    expect(browser).toMatch(/\{issueCount > 0 && \(/);
    expect(screen.queryByTestId('inventory-diagnostics')).toBeNull();
  });
});

describe('the scroll architecture', () => {
  it('keeps exactly one scroll region in the window', () => {
    // The frame's own scroller is handed back via `bodyClassName`; the stage
    // does not scroll; the tab strip is `shrink-0`. Everything else is bounded.
    const scrollers = modal.match(/overflow-y-auto/g) ?? [];
    expect(scrollers).toHaveLength(1);
  });

  it('lets only the diagnostics disclosure scroll inside a tab', () => {
    // The documented escape hatch: exceptional content may scroll, the tab may
    // not. `max-h-40` bounds it so even that cannot grow the panel.
    expect(browser).toMatch(/max-h-40 overflow-y-auto/);
    expect(read('src/components/blobbi/EffectsPanel.tsx')).toMatch(/max-h-40 .*overflow-y-auto/);
  });
});
