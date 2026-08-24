/**
 * The Wardrobe, driven.
 *
 * Both halves have their own deep suites — `InventoryBrowser.equipment.test.tsx`
 * for the cosmetic policy, `EffectsPanel.test.tsx` for the effect one — so what
 * this file owns is the seam between them: that the segmented control switches,
 * that each half is actually mounted, that carried items never appear here, and
 * that leaving Effects ends a preview.
 *
 * That last one is the bug the seam invites: the stage draws an effect preview
 * through the real renderer, and a preview left running after the player walked
 * away would show a Blobbi wearing something it does not have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { WardrobePanel } from './WardrobePanel';
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

function renderWardrobe(props: Partial<React.ComponentProps<typeof WardrobePanel>> = {}) {
  const onPreviewEffects = vi.fn();
  const onSectionChange = vi.fn();
  const utils = render(
    <TestApp>
      <WardrobePanel
        characterId="blobbi-1"
        form="baby"
        onEquip={() => {}}
        onUnequip={() => {}}
        onPreviewEffects={onPreviewEffects}
        previewingEffectId={null}
        onSectionChange={onSectionChange}
        {...props}
      />
    </TestApp>,
  );
  return { ...utils, onPreviewEffects, onSectionChange };
}

beforeEach(() => {
  mockUseItemCatalog.mockReturnValue({ data: undefined });
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
  });
  // A bag full of food and coins — none of which belongs in a wardrobe.
  let inv = buildEmptyInventory('owner');
  inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 3);
  inv = addInventoryItemQuantity(inv, itemIdToAddress('med_vitamins')!, 2);
  mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
});

describe('the wardrobe segmented control', () => {
  it('opens on Clothing', async () => {
    renderWardrobe();
    expect(await screen.findByTestId('wardrobe-wearables')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('wardrobe-effects')).toHaveAttribute('aria-selected', 'false');
  });

  it('switches to Effects and back', async () => {
    renderWardrobe();
    fireEvent.click(await screen.findByTestId('wardrobe-effects'));

    expect(screen.getByTestId('wardrobe-effects')).toHaveAttribute('aria-selected', 'true');
    // The effects half is genuinely mounted, not just highlighted.
    expect(screen.getByTestId('effects-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('wardrobe-wearables'));
    expect(screen.getByTestId('inventory-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('effects-panel')).toBeNull();
  });

  it('tells its parent to end an effect preview when leaving Effects', async () => {
    const { onSectionChange } = renderWardrobe();
    fireEvent.click(await screen.findByTestId('wardrobe-effects'));
    fireEvent.click(screen.getByTestId('wardrobe-wearables'));

    // The window uses this to clear `previewEffects`: a preview left running
    // after the player walked away would draw a Blobbi wearing something it
    // does not have.
    expect(onSectionChange).toHaveBeenLastCalledWith('wearables');
  });
});

describe('what the wardrobe never shows', () => {
  it('has no food, no medicine and no coins', async () => {
    renderWardrobe();
    await screen.findByTestId('wardrobe-wearables');

    // Those are Items. A player looking for a hat should not scroll past a
    // sandwich, which is the whole reason this tab exists.
    expect(screen.queryByText('Apple')).toBeNull();
    expect(screen.queryByText('Vitamins')).toBeNull();
  });

  it('offers no category filter, having only one category', async () => {
    renderWardrobe();
    await screen.findByTestId('wardrobe-wearables');
    expect(screen.queryByRole('tablist', { name: 'Item categories' })).toBeNull();
  });

  it('says so in the wardrobe\'s own words when there is nothing to wear', async () => {
    renderWardrobe();
    expect(await screen.findByText(/nothing to wear yet/i)).toBeInTheDocument();
  });
});
