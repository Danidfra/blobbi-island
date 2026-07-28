/**
 * Claim-ledger tests.
 *
 * The ledger is one half of the idempotency guarantee (the reducer is the
 * other), and it is the half that has to survive things React state cannot: a
 * refresh, an unmount, a second tab, and two clicks inside one tick.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  CLAIM_LEASE_TTL_MS,
  acquireClaimLock,
  claimLockKind,
  claimedRunIds,
  clearClaims,
  hasClaimed,
  isClaimLocked,
  isGrantBlocked,
  persistClaim,
  readClaim,
  readClaims,
  releaseClaimLock,
  resetClaimLocks,
  withClaimLock,
} from './arcade-claim-ledger';
import {
  ARCADE_CLAIMS_STORAGE_KEY,
  type ArcadeRewardClaim,
} from '@/arcade/arcade-reward-boundary';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function claim(overrides: Partial<ArcadeRewardClaim> = {}): ArcadeRewardClaim {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    status: 'pending',
    tickets: 6,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attempts: 0,
    failure: null,
    quantityBefore: null,
    reconcileAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetClaimLocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetClaimLocks();
});

describe('recording claims', () => {
  it('stores and reads a claim back', () => {
    expect(persistClaim(ALICE, claim())).toBe(true);
    expect(readClaim(ALICE, 'run-1')).toEqual(claim());
  });

  it('scopes claims by owner, so two accounts never see each other', () => {
    persistClaim(ALICE, claim({ status: 'claimed' }));
    expect(hasClaimed(ALICE, 'run-1')).toBe(true);
    expect(hasClaimed(BOB, 'run-1')).toBe(false);
    expect(readClaims(BOB)).toEqual({});
  });

  it('lists only FULLY claimed runs as claimed', () => {
    persistClaim(ALICE, claim({ runId: 'pending-run', status: 'publishing' }));
    persistClaim(ALICE, claim({ runId: 'paid-run', status: 'claimed' }));
    persistClaim(ALICE, claim({ runId: 'failed-run', status: 'failed' }));
    expect(claimedRunIds(ALICE)).toEqual(['paid-run']);
  });

  it('blocks a new grant for every status that may have been published', () => {
    for (const status of ['claimed', 'publishing', 'verifying', 'ambiguous'] as const) {
      clearClaims(ALICE);
      persistClaim(ALICE, claim({ status }));
      expect(isGrantBlocked(ALICE, 'run-1'), status).toBe(true);
    }
  });

  it('does NOT block a grant for a status that provably never published', () => {
    for (const status of ['pending', 'failed'] as const) {
      clearClaims(ALICE);
      persistClaim(ALICE, claim({ status }));
      expect(isGrantBlocked(ALICE, 'run-1'), status).toBe(false);
    }
  });

  it('keeps an ambiguous record readable, with its baseline intact', () => {
    persistClaim(ALICE, claim({ status: 'ambiguous', quantityBefore: 10, failure: 'verify-mismatch' }));
    expect(readClaim(ALICE, 'run-1')).toMatchObject({
      status: 'ambiguous',
      quantityBefore: 10,
      failure: 'verify-mismatch',
    });
  });

  it('repairs a record written before the baseline field existed', () => {
    localStorage.setItem(
      ARCADE_CLAIMS_STORAGE_KEY,
      JSON.stringify({
        [ALICE]: {
          'run-1': {
            runId: 'run-1',
            gameId: 'blobbi-dance',
            machineId: 'arcade-dance-machine',
            status: 'ambiguous',
            tickets: 3,
            createdAt: 1,
            updatedAt: 1,
            attempts: 1,
            failure: null,
          },
        },
      }),
    );
    // No baseline means nothing can ever be reconciled — but the record must
    // still BLOCK, which is the part that matters.
    expect(readClaim(ALICE, 'run-1')).toMatchObject({ quantityBefore: null, reconcileAttempts: 0 });
    expect(isGrantBlocked(ALICE, 'run-1')).toBe(true);
  });

  it('treats `claimed` as a one-way door in storage too', () => {
    persistClaim(ALICE, claim({ status: 'claimed' }));
    // A late failure — a retry that raced a success, a stale callback — must not
    // reopen a claim that was already confirmed.
    persistClaim(ALICE, claim({ status: 'failed', failure: 'publish-rejected' }));
    persistClaim(ALICE, claim({ status: 'ambiguous', failure: 'verify-mismatch' }));
    expect(readClaim(ALICE, 'run-1')?.status).toBe('claimed');
    expect(hasClaimed(ALICE, 'run-1')).toBe(true);
  });

  it('refuses to downgrade an ambiguous record to a fresh publishable claim', () => {
    // Structural, not merely a caller convention: a ledger that could express
    // "ambiguous → pending" is one refactor away from the 3 → 6 duplicate.
    persistClaim(ALICE, claim({ status: 'ambiguous', quantityBefore: 10 }));
    expect(persistClaim(ALICE, claim({ status: 'pending' }))).toBe(false);
    expect(persistClaim(ALICE, claim({ status: 'failed' }))).toBe(false);
    expect(readClaim(ALICE, 'run-1')?.status).toBe('ambiguous');
    expect(isGrantBlocked(ALICE, 'run-1')).toBe(true);
  });

  it('lets an ambiguous record become claimed — the one legal way out', () => {
    persistClaim(ALICE, claim({ status: 'ambiguous', quantityBefore: 10 }));
    expect(persistClaim(ALICE, claim({ status: 'claimed' }))).toBe(true);
    expect(hasClaimed(ALICE, 'run-1')).toBe(true);
  });

  it('refuses to replace an in-flight record with a brand-new pending claim', () => {
    for (const status of ['publishing', 'verifying'] as const) {
      clearClaims(ALICE);
      persistClaim(ALICE, claim({ status }));
      expect(persistClaim(ALICE, claim({ status: 'pending' })), status).toBe(false);
      expect(readClaim(ALICE, 'run-1')?.status).toBe(status);
    }
  });

  it('still allows publishing → failed, which the writer legitimately produces', () => {
    // A refusing signer throws AFTER the record has moved to `publishing`, and
    // that outcome is provably unsent.
    persistClaim(ALICE, claim({ status: 'publishing' }));
    expect(persistClaim(ALICE, claim({ status: 'failed', failure: 'sign-failed' }))).toBe(true);
    expect(readClaim(ALICE, 'run-1')?.status).toBe('failed');
  });

  it('does nothing at all without an owner', () => {
    expect(persistClaim(undefined, claim())).toBe(false);
    expect(readClaims(undefined)).toEqual({});
    expect(claimedRunIds(undefined)).toEqual([]);
  });
});

describe('surviving a hostile browser', () => {
  it('reports a refused write instead of pretending it worked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(persistClaim(ALICE, claim())).toBe(false);
  });

  it('reports a write that silently vanished — read-back, not just "no throw"', () => {
    // Quota eviction, private mode and some extensions accept `setItem` and drop
    // the value. A claim record that is not really there is exactly the state
    // that lets a grant be offered a second time, so the caller must be told.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    expect(persistClaim(ALICE, claim())).toBe(false);
  });

  it('reports a write that stored a DIFFERENT status as failed', () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      // Store a stale version of the record instead of the new one.
      real.call(
        this,
        key,
        JSON.stringify({ [ALICE]: { 'run-1': claim({ status: 'pending' }) } }),
      );
    });
    expect(persistClaim(ALICE, claim({ status: 'publishing' }))).toBe(false);
  });

  it('reads an empty ledger rather than throwing on corrupt JSON', () => {
    localStorage.setItem(ARCADE_CLAIMS_STORAGE_KEY, '{not json');
    expect(readClaims(ALICE)).toEqual({});
    expect(hasClaimed(ALICE, 'run-1')).toBe(false);
  });

  it('drops entries that are not claims, rather than trusting them', () => {
    localStorage.setItem(
      ARCADE_CLAIMS_STORAGE_KEY,
      JSON.stringify({
        [ALICE]: {
          'good-run': claim({ runId: 'good-run', status: 'claimed' }),
          'forged-run': { runId: 'forged-run', status: 'totally-claimed' },
          'junk-run': 42,
        },
      }),
    );
    expect(Object.keys(readClaims(ALICE))).toEqual(['good-run']);
    expect(hasClaimed(ALICE, 'forged-run')).toBe(false);
  });

  it('ignores a ledger that is an array or a primitive', () => {
    localStorage.setItem(ARCADE_CLAIMS_STORAGE_KEY, '[1,2,3]');
    expect(readClaims(ALICE)).toEqual({});
    localStorage.setItem(ARCADE_CLAIMS_STORAGE_KEY, '"nope"');
    expect(readClaims(ALICE)).toEqual({});
  });
});

describe('clearing', () => {
  it('clears one owner without touching another', () => {
    persistClaim(ALICE, claim({ status: 'claimed' }));
    persistClaim(BOB, claim({ status: 'claimed' }));
    clearClaims(ALICE);
    expect(hasClaimed(ALICE, 'run-1')).toBe(false);
    expect(hasClaimed(BOB, 'run-1')).toBe(true);
  });

  it('clears everything when given no owner', () => {
    persistClaim(ALICE, claim({ status: 'claimed' }));
    clearClaims();
    expect(localStorage.getItem(ARCADE_CLAIMS_STORAGE_KEY)).toBeNull();
  });
});

describe('the synchronous in-flight lock', () => {
  it('lets exactly one caller in, with no await between check and set', () => {
    expect(acquireClaimLock(ALICE, 'run-1')).toBe(true);
    expect(acquireClaimLock(ALICE, 'run-1')).toBe(false);
    expect(isClaimLocked(ALICE, 'run-1')).toBe(true);
  });

  it('is scoped to one owner and one run', () => {
    acquireClaimLock(ALICE, 'run-1');
    expect(acquireClaimLock(ALICE, 'run-2')).toBe(true);
    expect(acquireClaimLock(BOB, 'run-1')).toBe(true);
  });

  it('is releasable, and re-acquirable afterwards', () => {
    acquireClaimLock(ALICE, 'run-1');
    releaseClaimLock(ALICE, 'run-1');
    expect(isClaimLocked(ALICE, 'run-1')).toBe(false);
    expect(acquireClaimLock(ALICE, 'run-1')).toBe(true);
  });

  it('survives what React state does not — it is module-level, not a ref', () => {
    // Ten simultaneous attempts in one synchronous tick.
    const results = Array.from({ length: 10 }, () => acquireClaimLock(ALICE, 'run-1'));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});


describe('the cross-tab claim lock', () => {
  const NOW = 1_700_000_000_000;

  it('reports which mechanism this environment actually uses', () => {
    // jsdom has no Web Locks, so these tests exercise the lease fallback — which
    // is the weaker of the two and therefore the one worth covering.
    expect(claimLockKind()).toBe('lease');
  });

  it('runs the operation and releases the lease afterwards', async () => {
    const first = await withClaimLock(ALICE, 'run-1', NOW, async () => 'done');
    expect(first).toMatchObject({ acquired: true, kind: 'lease', value: 'done' });

    // Released: a second acquisition succeeds.
    const second = await withClaimLock(ALICE, 'run-1', NOW, async () => 'again');
    expect(second.acquired).toBe(true);
  });

  it('permits exactly one owner while the operation is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inner = 0;

    const held = withClaimLock(ALICE, 'run-1', NOW, async () => {
      inner += 1;
      await gate;
      return 'first';
    });

    // A "second tab" — a separate call that does not go through the
    // same-document Set — is refused while the lease is live.
    const blocked = await withClaimLock(ALICE, 'run-1', NOW, async () => {
      inner += 1;
      return 'second';
    });
    expect(blocked).toMatchObject({ acquired: false, kind: 'lease' });

    release();
    await held;
    expect(inner).toBe(1);
  });

  it('scopes the lease to one owner and one run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = withClaimLock(ALICE, 'run-1', NOW, () => gate.then(() => 'x'));

    expect((await withClaimLock(ALICE, 'run-2', NOW, async () => 1)).acquired).toBe(true);
    expect((await withClaimLock(BOB, 'run-1', NOW, async () => 1)).acquired).toBe(true);

    release();
    await held;
  });

  it('reclaims an EXPIRED lease rather than blocking for ever', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = withClaimLock(ALICE, 'run-1', NOW, () => gate.then(() => 'x'));

    // Same instant: refused.
    expect((await withClaimLock(ALICE, 'run-1', NOW, async () => 1)).acquired).toBe(false);
    // Past the TTL: the owning tab is gone, not slow.
    expect(
      (await withClaimLock(ALICE, 'run-1', NOW + CLAIM_LEASE_TTL_MS + 1, async () => 1)).acquired,
    ).toBe(true);

    release();
    await held;
  });

  it('runs WITHOUT cross-tab protection, and says so, when storage is unusable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const outcome = await withClaimLock(ALICE, 'run-1', NOW, async () => 'ran');
    // It does NOT report contention — there is no other tab, storage is simply
    // broken. The caller's durable-record requirement refuses the publish next.
    expect(outcome).toMatchObject({ acquired: true, kind: 'none', value: 'ran' });
  });

  it('releases the lease even when the operation throws', async () => {
    await expect(
      withClaimLock(ALICE, 'run-1', NOW, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await withClaimLock(ALICE, 'run-1', NOW, async () => 1)).acquired).toBe(true);
  });
});
