/**
 * Redemption-hook lifecycle tests.
 *
 * The REAL hook, the REAL state machine, the REAL ledger in real (test)
 * localStorage — with a fake spend writer and a fake ownership store, so every
 * branch is reachable and nothing can publish. The properties pinned here are
 * the ones that protect an honest player's tickets: one spend per attempt,
 * double-clicks and remounts cannot double-spend, an unresolved spend is never
 * respent, and a paid-but-undelivered prize is recoverable without paying
 * again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useArcadePrizeRedemption } from './useArcadePrizeRedemption';
import { getArcadePrize } from '@/arcade/prizes/prize-catalogue';
import type { ArcadePrizeSpendWriter } from '@/inventory/arcade-prize-spend-writer';
import { ArcadePrizeSpendError } from '@/inventory/arcade-prize-spend-writer';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import {
  ARCADE_REDEMPTIONS_STORAGE_KEY,
  clearRedemptions,
  readRedemptions,
  resetRedemptionLocks,
} from '@/lib/arcade-redemption-ledger';
import {
  clearLocalPrizeOwnership,
  createLocalPrizeOwnership,
  type ArcadePrizeOwnership,
} from '@/lib/arcade-prize-ownership';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';

const PUBKEY = 'f'.repeat(64);
const GLASSES = getArcadePrize('neon-star-glasses')!; // 40 tickets
const SNACK = getArcadePrize('arcade-snack')!; // 20 tickets, repeatable

/**
 * Make ledger writes fail selectively: only the redemptions key, and only
 * when the serialized ledger contains `marker` (e.g. `'"status":"spending"'`).
 * Ownership writes and unrelated storage stay healthy, so a test can break
 * exactly one persistence point.
 */
function failLedgerWritesContaining(marker: string) {
  const original = Storage.prototype.setItem;
  return vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === ARCADE_REDEMPTIONS_STORAGE_KEY && value.includes(marker)) {
        throw new Error('DEV: storage refused');
      }
      return original.call(this, key, value);
    });
}

let currentUser:
  | { pubkey: string; signer: { getPublicKey: () => Promise<string> } }
  | undefined = {
  pubkey: PUBKEY,
  signer: { getPublicKey: async () => PUBKEY },
};

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser, users: currentUser ? [currentUser] : [] }),
}));

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<typeof import('@nostrify/react')>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async () => [],
        event: async () => {
          throw new Error('The test pool refuses to publish');
        },
      },
    }),
  };
});

interface FakeSpendWriterOptions {
  /** Balances returned by successive reads. Last value repeats. */
  quantities?: readonly (number | null)[];
  spendError?: unknown;
}

function fakeSpendWriter(options: FakeSpendWriterOptions = {}) {
  let reads = 0;
  let spends = 0;
  let balance = 100;
  return {
    spendCount: () => spends,
    async spendTickets(redemption) {
      spends += 1;
      if (options.spendError) throw options.spendError;
      balance -= redemption.price;
    },
    async readTicketQuantity() {
      const index = reads;
      reads += 1;
      if (options.quantities) {
        return options.quantities[Math.min(index, options.quantities.length - 1)] ?? null;
      }
      return balance;
    },
  } satisfies ArcadePrizeSpendWriter & { spendCount: () => number };
}

