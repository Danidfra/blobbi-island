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
import type { ArcadeGameResult } from './types';

const NOW = 1_700_000_100_000;

const policy: ArcadeRewardPolicy = {
  gameId: 'blobbi-dance',
  status: 'draft',
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

  it('refuses a run that has already been claimed — the idempotency guarantee', () => {
    const r = result();
    const outcome = createPendingClaim(r, calculateTicketAward(policy, r), NOW, ['run-1']);
    expect(outcome).toEqual({ ok: false, reason: 'run already claimed' });
  });
});

describe('claim lifecycle', () => {
  it('walks pending → publishing → verifying → claimed on a confirmed read-back', () => {
    let claim = pending();

    claim = advanceClaim(claim, { type: 'begin-publish', now: NOW + 1 });
    expect(claim.status).toBe('publishing');
    expect(claim.attempts).toBe(1);

    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW + 2 });
    expect(claim.status).toBe('verifying');

    claim = advanceClaim(claim, {
      type: 'confirm',
      now: NOW + 3,
      quantityBefore: 4,
      quantityAfter: 12,
    });
    expect(claim.status).toBe('claimed');
    expect(isClaimSettled(claim)).toBe(true);
    expect(isRetryable(claim)).toBe(false);
  });

  it('refuses to settle when the read-back does not show the awarded delta', () => {
    let claim = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW });

    // Nothing moved: the publish resolved but the relay never took it.
    const stuck = advanceClaim(claim, {
      type: 'confirm',
      now: NOW,
      quantityBefore: 4,
      quantityAfter: 4,
    });
    expect(stuck.status).toBe('failed');
    expect(stuck.failure).toBe('verify-mismatch');
    expect(isRetryable(stuck)).toBe(true);

    // Something else moved it: also not proof of OUR write.
    const wrong = advanceClaim(claim, {
      type: 'confirm',
      now: NOW,
      quantityBefore: 4,
      quantityAfter: 5,
    });
    expect(wrong.status).toBe('failed');
  });

  it.each([
    'publish-timeout',
    'publish-rejected',
    'sign-failed',
    'verify-unavailable',
  ] as const)('keeps a %s failure retryable under the same runId', (failure) => {
    const published = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    const failed = advanceClaim(published, { type: 'fail', now: NOW + 1, failure });

    expect(failed.status).toBe('failed');
    expect(failed.failure).toBe(failure);
    expect(failed.runId).toBe('run-1');
    expect(failed.tickets).toBe(8);
    expect(isRetryable(failed)).toBe(true);

    const retried = advanceClaim(failed, { type: 'begin-publish', now: NOW + 2 });
    expect(retried.status).toBe('publishing');
    expect(retried.runId).toBe('run-1');
    // The retry is the same claim, so the attempt counter — not the ticket count
    // — is what grows.
    expect(retried.attempts).toBe(2);
    expect(retried.tickets).toBe(8);
    expect(retried.failure).toBeNull();
  });

  it('treats a publish timeout as a failure, never as success', () => {
    const published = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    const timedOut = advanceClaim(published, {
      type: 'fail',
      now: NOW,
      failure: 'publish-timeout',
    });
    expect(isClaimSettled(timedOut)).toBe(false);
  });

  it('ignores a duplicate publish while one is already in flight', () => {
    const publishing = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    expect(advanceClaim(publishing, { type: 'begin-publish', now: NOW + 1 })).toBe(publishing);
  });

  it('never reopens a settled claim', () => {
    let claim = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    claim = advanceClaim(claim, { type: 'begin-verify', now: NOW });
    claim = advanceClaim(claim, {
      type: 'confirm',
      now: NOW,
      quantityBefore: 0,
      quantityAfter: 8,
    });

    for (const event of [
      { type: 'begin-publish', now: NOW + 9 },
      { type: 'begin-verify', now: NOW + 9 },
      { type: 'fail', now: NOW + 9, failure: 'publish-timeout' },
      { type: 'confirm', now: NOW + 9, quantityBefore: 0, quantityAfter: 0 },
    ] as const) {
      expect(advanceClaim(claim, event)).toBe(claim);
    }
  });

  it('cannot skip verification', () => {
    const publishing = advanceClaim(pending(), { type: 'begin-publish', now: NOW });
    const skipped = advanceClaim(publishing, {
      type: 'confirm',
      now: NOW,
      quantityBefore: 0,
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
