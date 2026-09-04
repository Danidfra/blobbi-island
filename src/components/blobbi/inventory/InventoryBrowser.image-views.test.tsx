/**
 * COMPACT UI always shows the item's primary image, never a pose-specific view.
 *
 * This is the half of the image-view integration that has nothing to do with
 * Blobbis: a bag tile, a shop card and an item-detail header are unposed cells,
 * so a definition that publishes `front`/`back`/`side-*` artwork must still be
 * *sold* and *listed* with its default picture. Showing a hat's back view in an
 * inventory grid would misrepresent the item.
 *
 * Driven through the real `InventoryBrowser` and a mocked catalog; no relay, no
 * published definition, no inventory ownership beyond the in-memory event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TestApp } from '@/test/TestApp';
import { InventoryBrowser } from './InventoryBrowser';
import {
  buildEmptyInventory,
  dTagToAddress,
  type ResolvedBlobbiItemDefinition,
} from '@/inventory';
import { addInventoryItemQuantity } from '@nostr-games/inventory';
import { ARCADE_TICKET_D } from '@/protocol/event-registry';
import { FIXTURE_IMAGE_URLS as U } from '@/inventory/item-image-fixtures';

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

const TICKET = dTagToAddress(ARCADE_TICKET_D)!;

/** The Arcade Ticket, re-published with whatever image collection a case needs. */
function ticketWithImages(
  images: ResolvedBlobbiItemDefinition['images'],
  image?: string,
): ResolvedBlobbiItemDefinition {
  return {
    address: TICKET,
    itemId: 'cur_arcade_ticket',
    d: ARCADE_TICKET_D,
    name: 'Arcade Ticket',
    type: 'currency',
    category: 'currency',
    effects: {},
    action: null,
    stages: ['egg', 'baby', 'adult'],
    emoji: '🎟️',
    ...(image ? { image } : {}),
    images,
    topics: ['currency', 'arcade'],
    slot: null,
    forms: null,
    visualDiagnostics: { slot: 'missing', forms: 'absent' },
    source: 'definition',
  };
}

function renderBagWith(definition: ResolvedBlobbiItemDefinition) {
  mockUseItemCatalog.mockReturnValue({
    data: {
      byAddress: new Map([[TICKET, definition]]),
      fetchedCount: 1,
      totalCount: 20,
    },
  });
  let inv = buildEmptyInventory('owner');
  inv = addInventoryItemQuantity(inv, TICKET, 5);
  mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });

  return render(
    <TestApp>
      <InventoryBrowser characterId="blobbi-1" onEquip={() => {}} onUnequip={() => {}} />
    </TestApp>,
  );
}

const tileImageSrc = () =>
  document.querySelector('[data-readonly-item] img')?.getAttribute('src') ?? null;

describe('inventory tiles use the primary image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOptimizedStatus.mockReturnValue({
      status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
    });
  });

  it('shows exactly one unmarked image', async () => {
    renderBagWith(ticketWithImages([{ url: U.primary }], U.primary));
    await screen.findByText('Arcade Ticket');
    expect(tileImageSrc()).toBe(U.primary);
  });

  it('prefers the unmarked image over front/back views', async () => {
    renderBagWith(
      ticketWithImages(
        [
          { url: U.primary },
          { url: U.front, marker: 'front' },
          { url: U.back, marker: 'back' },
        ],
        U.primary,
      ),
    );
    await screen.findByText('Arcade Ticket');
    expect(tileImageSrc()).toBe(U.primary);
    expect(document.body.innerHTML).not.toContain(U.front);
    expect(document.body.innerHTML).not.toContain(U.back);
  });

  it('falls back to the first valid image when every image is marked', async () => {
    renderBagWith(
      ticketWithImages([
        { url: U.sideRight, marker: 'side-right' },
        { url: U.front, marker: 'front' },
      ]),
    );
    await screen.findByText('Arcade Ticket');
    expect(tileImageSrc()).toBe(U.sideRight);
  });

  it('uses the first of several unmarked images', async () => {
    renderBagWith(
      ticketWithImages([{ url: U.primary }, { url: U.primaryAlt }], U.primary),
    );
    await screen.findByText('Arcade Ticket');
    expect(tileImageSrc()).toBe(U.primary);
  });

  it('renders the emoji when the definition has no usable image', async () => {
    renderBagWith(ticketWithImages([]));
    const label = await screen.findByText('Arcade Ticket');
    expect(tileImageSrc()).toBeNull();
    expect(label.closest('[data-readonly-item]')!.textContent).toContain('🎟️');
  });
});
