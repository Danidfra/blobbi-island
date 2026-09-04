/**
 * After a confirmed kind:31633 write, every reader for that pubkey must show
 * the new state, without a reload.
 *
 * ## The defect these reproduce
 *
 * Every writer invalidates the canonical inventory query, so the intent was
 * always there. What was missing is that invalidation only asks the RELAY
 * again, and a relay does not serve a replaceable event the instant it accepts
 * it. The refetch therefore raced propagation and usually won: it returned the
 * event we had just replaced, React Query stored that as fresh, and
 * `staleTime` then suppressed further refetches, so the old quantity sat on
 * screen until something remounted or the page was reloaded.
 *
 * The transaction knew the answer all along: it built and signed the very
 * event that landed. These tests pin that the confirmed event, not the race,
 * decides what the UI shows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { clearCoinOps } from '@/lib/coin-op-ledger';
import { clearSpendIntents } from '@/lib/coin-spend-intent';

const PUBKEY = 'b'.repeat(64);

/**
 * A relay that accepts writes instantly but SERVES them late, the ordinary
 * behaviour that the old invalidate-and-refetch approach lost a race with.
 */
function makeLaggingRelay(initial: NostrEvent) {
  let served = initial;
  let latest = initial;
  /** Reads keep returning the previous event until this is called. */
  const catchUp = () => {
    served = latest;
  };
  const nostr = {
    query: vi.fn(async () => [served]),
    event: vi.fn(async (event: NostrEvent) => {
      latest = event;
    }),
  };
  return { nostr, catchUp, latest: () => latest };
}

function inventoryEvent(coins: number, apples: number, createdAt: number): NostrEvent {
  const tags: string[][] = [['d', 'blobbi:island']];
  if (apples > 0) tags.push(['a', APPLE, '', String(apples)]);
  if (coins > 0) tags.push(['a', BLOBBI_COIN_ADDRESS, '', String(coins)]);
  return {
    id: `inv-${createdAt}`,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 31633,
    tags,
    content: '',
    sig: 'sig',
  };
}

const relayRef: { current: ReturnType<typeof makeLaggingRelay> | null } = { current: null };

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: relayRef.current!.nostr }),
}));
vi.mock('@/hooks/useNostr', () => ({
  useNostr: () => ({ nostr: relayRef.current!.nostr }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: PUBKEY,
      signer: {
        signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
          ...t,
          id: `signed-${t.created_at}-${Math.random().toString(16).slice(2, 8)}`,
          pubkey: PUBKEY,
          sig: 'sig',
        }),
      },
    },
  }),
}));

import { BLOBBI_COIN_ADDRESS } from './coin';
import { itemIdToAddress } from './registry';
import { useCoinBalance, useCoinWallet } from './useCoinWallet';
import { useIslandInventory } from './useIslandInventory';
import { useInventoryMutation, getQuantity } from './useInventoryMutation';
import type { NUser } from '@nostrify/react/login';
import { useBatchPurchase } from './useBatchPurchase';
import {
  clearConfirmedInventories,
  recordConfirmedInventory,
} from './confirmed-inventory';
import { useInventoryCacheSync } from './useInventoryCacheSync';
import { runInventoryTransaction } from './inventory-transaction';
import { applyMutation } from './useInventoryMutation';
import { inventoryQueryKey } from './useIslandInventory';

/** The real catalogued apple: 10 Coins, so the shop path prices it. */
const APPLE = itemIdToAddress('food_apple')!;

/** The same signer the mocked session exposes, for direct transaction writes. */
const userStub = {
  pubkey: PUBKEY,
  signer: {
    signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
      ...t,
      id: `signed-${t.created_at}-${Math.random().toString(16).slice(2, 8)}`,
      pubkey: PUBKEY,
      sig: 'sig',
    }),
  },
} as unknown as NUser;

/**
 * ONE client per test. Building it inside the wrapper component would make a
 * fresh cache on every render, which quietly detaches anything holding a
 * reference to the previous one.
 */
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Everything a feature surface would read and write, in one hook. */
function useInventorySurface() {
  return {
    balance: useCoinBalance(),
    inventory: useIslandInventory(),
    wallet: useCoinWallet(),
    mutate: useInventoryMutation(),
    batch: useBatchPurchase(),
  };
}

function renderSurface() {
  return renderHook(() => useInventorySurface(), { wrapper });
}

beforeEach(() => {
  clearCoinOps();
  clearSpendIntents();
  clearConfirmedInventories();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  relayRef.current = makeLaggingRelay(inventoryEvent(100, 1, 1_000));
});
afterEach(() => {
  clearCoinOps();
  clearSpendIntents();
  clearConfirmedInventories();
  vi.clearAllMocks();
});

