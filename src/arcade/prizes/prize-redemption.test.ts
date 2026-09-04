/**
 * Redemption contract tests, eligibility and the pure state machine.
 *
 * Written the way the reward claim machine's tests are: every route to a
 * refusal, both sides of the verify equation, and, most importantly, the
 * transitions that must NOT exist (an unresolved spend that publishes again is
 * the exact defect class the reward boundary was rebuilt around).
 */
import { describe, it, expect } from 'vitest';

import { getArcadePrize } from './prize-catalogue';
import {
  advanceRedemption,
  blocksNewRedemption,
  createReservedRedemption,
  evaluatePrizeEligibility,
  isSpendRetryable,
  needsDelivery,
  type ArcadePrizeRedemption,
} from './prize-redemption';

const GLASSES = getArcadePrize('neon-star-glasses')!; // 40 tickets
const SNACK = getArcadePrize('arcade-snack')!; // repeatable
const FRAME = getArcadePrize('golden-ticket-frame')!; // coming-soon

const eligible = (overrides: Partial<Parameters<typeof evaluatePrizeEligibility>[0]> = {}) =>
  evaluatePrizeEligibility({
    prize: GLASSES,
    balance: 100,
    owned: false,
    loggedIn: true,
    ...overrides,
  });

describe('eligibility', () => {
  it('allows a logged-in player with enough tickets', () => {
    expect(eligible()).toEqual({ eligible: true });
  });

  it('allows an EXACT-balance redemption', () => {
    expect(eligible({ balance: GLASSES.price })).toEqual({ eligible: true });
  });

  it('refuses one ticket short, and zero balance', () => {
    expect(eligible({ balance: GLASSES.price - 1 })).toEqual({
      eligible: false,
      reason: 'insufficient-tickets',
    });
    expect(eligible({ balance: 0 })).toEqual({
      eligible: false,
      reason: 'insufficient-tickets',
    });
  });

  it('refuses a logged-out player before anything else', () => {
    expect(eligible({ loggedIn: false, balance: null, owned: true })).toEqual({
      eligible: false,
      reason: 'logged-out',
    });
  });

  it('refuses a coming-soon prize', () => {
    expect(eligible({ prize: FRAME, balance: 10_000 })).toEqual({
      eligible: false,
      reason: 'coming-soon',
    });
  });

  it('refuses an owned non-repeatable prize, but allows a repeatable one', () => {
    expect(eligible({ owned: true })).toEqual({ eligible: false, reason: 'owned' });
    expect(eligible({ prize: SNACK, owned: true })).toEqual({ eligible: true });
  });

  it('distinguishes an unavailable balance from an insufficient one', () => {
    expect(eligible({ balance: null })).toEqual({
      eligible: false,
      reason: 'balance-unavailable',
    });
  });

  it('refuses a prize with a nonsense price whatever else is true', () => {
    const broken = { ...GLASSES, price: 0 };
    expect(eligible({ prize: broken })).toEqual({ eligible: false, reason: 'invalid-price' });
    expect(eligible({ prize: { ...GLASSES, price: 39.5 } })).toEqual({
      eligible: false,
      reason: 'invalid-price',
    });
  });
});

// ── State machine ──────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;

function reserved(): ArcadePrizeRedemption {
  const outcome = createReservedRedemption(GLASSES, 'attempt-1', 'temp-v1', T0);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.redemption;
}

/** Drive a fresh reservation to a confirmed spend at baseline 100. */
function spent(): ArcadePrizeRedemption {
  let r = advanceRedemption(reserved(), { type: 'begin-spend', now: T0 + 1, quantityBefore: 100 });
  r = advanceRedemption(r, { type: 'spend-confirmed', now: T0 + 2, quantityAfter: 60 });
  expect(r.status).toBe('spent');
  return r;
}

describe('reservation', () => {
  it('freezes the price, catalogue version and identity', () => {
    const r = reserved();
    expect(r).toMatchObject({
      redemptionId: 'neon-star-glasses:attempt-1',
      prizeId: 'neon-star-glasses',
      attemptId: 'attempt-1',
      price: 40,
      catalogueVersion: 'temp-v1',
      status: 'reserved',
      attempts: 0,
      quantityBefore: null,
    });
  });

  it('refuses a blank attempt id and an invalid price', () => {
    expect(createReservedRedemption(GLASSES, '  ', 'temp-v1', T0).ok).toBe(false);
    expect(createReservedRedemption({ ...GLASSES, price: -1 }, 'a', 'temp-v1', T0).ok).toBe(false);
  });
});

