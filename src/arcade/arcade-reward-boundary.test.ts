/**
 * Reward-boundary tests.
 *
 * Everything here is about what must NOT happen: no claim without a valid
 * result, no `claimed` without a verified read-back, no second grant for a run
 * that already paid, and — this phase's headline — no write path at all.
 */
import { describe, it, expect } from 'vitest';

import {
  ARCADE_CLAIMS_STORAGE_KEY,
  ARCADE_REWARD_WRITER_UNIMPLEMENTED,
  advanceClaim,
  createPendingClaim,
  isClaimSettled,
  isRetryable,
  type ArcadeRewardClaim,
} from './arcade-reward-boundary';
import { calculateTicketAward, type ArcadeRewardPolicy } from './reward-policy';
import { blocksNewGrant, isPrePublishFailure, needsReconciliation } from './arcade-reward-boundary';
import type { ArcadeGameResult } from './types';

const NOW = 1_700_000_100_000;

const policy: ArcadeRewardPolicy = {
  gameId: 'blobbi-dance',
  policyId: 'test-policy',
  version: 1,
  status: 'draft',
  shape: 'scaled',
  base: () => 8,
  maxTicketsPerRun: 25,
};

function result(overrides: Partial<ArcadeGameResult> = {}): ArcadeGameResult {
  return {
    runId: 'run-1',
    gameId: 'blobbi-dance',
    machineId: 'arcade-dance-machine',
    difficulty: 'easy',
    cleared: true,
    score: 1000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_090_000,
    stats: { accuracy: 90 },
    ...overrides,
  };
}

function pending(overrides: Partial<ArcadeGameResult> = {}): ArcadeRewardClaim {
  const r = result(overrides);
  const outcome = createPendingClaim(r, calculateTicketAward(policy, r), NOW);
  if (!outcome.ok) throw new Error(`fixture failed: ${outcome.reason}`);
  return outcome.claim;
}

describe('creating a pending claim', () => {
  it('records the award before anything is published', () => {
    const claim = pending();
    expect(claim.status).toBe('pending');
    expect(claim.tickets).toBe(8);
    expect(claim.runId).toBe('run-1');
    expect(claim.attempts).toBe(0);
    expect(claim.failure).toBeNull();
  });

  it('refuses a malformed result', () => {
    const r = result({ score: -1 });
    const outcome = createPendingClaim(r, calculateTicketAward(policy, r), NOW);
    expect(outcome.ok).toBe(false);
  });

  it('refuses a result that could not survive a refresh', () => {
    const dirty = { ...result(), rerender: () => {} } as unknown as ArcadeGameResult;
    const outcome = createPendingClaim(dirty, calculateTicketAward(policy, result()), NOW);
    expect(outcome).toEqual({ ok: false, reason: 'result is not serialisable at rerender' });
  });

  it('refuses an award that belongs to a different run', () => {
    const other = calculateTicketAward(policy, result({ runId: 'run-2' }));
    const outcome = createPendingClaim(result(), other, NOW);
    expect(outcome).toEqual({ ok: false, reason: 'award does not belong to this result' });
  });

  it('refuses a rejected or empty award — there is nothing to grant', () => {
    const zero = calculateTicketAward({ ...policy, base: () => 0 }, result({ cleared: false }));
    expect(zero.total).toBeGreaterThan(0); // participation floor still pays

    const rejected = calculateTicketAward(policy, result({ gameId: 'other' }));
    expect(createPendingClaim(result({ gameId: 'other' }), rejected, NOW).ok).toBe(false);
  });

  it('starts with no baseline and no reconciliation attempts', () => {
    const claim = pending();
    expect(claim.quantityBefore).toBeNull();
    expect(claim.reconcileAttempts).toBe(0);
  });

  it.each([
    ['claimed', 'run already claimed'],
    ['ambiguous', 'a previous attempt for this run may already have been published'],
    ['publishing', 'a claim for this run is already in progress'],
    ['verifying', 'a claim for this run is already in progress'],
  ] as const)('refuses a new grant when a %s record exists', (status, reason) => {
    const r = result();
    const existing: ArcadeRewardClaim = { ...pending(), status };
    const outcome = createPendingClaim(r, calculateTicketAward(policy, r), NOW, existing);
    expect(outcome).toEqual({ ok: false, reason });
  });

  it.each([['pending'], ['failed']] as const)(
    'allows a new attempt when the existing record is %s',
    (status) => {
      const r = result();
      const existing: ArcadeRewardClaim = { ...pending(), status, attempts: 2 };
      const outcome = createPendingClaim(r, calculateTicketAward(policy, r), NOW, existing);
      expect(outcome.ok).toBe(true);
      // A retry is the SAME claim continuing, so its attempt count carries over.
      if (outcome.ok) expect(outcome.claim.attempts).toBe(2);
    },
  );
});