describe('a confirmed write is visible immediately', () => {
  it('a Coin spend drops the rendered balance without a reload', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-1',
        amount: 20,
        label: 'test-spend',
      });
    });

    // The relay is still serving the pre-spend event; the UI must not be.
    await waitFor(() => expect(result.current.balance.balance).toBe(80));
  });

  it('a Coin grant raises the rendered balance without a reload', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.grantCoins({
        opId: 'grant-1',
        amount: 25,
        label: 'test-grant',
      });
    });

    await waitFor(() => expect(result.current.balance.balance).toBe(125));
  });

  it('an item grant raises the rendered quantity without a reload', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.mutate.mutateAsync({ type: 'add', address: APPLE, amount: 2 });
    });

    await waitFor(() =>
      expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(3),
    );
  });

  it('consuming an item lowers the rendered quantity without a reload', async () => {
    relayRef.current = makeLaggingRelay(inventoryEvent(100, 3, 1_000));
    const { result } = renderSurface();
    await waitFor(() => expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(3));

    await act(async () => {
      await result.current.mutate.mutateAsync({ type: 'remove', address: APPLE, amount: 1 });
    });

    await waitFor(() =>
      expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(2),
    );
  });

  it('a batch purchase moves Coins and items together, coherently', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.batch.mutateAsync({ lines: [{ address: APPLE, quantity: 2 }] });
    });

    // One event carried both sides, so the UI must show both.
    await waitFor(() => {
      expect(result.current.balance.balance).toBe(80); // 2 apples at 10
      expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(3);
    });
  });

  it('a later stale relay answer cannot roll the UI back', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-stale',
        amount: 20,
        label: 'test-spend',
      });
    });
    await waitFor(() => expect(result.current.balance.balance).toBe(80));

    // Force the query to run again while the relay is still behind.
    await act(async () => {
      await result.current.inventory.refetch();
    });

    expect(result.current.balance.balance).toBe(80);
  });

  it('converges to the relay once it catches up, with the same value', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-converge',
        amount: 20,
        label: 'test-spend',
      });
    });
    await waitFor(() => expect(result.current.balance.balance).toBe(80));

    relayRef.current!.catchUp();
    await act(async () => {
      await result.current.inventory.refetch();
    });

    expect(result.current.balance.balance).toBe(80);
  });

  it('preserves unrelated entries through the confirmed update', async () => {
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-lossless',
        amount: 20,
        label: 'test-spend',
      });
    });

    await waitFor(() => expect(result.current.balance.balance).toBe(80));
    // The apple the player already owned is untouched by a Coin spend.
    expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(1);
  });
});

describe('an unconfirmed write leaves no confirmed-looking state', () => {
  it('a publish timeout does not move the rendered balance', async () => {
    const relay = relayRef.current!;
    relay.nostr.event.mockImplementation(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const { result } = renderSurface();
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-ambiguous',
        amount: 20,
        label: 'test-spend',
      });
    });

    // Ambiguous: it MAY have landed, so the UI must keep showing what is
    // actually known rather than an optimistic 80.
    expect(result.current.balance.balance).toBe(100);
  });

  it('a definite failure rolls the optimistic quantity back', async () => {
    const relay = relayRef.current!;
    relay.nostr.event.mockRejectedValue(new Error('relay refused'));
    const { result } = renderSurface();
    await waitFor(() => expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(1));

    await act(async () => {
      await result.current.mutate
        .mutateAsync({ type: 'add', address: APPLE, amount: 5 })
        .catch(() => {});
    });

    await waitFor(() =>
      expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(1),
    );
  });
});

/**
 * The confirmed event reaches the cache without waiting for a read.
 *
 * The reader's fold alone would only take effect on the next refetch, which is
 * a relay round trip away. The root-mounted sync closes that gap.
 */
