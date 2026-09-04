/**
 * What the browser tells its host after a consumption, and when.
 *
 * The contract: `onCareApplied` fires EXACTLY ONCE per successful logical
 * consumption, with the real applied change and the source's name, and never
 * for a failure, an unconfirmed spend, a pending effect or a resume that
 * found nothing left to apply. When a host shows the moment in-world, the
 * plain success toast is not shown as well; every other toast is unchanged.
 *
 * Same harness as `InventoryBrowser.external.test.tsx`: the real collection,
 * the real compatibility policy, the real Strawberry event; only the
 * relay-backed hooks and the toast are stood in for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { InventoryBrowser } from './InventoryBrowser';
import {
  buildEmptyInventory,
  itemIdToAddress,
  parseInventoryEvent,
  parseTrustedItemDefinition,
  resolveExternalInventoryState,
  resolveFromDefinition,
  type CareFeedback,
  type DiscoveredInventory,
  type ExternalInventoryState,
} from '@/inventory';
import { KIND_GAME_INVENTORY } from '@/inventory/package';
import { FARM_STRAWBERRY_EVENT } from '@/inventory/partner-item-event-fixtures';
import { addInventoryItemQuantity } from '@nostr-games/inventory';

const mockUseIslandInventory = vi.fn();
const mockUseExternalInventoryView = vi.fn();
const mockUseExternalItemCatalog = vi.fn();
const mockUseUseItem = vi.fn();
const mockUseConsumeExternalItem = vi.fn();
const toast = vi.fn();

vi.mock('@/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inventory')>();
  return {
    ...actual,
    useIslandInventory: () => mockUseIslandInventory(),
    useItemCatalog: () => ({ data: undefined }),
    useExternalInventoryView: () => mockUseExternalInventoryView(),
    useExternalItemCatalog: () => mockUseExternalItemCatalog(),
    useUseItem: () => mockUseUseItem(),
    useConsumeExternalItem: () => mockUseConsumeExternalItem(),
  };
});

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { currentPet: { id: 'blobbi-1', stage: 'baby', name: 'Moon' }, allPets: [] },
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast }),
}));

const OWNER = 'c'.repeat(64);
const FARM_ISSUER = 'f47aaf2e3279fe6fcdde556336d1f740705126c9a37e6390e2ede21165199fb4';
const STRAWBERRY = `31632:${FARM_ISSUER}:farm:produce:strawberry`;
const APPLE = itemIdToAddress('food_apple')!;
const STRAWBERRY_DEFINITION = resolveFromDefinition(parseTrustedItemDefinition(FARM_STRAWBERRY_EVENT)!);

function farmInventory(quantity: number): DiscoveredInventory {
  const snapshot = parseInventoryEvent({
    id: 'snap-farm',
    pubkey: OWNER,
    created_at: 1788395700,
    kind: KIND_GAME_INVENTORY,
    tags: [['d', 'farm:main'], ['a', STRAWBERRY, 'wss://relay.primal.net', String(quantity)]],
    content: '',
    sig: '',
  })!;
  return {
    id: 'farm:main',
    address: `31633:${OWNER}:farm:main`,
    owner: OWNER,
    contexts: ['game:farm'],
    createdAt: 1788395700,
    items: [{ address: STRAWBERRY, relay: 'wss://relay.primal.net', quantity }],
    snapshot,
  };
}

function readyState(inventory: DiscoveredInventory): ExternalInventoryState {
  const resolution = resolveExternalInventoryState({ snapshot: inventory.snapshot, folds: [], spends: [] });
  return { inventory, status: 'ready', resolution, effective: inventory.snapshot };
}

/** A mutate stand-in that resolves the way React Query would, through the per-call callbacks. */
type MutateOptions<R> = { onSuccess?: (r: R) => void; onError?: (e: Error) => void };
function resolvingWith<R>(outcome: { success: R } | { error: Error }) {
  return vi.fn((_input: unknown, options?: MutateOptions<R>) => {
    if ('success' in outcome) options?.onSuccess?.(outcome.success);
    else options?.onError?.(outcome.error);
  });
}

const FEED_25 = { action: 'feed' as const, quantity: 1, statDeltas: { hunger: 25, happiness: 0, health: 0, hygiene: 0, energy: 0 }, experienceGained: 5 };
const FEED_75 = { ...FEED_25, quantity: 3, statDeltas: { ...FEED_25.statDeltas, hunger: 75 }, experienceGained: 15 };
const SPEND_ID = 'a'.repeat(64);

let onCareApplied: ReturnType<typeof vi.fn<(f: CareFeedback) => void>>;

function browser(withHost = true) {
  return (
    <TestApp>
      <InventoryBrowser
        characterId="blobbi-1"
        categories={['food', 'toy', 'care', 'currency']}
        onEquip={() => {}}
        onUnequip={() => {}}
        {...(withHost ? { onCareApplied } : {})}
      />
    </TestApp>
  );
}

async function feed(name: string, times = 0) {
  const cell = (await screen.findByText(name)).closest('[data-entry-key]')!;
  fireEvent.click(cell);
  await screen.findByRole('dialog');
  const plus = screen.getByRole('button', { name: 'Increase quantity' });
  for (let i = 0; i < times; i += 1) fireEvent.click(plus);
  fireEvent.click(screen.getByRole('button', { name: 'Feed Blobbi' }));
}