function fakeOwnership(options: { failGrants?: number } = {}) {
  /** pubkey → prizeId → delivered redemption ids: per-attempt, like the real store. */
  const owned = new Map<string, Map<string, Set<string>>>();
  let failures = options.failGrants ?? 0;
  let grantCalls = 0;
  let increments = 0;
  const deliveries = (pubkey: string, prizeId: string) => {
    const prizes = owned.get(pubkey) ?? new Map<string, Set<string>>();
    owned.set(pubkey, prizes);
    const set = prizes.get(prizeId) ?? new Set<string>();
    prizes.set(prizeId, set);
    return set;
  };
  return {
    /** Every call, idempotent no-ops included. */
    grantCount: () => grantCalls,
    /** Calls that actually recorded a NEW delivery. */
    incrementCount: () => increments,
    async hasPrize(pubkey: string, prizeId: string) {
      return (owned.get(pubkey)?.get(prizeId)?.size ?? 0) > 0;
    },
    async hasDelivery(pubkey: string, prizeId: string, redemptionId: string) {
      return deliveries(pubkey, prizeId).has(redemptionId);
    },
    async grantPrize(pubkey: string, prize: ArcadePrize, redemptionId: string) {
      grantCalls += 1;
      const set = deliveries(pubkey, prize.id);
      if (set.has(redemptionId)) return; // idempotent per attempt
      if (failures > 0) {
        failures -= 1;
        throw new Error('DEV: delivery refused');
      }
      set.add(redemptionId);
      increments += 1;
    },
    async listOwnedPrizes(pubkey: string) {
      return [...(owned.get(pubkey) ?? new Map<string, Set<string>>())].map(
        ([prizeId, ids]) => ({
          prizeId,
          count: ids.size,
          firstGrantedAt: 1,
          deliveredRedemptionIds: [...ids],
        }),
      );
    },
  } satisfies ArcadePrizeOwnership & {
    grantCount: () => number;
    incrementCount: () => number;
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

let attempt = 0;

function mount(options: {
  writer: ArcadePrizeSpendWriter;
  ownership?: ArcadePrizeOwnership;
}) {
  // Doubles are created ONCE per mount, not per render: a new object each
  // render would retrigger the hook's ownership memo forever.
  const ownership = options.ownership ?? fakeOwnership();
  const mintAttemptId = () => `attempt-${++attempt}`;
  return renderHook(
    () =>
      useArcadePrizeRedemption({
        writer: options.writer,
        ownership,
        mintAttemptId,
      }),
    { wrapper },
  );
}

beforeEach(() => {
  localStorage.clear();
  clearRedemptions();
  clearLocalPrizeOwnership();
  resetRedemptionLocks();
  currentUser = { pubkey: PUBKEY, signer: { getPublicKey: async () => PUBKEY } };
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  attempt = 0;
});

afterEach(() => {
  localStorage.clear();
  resetRedemptionLocks();
});

describe('the happy path', () => {
  it('spends once, delivers, confirms, and invalidates the inventory query', async () => {
    const writer = fakeSpendWriter();
    const ownership = fakeOwnership();
    queryClient.setQueryData(inventoryQueryKey(PUBKEY), { placeholder: true });
    const { result } = mount({ writer, ownership });

    let final: Awaited<ReturnType<typeof result.current.redeem>>;
    await act(async () => {
      final = await result.current.redeem(GLASSES);
    });

    expect(final!.phase).toBe('confirmed');
    expect(final!.message).toContain('Neon Star Glasses');
    expect(writer.spendCount()).toBe(1);
    expect(ownership.grantCount()).toBe(1);
    expect(result.current.ownedCounts.get(GLASSES.id)).toBe(1);
    expect(queryClient.getQueryState(inventoryQueryKey(PUBKEY))?.isInvalidated).toBe(true);
  });

  it('records the whole journey in the durable ledger', async () => {
    const { result } = mount({ writer: fakeSpendWriter() });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    const records = Object.values(readRedemptions(PUBKEY));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      prizeId: GLASSES.id,
      price: 40,
      status: 'confirmed',
      catalogueVersion: 'temp-v1',
    });
  });
});

