/**
 * SHOP CARDS use the primary image, and published artwork outranks the bundled
 * local path.
 *
 * The shop is the other compact, unposed context in the app. Two properties:
 *
 *  1. a definition that publishes several views is still SOLD with its default
 *     picture — a `back` marker exists to dress a Blobbi, not to advertise;
 *  2. when an issuer says what an item looks like, that beats
 *     `FOOD_IMAGES`, which is an inferred path into this repository's `public/`
 *     tree rather than a published fact.
 *
 * The 20 published definitions carry no `image` tag today, so property 2 is
 * asserted with a fixture definition rather than by changing what the shop
 * currently shows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { FoodShopModal } from './FoodShopModal';
import {
  bundledFallbackDefinition,
  itemIdToAddress,
  type ResolvedBlobbiItemDefinition,
} from '@/inventory';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';

const mockUseItemCatalog = vi.fn();
const mockUseOptimizedStatus = vi.fn();
const mockUseBatchPurchase = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useItemCatalog: () => mockUseItemCatalog(),
    useBatchPurchase: () => mockUseBatchPurchase(),
  };
});

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => mockUseOptimizedStatus(),
}));

const APPLE = itemIdToAddress('food_apple')!;

/** The bundled local artwork the shop uses when a definition has no image. */
const BUNDLED_APPLE_IMAGE = '/assets/items/food/apple.png';

function appleWithImages(
  images: ResolvedBlobbiItemDefinition['images'],
  image?: string,
): ResolvedBlobbiItemDefinition {
  return {
    address: APPLE,
    itemId: 'food_apple',
    d: 'blobbi:food:apple',
    name: 'Apple',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 25 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🍎',
    ...(image ? { image } : {}),
    images,
    topics: ['edible', 'food'],
    slot: null,
    forms: null,
    source: 'definition',
  };
}

function renderShop(definition?: ResolvedBlobbiItemDefinition) {
  mockUseItemCatalog.mockReturnValue({
    data: definition
      ? { byAddress: new Map([[APPLE, definition]]), fetchedCount: 1, totalCount: 20 }
      : undefined,
  });
  return render(
    <TestApp>
      <FoodShopModal isOpen={true} onClose={() => {}} />
    </TestApp>,
  );
}

const appleImageSrc = () =>
  (screen.getByAltText('Apple') as HTMLImageElement).getAttribute('src');

describe('shop cards use the primary image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBatchPurchase.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseOptimizedStatus.mockReturnValue({ status: { owner: { coins: 500 } } });
  });

  it('keeps the bundled artwork for the REAL apple definition', async () => {
    // The genuine production model, straight from the bundled catalog: the
    // apple's definition carries no `image` tag, so the shop still shows the
    // local file it has always shown. This is the "nothing changed visually"
    // assertion for all 20 published definitions.
    const apple = bundledFallbackDefinition(APPLE)!;
    expect(apple.images).toEqual([]);
    renderShop(apple);
    await screen.findByAltText('Apple');
    expect(appleImageSrc()).toBe(BUNDLED_APPLE_IMAGE);
  });

  it('prefers a published primary image over the bundled local path', async () => {
    renderShop(appleWithImages([{ url: U.primary }], U.primary));
    await screen.findByAltText('Apple');
    expect(appleImageSrc()).toBe(U.primary);
  });

  it('never sells an item with a pose-specific view when a primary exists', async () => {
    renderShop(
      appleWithImages(
        [
          { url: U.primary },
          { url: U.front, marker: 'front' },
          { url: U.back, marker: 'back' },
        ],
        U.primary,
      ),
    );
    await screen.findByAltText('Apple');
    expect(appleImageSrc()).toBe(U.primary);
    expect(document.body.innerHTML).not.toContain(U.front);
    expect(document.body.innerHTML).not.toContain(U.back);
  });

  it('falls back to the first valid image when every image is marked', async () => {
    renderShop(
      appleWithImages([
        { url: U.sideRight, marker: 'side-right' },
        { url: U.front, marker: 'front' },
      ]),
    );
    await screen.findByAltText('Apple');
    expect(appleImageSrc()).toBe(U.sideRight);
  });

  it('falls back to the bundled path when the definition has no usable image', async () => {
    renderShop(appleWithImages([]));
    await screen.findByAltText('Apple');
    expect(appleImageSrc()).toBe(BUNDLED_APPLE_IMAGE);
  });
});