describe('the spend path', () => {
  it('confirms only when the read-back shows exactly baseline minus price', () => {
    expect(spent().status).toBe('spent');
  });

  it('treats any other read-back as UNRESOLVED, not failed', () => {
    let r = advanceRedemption(reserved(), { type: 'begin-spend', now: T0, quantityBefore: 100 });
    r = advanceRedemption(r, { type: 'spend-confirmed', now: T0, quantityAfter: 100 }); // stale
    expect(r.status).toBe('spend-unresolved');
    expect(r.failure).toBe('verify-mismatch');
  });

  it('routes pre-spend failures to a retryable state and the rest to unresolved', () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const refused = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'sign-failed',
    });
    expect(refused.status).toBe('failed-before-spend');
    expect(isSpendRetryable(refused)).toBe(true);

    const timedOut = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
    expect(timedOut.status).toBe('spend-unresolved');
    expect(isSpendRetryable(timedOut)).toBe(false);
  });

  it('lets a failed-before-spend attempt begin the spend again, same record', () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const failed = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-rejected',
    });
    const retried = advanceRedemption(failed, {
      type: 'begin-spend',
      now: T0 + 5,
      quantityBefore: 100,
    });
    expect(retried.status).toBe('spending');
    expect(retried.attempts).toBe(2);
  });

  it('REFUSES begin-spend from an unresolved record, the transition does not exist', () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const unresolved = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
    const attempted = advanceRedemption(unresolved, {
      type: 'begin-spend',
      now: T0 + 5,
      quantityBefore: 60,
    });
    expect(attempted).toBe(unresolved);
  });

  it('cannot downgrade an unresolved spend to failed-before-spend', () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const unresolved = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
    const mislabelled = advanceRedemption(unresolved, {
      type: 'spend-failed',
      now: T0 + 1,
      failure: 'sign-failed',
    });
    expect(mislabelled).toBe(unresolved);
  });
});

describe('read-only reconciliation', () => {
  const unresolved = () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    return advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
  };

  it('confirms the spend ONLY on exactly baseline − price', () => {
    const r = advanceRedemption(unresolved(), { type: 'reconcile', now: T0 + 9, quantityNow: 60 });
    expect(r.status).toBe('spent');
  });

  it('stays unresolved when the balance dropped by MORE than the price', () => {
    // The concurrent unrelated-spend case, explicitly: baseline 100, price 40,
    // THIS publish never landed, another tab spent 50 → balance 50. Under the
    // old "at least the price" rule this delivered an unpaid prize.
    const r = advanceRedemption(unresolved(), { type: 'reconcile', now: T0 + 9, quantityNow: 50 });
    expect(r.status).toBe('spend-unresolved');
  });

  it('stays unresolved on a smaller-than-price drop', () => {
    expect(
      advanceRedemption(unresolved(), { type: 'reconcile', now: T0, quantityNow: 90 }).status,
    ).toBe('spend-unresolved');
  });

  it('stays unresolved on an INCREASED balance', () => {
    expect(
      advanceRedemption(unresolved(), { type: 'reconcile', now: T0, quantityNow: 140 }).status,
    ).toBe('spend-unresolved');
  });

  it('stays unresolved on an unchanged balance or an unreadable one', () => {
    expect(
      advanceRedemption(unresolved(), { type: 'reconcile', now: T0, quantityNow: 100 }).status,
    ).toBe('spend-unresolved');
    expect(
      advanceRedemption(unresolved(), { type: 'reconcile', now: T0, quantityNow: null }).status,
    ).toBe('spend-unresolved');
  });

  it('counts reconciliation attempts', () => {
    const once = advanceRedemption(unresolved(), { type: 'reconcile', now: T0, quantityNow: 100 });
    const twice = advanceRedemption(once, { type: 'reconcile', now: T0, quantityNow: 100 });
    expect(twice.reconcileAttempts).toBe(2);
  });
});