beforeEach(() => {
  toast.mockReset();
  onCareApplied = vi.fn();
  const farm = farmInventory(3);
  mockUseExternalInventoryView.mockReturnValue({
    inventories: [farm],
    states: new Map([[farm.address, readyState(farm)]]),
    isLoading: false,
    isError: false,
    error: null,
  });
  mockUseExternalItemCatalog.mockReturnValue({
    data: { byAddress: new Map([[STRAWBERRY, STRAWBERRY_DEFINITION]]), resolvedCount: 1, requestedCount: 1 },
  });
  mockUseIslandInventory.mockReturnValue({
    data: addInventoryItemQuantity(buildEmptyInventory(OWNER), APPLE, 2),
    isLoading: false,
  });
  mockUseUseItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseConsumeExternalItem.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('a successful Farm feed', () => {
  it('tells the host once, with the real gain and the source, and skips the plain success toast', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'applied', spendId: SPEND_ID, experienceGained: 5, resumed: false, alreadyApplied: false, effect: FEED_25 } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');

    expect(onCareApplied).toHaveBeenCalledTimes(1);
    const [feedback] = onCareApplied.mock.calls[0];
    expect(feedback).toMatchObject({
      id: SPEND_ID,
      action: 'feed',
      quantity: 1,
      itemName: 'Strawberry',
      provenance: 'Nostr Farm',
      statDeltas: { hunger: 25 },
    });
    expect(toast).not.toHaveBeenCalled();
    // The dialog closed with the action.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a batch of 3 is ONE feedback carrying the applied total', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'applied', spendId: SPEND_ID, experienceGained: 15, resumed: false, alreadyApplied: false, effect: FEED_75 } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry', 2);
    expect(onCareApplied).toHaveBeenCalledTimes(1);
    expect(onCareApplied.mock.calls[0][0]).toMatchObject({ quantity: 3, statDeltas: { hunger: 75 } });
  });

  it('keeps the toast when there is more to say: a receipt warning, or a finished earlier feed', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'applied', spendId: SPEND_ID, experienceGained: 5, resumed: true, alreadyApplied: false, effect: FEED_25, warning: 'receipt not confirmed' } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');
    expect(onCareApplied).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].title).toBe('Finished an Earlier Feed');
  });

  it('without a host that shows the moment, the success toast is unchanged', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'applied', spendId: SPEND_ID, experienceGained: 5, resumed: false, alreadyApplied: false, effect: FEED_25 } }),
      isPending: false,
    });
    render(browser(false));
    await feed('Strawberry');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Item Used' });
    expect(toast.mock.calls[0][0].description).toContain('Farm');
  });
});

describe('nothing to celebrate', () => {
  it('a consumption that threw: the error toast, no feedback', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ error: new Error('The spend was refused; nothing was used. Try again in a moment.') }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');
    expect(onCareApplied).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Could Not Use Item', variant: 'destructive' });
  });

  it('an unconfirmed spend: nothing was applied, so nothing is shown as applied', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'spend-unconfirmed', spendId: SPEND_ID, resumed: false, error: 'silent' } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');
    expect(onCareApplied).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Not Confirmed Yet', variant: 'destructive' });
  });

  it('a spend whose effect is still owed: no gain to show yet', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'effect-pending', spendId: SPEND_ID, resumed: false, error: 'signer refused' } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');
    expect(onCareApplied).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Almost There' });
  });

  it('a resume that found the effect already on the pet: the toast says so, the gain is not replayed', async () => {
    mockUseConsumeExternalItem.mockReturnValue({
      mutate: resolvingWith({ success: { status: 'applied', spendId: SPEND_ID, experienceGained: 0, resumed: true, alreadyApplied: true } }),
      isPending: false,
    });
    render(browser());
    await feed('Strawberry');
    expect(onCareApplied).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0].title).toBe('Finished an Earlier Feed');
  });
});

describe('an Island item gets the same moment, without a source', () => {
  it('tells the host once, with a fresh id and no provenance', async () => {
    mockUseUseItem.mockReturnValue({
      mutate: resolvingWith({ success: { address: APPLE, petId: 'blobbi-1', quantity: 1, action: 'feed', experienceGained: 5, inventoryDecremented: true, effect: { ...FEED_25, statDeltas: { ...FEED_25.statDeltas, hunger: 20 } } } }),
      isPending: false,
    });
    render(browser());
    await feed('Apple');
    expect(onCareApplied).toHaveBeenCalledTimes(1);
    const [feedback] = onCareApplied.mock.calls[0];
    expect(feedback).toMatchObject({ action: 'feed', quantity: 1, itemName: 'Apple', statDeltas: { hunger: 20 } });
    expect(feedback.provenance).toBeUndefined();
    expect(feedback.id).not.toBe(SPEND_ID);
    expect(toast).not.toHaveBeenCalled();
  });

  it('a decrement warning still shows the moment AND the warning', async () => {
    mockUseUseItem.mockReturnValue({
      mutate: resolvingWith({ success: { address: APPLE, petId: 'blobbi-1', quantity: 1, action: 'feed', experienceGained: 5, inventoryDecremented: false, warning: 'Effect applied, but the item count was not decremented.', effect: FEED_25 } }),
      isPending: false,
    });
    render(browser());
    await feed('Apple');
    expect(onCareApplied).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].description).toContain('not decremented');
  });

  it('a failed Island feed shows the error and no moment', async () => {
    mockUseUseItem.mockReturnValue({
      mutate: resolvingWith({ error: new Error('Not enough Apple') }),
      isPending: false,
    });
    render(browser());
    await feed('Apple');
    expect(onCareApplied).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Could Not Use Item', variant: 'destructive' });
  });
});

describe('the dialog names the source', () => {
  it('for Farm produce, and not for an Apple', async () => {
    render(browser());
    fireEvent.click((await screen.findByText('Strawberry')).closest('[data-entry-key]')!);
    await screen.findByRole('dialog');
    expect(screen.getByTestId('consume-provenance')).toHaveTextContent('From Nostr Farm');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click((await screen.findByText('Apple')).closest('[data-entry-key]')!);
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('consume-provenance')).toBeNull();
  });
});
