/**
 * Hook-level tests for the canonical inventory mutation layer.
 *
 * The Nostr relay + publish primitives are mocked so we can drive success and
 * failure deterministically and assert optimistic-cache behavior + rollback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const TEST_PUBKEY = 'a'.repeat(64);

const nostrEvent = vi.fn<(event: NostrEvent, opts?: unknown) => Promise<void>>();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const signEvent = vi.fn(
  async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
    ...t,
    tags: t.tags ?? [],
    content: t.content ?? '',
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    id: 'id-' + Math.random().toString(16).slice(2),
    pubkey: TEST_PUBKEY,
    sig: 'sig',
  }),
);

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { event: nostrEvent, query: nostrQuery } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: TEST_PUBKEY, signer: { signEvent } },
  }),
}));

import { useInventoryMutation } from './useInventoryMutation';
import {
  InventoryTransactionError,
  isAmbiguousInventoryPublish,
} from './inventory-transaction';
import {
  buildEmptyInventory,
  itemIdToAddress,
  inventoryQueryKey,
  buildInventoryTemplate,
} from './index';
import { applyMutation } from './useInventoryMutation';
import type { GameInventory } from './package';

const APPLE = itemIdToAddress('food_apple')!;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function inventoryToEvent(inv: GameInventory): NostrEvent {
  const template = buildInventoryTemplate(inv);
  return {
    id: 'inv-evt',
    pubkey: TEST_PUBKEY,
    created_at: 100,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

describe('useInventoryMutation', () => {
  beforeEach(() => {
    nostrEvent.mockReset();
    nostrQuery.mockReset();
    signEvent.mockClear();
    nostrEvent.mockResolvedValue(undefined);
    // Relay returns an empty inventory by default (fresh read).
    nostrQuery.mockResolvedValue([]);
  });

  it('optimistically updates the cache immediately', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed cache with an existing inventory.
    const seeded = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: APPLE,
      amount: 1,
    });
    client.setQueryData(inventoryQueryKey(TEST_PUBKEY), seeded);
    // Relay read returns the same seeded inventory.
    nostrQuery.mockResolvedValue([inventoryToEvent(seeded)]);

    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.mutate({ type: 'add', address: APPLE, amount: 2 });
    });

    // Optimistic cache should reflect +2 immediately (before publish resolves).
    await waitFor(() => {
      const cached = client.getQueryData<GameInventory>(
        inventoryQueryKey(TEST_PUBKEY),
      );
      const qty = cached?.items.find((i) => i.address === APPLE)?.quantity;
      expect(qty).toBe(3);
    });
  });

  it('publishes a kind:31633 event on success', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ type: 'add', address: APPLE, amount: 2 });
    });

    expect(nostrEvent).toHaveBeenCalledTimes(1);
    const published = nostrEvent.mock.calls[0][0];
    expect(published.kind).toBe(31633);
    expect(published.tags.some((t) => t[0] === 'a' && t[1] === APPLE)).toBe(true);
  });

  it('rolls back the optimistic cache on publish failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seeded = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: APPLE,
      amount: 5,
    });
    client.setQueryData(inventoryQueryKey(TEST_PUBKEY), seeded);
    nostrQuery.mockResolvedValue([inventoryToEvent(seeded)]);
    nostrEvent.mockRejectedValue(new Error('relay down'));

    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current
        .mutateAsync({ type: 'remove', address: APPLE, amount: 5 })
        .catch(() => undefined);
    });

    // After rollback the cache is restored to the pre-mutation snapshot (5).
    await waitFor(() => {
      const cached = client.getQueryData<GameInventory>(
        inventoryQueryKey(TEST_PUBKEY),
      );
      const qty = cached?.items.find((i) => i.address === APPLE)?.quantity;
      expect(qty).toBe(5);
    });
  });

  it('a publish timeout is AMBIGUOUS: the mutation rejects and never reports success', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seeded = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: APPLE,
      amount: 5,
    });
    client.setQueryData(inventoryQueryKey(TEST_PUBKEY), seeded);
    nostrQuery.mockResolvedValue([inventoryToEvent(seeded)]);
    // The relay gives no verdict in time. Before the shared transaction this
    // path (useNostrPublish) swallowed the timeout and reported success.
    const timeout = new Error('publish timed out');
    timeout.name = 'TimeoutError';
    nostrEvent.mockRejectedValue(timeout);

    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ type: 'add', address: APPLE, amount: 2 })
        .catch((err: unknown) => {
          caught = err;
        });
    });

    // The rejection carries the transaction's ambiguity vocabulary.
    expect(caught).toBeInstanceOf(InventoryTransactionError);
    expect((caught as InventoryTransactionError).reason).toBe('publish-timeout');
    expect(isAmbiguousInventoryPublish(caught)).toBe(true);
    // The mutation never presents a false confirmed state.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);

    // The optimistic +2 is rolled back — the cache does not retain an
    // unconfirmed write as though it landed (the settled-state invalidation
    // then reconciles with whatever the relay actually holds).
    await waitFor(() => {
      const cached = client.getQueryData<GameInventory>(
        inventoryQueryKey(TEST_PUBKEY),
      );
      const qty = cached?.items.find((i) => i.address === APPLE)?.quantity;
      expect(qty).toBe(5);
    });
  });

  it('reads a FRESH relay inventory as the write base (not the stale cache)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Cache is stale/empty, but the relay has 4 apples.
    const relayInv = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: APPLE,
      amount: 4,
    });
    nostrQuery.mockResolvedValue([inventoryToEvent(relayInv)]);

    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ type: 'consume', address: APPLE });
    });

    // Published event should be 3 (4 fresh - 1 consumed), NOT 0 from an empty
    // cache snapshot.
    const published = nostrEvent.mock.calls[0][0];
    const aTag = published.tags.find((t) => t[0] === 'a' && t[1] === APPLE);
    expect(aTag?.[3]).toBe('3');
  });

  it('a missing cache snapshot does NOT overwrite the existing relay inventory with an empty event', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // No cache snapshot at all; relay already holds items.
    const PIZZA = itemIdToAddress('food_pizza')!;
    const relayInv = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: PIZZA,
      amount: 5,
    });
    nostrQuery.mockResolvedValue([inventoryToEvent(relayInv)]);
    expect(client.getQueryData(inventoryQueryKey(TEST_PUBKEY))).toBeUndefined();

    const { result } = renderHook(() => useInventoryMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ type: 'add', address: APPLE, amount: 2 });
    });

    const published = nostrEvent.mock.calls[0][0];
    // The pre-existing pizza survives (not clobbered) and the apple is added.
    const pizzaTag = published.tags.find((t) => t[0] === 'a' && t[1] === PIZZA);
    const appleTag = published.tags.find((t) => t[0] === 'a' && t[1] === APPLE);
    expect(pizzaTag?.[3]).toBe('5');
    expect(appleTag?.[3]).toBe('2');
  });
});