describe('exactly-once', () => {
  it('spends once for two same-tick calls', async () => {
    const writer = fakeSpendWriter();
    const { result } = mount({ writer });
    await act(async () => {
      await Promise.all([result.current.redeem(GLASSES), result.current.redeem(GLASSES)]);
    });
    expect(writer.spendCount()).toBe(1);
  });

  it('refuses a second redemption of a confirmed non-repeatable prize without spending', async () => {
    const writer = fakeSpendWriter();
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    let second: Awaited<ReturnType<typeof result.current.redeem>>;
    await act(async () => {
      second = await result.current.redeem(GLASSES);
    });
    expect(second!.phase).toBe('confirmed');
    expect(writer.spendCount()).toBe(1);
  });

  it('a REMOUNT hydrates the unresolved spend instead of offering a fresh one', async () => {
    const writer = fakeSpendWriter({
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const first = mount({ writer });
    await act(async () => {
      await first.result.current.redeem(GLASSES);
    });
    expect(first.result.current.state.phase).toBe('spend-unresolved');
    first.unmount();

    // A fresh mount — a refresh, a reopened counter.
    const second = mount({ writer: fakeSpendWriter() });
    act(() => {
      second.result.current.hydrateForPrize(GLASSES);
    });
    expect(second.result.current.state.phase).toBe('spend-unresolved');

    // And redeeming from here does NOT spend.
    const freshWriter = fakeSpendWriter();
    const third = mount({ writer: freshWriter });
    let outcome: Awaited<ReturnType<typeof third.result.current.redeem>>;
    await act(async () => {
      outcome = await third.result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('spend-unresolved');
    expect(freshWriter.spendCount()).toBe(0);
  });
});

describe('failure before the spend', () => {
  it('is retryable, and the retry spends', async () => {
    const refusing = fakeSpendWriter({
      spendError: new ArcadePrizeSpendError('no', 'sign-failed'),
    });
    const { result } = mount({ writer: refusing });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.message).toMatch(/nothing was spent/i);

    const working = fakeSpendWriter();
    const retry = mount({ writer: working });
    let outcome: Awaited<ReturnType<typeof retry.result.current.redeem>>;
    await act(async () => {
      outcome = await retry.result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('confirmed');
    expect(working.spendCount()).toBe(1);
  });

  it('refuses to publish when the baseline cannot be read', async () => {
    const writer = fakeSpendWriter({ quantities: [null] });
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.failure).toBe('baseline-unavailable');
    expect(writer.spendCount()).toBe(0);
  });
});

describe('the unresolved spend', () => {
  it('treats a verify mismatch as unresolved, not failed', async () => {
    // baseline 100, spend "succeeds", read-back still 100 (stale relay)
    const writer = fakeSpendWriter({ quantities: [100, 100] });
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');
    expect(result.current.state.message).toMatch(/will not send it again/i);
  });

  it('reconciles read-only, then DELIVERS once the balance proves the spend', async () => {
    // spend times out; later reads show the drop.
    const writer = fakeSpendWriter({
      quantities: [100, 60],
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const ownership = fakeOwnership();
    const { result } = mount({ writer, ownership });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');
    expect(writer.spendCount()).toBe(1);

    let outcome: Awaited<ReturnType<typeof result.current.checkSpendStatus>>;
    await act(async () => {
      outcome = await result.current.checkSpendStatus(GLASSES);
    });
    expect(outcome!.phase).toBe('confirmed');
    expect(writer.spendCount()).toBe(1); // reconciliation never publishes
    expect(ownership.grantCount()).toBe(1);
  });

  it('stays unresolved when reconciliation is inconclusive', async () => {
    const writer = fakeSpendWriter({
      quantities: [100, 100, 100],
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
      await result.current.checkSpendStatus(GLASSES);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');
    expect(writer.spendCount()).toBe(1);
  });
});

describe('delivery recovery', () => {
  it('keeps a paid-but-undelivered prize recoverable, and never spends again', async () => {
    const writer = fakeSpendWriter();
    const ownership = fakeOwnership({ failGrants: 1 });
    const { result } = mount({ writer, ownership });

    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('delivery-recovery');
    expect(result.current.state.message).toMatch(/without paying again/i);
    expect(writer.spendCount()).toBe(1);

    // The recovery: redeeming again goes straight to delivery.
    let outcome: Awaited<ReturnType<typeof result.current.redeem>>;
    await act(async () => {
      outcome = await result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('confirmed');
    expect(writer.spendCount()).toBe(1);
    expect(ownership.grantCount()).toBe(2);
  });

  it('lists pending deliveries for a refresh to reconcile', async () => {
    const ownership = fakeOwnership({ failGrants: 1 });
    const { result } = mount({ writer: fakeSpendWriter(), ownership });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    const pending = result.current.listPendingDeliveries();
    expect(pending.map((r) => r.prizeId)).toEqual([GLASSES.id]);

    // The refresh path: finishDelivery on the listed record.
    await act(async () => {
      await result.current.finishDelivery(GLASSES, pending[0]);
    });
    expect(result.current.state.phase).toBe('confirmed');
    expect(result.current.listPendingDeliveries()).toEqual([]);
  });
});

describe('durable persistence is a prerequisite for publishing', () => {
  it('publishes NOTHING when the reserved record will not persist', async () => {
    const spy = failLedgerWritesContaining('"status":"reserved"');
    const writer = fakeSpendWriter();
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.failure).toBe('ledger-unavailable');
    expect(writer.spendCount()).toBe(0);
    spy.mockRestore();
  });

  it('publishes NOTHING when the SPENDING record (the baseline evidence) will not persist', async () => {
    const spy = failLedgerWritesContaining('"status":"spending"');
    const writer = fakeSpendWriter();
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.failure).toBe('ledger-unavailable');
    expect(writer.spendCount()).toBe(0);
    // No durable record claims a spend is or was in flight.
    for (const record of Object.values(readRedemptions(PUBKEY))) {
      expect(['reserved', 'failed-before-spend']).toContain(record.status);
    }
    spy.mockRestore();

    // And once storage recovers, the SAME prize redeems cleanly.
    const retryWriter = fakeSpendWriter();
    const retry = mount({ writer: retryWriter });
    let outcome: Awaited<ReturnType<typeof retry.result.current.redeem>>;
    await act(async () => {
      outcome = await retry.result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('confirmed');
    expect(retryWriter.spendCount()).toBe(1);
  });

  it('a persistence failure AFTER a possibly-published spend never becomes retryable', async () => {
    // The publish times out (possibly landed); the unresolved transition then
    // refuses to persist. The durable record stays `spending`, which must
    // hydrate as unresolved — never as a fresh Redeem.
    const spy = failLedgerWritesContaining('"status":"spend-unresolved"');
    const writer = fakeSpendWriter({
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const first = mount({ writer });
    await act(async () => {
      await first.result.current.redeem(GLASSES);
    });
    expect(first.result.current.state.phase).toBe('spend-unresolved');
    expect(writer.spendCount()).toBe(1);
    spy.mockRestore();
    first.unmount();

    const freshWriter = fakeSpendWriter();
    const second = mount({ writer: freshWriter });
    act(() => {
      second.result.current.hydrateForPrize(GLASSES);
    });
    expect(second.result.current.state.phase).toBe('spend-unresolved');
    let outcome: Awaited<ReturnType<typeof second.result.current.redeem>>;
    await act(async () => {
      outcome = await second.result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('spend-unresolved');
    expect(freshWriter.spendCount()).toBe(0);
  });

  it('a persistence failure during DELIVERY never touches the spend writer again', async () => {
    const spy = failLedgerWritesContaining('"status":"delivering"');
    const writer = fakeSpendWriter();
    const ownership = fakeOwnership();
    const { result } = mount({ writer, ownership });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    // Delivery proceeded despite the bookkeeping failure — it is idempotent
    // per redemption id and the durable `spent` record kept it recoverable.
    expect(result.current.state.phase).toBe('confirmed');
    expect(writer.spendCount()).toBe(1);
    expect(ownership.incrementCount()).toBe(1);
    spy.mockRestore();
  });

  it('does NOT report confirmed when the final record will not persist — and finalizes later without re-granting', async () => {
    const spy = failLedgerWritesContaining('"status":"confirmed"');
    const writer = fakeSpendWriter();
    const ownership = fakeOwnership();
    const { result } = mount({ writer, ownership });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('delivery-recovery');
    expect(result.current.state.message).toMatch(/could not record/i);
    // The prize IS delivered — only the record is missing.
    expect(ownership.incrementCount()).toBe(1);
    spy.mockRestore();

    // Finalization: no spend, no second increment, then durably confirmed.
    let outcome: Awaited<ReturnType<typeof result.current.redeem>>;
    await act(async () => {
      outcome = await result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('confirmed');
    expect(writer.spendCount()).toBe(1);
    expect(ownership.incrementCount()).toBe(1);
    expect(
      Object.values(readRedemptions(PUBKEY)).filter((r) => r.status === 'confirmed'),
    ).toHaveLength(1);
  });
});

describe('exact-balance reconciliation in the hook', () => {
  it('stays unresolved when the balance dropped by MORE than the price — the concurrent-spend case', async () => {
    // baseline 100, price 40, this publish never landed, another tab spent 50:
    // the balance now reads 50. The old "at least the price" rule would have
    // delivered a prize that was never paid for; the exact rule refuses.
    const writer = fakeSpendWriter({
      quantities: [100, 50, 50],
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const ownership = fakeOwnership();
    const { result } = mount({ writer, ownership });
    await act(async () => {
      await result.current.redeem(GLASSES);
      await result.current.checkSpendStatus(GLASSES);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');
    expect(writer.spendCount()).toBe(1); // reconciliation never publishes
    expect(ownership.grantCount()).toBe(0); // and never delivers on weak evidence
  });
});

describe('publication error classification', () => {
  it('treats a PROVEN all-relay rejection as retryable — only a proving writer can say so', async () => {
    const rejecting = fakeSpendWriter({
      spendError: new ArcadePrizeSpendError('every relay refused', 'publish-rejected'),
    });
    const { result } = mount({ writer: rejecting });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('failed');
    expect(result.current.state.failure).toBe('publish-rejected');
    expect(result.current.state.message).toMatch(/nothing was saved/i);
  });

  it('treats a GENERIC publication error as possibly published — unresolved, no retry', async () => {
    // The production writer lets unrecognised publish errors through raw, and
    // NPool's contract cannot prove no relay stored the event.
    const writer = fakeSpendWriter({ spendError: new Error('socket closed') });
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');
    expect(result.current.state.failure).toBe('verify-unavailable');

    const freshWriter = fakeSpendWriter();
    const retry = mount({ writer: freshWriter });
    let outcome: Awaited<ReturnType<typeof retry.result.current.redeem>>;
    await act(async () => {
      outcome = await retry.result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('spend-unresolved');
    expect(freshWriter.spendCount()).toBe(0);
  });
});

describe('repeatable prizes', () => {
  it('confirms, then allows a NEW explicit redemption; counts 1 then 2', async () => {
    const writer = fakeSpendWriter();
    const ownership = fakeOwnership();
    const { result } = mount({ writer, ownership });

    await act(async () => {
      await result.current.redeem(SNACK);
    });
    expect(result.current.state.phase).toBe('confirmed');
    expect(result.current.ownedCounts.get(SNACK.id)).toBe(1);

    await act(async () => {
      await result.current.redeem(SNACK);
    });
    expect(result.current.state.phase).toBe('confirmed');
    expect(result.current.ownedCounts.get(SNACK.id)).toBe(2);
    expect(writer.spendCount()).toBe(2);
    expect(ownership.incrementCount()).toBe(2);
    // Two attempts, two records, both confirmed.
    expect(
      Object.values(readRedemptions(PUBKEY)).filter(
        (r) => r.prizeId === SNACK.id && r.status === 'confirmed',
      ),
    ).toHaveLength(2);
  });

  it('hydrates a repeatable prize with only confirmed history to IDLE — redeemable again', async () => {
    const { result } = mount({ writer: fakeSpendWriter() });
    await act(async () => {
      await result.current.redeem(SNACK);
    });
    act(() => {
      result.current.hydrateForPrize(SNACK);
    });
    expect(result.current.state.phase).toBe('idle');
    // A NON-repeatable confirmed prize still hydrates to its confirmed state.
    await act(async () => {
      await result.current.redeem(GLASSES);
    });
    act(() => {
      result.current.hydrateForPrize(GLASSES);
    });
    expect(result.current.state.phase).toBe('confirmed');
  });

  it('an UNRESOLVED or DELIVERING attempt still blocks the next repeatable redemption', async () => {
    const writer = fakeSpendWriter({
      spendError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    });
    const { result } = mount({ writer });
    await act(async () => {
      await result.current.redeem(SNACK);
    });
    expect(result.current.state.phase).toBe('spend-unresolved');

    const freshWriter = fakeSpendWriter();
    const second = mount({ writer: freshWriter });
    let outcome: Awaited<ReturnType<typeof second.result.current.redeem>>;
    await act(async () => {
      outcome = await second.result.current.redeem(SNACK);
    });
    expect(outcome!.phase).toBe('spend-unresolved');
    expect(freshWriter.spendCount()).toBe(0);
  });

  it('retrying ONE delivery attempt never double-increments, across a remount and the REAL store', async () => {
    // The real localStorage-backed store, so this also covers "refresh
    // preserves counts and delivered redemption ids".
    const ownership = createLocalPrizeOwnership(() => 1_700_000_000_000);
    const failFinal = failLedgerWritesContaining('"status":"confirmed"');
    const first = mount({ writer: fakeSpendWriter(), ownership });
    await act(async () => {
      await first.result.current.redeem(SNACK);
    });
    expect(first.result.current.state.phase).toBe('delivery-recovery');
    failFinal.mockRestore();
    first.unmount();

    // The refresh: a new mount, a NEW real-store instance, same localStorage.
    const ownershipAfterRefresh = createLocalPrizeOwnership(() => 1_700_000_000_001);
    const second = mount({ writer: fakeSpendWriter(), ownership: ownershipAfterRefresh });
    const pending = second.result.current.listPendingDeliveries();
    expect(pending).toHaveLength(1);
    await act(async () => {
      await second.result.current.finishDelivery(SNACK, pending[0]);
    });
    expect(second.result.current.state.phase).toBe('confirmed');
    // One attempt, one count — the retry re-delivered the SAME redemption id.
    expect(second.result.current.ownedCounts.get(SNACK.id)).toBe(1);
    const owned = await ownershipAfterRefresh.listOwnedPrizes(PUBKEY);
    expect(owned[0].deliveredRedemptionIds).toHaveLength(1);
  });
});

describe('logged out', () => {
  it('fails safely without touching anything', async () => {
    currentUser = undefined;
    const writer = fakeSpendWriter();
    const { result } = mount({ writer });
    let outcome: Awaited<ReturnType<typeof result.current.redeem>>;
    await act(async () => {
      outcome = await result.current.redeem(GLASSES);
    });
    expect(outcome!.phase).toBe('failed');
    expect(outcome!.message).toMatch(/log in/i);
    expect(writer.spendCount()).toBe(0);
    await waitFor(() => expect(result.current.isLoggedIn).toBe(false));
  });
});
