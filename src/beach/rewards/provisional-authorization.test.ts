/**
 * Provisional authorization — exactly-once, honesty about outcomes, and the
 * seam contract (calculation and wallet stay untouched by outcome mapping).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createTreasureHuntRound,
  treasureHuntReducer,
  buildTreasureHuntResult,
  type TreasureHuntResult,
} from '@/beach/treasure-hunt';
import { TREASURE_HUNT_UI_POLICY } from '@/components/blobbi/beach/treasure-hunt-config';
import type { CoinMutationOutcome, CoinWallet } from '@/inventory/coin-wallet';
import {
  clearBeachRewardOps,
  finalizeBeachReward,
  readBeachRewardOp,
  reserveBeachReward,
  resolveBeachReward,
} from '@/lib/beach-reward-ledger';

import { BEACH_REWARD_POLICY } from './policy';
import { createProvisionalTreasureHuntAuthorizer } from './provisional-authorization';

const PUBKEY = 'a1'.repeat(32);
const NOW = 1_800_000_000_000;

function finishedResult(seed = 'auth-seed'): TreasureHuntResult {
  const created = createTreasureHuntRound({ seed, policy: TREASURE_HUNT_UI_POLICY });
  if (!created.ok) throw new Error('generation failed');
  let round = treasureHuntReducer(created.round, { type: 'start' });
  round = treasureHuntReducer(round, { type: 'advance-time', seconds: 25 });
  round = treasureHuntReducer(round, { type: 'dig', position: round.targets[0].position });
  round = treasureHuntReducer(round, { type: 'end-round' });
  return buildTreasureHuntResult(round);
}

function tooShortResult(seed = 'short-seed'): TreasureHuntResult {
  const created = createTreasureHuntRound({ seed, policy: TREASURE_HUNT_UI_POLICY });
  if (!created.ok) throw new Error('generation failed');
  let round = treasureHuntReducer(created.round, { type: 'start' });
  round = treasureHuntReducer(round, { type: 'advance-time', seconds: 3 });
  round = treasureHuntReducer(round, { type: 'dig', position: round.targets[0].position });
  round = treasureHuntReducer(round, { type: 'end-round' });
  return buildTreasureHuntResult(round);
}

function makeWallet(outcome: CoinMutationOutcome | Error) {
  const grantCoins = vi.fn(
    async (_op: { opId: string; amount: number; label: string }): Promise<CoinMutationOutcome> => {
      void _op;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  );
  const wallet = {
    grantCoins,
    spendCoins: vi.fn(),
    readBalance: vi.fn(),
    reconcileOp: vi.fn(),
  } as unknown as CoinWallet;
  return { wallet, grantCoins };
}

function reserve(opId: string) {
  return reserveBeachReward({
    pubkey: PUBKEY,
    opId,
    roundKey: 'round',
    windowKey: '2026-08-02',
    limit: 10,
    now: NOW,
  });
}

beforeEach(() => clearBeachRewardOps());
afterEach(() => clearBeachRewardOps());

describe('provisional authorization', () => {
  it('finalizes the amount durably, grants under the SAME opId, resolves applied', async () => {
    const { wallet, grantCoins } = makeWallet({ status: 'applied', balance: 50, verified: true });
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    reserve('op-1');

    const result = finishedResult();
    const outcome = await authorizer.authorize(result, 'op-1');

    expect(outcome.status).toBe('applied');
    expect(grantCoins).toHaveBeenCalledTimes(1);
    const op = grantCoins.mock.calls[0][0];
    expect(op.opId).toBe('op-1');
    expect(op.label).toBe('beach-reward');
    expect(readBeachRewardOp(PUBKEY, 'op-1')?.status).toBe('applied');
    expect(readBeachRewardOp(PUBKEY, 'op-1')?.amount).toBe(op.amount);
  });

  it('an already-applied operation is idempotent success without a second grant', async () => {
    const { wallet, grantCoins } = makeWallet({ status: 'applied', balance: 50, verified: true });
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    reserve('op-dup');
    finalizeBeachReward(PUBKEY, 'op-dup', 9, NOW);
    resolveBeachReward(PUBKEY, 'op-dup', 'applied', NOW);

    const outcome = await authorizer.authorize(finishedResult(), 'op-dup');
    expect(outcome).toMatchObject({ status: 'applied', alreadyApplied: true });
    expect(grantCoins).not.toHaveBeenCalled();
  });

  it('an ineligible result earns nothing and calls no wallet', async () => {
    const { wallet, grantCoins } = makeWallet({ status: 'applied', balance: 0, verified: true });
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    reserve('op-short');

    const outcome = await authorizer.authorize(tooShortResult(), 'op-short');
    expect(outcome).toMatchObject({ status: 'ineligible', reason: 'too-short' });
    expect(grantCoins).not.toHaveBeenCalled();
  });

  it('an abandoned/missing reservation grants nothing', async () => {
    const { wallet, grantCoins } = makeWallet({ status: 'applied', balance: 0, verified: true });
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    const outcome = await authorizer.authorize(finishedResult(), 'op-never-reserved');
    expect(outcome).toEqual({ status: 'no-reservation' });
    expect(grantCoins).not.toHaveBeenCalled();
  });

  it('an ambiguous grant is recorded ambiguous — surfaced, not retried', async () => {
    const { wallet } = makeWallet({ status: 'ambiguous', reason: 'publish-timeout' });
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    reserve('op-amb');

    const outcome = await authorizer.authorize(finishedResult(), 'op-amb');
    expect(outcome.status).toBe('ambiguous');
    expect(readBeachRewardOp(PUBKEY, 'op-amb')?.status).toBe('ambiguous');
  });

  it('a provably-unsent failure keeps the op finalized (retryable) and says so', async () => {
    const { wallet } = makeWallet(new Error('signer refused'));
    const authorizer = createProvisionalTreasureHuntAuthorizer({
      pubkey: PUBKEY,
      wallet,
      policy: BEACH_REWARD_POLICY,
      now: () => NOW,
    });
    reserve('op-fail');

    const outcome = await authorizer.authorize(finishedResult(), 'op-fail');
    expect(outcome).toMatchObject({ status: 'failed', message: 'signer refused' });
    expect(readBeachRewardOp(PUBKEY, 'op-fail')?.status).toBe('finalized');
  });
});