describe('the cache is reconciled without a round trip', () => {
  it('a confirmation alone updates every reader, with no relay read at all', async () => {
    const relay = relayRef.current!;
    const { result } = renderHook(
      () => {
        useInventoryCacheSync();
        return useInventorySurface();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.balance.balance).toBe(100));
    const readsBefore = relay.nostr.query.mock.calls.length;

    // Exactly what the transaction does the instant a relay accepts a write.
    await act(async () => {
      recordConfirmedInventory(PUBKEY, inventoryEvent(80, 1, 2_000));
    });

    await waitFor(() => expect(result.current.balance.balance).toBe(80));
    expect(getQuantity(result.current.inventory.data!, APPLE)).toBe(1);
    // The whole point: not one extra relay read was needed to get here.
    expect(relay.nostr.query.mock.calls.length).toBe(readsBefore);
  });

  it('ignores a confirmation belonging to another account', async () => {
    const { result } = renderHook(
      () => {
        useInventoryCacheSync();
        return useInventorySurface();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    act(() => {
      recordConfirmedInventory('c'.repeat(64), {
        ...inventoryEvent(9_999, 0, 5_000),
        pubkey: 'c'.repeat(64),
      });
    });

    expect(result.current.balance.balance).toBe(100);
  });

  it('never rolls the cache back to an older confirmed event', async () => {
    const { result } = renderHook(
      () => {
        useInventoryCacheSync();
        return useInventorySurface();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    await act(async () => {
      await result.current.wallet.spendCoins({
        opId: 'spend-newer',
        amount: 20,
        label: 'test-spend',
      });
    });
    await waitFor(() => expect(result.current.balance.balance).toBe(80));

    // A late callback carrying an older event must change nothing.
    act(() => {
      recordConfirmedInventory(PUBKEY, inventoryEvent(500, 1, 900));
    });

    expect(result.current.balance.balance).toBe(80);
  });
});

/**
 * Coin and Arcade Ticket writers bypass `useInventoryMutation` entirely, so
 * they would be the surfaces left stale by a hook-only fix. They share the
 * transaction, so they share the reconciliation.
 */
describe('direct transaction writers reconcile too', () => {
  it('an Arcade Ticket grant reaches the shared inventory cache', async () => {
    const { result } = renderHook(
      () => {
        useInventoryCacheSync();
        return useInventorySurface();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.balance.balance).toBe(100));

    const TICKET = itemIdToAddress('cur_arcade_ticket')!;
    await act(async () => {
      await runInventoryTransaction(
        { nostr: relayRef.current!.nostr, user: userStub },
        async (ctx) => {
          const { inventory } = await ctx.readBase();
          await ctx.publish(applyMutation(inventory, { type: 'add', address: TICKET, amount: 4 }));
        },
      );
    });

    await waitFor(() =>
      expect(getQuantity(result.current.inventory.data!, TICKET)).toBe(4),
    );
    // ...and the Coin balance rode through untouched.
    expect(result.current.balance.balance).toBe(100);
  });
});

describe('a cold cache is never fabricated as empty', () => {
  it('an unusable first read leaves the balance unknown, not zero', async () => {
    const relay = relayRef.current!;
    relay.nostr.query.mockRejectedValue(new Error('relay unreachable'));
    const { result } = renderSurface();

    // Nothing is known yet: `null` means unknown and renders as such.
    await waitFor(() => expect(result.current.inventory.isError).toBe(true));
    expect(result.current.balance.balance).toBeNull();

    await act(async () => {
      await result.current.mutate
        .mutateAsync({ type: 'add', address: APPLE, amount: 1 })
        .catch(() => {});
    });

    // The optimistic path must not invent an empty inventory here: doing so
    // rendered a real `0` for a player who actually holds 100 Coins.
    expect(result.current.balance.balance).toBeNull();
  });
});

describe('the query-key contract is pinned', () => {
  it('readers and writers cannot silently diverge', () => {
    expect(inventoryQueryKey(PUBKEY)).toEqual(['blobbi-inventory-31633', PUBKEY]);
    // Scoped by pubkey, so one account's write never lands on another's cache.
    expect(inventoryQueryKey('other')).not.toEqual(inventoryQueryKey(PUBKEY));
  });
});

/**
 * One boundary, structurally.
 *
 * The alternative to a shared reconciliation is every feature patching
 * quantities itself: Food Shop patching Coins, the Mine patching Coins,
 * `useUseItem` patching an item count, which is how the numbers drift apart
 * in the first place. This pins that no production module does that.
 */
describe('only one module writes the inventory cache', () => {
  it('no feature patches the canonical inventory query itself', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'src');

    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
      });
    })(root);

    const allowed = [
      join(root, 'inventory', 'useInventoryCacheSync.ts'), // the boundary
      join(root, 'inventory', 'useInventoryMutation.ts'), // optimistic + rollback
    ];

    const offenders = files
      .filter((file) => !allowed.includes(file))
      // Dev harnesses seed fixtures deliberately and never ship to players.
      .filter((file) => !/\/pages\/Dev[A-Za-z]+\.tsx$/.test(file))
      .filter((file) => {
        const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        return /setQueryData[\s\S]{0,80}inventoryQueryKey/.test(source);
      })
      .map((file) => file.replace(`${process.cwd()}/`, ''));

    expect(offenders).toEqual([]);
  });
});
