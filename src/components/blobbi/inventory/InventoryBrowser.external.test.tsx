/**
 * Items owned in an inventory Blobbi Island does not write.
 *
 * The end of the interoperability chain: a player's kind:31633 in another
 * game's context, resolved through that game's kind:31632, its balance derived
 * through kind:1416 spends and the kind:1417 fold chain, rendered in the same
 * grid as everything else — and USABLE when, and only when, Island's
 * compatibility policy has an interpretation for it AND the balance is
 * current. Using it never goes through Island's own inventory debit; it goes
 * through the kind:1416 spend path.
 *
 * Everything here goes through the real `useInventoryCollection`, the real
 * compatibility policy, the real `resolveFromDefinition` and the real
 * Strawberry event. Only the relay-backed hooks are stood in for, because a
 * test must not depend on a relay.
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
  parseInventoryEvent,
  parseTrustedItemDefinition,
  resolveFromDefinition,
  type DiscoveredInventory,
  type ExternalInventoryState,
  type ExternalItemCatalog,
  type ResolvedBlobbiItemDefinition,
} from '@/inventory';
import { KIND_GAME_INVENTORY, type GameInventory } from '@/inventory/package';
import {
  FARM_STRAWBERRY_EVENT,
  FARM_STRAWBERRY_PRIMARY_IMAGE,
} from '@/inventory/partner-item-event-fixtures';
import { addInventoryItemQuantity, setInventoryItemQuantity } from '@nostr-games/inventory';

const mockUseIslandInventory = vi.fn();
const mockUseItemCatalog = vi.fn();
const mockUseExternalInventories = vi.fn();
const mockUseExternalItemCatalog = vi.fn();
const mockUseExternalInventoryStates = vi.fn();
const mockUseOptimizedStatus = vi.fn();
const mockUseUseItem = vi.fn();
const mockUseConsumeExternalItem = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useIslandInventory: () => mockUseIslandInventory(),
    useItemCatalog: () => mockUseItemCatalog(),
    useExternalInventories: () => mockUseExternalInventories(),
    useExternalItemCatalog: () => mockUseExternalItemCatalog(),
    useExternalInventoryStates: (inventories: DiscoveredInventory[] | undefined) =>
      mockUseExternalInventoryStates(inventories),
    useUseItem: () => mockUseUseItem(),
    useConsumeExternalItem: () => mockUseConsumeExternalItem(),
  };
});

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => mockUseOptimizedStatus(),
}));

const OWNER = 'c'.repeat(64);
const FARM_ISSUER =
  'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const FARM_TOOL = `31632:${FARM_ISSUER}:farm:tool:hoe`;

/** The real definition, resolved by the real generic normalization. */
const STRAWBERRY_DEFINITION = resolveFromDefinition(
  parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!,
);

/** A trusted Farm item that is NOT edible food: same issuer, other semantics. */
const FARM_TOOL_DEFINITION: ResolvedBlobbiItemDefinition = {
  ...STRAWBERRY_DEFINITION,
  address: FARM_TOOL,
  d: 'farm:tool:hoe',
  name: 'Hoe',
  type: 'material',
  category: 'food', // deliberately mis-filed as food: category alone must not make it usable
  topics: ['tool'],
};

function snapshotFor(id: string, items: [string, number][]): GameInventory {
  const tags: string[][] = [['d', id]];
  for (const [address, quantity] of items) tags.push(['a', address, 'wss://relay.primal.net', String(quantity)]);
  return parseInventoryEvent({
    id: `snap-${id}`,
    pubkey: OWNER,
    created_at: 1788395700,
    kind: KIND_GAME_INVENTORY,
    tags,
    content: '',
    sig: '',
  })!;
}

function farmInventory(quantity: number, id = 'farm:main', address = STRAWBERRY): DiscoveredInventory {
  return {
    id,
    address: `31633:${OWNER}:${id}`,
    owner: OWNER,
    contexts: ['game:farm'],
    createdAt: 1788395700,
    items: [{ address, relay: 'wss://relay.primal.net', quantity }],
    snapshot: snapshotFor(id, [[address, quantity]]),
  };
}

/** A ready state whose effective quantities equal the snapshot, unless overridden. */
function readyState(inventory: DiscoveredInventory, effective?: [string, number][]): ExternalInventoryState {
  let inv = inventory.snapshot;
  for (const [address, quantity] of effective ?? []) {
    inv = setInventoryItemQuantity(inv, address, quantity);
  }
  return { inventory, status: 'ready', effective: inv };
}

function statesOf(...states: ExternalInventoryState[]) {
  return new Map(states.map((state) => [state.inventory.address, state]));
}

