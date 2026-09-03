/**
 * Items owned in an inventory Blobbi Island does not write.
 *
 * The end of the interoperability chain: a player's kind:31633 in another
 * game's context, resolved through that game's kind:31632, rendered in the same
 * grid as everything else — and NOT clickable, because Blobbi cannot spend
 * something it cannot safely debit.
 *
 * Everything here goes through the real `useInventoryCollection`, the real
 * `resolveFromDefinition` and the real Strawberry event. Only the two relay
 * reads are stood in for, because a test must not depend on a relay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { InventoryBrowser } from './InventoryBrowser';
import { entryKey, type CollectionCategory } from './useInventoryCollection';
import {
  buildEmptyInventory,
  itemIdToAddress,
  ISLAND_INVENTORY_D,
  parseTrustedItemDefinition,
  resolveFromDefinition,
  type DiscoveredInventory,
  type ExternalItemCatalog,
} from '@/inventory';
import {
  FARM_STRAWBERRY_EVENT,
  FARM_STRAWBERRY_PRIMARY_IMAGE,
} from '@/inventory/partner-item-event-fixtures';
import { addInventoryItemQuantity } from '@nostr-games/inventory';

const mockUseIslandInventory = vi.fn();
const mockUseItemCatalog = vi.fn();
const mockUseExternalInventories = vi.fn();
const mockUseExternalItemCatalog = vi.fn();
const mockUseOptimizedStatus = vi.fn();
const mockUseUseItem = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useIslandInventory: () => mockUseIslandInventory(),
    useItemCatalog: () => mockUseItemCatalog(),
    useExternalInventories: () => mockUseExternalInventories(),
    useExternalItemCatalog: () => mockUseExternalItemCatalog(),
    useUseItem: () => mockUseUseItem(),
  };
});

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => mockUseOptimizedStatus(),
}));

const OWNER = 'c'.repeat(64);
const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;

/** The real definition, resolved by the real generic normalization. */
const STRAWBERRY_DEFINITION = resolveFromDefinition(
  parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!,
);

function farmInventory(quantity: number, id = 'farm:main'): DiscoveredInventory {
  return {
    id,
    address: `31633:${OWNER}:${id}`,
    owner: OWNER,
    contexts: ['game:farm'],
    createdAt: 1788395700,
    items: [{ address: STRAWBERRY, relay: 'wss://relay.primal.net', quantity }],
  };
}

function strawberryCatalog(): ExternalItemCatalog {
  return {
    byAddress: new Map([[STRAWBERRY, STRAWBERRY_DEFINITION]]),
    resolvedCount: 1,
    requestedCount: 1,
  };
}

function browser(categories: CollectionCategory[] = ['food', 'toy', 'care', 'currency']) {
  return (
    <TestApp>
      <InventoryBrowser
        characterId="blobbi-1"
        categories={categories}
        onEquip={() => {}}
        onUnequip={() => {}}
      />
    </TestApp>
  );
}

/**
 * The tile containing an item's name.
 *
 * Async on the FIRST look, like every other test in this directory: the browser
 * settles its providers before the grid paints, so a synchronous query right
 * after `render` can run before the collection exists.
 */
const tile = async (name: string) =>
  (await screen.findByText(name)).closest('[data-entry-key]')!;

beforeEach(() => {
  mockUseIslandInventory.mockReturnValue({
    data: buildEmptyInventory(OWNER),
    isLoading: false,
  });
  mockUseItemCatalog.mockReturnValue({ data: undefined });
  mockUseExternalInventories.mockReturnValue({ data: [], isLoading: false });
  mockUseExternalItemCatalog.mockReturnValue({ data: undefined });
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1' }, allPets: [] },
  });
});

