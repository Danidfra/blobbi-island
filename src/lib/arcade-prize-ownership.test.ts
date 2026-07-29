/**
 * Temporary-ownership tests: namespaced per owner, idempotent PER DELIVERY
 * ATTEMPT (redemption id), counting repeatable prizes once per new attempt,
 * migrating pre-identity records, and honestly failing when storage refuses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  clearLocalPrizeOwnership,
  createLocalPrizeOwnership,
} from './arcade-prize-ownership';
import { getArcadePrize } from '@/arcade/prizes/prize-catalogue';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const GLASSES = getArcadePrize('neon-star-glasses')!; // non-repeatable
const SNACK = getArcadePrize('arcade-snack')!; // repeatable

const store = createLocalPrizeOwnership(() => 1_700_000_000_000);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('grants and lookups', () => {
  it('records a delivery for its owner only, remembering the redemption id', async () => {
    await store.grantPrize(OWNER, GLASSES, 'r1');
    expect(await store.hasPrize(OWNER, GLASSES.id)).toBe(true);
    expect(await store.hasDelivery(OWNER, GLASSES.id, 'r1')).toBe(true);
    expect(await store.hasDelivery(OWNER, GLASSES.id, 'r2')).toBe(false);
    expect(await store.hasPrize(OTHER, GLASSES.id)).toBe(false);
    expect(await store.listOwnedPrizes(OWNER)).toEqual([
      {
        prizeId: GLASSES.id,
        count: 1,
        firstGrantedAt: 1_700_000_000_000,
        deliveredRedemptionIds: ['r1'],
      },
    ]);
  });

  it('is idempotent per redemption id — the recovery path may run twice', async () => {
    await store.grantPrize(OWNER, SNACK, 'r1');
    await store.grantPrize(OWNER, SNACK, 'r1');
    const [owned] = await store.listOwnedPrizes(OWNER);
    expect(owned.count).toBe(1);
    expect(owned.deliveredRedemptionIds).toEqual(['r1']);
  });

  it('counts a repeatable prize up exactly once per NEW redemption id', async () => {
    await store.grantPrize(OWNER, SNACK, 'r1');
    await store.grantPrize(OWNER, SNACK, 'r2');
    await store.grantPrize(OWNER, SNACK, 'r2'); // retried delivery of attempt 2
    const [owned] = await store.listOwnedPrizes(OWNER);
    expect(owned.count).toBe(2);
    expect(owned.deliveredRedemptionIds).toEqual(['r1', 'r2']);
  });

  it('never counts a NON-repeatable prize past one, whatever ids arrive', async () => {
    await store.grantPrize(OWNER, GLASSES, 'r1');
    await store.grantPrize(OWNER, GLASSES, 'r2'); // upstream bug — belt and braces
    const [owned] = await store.listOwnedPrizes(OWNER);
    expect(owned.count).toBe(1);
    expect(owned.deliveredRedemptionIds).toEqual(['r1', 'r2']);
  });

  it('refuses a grant with no owner or no redemption id', async () => {
    await expect(store.grantPrize('', GLASSES, 'r1')).rejects.toThrow(/owner/);
    await expect(store.grantPrize(OWNER, GLASSES, '  ')).rejects.toThrow(/redemption id/);
  });

  it('stores under a key that says TEMPORARY out loud', async () => {
    await store.grantPrize(OWNER, GLASSES, 'r1');
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => k.includes('prize-ownership:temp-'))).toBe(true);
  });

  it('reports a refused write as a delivery failure, not a silent success', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(store.grantPrize(OWNER, GLASSES, 'r1')).rejects.toThrow();
  });
});

describe('migration from pre-identity records', () => {
  it('normalises a legacy record (no deliveredRedemptionIds) and keeps its count', async () => {
    // A record written before delivery identity existed.
    localStorage.setItem(
      `blobbi:arcade:prize-ownership:temp-v1:${OWNER}`,
      JSON.stringify({
        [SNACK.id]: { prizeId: SNACK.id, count: 3, firstGrantedAt: 5 },
      }),
    );
    const [owned] = await store.listOwnedPrizes(OWNER);
    expect(owned).toEqual({
      prizeId: SNACK.id,
      count: 3,
      firstGrantedAt: 5,
      deliveredRedemptionIds: [],
    });
    // A new delivery starts recording ids from now on.
    await store.grantPrize(OWNER, SNACK, 'r-new');
    const [after] = await store.listOwnedPrizes(OWNER);
    expect(after.count).toBe(4);
    expect(after.deliveredRedemptionIds).toEqual(['r-new']);
  });
});

describe('clearing', () => {
  it('clears one owner, or every temp namespace', async () => {
    await store.grantPrize(OWNER, GLASSES, 'r1');
    await store.grantPrize(OTHER, GLASSES, 'r1');
    clearLocalPrizeOwnership(OWNER);
    expect(await store.hasPrize(OWNER, GLASSES.id)).toBe(false);
    expect(await store.hasPrize(OTHER, GLASSES.id)).toBe(true);
    clearLocalPrizeOwnership();
    expect(await store.hasPrize(OTHER, GLASSES.id)).toBe(false);
  });
});