function catalogOf(...definitions: ResolvedBlobbiItemDefinition[]): ExternalItemCatalog {
  return {
    byAddress: new Map(definitions.map((definition) => [definition.address, definition])),
    resolvedCount: definitions.length,
    requestedCount: definitions.length,
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

/** The tile containing an item's name. Async on the FIRST look. */
const tile = async (name: string) =>
  (await screen.findByText(name)).closest('[data-entry-key]')!;

let consumeIsland: ReturnType<typeof vi.fn>;
let consumeExternal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  consumeIsland = vi.fn();
  consumeExternal = vi.fn();
  mockUseIslandInventory.mockReturnValue({
    data: buildEmptyInventory(OWNER),
    isLoading: false,
  });
  mockUseItemCatalog.mockReturnValue({ data: undefined });
  mockUseExternalInventories.mockReturnValue({ data: [], isLoading: false });
  mockUseExternalItemCatalog.mockReturnValue({ data: undefined });
  mockUseExternalInventoryStates.mockReturnValue(new Map());
  mockUseUseItem.mockReturnValue({ mutate: consumeIsland, isPending: false });
  mockUseConsumeExternalItem.mockReturnValue({ mutate: consumeExternal, isPending: false });
  mockUseOptimizedStatus.mockReturnValue({
    status: { currentPet: { id: 'blobbi-1', stage: 'baby' }, allPets: [] },
  });
});

function showFarm(inventory: DiscoveredInventory, state: ExternalInventoryState = readyState(inventory)) {
  mockUseExternalInventories.mockReturnValue({ data: [inventory], isLoading: false });
  mockUseExternalItemCatalog.mockReturnValue({ data: catalogOf(STRAWBERRY_DEFINITION, FARM_TOOL_DEFINITION) });
  mockUseExternalInventoryStates.mockReturnValue(statesOf(state));
}

describe("a partner item appears in the player's things", () => {
  beforeEach(() => showFarm(farmInventory(3)));

  it('shows its real name, artwork and quantity under Food', async () => {
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell.querySelector('img')?.getAttribute('src')).toBe(FARM_STRAWBERRY_PRIMARY_IMAGE);
    expect(cell.textContent).toContain('3');
  });

  it("is classified as FOOD, from the definition's own `category` tag", async () => {
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
    expect(cell.textContent).not.toContain('farm:main');
    expect(cell.textContent).not.toContain('31632');
    expect(cell.textContent).not.toContain(FARM_ISSUER);
  });

  it('records its source inventory internally', async () => {
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell).toHaveAttribute('data-entry-key', entryKey('farm:main', STRAWBERRY));
    expect(cell).toHaveAttribute('data-source', 'external');
    expect(cell).toHaveAttribute('data-availability', 'ready');
  });
});

describe('the quantity is the EFFECTIVE balance, not the raw snapshot', () => {
  it('shows the derived quantity when pending spends have debited the snapshot', async () => {
    const inventory = farmInventory(3);
    showFarm(inventory, readyState(inventory, [[STRAWBERRY, 2]]));
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell.textContent).toContain('2');
    expect(cell.textContent).not.toContain('3');
  });

  it('shows no row for an item pending spends have fully consumed', async () => {
    const inventory = farmInventory(1);
    showFarm(inventory, readyState(inventory, [[STRAWBERRY, 0]]));
    render(browser());
    expect(await screen.findByText(/bag is empty|Nothing to collect/i)).toBeInTheDocument();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });
});

describe('a compatible partner item is USABLE through the spend path', () => {
  beforeEach(() => showFarm(farmInventory(3)));

  it('offers the consume dialog and spends from the EXACT source inventory', async () => {
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell.closest('button') ?? (cell.tagName === 'BUTTON' ? cell : null)).not.toBeNull();

    fireEvent.click(cell);
    // The consume dialog shows Island's interpretation: one food segment.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).toContain('25');

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));

    expect(consumeExternal).toHaveBeenCalledTimes(1);
    const [input] = consumeExternal.mock.calls[0];
    expect(input.inventory.address).toBe(`31633:${OWNER}:farm:main`);
    expect(input.itemAddress).toBe(STRAWBERRY);
    expect(input.petId).toBe('blobbi-1');
    expect(input.compatibility).toEqual({ action: 'feed', profile: 'raw-produce', hungerSegments: 1 });
    // Never Island's own inventory debit.
    expect(consumeIsland).not.toHaveBeenCalled();
  });

  it('spends ONE unit per action', async () => {
    render(browser());
    fireEvent.click(await tile('Strawberry'));
    const dialog = await screen.findByRole('dialog');
    // The quantity stepper cannot exceed one for an external item.
    expect(dialog.textContent).not.toContain('/ 3');
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(consumeExternal).toHaveBeenCalledTimes(1);
  });

  it('disables the dialog while a spend is in flight', async () => {
    mockUseConsumeExternalItem.mockReturnValue({ mutate: consumeExternal, isPending: true });
    render(browser());
    fireEvent.click(await tile('Strawberry'));
    await screen.findByRole('dialog');
    const use = screen.getByRole('button', { name: /Using/ });
    expect(use).toBeDisabled();
  });
});

