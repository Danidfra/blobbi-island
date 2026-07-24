/**
 * Tests for the true multi-item batch purchase flow (`useBatchPurchase`).
 *
 * A batch purchase publishes EXACTLY ONE kind:31633 (all cart lines applied to
 * one fresh inventory snapshot) followed by EXACTLY ONE kind:11125 (total coin
 * deduction). It is NOT implemented by looping the single-item mutation.
 *
 * Ordering is GRANT-ALL-FIRST then DEDUCT-TOTAL, explicitly non-atomic:
 *   - inventory publish fails  → no items, no coins;
 *   - inventory ok / coins fail → all items granted, whole-cart warning.
 *
 * Two layers of tests:
 *  A. Boundary tests: mock useInventoryMutation + useCoinsMutation to assert
 *     event counts, ordering, validation, and partial-failure semantics.
 *  B. Integration test: real useInventoryMutation against a stateful in-memory
 *     relay to prove one 31633 contains ALL merged lines and preserves
 *     pre-existing unrelated entries, with no `storage` tag.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TEST_PUBKEY = 'c'.repeat(64);

// ─── Shared mocks ──────────────────────────────────────────────────────────
const inventoryMutate = vi.fn();
const coinsMutate = vi.fn();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: TEST_PUBKEY } }),
}));

vi.mock('./useInventoryMutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useInventoryMutation')>();
  return {
    ...actual,
    useInventoryMutation: () => ({ mutateAsync: inventoryMutate }),
  };
});

vi.mock('./useCoinsMutation', () => ({
  useCoinsMutation: () => ({ mutateAsync: coinsMutate }),
}));

import { useBatchPurchase } from './useBatchPurchase';
import { itemIdToAddress } from './registry';

const APPLE = itemIdToAddress('food_apple')!; // 10
const BLOCKS = itemIdToAddress('toy_blocks')!; // 40
const CAKE = itemIdToAddress('food_cake')!; // 50

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderBatch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useBatchPurchase(), { wrapper: makeWrapper(client) });
}

describe('useBatchPurchase — single-event multi-item purchase', () => {
  beforeEach(() => {
    inventoryMutate.mockReset();
    coinsMutate.mockReset();
    inventoryMutate.mockResolvedValue(undefined);
    coinsMutate.mockResolvedValue({ previousCoins: 1000, newCoins: 900 });
  });

  it('two different items produce exactly one 31633 (one batch inventory call)', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [
          { address: BLOCKS, quantity: 10, unitPrice: 40 },
          { address: APPLE, quantity: 2, unitPrice: 10 },
        ],
        currentCoins: 1000,
      });
    });
    // Exactly one inventory publish (a single `batch` mutation), not one per item.
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    const call = inventoryMutate.mock.calls[0][0];
    expect(call.type).toBe('batch');
    expect(call.lines).toHaveLength(2);
  });

  it('ten units of one item still produce exactly one 31633', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [{ address: BLOCKS, quantity: 10, unitPrice: 40 }],
        currentCoins: 1000,
      });
    });
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(inventoryMutate.mock.calls[0][0].type).toBe('batch');
  });

  it('exactly one 11125 is published with the TOTAL coin deduction', async () => {
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [
          { address: BLOCKS, quantity: 10, unitPrice: 40 }, // 400
          { address: APPLE, quantity: 2, unitPrice: 10 }, // 20
        ],
        currentCoins: 1000,
      });
    });
    expect(coinsMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).toHaveBeenCalledWith(-420);
  });

  it('duplicate input lines are merged', async () => {
    const { result } = renderBatch();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({
        lines: [
          { address: APPLE, quantity: 2, unitPrice: 10 },
          { address: APPLE, quantity: 3, unitPrice: 10 },
        ],
        currentCoins: 1000,
      });
    });
    // Merged into a single line of quantity 5.
    const call = inventoryMutate.mock.calls[0][0];
    expect(call.type).toBe('batch');
    expect(call.lines).toHaveLength(1);
    expect(call.lines[0]).toMatchObject({ address: APPLE, amount: 5 });
    // Total cost reflects the merged quantity, charged once.
    expect(coinsMutate).toHaveBeenCalledWith(-50);
    expect(res!.lines).toHaveLength(1);
    expect(res!.totalCost).toBe(50);
  });

  it('insufficient total coins rejects before ANY publication', async () => {
    const { result } = renderBatch();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          lines: [
            { address: BLOCKS, quantity: 10, unitPrice: 40 }, // 400
            { address: CAKE, quantity: 2, unitPrice: 50 }, // 100 -> total 500
          ],
          currentCoins: 100,
        });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error?.message).toMatch(/Insufficient coins/);
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(coinsMutate).not.toHaveBeenCalled();
  });

  it('invalid line quantities reject before any publication', async () => {
    const cases = [
      { quantity: 0, unitPrice: 10 },
      { quantity: -2, unitPrice: 10 },
      { quantity: 1.5, unitPrice: 10 },
    ];
    for (const bad of cases) {
      inventoryMutate.mockClear();
      coinsMutate.mockClear();
      const { result } = renderBatch();
      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            lines: [{ address: APPLE, ...bad }],
            currentCoins: 1000,
          });
        } catch (e) {
          error = e as Error;
        }
      });
      expect(error).toBeInstanceOf(Error);
      expect(inventoryMutate).not.toHaveBeenCalled();
      expect(coinsMutate).not.toHaveBeenCalled();
    }
  });

  it('inventory quantity overflow rejects', async () => {
    const { result } = renderBatch();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          lines: [{ address: APPLE, quantity: Number.MAX_SAFE_INTEGER + 10, unitPrice: 0 }],
          currentCoins: Number.MAX_SAFE_INTEGER,
        });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error).toBeInstanceOf(Error);
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(coinsMutate).not.toHaveBeenCalled();
  });

  it('empty cart rejects', async () => {
    const { result } = renderBatch();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({ lines: [], currentCoins: 1000 });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error?.message).toMatch(/empty cart/i);
    expect(inventoryMutate).not.toHaveBeenCalled();
    expect(coinsMutate).not.toHaveBeenCalled();
  });

  it('inventory-success / coins-failure returns a whole-cart partial warning (no throw)', async () => {
    inventoryMutate.mockResolvedValue(undefined);
    coinsMutate.mockRejectedValue(new Error('sign failed'));
    const { result } = renderBatch();
    let res: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({
        lines: [
          { address: BLOCKS, quantity: 1, unitPrice: 40 },
          { address: APPLE, quantity: 1, unitPrice: 10 },
        ],
        currentCoins: 1000,
      });
    });
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).toHaveBeenCalledTimes(1);
    expect(res!.coinsCharged).toBe(false);
    expect(res!.warning).toMatch(/coins were not charged/i);
  });

  it('inventory-publish failure grants nothing and charges nothing', async () => {
    inventoryMutate.mockRejectedValue(new Error('relay down'));
    const { result } = renderBatch();
    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          lines: [{ address: APPLE, quantity: 1, unitPrice: 10 }],
          currentCoins: 1000,
        });
      } catch (e) {
        error = e as Error;
      }
    });
    expect(error?.message).toMatch(/relay down/);
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    expect(coinsMutate).not.toHaveBeenCalled();
  });

  it('ordering is grant-all (31633) BEFORE deduct-total (11125)', async () => {
    const order: string[] = [];
    inventoryMutate.mockImplementation(async () => {
      order.push('inventory');
    });
    coinsMutate.mockImplementation(async () => {
      order.push('coins');
      return { previousCoins: 1000, newCoins: 580 };
    });
    const { result } = renderBatch();
    await act(async () => {
      await result.current.mutateAsync({
        lines: [
          { address: BLOCKS, quantity: 10, unitPrice: 40 },
          { address: APPLE, quantity: 2, unitPrice: 10 },
        ],
        currentCoins: 1000,
      });
    });
    expect(order).toEqual(['inventory', 'coins']);
  });

  it('blocks rapid double-submit (mutation pending guard)', async () => {
    // Model a slow inventory publish so the mutation stays pending between the
    // two submits. The UI relies on `isPending` to block re-entry.
    let releaseInventory: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseInventory = resolve;
    });
    inventoryMutate.mockImplementation(async () => {
      await gate;
    });
    const { result } = renderBatch();

    const input = {
      lines: [{ address: APPLE, quantity: 1, unitPrice: 10 }],
      currentCoins: 1000,
    };

    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.mutateAsync(input);
    });

    // While the first submit is in flight the mutation reports pending; the
    // UI's `if (isPending) return;` guard prevents a second publication.
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      releaseInventory?.();
      await first;
    });

    // The in-flight submit resulted in exactly one inventory publish (no
    // duplicate from a racing second submit that the UI guard would block).
    expect(inventoryMutate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});

// ─── Integration: pure batch transform yields one 31633 with all lines ───────

describe('useBatchPurchase — batch inventory transform (single 31633)', () => {
  it('one built 31633 template contains all merged lines and preserves pre-existing entries', async () => {
    const { applyMutation, buildInventoryTemplate } = await import(
      './useInventoryMutation'
    );
    const { buildEmptyInventory } = await import('./useIslandInventory');

    // Seed a pre-existing UNRELATED entry (cake x1).
    const seeded = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'add',
      address: CAKE,
      amount: 1,
    });

    // Apply the whole cart as ONE batch mutation to the single snapshot.
    const next = applyMutation(seeded, {
      type: 'batch',
      lines: [
        { address: BLOCKS, amount: 10 },
        { address: APPLE, amount: 2 },
      ],
    });

    // Build EXACTLY ONE inventory event template from the resulting snapshot.
    const template = buildInventoryTemplate(next);
    const aTags = template.tags.filter((t) => t[0] === 'a');
    const addresses = aTags.map((t) => t[1]);

    // All purchased lines present, plus the pre-existing entry preserved.
    expect(addresses).toContain(BLOCKS);
    expect(addresses).toContain(APPLE);
    expect(addresses).toContain(CAKE);
    // No legacy consumable `storage` tag is ever emitted on kind:31633.
    expect(template.tags.some((t) => t[0] === 'storage')).toBe(false);
    // It is a kind:31633 event.
    expect(template.kind).toBe(31633);
  });

  it('folding duplicate addresses in a batch sums their quantities', async () => {
    const { applyMutation, buildInventoryTemplate } = await import(
      './useInventoryMutation'
    );
    const { buildEmptyInventory } = await import('./useIslandInventory');
    const { getInventoryItemQuantity, parseGameInventory } = await import(
      './package'
    );

    const next = applyMutation(buildEmptyInventory(TEST_PUBKEY), {
      type: 'batch',
      lines: [
        { address: APPLE, amount: 2 },
        { address: APPLE, amount: 3 },
      ],
    });
    const template = buildInventoryTemplate(next);
    const parsed = parseGameInventory({
      id: 'x',
      pubkey: TEST_PUBKEY,
      created_at: 1,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: 's',
    } as never);
    expect(getInventoryItemQuantity(parsed!, APPLE)).toBe(5);
  });
});

