/**
 * Redemption-ledger tests: durable records per owner, honest persist-and-read-
 * back, the blocking rules, and the synchronous lock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  acquireRedemptionLock,
  blockingRedemptionForPrize,
  clearRedemptions,
  confirmedPrizeIds,
  pendingDeliveries,
  persistRedemption,
  readRedemption,
  readRedemptions,
  releaseRedemptionLock,
  resetRedemptionLocks,
} from './arcade-redemption-ledger';
import type {
  ArcadePrizeRedemption,
  PrizeRedemptionStatus,
} from '@/arcade/prizes/prize-redemption';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function record(
  status: PrizeRedemptionStatus,
  overrides: Partial<ArcadePrizeRedemption> = {},
): ArcadePrizeRedemption {
  const attemptId = overrides.attemptId ?? 'attempt-1';
  const prizeId = overrides.prizeId ?? 'neon-star-glasses';
  return {
    redemptionId: `${prizeId}:${attemptId}`,
    prizeId,
    attemptId,
    price: 40,
    catalogueVersion: 'temp-v1',
    status,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attempts: 1,
    failure: null,
    quantityBefore: 100,
    reconcileAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetRedemptionLocks();
});

afterEach(() => {
  localStorage.clear();
  resetRedemptionLocks();
});

describe('persistence', () => {
  it('writes, reads back, and scopes records to their owner', () => {
    expect(persistRedemption(OWNER, record('reserved'))).toBe(true);
    expect(readRedemption(OWNER, 'neon-star-glasses:attempt-1')?.status).toBe('reserved');
    expect(readRedemption(OTHER, 'neon-star-glasses:attempt-1')).toBeNull();
    expect(Object.keys(readRedemptions(OWNER))).toHaveLength(1);
  });

  it('refuses to persist without an owner', () => {
    expect(persistRedemption(undefined, record('reserved'))).toBe(false);
  });

  it('updates a record in place by redemption id', () => {
    persistRedemption(OWNER, record('reserved'));
    persistRedemption(OWNER, record('spending'));
    expect(readRedemption(OWNER, 'neon-star-glasses:attempt-1')?.status).toBe('spending');
    expect(Object.keys(readRedemptions(OWNER))).toHaveLength(1);
  });

  it('survives corrupted storage by reporting nothing rather than throwing', () => {
    localStorage.setItem('blobbi:arcade:prize-redemptions:v1', '{not json');
    expect(readRedemptions(OWNER)).toEqual({});
  });

  it('clears one owner without touching another', () => {
    persistRedemption(OWNER, record('confirmed'));
    persistRedemption(OTHER, record('confirmed'));
    clearRedemptions(OWNER);
    expect(readRedemptions(OWNER)).toEqual({});
    expect(Object.keys(readRedemptions(OTHER))).toHaveLength(1);
  });
});

describe('blocking', () => {
  it('blocks a new redemption for in-flight, unresolved, spent, delivering and confirmed', () => {
    for (const status of [
      'spending',
      'spend-unresolved',
      'spent',
      'delivering',
      'confirmed',
    ] as const) {
      localStorage.clear();
      persistRedemption(OWNER, record(status));
      expect(blockingRedemptionForPrize(OWNER, 'neon-star-glasses')?.status, status).toBe(status);
    }
  });

  it('does not block for abandoned reservations or provably-failed attempts', () => {
    persistRedemption(OWNER, record('reserved'));
    persistRedemption(OWNER, record('failed-before-spend', { attemptId: 'attempt-2' }));
    expect(blockingRedemptionForPrize(OWNER, 'neon-star-glasses')).toBeNull();
  });

  it('scopes blocking to the prize, not the whole counter', () => {
    persistRedemption(OWNER, record('spending'));
    expect(blockingRedemptionForPrize(OWNER, 'arcade-snack')).toBeNull();
  });

  it('reports the most recently updated blocking record', () => {
    persistRedemption(OWNER, record('confirmed', { attemptId: 'old', updatedAt: 1 }));
    persistRedemption(OWNER, record('delivering', { attemptId: 'new', updatedAt: 2 }));
    expect(blockingRedemptionForPrize(OWNER, 'neon-star-glasses')?.attemptId).toBe('new');
  });

  it('lets a REPEATABLE prize past its confirmed attempts', () => {
    persistRedemption(OWNER, record('confirmed', { prizeId: 'arcade-snack' }));
    expect(blockingRedemptionForPrize(OWNER, 'arcade-snack', true)).toBeNull();
    // The same record blocks a non-repeatable read of the same ledger.
    expect(blockingRedemptionForPrize(OWNER, 'arcade-snack', false)?.status).toBe('confirmed');
  });

  it('still blocks a repeatable prize on anything in flight or undelivered', () => {
    for (const status of ['spending', 'spend-unresolved', 'spent', 'delivering'] as const) {
      localStorage.clear();
      persistRedemption(OWNER, record(status, { prizeId: 'arcade-snack' }));
      expect(blockingRedemptionForPrize(OWNER, 'arcade-snack', true)?.status, status).toBe(
        status,
      );
    }
  });
});

describe('recovery queries', () => {
  it('lists pending deliveries oldest-first', () => {
    persistRedemption(OWNER, record('spent', { prizeId: 'arcade-snack', updatedAt: 2 }));
    persistRedemption(OWNER, record('delivering', { updatedAt: 1 }));
    persistRedemption(OWNER, record('confirmed', { prizeId: 'arcade-glow' }));
    expect(pendingDeliveries(OWNER).map((r) => r.prizeId)).toEqual([
      'neon-star-glasses',
      'arcade-snack',
    ]);
  });

  it('lists confirmed prize ids without duplicates', () => {
    persistRedemption(OWNER, record('confirmed', { attemptId: 'a1' }));
    persistRedemption(OWNER, record('confirmed', { attemptId: 'a2' }));
    persistRedemption(OWNER, record('spending', { prizeId: 'arcade-snack' }));
    expect(confirmedPrizeIds(OWNER)).toEqual(['neon-star-glasses']);
  });
});

describe('the synchronous lock', () => {
  it('grants once per owner+prize and refuses the second taker', () => {
    expect(acquireRedemptionLock(OWNER, 'neon-star-glasses')).toBe(true);
    expect(acquireRedemptionLock(OWNER, 'neon-star-glasses')).toBe(false);
    // A different prize — or a different owner — is a different lock.
    expect(acquireRedemptionLock(OWNER, 'arcade-snack')).toBe(true);
    expect(acquireRedemptionLock(OTHER, 'neon-star-glasses')).toBe(true);
  });

  it('releases', () => {
    acquireRedemptionLock(OWNER, 'neon-star-glasses');
    releaseRedemptionLock(OWNER, 'neon-star-glasses');
    expect(acquireRedemptionLock(OWNER, 'neon-star-glasses')).toBe(true);
  });
});