describe('a partner item appears in the player\'s things', () => {
  beforeEach(() => {
    mockUseExternalInventories.mockReturnValue({ data: [farmInventory(3)], isLoading: false });
    mockUseExternalItemCatalog.mockReturnValue({ data: strawberryCatalog() });
  });

  it('shows its real name, artwork and quantity under Food', async () => {
    render(browser());

    expect(await screen.findByText('Strawberry')).toBeInTheDocument();

    const cell = (await screen.findByText('Strawberry')).closest('[data-entry-key]')!;
    expect(cell.querySelector('img')?.getAttribute('src')).toBe(
      FARM_STRAWBERRY_PRIMARY_IMAGE,
    );
    // The owned count, from the partner inventory's own `a` tag.
    expect(cell.textContent).toContain('3');

  });

  it('is classified as FOOD, from the definition\'s own `category` tag', async () => {
    // A surface responsible for food only still shows it — which is the whole
    // of the classification claim, made without any Blobbi knowledge of what a
    // strawberry is.
    render(browser(['food']));
    expect(await screen.findByText('Strawberry')).toBeInTheDocument();
  });

  it('is absent from a surface that does not show food', async () => {
    render(browser(['currency']));
    expect(await screen.findByText(/bag is empty|Nothing to collect/i)).toBeInTheDocument();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });

  it('says where it came from, without exposing any Nostr identifier', async () => {
    render(browser());

    const cell = await tile('Strawberry');
    expect(cell.textContent).toContain('Farm');
    // Nothing technical reaches the player: no address, no `d`, no pubkey.
    expect(cell.textContent).not.toContain('farm:main');
    expect(cell.textContent).not.toContain('31632');
    expect(cell.textContent).not.toContain(FARM_ISSUER);
  });

  it('is DISPLAY ONLY — no button, no consume dialog, no use call', async () => {
    const mutate = vi.fn();
    mockUseUseItem.mockReturnValue({ mutate, isPending: false });

    render(browser());

    const cell = await tile('Strawberry');
    // Marked non-actionable, exactly as currency is.
    expect(cell).toHaveAttribute('data-readonly-item', STRAWBERRY);
    expect(cell.tagName).not.toBe('BUTTON');
    expect(cell.closest('button')).toBeNull();

    fireEvent.click(cell);

    // No consume dialog opened, and nothing was debited anywhere.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('records its source inventory internally', async () => {
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell).toHaveAttribute('data-entry-key', entryKey('farm:main', STRAWBERRY));
    expect(cell).toHaveAttribute('data-source', 'external');
  });
});

describe('provenance is kept, not merged', () => {
  it('gives the same item in two inventories two stable rows', async () => {
    mockUseExternalInventories.mockReturnValue({
      data: [farmInventory(3), farmInventory(2, 'guild:chest')],
      isLoading: false,
    });
    mockUseExternalItemCatalog.mockReturnValue({ data: strawberryCatalog() });

    render(browser());

    const tiles = await screen.findAllByText('Strawberry');
    expect(tiles).toHaveLength(2);

    const keys = tiles.map((t) =>
      t.closest('[data-entry-key]')!.getAttribute('data-entry-key'),
    );
    // Two distinct rows, each naming the inventory that actually holds it. The
    // quantities are NOT summed into a number belonging to neither context.
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain(entryKey('farm:main', STRAWBERRY));
    expect(keys).toContain(entryKey('guild:chest', STRAWBERRY));
  });
});

describe('failing closed', () => {
  it('renders nothing for an address whose definition did not resolve', async () => {
    mockUseExternalInventories.mockReturnValue({ data: [farmInventory(3)], isLoading: false });
    // An untrusted or unreachable definition never reaches the catalog.
    mockUseExternalItemCatalog.mockReturnValue({
      data: { byAddress: new Map(), resolvedCount: 0, requestedCount: 1 },
    });

    render(browser());

    expect(await screen.findByText(/bag is empty|Nothing to collect/i)).toBeInTheDocument();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });

  it('renders nothing when the external read has not answered', async () => {
    mockUseExternalInventories.mockReturnValue({ data: undefined, isLoading: true });
    mockUseExternalItemCatalog.mockReturnValue({ data: undefined });

    render(browser());
    // The island read HAS answered and is empty, so the empty state is what
    // settles — and no partner item appears from a read still in flight.
    expect(await screen.findByText(/bag is empty|Nothing to collect/i)).toBeInTheDocument();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });
});

describe('the island inventory is unaffected', () => {
  it('keeps its own items usable alongside a display-only partner item', async () => {
    let inv = buildEmptyInventory(OWNER);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
    mockUseExternalInventories.mockReturnValue({ data: [farmInventory(3)], isLoading: false });
    mockUseExternalItemCatalog.mockReturnValue({ data: strawberryCatalog() });

    render(browser());

    // Blobbi's own apple is still a pressable consumable…
    const apple = await screen.findByText('Apple');
    expect(apple.closest('button')).not.toBeNull();
    expect(apple.closest('[data-entry-key]')).toHaveAttribute(
      'data-entry-key',
      entryKey(ISLAND_INVENTORY_D, itemIdToAddress('food_apple')!),
    );
    expect(apple.closest('[data-entry-key]')).toHaveAttribute('data-source', 'island');

    // …while the partner's strawberry is not.
    expect((await tile('Strawberry')).closest('button')).toBeNull();
  });
});
