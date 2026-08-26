/**
 * The startup reconciliation sweep — the production consumer of
 * `unresolvedCoinOps`.
 *
 * Contract: on login it reconciles unresolved Coin operations READ-ONLY
 * against the authoritative inventory; it never publishes, never converts
 * ambiguity into an answer the relay did not give, runs once per pubkey per
 * session, and is bounded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

const PUBKEY = 'e'.repeat(64);

let storedEvent: NostrEvent | null = null;
let queryUnreachable = false;
const nostrEvent = vi.fn(async () => {
  throw new Error('recovery must never publish');
});
const nostrQuery = vi.fn(async () => {
  if (queryUnreachable) throw new Error('relay unreachable');
  return storedEvent ? [storedEvent] : [];
});
const signEvent = vi.fn();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query: nostrQuery, event: nostrEvent } }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY, signer: { signEvent } } }),
}));

import {
  useCoinOpRecovery,
  resetCoinOpRecoveryRuns,
  MAX_RECOVERY_OPS,
} from './useCoinOpRecovery';
import { BLOBBI_COIN_ADDRESS } from './coin';
import {
  clearCoinOps,
  persistCoinOp,
  readCoinOp,
  unresolvedCoinOps,
  type CoinOpRecord,
} from '@/lib/coin-op-ledger';

function inventoryEvent(id: string, coinQuantity: number, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 31633,
    tags: [
      ['d', 'blobbi:island'],
      ['a', BLOBBI_COIN_ADDRESS, '', String(coinQuantity)],
    ],
    content: '',
    sig: 'sig',
  };
}

function ambiguousSpend(opId: string, overrides: Partial<CoinOpRecord> = {}): CoinOpRecord {
  return {
    opId,
    kind: 'spend',
    amount: 20,
    status: 'ambiguous',
    label: 'shop-purchase',
    balanceBefore: 100,
    publishedEventId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  storedEvent = null;
  queryUnreachable = false;
  nostrQuery.mockClear();
  nostrEvent.mockClear();
  clearCoinOps();
  resetCoinOpRecoveryRuns();
});
afterEach(() => {
  clearCoinOps();
  resetCoinOpRecoveryRuns();
});

describe('useCoinOpRecovery', () => {
  it('reconciles a landed ambiguous spend to applied, publishing nothing', async () => {
    persistCoinOp(PUBKEY, ambiguousSpend('shop-purchase:landed', { publishedEventId: 'evt-landed' }));
    storedEvent = inventoryEvent('evt-landed', 80, 2_000);

    renderHook(() => useCoinOpRecovery());

    await waitFor(() =>
      expect(readCoinOp(PUBKEY, 'shop-purchase:landed')?.status).toBe('applied'),
    );
    expect(readCoinOp(PUBKEY, 'shop-purchase:landed')?.note).toBe('reconciled-by-event-id');
    expect(nostrEvent).not.toHaveBeenCalled();
  });

  it('leaves an unprovable operation ambiguous — never success, never failure', async () => {
    persistCoinOp(PUBKEY, ambiguousSpend('shop-purchase:unclear', { publishedEventId: 'evt-mine' }));
    // The relay shows a different event and a balance matching neither
    // "landed" nor "did not land".
    storedEvent = inventoryEvent('evt-foreign', 55, 2_000);

    renderHook(() => useCoinOpRecovery());

    await waitFor(() => expect(nostrQuery).toHaveBeenCalled());
    // Give the sweep a beat to (not) do anything further.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readCoinOp(PUBKEY, 'shop-purchase:unclear')?.status).toBe('ambiguous');
  });

  it('an unreachable relay leaves records exactly as they were', async () => {
    persistCoinOp(PUBKEY, ambiguousSpend('shop-purchase:offline', { publishedEventId: 'evt-x' }));
    queryUnreachable = true;

    renderHook(() => useCoinOpRecovery());

    await waitFor(() => expect(nostrQuery).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readCoinOp(PUBKEY, 'shop-purchase:offline')?.status).toBe('ambiguous');
    expect(unresolvedCoinOps(PUBKEY)).toHaveLength(1);
  });

  it('sweeps once per pubkey per session, oldest first, bounded', async () => {
    // MAX + 2 provable records: the sweep resolves the oldest MAX and stops.
    for (let index = 0; index < MAX_RECOVERY_OPS + 2; index += 1) {
      persistCoinOp(
        PUBKEY,
        ambiguousSpend(`shop-purchase:bulk-${index}`, {
          publishedEventId: 'evt-current',
          createdAt: index + 1,
          updatedAt: index + 1,
        }),
      );
    }
    storedEvent = inventoryEvent('evt-current', 80, 2_000);

    const { rerender } = renderHook(() => useCoinOpRecovery());

    await waitFor(() => expect(unresolvedCoinOps(PUBKEY)).toHaveLength(2));
    // The two NEWEST records were beyond the bound and remain for next time.
    const remaining = unresolvedCoinOps(PUBKEY).map((record) => record.opId);
    expect(remaining).toEqual([
      `shop-purchase:bulk-${MAX_RECOVERY_OPS}`,
      `shop-purchase:bulk-${MAX_RECOVERY_OPS + 1}`,
    ]);

    // A re-render does not start a second sweep for the same pubkey.
    const queriesAfterSweep = nostrQuery.mock.calls.length;
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nostrQuery.mock.calls.length).toBe(queriesAfterSweep);
  });
});