describe('delivery', () => {
  it('flows spent → delivering → confirmed', () => {
    let r = spent();
    expect(needsDelivery(r)).toBe(true);
    r = advanceRedemption(r, { type: 'begin-delivery', now: T0 + 3 });
    expect(r.status).toBe('delivering');
    expect(needsDelivery(r)).toBe(true);
    r = advanceRedemption(r, { type: 'delivery-complete', now: T0 + 4 });
    expect(r.status).toBe('confirmed');
    expect(needsDelivery(r)).toBe(false);
  });

  it('keeps a failed delivery RECOVERABLE, never lost and never respent', () => {
    let r = advanceRedemption(spent(), { type: 'begin-delivery', now: T0 + 3 });
    r = advanceRedemption(r, { type: 'delivery-failed', now: T0 + 4 });
    expect(r.status).toBe('delivering');
    expect(blocksNewRedemption(r)).toBe(true);
    expect(isSpendRetryable(r)).toBe(false);
    // Recovery: delivery retried without any spend event.
    r = advanceRedemption(r, { type: 'delivery-complete', now: T0 + 5 });
    expect(r.status).toBe('confirmed');
  });

  it('makes confirmed terminal: no event reopens it', () => {
    let r = spent();
    r = advanceRedemption(r, { type: 'delivery-complete', now: T0 + 4 });
    expect(r.status).toBe('confirmed');
    for (const event of [
      { type: 'begin-spend', now: T0 + 9, quantityBefore: 60 },
      { type: 'spend-failed', now: T0 + 9, failure: 'sign-failed' },
      { type: 'reconcile', now: T0 + 9, quantityNow: 0 },
      { type: 'begin-delivery', now: T0 + 9 },
      { type: 'delivery-failed', now: T0 + 9 },
    ] as const) {
      expect(advanceRedemption(r, event)).toBe(r);
    }
  });
});

describe('what blocks a new redemption of the same prize', () => {
  it('lets a REPEATABLE prize past a confirmed attempt, and nothing else past anything in flight', () => {
    const confirmed = advanceRedemption(spent(), { type: 'delivery-complete', now: T0 });
    // Confirmed: the ONE status where repeatability matters.
    expect(blocksNewRedemption(confirmed, false)).toBe(true);
    expect(blocksNewRedemption(confirmed, true)).toBe(false);
    // Everything in flight blocks regardless of repeatability.
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const unresolvedRecord = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
    const delivering = advanceRedemption(spent(), { type: 'begin-delivery', now: T0 });
    for (const record of [spending, unresolvedRecord, spent(), delivering]) {
      expect(blocksNewRedemption(record, true), record.status).toBe(true);
    }
  });

  it('blocks everything from spending onward; frees reserved and failed-before-spend', () => {
    const spending = advanceRedemption(reserved(), {
      type: 'begin-spend',
      now: T0,
      quantityBefore: 100,
    });
    const unresolved = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'publish-timeout',
    });
    const failed = advanceRedemption(spending, {
      type: 'spend-failed',
      now: T0,
      failure: 'sign-failed',
    });
    expect(blocksNewRedemption(reserved())).toBe(false);
    expect(blocksNewRedemption(failed)).toBe(false);
    expect(blocksNewRedemption(spending)).toBe(true);
    expect(blocksNewRedemption(unresolved)).toBe(true);
    expect(blocksNewRedemption(spent())).toBe(true);
    expect(
      blocksNewRedemption(advanceRedemption(spent(), { type: 'delivery-complete', now: T0 })),
    ).toBe(true);
  });
});

// ── Atomic reconciliation ──────────────────────────────────────────────────
//
// For a prize whose debit and grant are ONE kind:31633 event, the evidence
// that settles an ambiguous publish is the PRIZE, not the balance. These tests
// pin both directions of that, and the refusal to guess in between.

/** An unresolved spend of 40 tickets against a baseline of 100. */
function unresolved(): ArcadePrizeRedemption {
  const spending = advanceRedemption(reserved(), {
    type: 'begin-spend',
    now: T0 + 1,
    quantityBefore: 100,
  });
  const r = advanceRedemption(spending, {
    type: 'spend-failed',
    now: T0 + 2,
    failure: 'publish-timeout',
  });
  expect(r.status).toBe('spend-unresolved');
  return r;
}