describe('the ambiguous status — the fix for the duplicate-grant defect', () => {
  const published = () =>
    advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 10 });

  it('turns a verify mismatch into AMBIGUOUS, never into a retryable failure', () => {
    const verifying = advanceClaim(published(), { type: 'begin-verify', now: NOW });
    // The relay has not caught up: the balance still reads 10.
    const settled = advanceClaim(verifying, { type: 'confirm', now: NOW, quantityAfter: 10 });

    expect(settled.status).toBe('ambiguous');
    expect(settled.failure).toBe('verify-mismatch');
    expect(isRetryable(settled)).toBe(false);
    expect(needsReconciliation(settled)).toBe(true);
    expect(blocksNewGrant(settled)).toBe(true);
  });

  it('refuses to publish an ambiguous claim, whatever the caller asks', () => {
    const ambiguous = advanceClaim(published(), {
      type: 'ambiguous',
      now: NOW,
      failure: 'publish-timeout',
    });
    const again = advanceClaim(ambiguous, {
      type: 'begin-publish',
      now: NOW + 1,
      quantityBefore: 13,
    });
    // Same object, same status: the transition simply does not exist.
    expect(again).toBe(ambiguous);
    expect(again.status).toBe('ambiguous');
  });

  it('re-labels a post-publication failure handed to `fail` as ambiguous', () => {
    // The boundary, not the caller, decides what is safe to retry.
    for (const failure of ['publish-timeout', 'verify-mismatch', 'verify-unavailable'] as const) {
      const settled = advanceClaim(published(), { type: 'fail', now: NOW, failure });
      expect(settled.status).toBe('ambiguous');
    }
  });

  it('keeps a pre-publication failure retryable', () => {
    for (const failure of [
      'sign-failed',
      'publish-rejected',
      'baseline-unavailable',
      'ledger-unavailable',
      'lock-unavailable',
      'invalid-claim',
    ] as const) {
      expect(isPrePublishFailure(failure)).toBe(true);
      const settled = advanceClaim(pending(), { type: 'fail', now: NOW, failure });
      expect(settled.status).toBe('failed');
      expect(isRetryable(settled)).toBe(true);
    }
  });

  it('never downgrades an ambiguous claim to failed', () => {
    const ambiguous = advanceClaim(published(), {
      type: 'ambiguous',
      now: NOW,
      failure: 'verify-mismatch',
    });
    const late = advanceClaim(ambiguous, { type: 'fail', now: NOW + 1, failure: 'sign-failed' });
    expect(late).toBe(ambiguous);
  });

  it('refuses to publish without a baseline to reconcile against later', () => {
    const noBaseline = advanceClaim(pending(), {
      type: 'begin-publish',
      now: NOW,
      quantityBefore: Number.NaN,
    });
    expect(noBaseline.status).toBe('pending');
  });
});

describe('reconciliation is read-only and conservative', () => {
  const ambiguous = () =>
    advanceClaim(
      advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 10 }),
      { type: 'ambiguous', now: NOW, failure: 'verify-mismatch' },
    );

  it('confirms when the balance shows the baseline plus the award', () => {
    const settled = advanceClaim(ambiguous(), { type: 'reconcile', now: NOW, quantityNow: 18 });
    expect(settled.status).toBe('claimed');
    expect(settled.failure).toBeNull();
  });

  it('confirms when the balance is HIGHER — erring toward not paying twice', () => {
    // Another grant landed in between. `>=` can only ever cost a payment that
    // was owed; `===` could pay one twice, which is the failure being fixed.
    const settled = advanceClaim(ambiguous(), { type: 'reconcile', now: NOW, quantityNow: 25 });
    expect(settled.status).toBe('claimed');
  });

  it('stays ambiguous when the balance has not moved', () => {
    const settled = advanceClaim(ambiguous(), { type: 'reconcile', now: NOW, quantityNow: 10 });
    expect(settled.status).toBe('ambiguous');
    expect(settled.reconcileAttempts).toBe(1);
    expect(isRetryable(settled)).toBe(false);
  });

  it('stays ambiguous when the read fails, and counts the attempt', () => {
    const settled = advanceClaim(ambiguous(), { type: 'reconcile', now: NOW, quantityNow: null });
    expect(settled.status).toBe('ambiguous');
    expect(settled.reconcileAttempts).toBe(1);
  });

  it('never re-opens a claimed record', () => {
    const claimedClaim = advanceClaim(ambiguous(), { type: 'reconcile', now: NOW, quantityNow: 18 });
    expect(advanceClaim(claimedClaim, { type: 'reconcile', now: NOW, quantityNow: 0 })).toBe(
      claimedClaim,
    );
  });

  it('ignores reconciliation for a claim that is not ambiguous', () => {
    const p = pending();
    expect(advanceClaim(p, { type: 'reconcile', now: NOW, quantityNow: 99 })).toBe(p);
  });
});

