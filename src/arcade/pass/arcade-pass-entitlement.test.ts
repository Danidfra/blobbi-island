/**
 * The Arcade Pass entitlement: two limits, one allowance, no stacking.
 *
 * The Pass is the only thing in the app that a player pays Tickets for and
 * then spends down locally, so the invariants here are the ones a bug would
 * turn into free plays: an allowance that never goes negative, a play that
 * cannot be spent twice, and a grant that cannot quietly reset a count the
 * player is in the middle of using.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ARCADE_PASS_DURATION_MS,
  ARCADE_PASS_FREE_PLAYS,
  arcadePassRemainingFreePlays,
  arcadePassRemainingMs,
  canRedeemArcadePass,
  clearArcadePasses,
  consumeArcadeFreePlay,
  grantArcadePass,
  hasActiveArcadePass,
  hasUsableArcadePass,
  readArcadePass,
  subscribeArcadePassEntitlement,
} from './arcade-pass-entitlement';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const T0 = 1_700_000_000_000;

beforeEach(() => clearArcadePasses());
afterEach(() => {
  clearArcadePasses();
  vi.restoreAllMocks();
});

const redeem = (pubkey = ALICE, id = 'redemption-1', now = T0) =>
  grantArcadePass(pubkey, { redemptionId: id, nowMs: now });

describe('redemption creates both limits', () => {
  it('grants 24 hours and exactly the configured allowance', () => {
    expect(redeem()).toBe(true);

    const record = readArcadePass(ALICE)!;
    expect(record.expiresAt).toBe(T0 + ARCADE_PASS_DURATION_MS);
    expect(record.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
    expect(record.redemptionId).toBe('redemption-1');
  });

  it('reports usable, with both dimensions readable', () => {
    redeem();
    expect(hasUsableArcadePass(ALICE, T0 + 1)).toBe(true);
    expect(arcadePassRemainingFreePlays(ALICE, T0 + 1)).toBe(ARCADE_PASS_FREE_PLAYS);
    expect(arcadePassRemainingMs(ALICE, T0 + 1)).toBe(ARCADE_PASS_DURATION_MS - 1);
  });

  it('stays scoped to the account that paid for it', () => {
    redeem(ALICE);
    expect(hasUsableArcadePass(BOB, T0 + 1)).toBe(false);
    expect(arcadePassRemainingFreePlays(BOB, T0 + 1)).toBe(0);
  });
});

describe('spending the allowance', () => {
  it('consumes exactly one play per admitted game', async () => {
    redeem();

    expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(true);
    expect(arcadePassRemainingFreePlays(ALICE, T0 + 1)).toBe(ARCADE_PASS_FREE_PLAYS - 1);

    expect(await consumeArcadeFreePlay(ALICE, T0 + 2)).toBe(true);
    expect(arcadePassRemainingFreePlays(ALICE, T0 + 2)).toBe(ARCADE_PASS_FREE_PLAYS - 2);
  });

  it('spends the final play once, and refuses everything after', async () => {
    redeem();
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(true);
    }

    expect(arcadePassRemainingFreePlays(ALICE, T0 + 1)).toBe(0);
    expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(false);
    expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(false);
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(0);
  });

  it('never goes negative, however many callers ask', async () => {
    redeem();
    const asks = Array.from({ length: ARCADE_PASS_FREE_PLAYS + 10 }, () =>
      consumeArcadeFreePlay(ALICE, T0 + 1),
    );
    const granted = (await Promise.all(asks)).filter(Boolean).length;

    expect(granted).toBe(ARCADE_PASS_FREE_PLAYS);
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(0);
  });

  it('lets exactly one concurrent caller take the LAST play', async () => {
    // The double-spend the in-lock re-check exists for: two callers, one play.
    //
    // Within a tab this holds regardless of the lock, because the critical
    // section is synchronous. The CROSS-TAB half cannot be reproduced in
    // process — jsdom has no Web Locks and one thread cannot interleave two
    // synchronous sections — so the lock's involvement is pinned structurally
    // by 'requests the per-account cross-tab lock' below instead.
    redeem();
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS - 1; i += 1) {
      await consumeArcadeFreePlay(ALICE, T0 + 1);
    }
    expect(arcadePassRemainingFreePlays(ALICE, T0 + 1)).toBe(1);

    const [first, second] = await Promise.all([
      consumeArcadeFreePlay(ALICE, T0 + 1),
      consumeArcadeFreePlay(ALICE, T0 + 1),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(0);
  });

  it('refuses once the pass expires, however many plays are left', async () => {
    redeem();
    const expired = T0 + ARCADE_PASS_DURATION_MS;

    expect(await consumeArcadeFreePlay(ALICE, expired)).toBe(false);
    // The count is untouched — the clock ended it, not the allowance.
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
    expect(arcadePassRemainingFreePlays(ALICE, expired)).toBe(0);
  });

  it('refuses without a pubkey rather than spending someone else’s pass', async () => {
    redeem();
    expect(await consumeArcadeFreePlay(undefined, T0 + 1)).toBe(false);
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
  });

  it('requests the per-account cross-tab lock, exclusively', async () => {
    // The structural half of the concurrency guarantee. jsdom has no Web
    // Locks, so without this the suite would pass identically if the lock were
    // deleted — the in-tab result is the same either way.
    const requests: { name: string; mode: string | undefined }[] = [];
    const locks = {
      request: async (
        name: string,
        options: { mode?: string },
        callback: (lock: unknown) => Promise<unknown>,
      ) => {
        requests.push({ name, mode: options.mode });
        return callback(null);
      },
    };
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: locks,
      configurable: true,
    });
    try {
      redeem();
      expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(true);

      expect(requests).toHaveLength(1);
      expect(requests[0].mode).toBe('exclusive');
      expect(requests[0].name).toContain(ALICE);
      // Per account: two players in two tabs must not queue behind each other.
      expect(requests[0].name).not.toContain(BOB);
    } finally {
      delete (globalThis.navigator as { locks?: unknown }).locks;
    }
  });

  it('re-checks INSIDE the lock, so a play spent while queueing is not respent', async () => {
    // A queued caller must not act on what it saw before it got the lock. The
    // stub drains the allowance while the real call waits its turn.
    redeem();
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS - 1; i += 1) {
      await consumeArcadeFreePlay(ALICE, T0 + 1);
    }

    let drainedInsideLock = false;
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: {
        request: async (
          _name: string,
          _options: { mode?: string },
          callback: (lock: unknown) => Promise<unknown>,
        ) => {
          if (!drainedInsideLock) {
            drainedInsideLock = true;
            // Stand in for the tab ahead in the queue taking the last play.
            const store = JSON.parse(localStorage.getItem('blobbi:arcade:pass')!);
            store[ALICE].remainingFreePlays = 0;
            localStorage.setItem('blobbi:arcade:pass', JSON.stringify(store));
          }
          return callback(null);
        },
      },
      configurable: true,
    });
    try {
      expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(false);
      expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(0);
    } finally {
      delete (globalThis.navigator as { locks?: unknown }).locks;
    }
  });

  it('refuses when storage drops the decrement instead of reporting success', async () => {
    redeem();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(await consumeArcadeFreePlay(ALICE, T0 + 1)).toBe(false);
  });
});

describe('the two predicates answer different questions', () => {
  it('keeps an exhausted pass ACTIVE but not USABLE', async () => {
    redeem();
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(ALICE, T0 + 1);
    }

    // Still worth showing — the record has not expired — but it buys nothing.
    expect(hasActiveArcadePass(ALICE, T0 + 1)).toBe(true);
    expect(hasUsableArcadePass(ALICE, T0 + 1)).toBe(false);
    expect(arcadePassRemainingMs(ALICE, T0 + 1)).toBeGreaterThan(0);
  });

  it('reports neither once the clock runs out', () => {
    redeem();
    const expired = T0 + ARCADE_PASS_DURATION_MS;
    expect(hasActiveArcadePass(ALICE, expired)).toBe(false);
    expect(hasUsableArcadePass(ALICE, expired)).toBe(false);
  });
});

describe('no stacking', () => {
  it('refuses a second Pass while one is still usable', () => {
    redeem(ALICE, 'first');
    expect(canRedeemArcadePass(ALICE, T0 + 1)).toBe(false);

    expect(grantArcadePass(ALICE, { redemptionId: 'second', nowMs: T0 + 1 })).toBe(false);

    // Untouched: neither the window nor the allowance moved.
    const record = readArcadePass(ALICE)!;
    expect(record.redemptionId).toBe('first');
    expect(record.expiresAt).toBe(T0 + ARCADE_PASS_DURATION_MS);
    expect(record.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
  });

  it('is idempotent for the SAME redemption, without resetting the count', async () => {
    redeem(ALICE, 'first');
    await consumeArcadeFreePlay(ALICE, T0 + 1);

    // A retried delivery of a redemption already paid for and delivered.
    expect(grantArcadePass(ALICE, { redemptionId: 'first', nowMs: T0 + 2 })).toBe(true);
    expect(readArcadePass(ALICE)!.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS - 1);
  });

  it('allows a new Pass once the allowance is spent, even with time left', async () => {
    redeem(ALICE, 'first');
    for (let i = 0; i < ARCADE_PASS_FREE_PLAYS; i += 1) {
      await consumeArcadeFreePlay(ALICE, T0 + 1);
    }

    expect(canRedeemArcadePass(ALICE, T0 + 1)).toBe(true);
    expect(grantArcadePass(ALICE, { redemptionId: 'second', nowMs: T0 + 1 })).toBe(true);

    const record = readArcadePass(ALICE)!;
    expect(record.remainingFreePlays).toBe(ARCADE_PASS_FREE_PLAYS);
    // A fresh 24 hours from NOW, not the old expiry extended.
    expect(record.expiresAt).toBe(T0 + 1 + ARCADE_PASS_DURATION_MS);
  });

  it('allows a new Pass once the old one expires', () => {
    redeem(ALICE, 'first');
    const later = T0 + ARCADE_PASS_DURATION_MS + 1;

    expect(canRedeemArcadePass(ALICE, later)).toBe(true);
    expect(grantArcadePass(ALICE, { redemptionId: 'second', nowMs: later })).toBe(true);
    expect(readArcadePass(ALICE)!.expiresAt).toBe(later + ARCADE_PASS_DURATION_MS);
  });

  it('never adds two windows together', () => {
    redeem(ALICE, 'first');
    const later = T0 + ARCADE_PASS_DURATION_MS + 1;
    grantArcadePass(ALICE, { redemptionId: 'second', nowMs: later });

    const record = readArcadePass(ALICE)!;
    expect(record.expiresAt - later).toBe(ARCADE_PASS_DURATION_MS);
  });
});

describe('persistence', () => {
  it('survives a reload — every read goes back to storage', async () => {
    redeem();
    await consumeArcadeFreePlay(ALICE, T0 + 1);

    // Nothing is cached in module state, so this IS what a new tab sees.
    expect(arcadePassRemainingFreePlays(ALICE, T0 + 1)).toBe(ARCADE_PASS_FREE_PLAYS - 1);
    expect(arcadePassRemainingMs(ALICE, T0 + 1)).toBe(ARCADE_PASS_DURATION_MS - 1);
  });

  it('rejects a record with no allowance rather than inventing one', () => {
    // A pre-allowance record could only come from the dev harness — the Pass
    // was never purchasable before the bound existed. Granting it an unknown
    // number of free plays would be inventing plays nobody paid for.
    localStorage.setItem(
      'blobbi:arcade:pass',
      JSON.stringify({
        [ALICE]: { expiresAt: T0 + ARCADE_PASS_DURATION_MS, redeemedAt: T0, redemptionId: 'old' },
      }),
    );

    expect(readArcadePass(ALICE)).toBeNull();
    expect(hasUsableArcadePass(ALICE, T0 + 1)).toBe(false);
  });

  it('notifies subscribers when the count changes', async () => {
    let notifications = 0;
    const unsubscribe = subscribeArcadePassEntitlement(() => {
      notifications += 1;
    });
    try {
      redeem();
      await consumeArcadeFreePlay(ALICE, T0 + 1);
      expect(notifications).toBeGreaterThanOrEqual(2);
    } finally {
      unsubscribe();
    }
  });
});
