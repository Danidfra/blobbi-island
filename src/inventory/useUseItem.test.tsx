/**
 * Partial-failure and eligibility tests for the consumption flow (Q8 of the
 * audit).
 *
 * Ordering: publish Blobbi interaction (1124) + state (31124) FIRST, then
 * decrement inventory (31633). We assert:
 *  - a fresh ownership check blocks using an item the player does not own
 *    (no effect published);
 *  - both steps succeed → inventoryDecremented true, no warning;
 *  - the effect publishes succeed but the decrement fails → the effect is
 *    applied, a WARNING is returned, and the flow does not throw (favor-user);
 *  - a stage-restricted item (shell repair on a baby) is rejected before any
 *    publish.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const TEST_PUBKEY = 'e'.repeat(64);

const publish = vi.fn();
const inventoryMutate = vi.fn();
const nostrQuery = vi.fn<() => Promise<NostrEvent[]>>();
const applyOptimisticUpdate = vi.fn();

let currentPet: Record<string, unknown> | null;

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: nostrQuery, event: vi.fn() } }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: publish }),
}));

vi.mock('@/hooks/useOptimizedStatus', () => ({
  useOptimizedStatus: () => ({
    status: { allPets: currentPet ? [currentPet] : [] },
    applyOptimisticUpdate,
  }),
}));

vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return {
    ...actual,
    useInventoryMutation: () => ({ mutateAsync: inventoryMutate }),
  };
});

import { useUseItem } from './useUseItem';
import {
  buildEmptyInventory,
  buildInventoryTemplate,
  applyMutation,
} from './index';
import { bundledFallbackDefinition } from './catalog-fallback';
import { itemIdToAddress } from './registry';

const APPLE = itemIdToAddress('food_apple')!;
const SHELL = itemIdToAddress('med_shell_repair')!;
const appleDef = bundledFallbackDefinition(APPLE)!;
const shellDef = bundledFallbackDefinition(SHELL)!;

function inventoryEvent(address: string, qty: number): NostrEvent {
  const inv = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
    type: 'add',
    address,
    amount: qty,
  });
  const template = buildInventoryTemplate(inv);
  return {
    id: 'inv',
    pubkey: TEST_PUBKEY,
    created_at: 10,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: 'sig',
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderUse() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useUseItem(), { wrapper: makeWrapper(client) });
}

const babyPet = {
  id: 'blobbi-1',
  stage: 'baby',
  generation: 1,
  breedingReady: false,
  careStreak: 0,
  hunger: 50,
  happiness: 50,
  health: 50,
  hygiene: 50,
  energy: 50,
  experience: 0,
  isSleeping: false,
  rawTags: [],
  rawContent: '',
};

describe('useUseItem consumption', () => {
  beforeEach(() => {
    publish.mockReset();
    inventoryMutate.mockReset();
    nostrQuery.mockReset();
    applyOptimisticUpdate.mockReset();
    currentPet = { ...babyPet };
    publish.mockResolvedValue(undefined);
    inventoryMutate.mockResolvedValue(undefined);
  });

  it('blocks use when the item is not owned (no effect published)', async () => {
    nostrQuery.mockResolvedValue([]); // empty inventory
    const { result } = renderUse();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error?.message).toMatch(/Not enough/);
    expect(publish).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });

  it('both effect and decrement succeed', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 3)]);
    const { result } = renderUse();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    // interaction (1124) + state (31124) published.
    expect(publish).toHaveBeenCalledTimes(2);
    expect(inventoryMutate).toHaveBeenCalledWith({ type: 'remove', address: APPLE, amount: 1 });
    expect(res!.inventoryDecremented).toBe(true);
    expect(res!.warning).toBeUndefined();
  });

  it('effect succeeds but decrement fails → warning, no throw', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(APPLE, 1)]);
    inventoryMutate.mockRejectedValue(new Error('relay down'));
    const { result } = renderUse();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ address: APPLE, definition: appleDef, petId: 'blobbi-1', quantity: 1 });
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(res!.inventoryDecremented).toBe(false);
    expect(res!.warning).toMatch(/not decremented/i);
  });

  it('rejects a stage-restricted item before any publish (shell repair on baby)', async () => {
    nostrQuery.mockResolvedValue([inventoryEvent(SHELL, 1)]);
    const { result } = renderUse();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ address: SHELL, definition: shellDef, petId: 'blobbi-1', quantity: 1 });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error?.message).toMatch(/cannot be used on a baby/i);
    expect(publish).not.toHaveBeenCalled();
    expect(inventoryMutate).not.toHaveBeenCalled();
  });
});