describe('what stays display-only', () => {
  it('a trusted item without edible-food semantics, whatever its category says', async () => {
    const inventory = farmInventory(2, 'farm:main', FARM_TOOL);
    showFarm(inventory);
    render(browser());
    const cell = await tile('Hoe');
    expect(cell.closest('button')).toBeNull();
    expect(cell).toHaveAttribute('data-readonly-item', FARM_TOOL);
    fireEvent.click(cell);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumeExternal).not.toHaveBeenCalled();
  });

  it('a compatible item whose inventory is still syncing', async () => {
    const inventory = farmInventory(3);
    showFarm(inventory, { inventory, status: 'loading' });
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell).toHaveAttribute('data-availability', 'loading');
    expect(cell.textContent).toContain('Syncing');
    expect(cell.closest('button')).toBeNull();
    fireEvent.click(cell);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a compatible item whose fold chain could not be verified', async () => {
    const inventory = farmInventory(3);
    showFarm(inventory, { inventory, status: 'unresolved', problems: [] });
    render(browser());
    const cell = await tile('Strawberry');
    expect(cell).toHaveAttribute('data-availability', 'unresolved');
    expect(cell.textContent).toContain('Unavailable');
    expect(cell.closest('button')).toBeNull();
    fireEvent.click(cell);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consumeExternal).not.toHaveBeenCalled();
  });
});

describe('provenance is kept, not merged', () => {
  it('gives the same item in two inventories two stable rows, each its own spend source', async () => {
    const main = farmInventory(3);
    const chest = farmInventory(2, 'guild:chest');
    mockUseExternalInventories.mockReturnValue({ data: [main, chest], isLoading: false });
    mockUseExternalItemCatalog.mockReturnValue({ data: catalogOf(STRAWBERRY_DEFINITION) });
    mockUseExternalInventoryStates.mockReturnValue(statesOf(readyState(main), readyState(chest)));

    render(browser());

    const tiles = await screen.findAllByText('Strawberry');
    expect(tiles).toHaveLength(2);
    const keys = tiles.map((t) => t.closest('[data-entry-key]')!.getAttribute('data-entry-key'));
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain(entryKey('farm:main', STRAWBERRY));
    expect(keys).toContain(entryKey('guild:chest', STRAWBERRY));

    // Pressing the chest's row spends from the chest, not from farm:main.
    const chestTile = tiles
      .map((t) => t.closest('[data-entry-key]')!)
      .find((t) => t.getAttribute('data-entry-key') === entryKey('guild:chest', STRAWBERRY))!;
    fireEvent.click(chestTile);
    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
    expect(consumeExternal.mock.calls[0][0].inventory.address).toBe(`31633:${OWNER}:guild:chest`);
  });
});

describe('failing closed', () => {
  it('renders nothing for an address whose definition did not resolve', async () => {
    const inventory = farmInventory(3);
    mockUseExternalInventories.mockReturnValue({ data: [inventory], isLoading: false });
    mockUseExternalItemCatalog.mockReturnValue({
      data: { byAddress: new Map(), resolvedCount: 0, requestedCount: 1 },
    });
    mockUseExternalInventoryStates.mockReturnValue(statesOf(readyState(inventory)));

    render(browser());

    expect(await screen.findByText(/bag is empty|Nothing to collect/i)).toBeInTheDocument();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });

  it('shows the loading state, not an empty bag, while discovery has not answered', async () => {
    mockUseExternalInventories.mockReturnValue({ data: undefined, isLoading: true });
    mockUseExternalItemCatalog.mockReturnValue({ data: undefined });

    render(browser());
    expect(await screen.findByText(/Opening your things/i)).toBeInTheDocument();
    expect(screen.queryByText(/bag is empty|Nothing to collect/i)).toBeNull();
    expect(screen.queryByText('Strawberry')).toBeNull();
  });
});

describe('the island inventory is unaffected', () => {
  it('keeps its own items on their own path alongside a partner item', async () => {
    let inv = buildEmptyInventory(OWNER);
    inv = addInventoryItemQuantity(inv, itemIdToAddress('food_apple')!, 2);
    mockUseIslandInventory.mockReturnValue({ data: inv, isLoading: false });
    showFarm(farmInventory(3));

    render(browser());

    const apple = await screen.findByText('Apple');
    expect(apple.closest('button')).not.toBeNull();
    expect(apple.closest('[data-entry-key]')).toHaveAttribute(
      'data-entry-key',
      entryKey(ISLAND_INVENTORY_D, itemIdToAddress('food_apple')!),
    );
    expect(apple.closest('[data-entry-key]')).toHaveAttribute('data-source', 'island');

    // Using the apple goes through Island's own inventory debit…
    fireEvent.click(apple);
    fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
    expect(consumeIsland).toHaveBeenCalledTimes(1);
    expect(consumeIsland.mock.calls[0][0].address).toBe(itemIdToAddress('food_apple'));
    // …and never the spend path.
    expect(consumeExternal).not.toHaveBeenCalled();
  });
});