describe('reconcile-atomic', () => {
  it('holding the prize proves the event landed, and delivered', () => {
    // The balance is deliberately WRONG for the spend. It does not matter: the
    // prize can only have come from this redemption's own event, and that
    // event carried the debit too.
    const r = advanceRedemption(unresolved(), {
      type: 'reconcile-atomic',
      now: T0 + 3,
      owned: true,
      quantityNow: 12,
    });
    expect(r.status).toBe('spent');
    expect(r.failure).toBeNull();
    expect(r.reconcileAttempts).toBe(1);
  });

  it('no prize AND an untouched balance proves nothing was spent', () => {
    const r = advanceRedemption(unresolved(), {
      type: 'reconcile-atomic',
      now: T0 + 3,
      owned: false,
      quantityNow: 100,
    });
    // Retryable, because one event carries both halves: neither is present.
    expect(r.status).toBe('failed-before-spend');
    expect(isSpendRetryable(r)).toBe(true);
    expect(blocksNewRedemption(r)).toBe(false);
  });

  it('stays unresolved when the balance moved but the prize is absent', () => {
    // Someone else spent tickets, or a stale-base write clobbered ours. Either
    // way this is not proof, and a "maybe" must never become a second debit.
    for (const quantityNow of [60, 55, 140, null]) {
      const r = advanceRedemption(unresolved(), {
        type: 'reconcile-atomic',
        now: T0 + 3,
        owned: false,
        quantityNow,
      });
      expect(r.status, `balance ${quantityNow}`).toBe('spend-unresolved');
      expect(isSpendRetryable(r)).toBe(false);
      expect(r.reconcileAttempts).toBe(1);
    }
  });

  it('never publishes from an unresolved record, however often it reconciles', () => {
    let r = unresolved();
    for (let i = 0; i < 5; i += 1) {
      r = advanceRedemption(r, {
        type: 'reconcile-atomic',
        now: T0 + 10 + i,
        owned: false,
        quantityNow: 60,
      });
      // `begin-spend` from `spend-unresolved` is the transition that does not
      // exist. Asserting it here is what keeps -40 from becoming -80.
      const attempted = advanceRedemption(r, {
        type: 'begin-spend',
        now: T0 + 20,
        quantityBefore: 60,
      });
      expect(attempted).toBe(r);
    }
    expect(r.reconcileAttempts).toBe(5);
    expect(r.attempts).toBe(1);
  });

  it('ignores every state that is not unresolved', () => {
    const confirmed = advanceRedemption(spent(), { type: 'delivery-complete', now: T0 + 5 });
    for (const record of [reserved(), spent(), confirmed]) {
      expect(
        advanceRedemption(record, {
          type: 'reconcile-atomic',
          now: T0 + 9,
          owned: true,
          quantityNow: 60,
        }),
        record.status,
      ).toBe(record);
    }
  });

  it('keeps the ORIGINAL logical redemption, same id, same frozen price', () => {
    const before = unresolved();
    const after = advanceRedemption(before, {
      type: 'reconcile-atomic',
      now: T0 + 3,
      owned: true,
      quantityNow: 60,
    });
    expect(after.redemptionId).toBe(before.redemptionId);
    expect(after.attemptId).toBe(before.attemptId);
    expect(after.price).toBe(before.price);
    expect(after.quantityBefore).toBe(before.quantityBefore);
    // The publish counter does NOT move: reconciliation reads, it never sends.
    expect(after.attempts).toBe(before.attempts);
  });
});

describe('the already-owned refusal', () => {
  it('is a provably pre-publish failure, so it is retryable and blocks nothing', () => {
    const r = advanceRedemption(reserved(), {
      type: 'spend-failed',
      now: T0 + 1,
      failure: 'already-owned',
    });
    expect(r.status).toBe('failed-before-spend');
    expect(isSpendRetryable(r)).toBe(true);
    expect(blocksNewRedemption(r)).toBe(false);
    expect(needsDelivery(r)).toBe(false);
  });

  it('cannot downgrade a spend that may already have been published', () => {
    const r = advanceRedemption(unresolved(), {
      type: 'spend-failed',
      now: T0 + 3,
      failure: 'already-owned',
    });
    expect(r.status).toBe('spend-unresolved');
  });
});