describe('claim lifecycle', () => {
  it('walks pending → publishing → verifying → claimed on a confirmed read-back', () => {
    let claim = pending();

    claim = advanceClaim(claim, { type: 'begin-publish', now: NOW + 1, quantityBefore: 0 });
    expect(claim.status).toBe('publishing');
    expect(claim.attempts).toBe(1);

    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW + 2 });
    expect(claim.status).toBe('verifying');

    // Baseline 0 + the 8-ticket award.
    claim = advanceClaim(claim, {
      type: 'confirm',
      now: NOW + 3,
      quantityAfter: 8,
    });
    expect(claim.status).toBe('claimed');
    expect(isClaimSettled(claim)).toBe(true);
    expect(isRetryable(claim)).toBe(false);
  });

  it('refuses to settle — and refuses to RETRY — when the delta is wrong', () => {
    let claim = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW });

    // Nothing moved. This is the exact state the manual test hit: the publish
    // resolved and the read-back had not caught up. It used to be `failed`, and
    // `failed` was retryable — which is how a 3-ticket reward became 6.
    const stuck = advanceClaim(claim, { type: 'confirm', now: NOW, quantityAfter: 0 });
    expect(stuck.status).toBe('ambiguous');
    expect(stuck.failure).toBe('verify-mismatch');
    expect(isRetryable(stuck)).toBe(false);

    // Something else moved it, but not by our award: also not proof.
    const wrong = advanceClaim(claim, { type: 'confirm', now: NOW, quantityAfter: 5 });
    expect(wrong.status).toBe('ambiguous');
    expect(isRetryable(wrong)).toBe(false);
  });

  it.each(['publish-rejected', 'sign-failed'] as const)(
    'keeps a %s failure retryable under the same runId',
    (failure) => {
    const published = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    const failed = advanceClaim(published, { type: 'fail', now: NOW + 1, failure });

    expect(failed.status).toBe('failed');
    expect(failed.failure).toBe(failure);
    expect(failed.runId).toBe('run-1');
    expect(failed.tickets).toBe(8);
    expect(isRetryable(failed)).toBe(true);

    const retried = advanceClaim(failed, { type: 'begin-publish', now: NOW + 2, quantityBefore: 0 });
    expect(retried.status).toBe('publishing');
    expect(retried.runId).toBe('run-1');
    // The retry is the same claim, so the attempt counter — not the ticket count
    // — is what grows.
    expect(retried.attempts).toBe(2);
    expect(retried.tickets).toBe(8);
    expect(retried.failure).toBeNull();
    },
  );

  it('treats a publish timeout as UNRESOLVED, never as success and never as retryable', () => {
    const published = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    const timedOut = advanceClaim(published, {
      type: 'fail',
      now: NOW,
      failure: 'publish-timeout',
    });
    expect(isClaimSettled(timedOut)).toBe(false);
    expect(timedOut.status).toBe('ambiguous');
    expect(isRetryable(timedOut)).toBe(false);
  });

  it('ignores a duplicate publish while one is already in flight', () => {
    const publishing = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    expect(advanceClaim(publishing, { type: 'begin-publish', now: NOW + 1, quantityBefore: 0 })).toBe(publishing);
  });

  it('never reopens a settled claim', () => {
    let claim = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW });
    claim = advanceClaim(claim, {
      type: 'confirm',
      now: NOW,
      quantityAfter: 8,
    });

    for (const event of [
      { type: 'begin-publish', now: NOW + 9, quantityBefore: 0 },
      { type: 'begin-verify', now: NOW + 9 },
      { type: 'fail', now: NOW + 9, failure: 'publish-timeout' },
      { type: 'confirm', now: NOW + 9, quantityAfter: 0 },
    ] as const) {
      expect(advanceClaim(claim, event)).toBe(claim);
    }
  });

  it('cannot skip verification', () => {
    const publishing = advanceClaim(pending(), { type: 'begin-publish', now: NOW, quantityBefore: 0 });
    const skipped = advanceClaim(publishing, {
      type: 'confirm',
      now: NOW,
      quantityAfter: 8,
    });
    expect(skipped).toBe(publishing);
    expect(skipped.status).toBe('publishing');
  });
});

describe('this phase grants nothing', () => {
  it('exposes a writer that refuses to write', async () => {
    await expect(
      ARCADE_REWARD_WRITER_UNIMPLEMENTED.publishTicketGrant(pending()),
    ).rejects.toThrow(/not implemented/);
    await expect(ARCADE_REWARD_WRITER_UNIMPLEMENTED.readTicketQuantity()).rejects.toThrow(
      /not implemented/,
    );
  });

  it('shares the claimed set across tabs by using localStorage', () => {
    // sessionStorage would let two tabs each pay the same run once.
    expect(ARCADE_CLAIMS_STORAGE_KEY).toMatch(/^blobbi:arcade:/);
  });
});
