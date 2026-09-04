/**
 * One rewarded Mine run at a time, per account, across tabs, and no ceiling
 * on what a run may pay.
 *
 * The Mine's boundary is a Blobbi's energy, not a daily Coin budget. What
 * still needs proving at this level is the concurrency guard (a second run
 * must not be playable against the same account while one is live) and that
 * a completed run freezes and settles its FULL gem value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMineSettlement } from './mine-settlement';
import {
  clearMineSessions,
  readMineSession,
  readMineSessions,
  MINE_ACTIVE_SESSION_TTL_MS,
} from './mine-session-ledger';
import type { CoinWallet } from '@/inventory/coin-wallet';
import type { EnergySettler } from './energy-settlement';

const PUBKEY = 'a'.repeat(64);
const PET_ID = 'pet-1';

/** A fixed reference instant; the Mine has no calendar behaviour any more. */
const DAY_ONE = Date.UTC(2026, 7, 28, 12);

function makeSettlement(nowRef: { ms: number }) {
  const coinCalls: { opId: string; amount: number }[] = [];
  const wallet = {
    readBalance: async () => 0,
    grantCoins: async (op: { opId: string; amount: number }) => {
      coinCalls.push({ opId: op.opId, amount: op.amount });
      return { status: 'applied' as const, balance: op.amount, verified: true };
    },
    spendCoins: async () => ({ status: 'applied' as const, balance: 0, verified: true }),
    reconcileOp: async () => null,
  } satisfies CoinWallet;

  const settler: EnergySettler = {
    settleEnergyDelta: async () => ({ status: 'applied' as const }),
  } as unknown as EnergySettler;

  const settlement = createMineSettlement({
    pubkey: PUBKEY,
    wallet,
    settler,
    now: () => nowRef.ms,
  });
  return { settlement, coinCalls };
}

/** One complete run: start, finish with `rawReward`, settle. */
async function mineRun(
  settlement: ReturnType<typeof makeSettlement>['settlement'],
  rawReward: number,
) {
  const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
  if (!started.ok) return { started, frozen: null, sessionId: null };
  const frozen = await settlement.finalizeSession(started.sessionId, {
    energyDelta: 80,
    coinReward: rawReward,
  });
  await settlement.settleSession(started.sessionId);
  return { started, frozen, sessionId: started.sessionId };
}

beforeEach(() => clearMineSessions());
afterEach(() => {
  clearMineSessions();
  vi.restoreAllMocks();
});

/**
 * One rewarded run at a time, per account, across tabs.
 *
 * Without this, a second tab could spend a whole energy bar on a run played
 * in parallel with another. The refusal happens at the start, before any
 * energy is at stake.
 */
describe('overlapping Mine runs are prevented', () => {
  it('a second start is refused while a run is in progress', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);

    const first = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    const second = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'session-in-progress' });
    // Refused means no durable record, so no energy can ever be owed for it.
    expect(readMineSessions(PUBKEY).filter((r) => r.status === 'open')).toHaveLength(1);
  });

  it('simultaneous starts in two tabs produce exactly ONE active session', async () => {
    const nowRef = { ms: DAY_ONE };
    // Two independent settlement instances = two tabs on one account.
    const tabA = makeSettlement(nowRef);
    const tabB = makeSettlement(nowRef);

    const [a, b] = await Promise.all([
      tabA.settlement.startSession({ petId: PET_ID, startEnergy: 100 }),
      tabB.settlement.startSession({ petId: PET_ID, startEnergy: 100 }),
    ]);

    const accepted = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(accepted).toHaveLength(1);
    expect(refused).toEqual([{ ok: false, reason: 'session-in-progress' }]);
    expect(readMineSessions(PUBKEY).filter((r) => r.status === 'open')).toHaveLength(1);
  });

  it('a run left behind by a closed tab stops blocking once it goes quiet', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const abandonedTab = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!abandonedTab.ok) throw new Error('start failed');

    // Still heartbeating: genuinely in progress, so still blocked.
    nowRef.ms = DAY_ONE + MINE_ACTIVE_SESSION_TTL_MS - 1_000;
    settlement.heartbeatSession(abandonedTab.sessionId);
    expect(await settlement.startSession({ petId: PET_ID, startEnergy: 100 })).toEqual({
      ok: false,
      reason: 'session-in-progress',
    });

    // The tab is gone; nothing refreshes the record any more.
    nowRef.ms += MINE_ACTIVE_SESSION_TTL_MS + 1_000;
    const next = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(next.ok).toBe(true);
    // The debris was abandoned rather than left to accumulate.
    expect(readMineSession(PUBKEY, abandonedTab.sessionId)?.status).toBe('abandoned');
  });

  it('an explicitly abandoned run does not block the next one', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const first = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!first.ok) throw new Error('start failed');

    settlement.abandonSession(first.sessionId);

    expect((await settlement.startSession({ petId: PET_ID, startEnergy: 100 })).ok).toBe(true);
  });

  it('a settled run does not block the next one', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    await mineRun(settlement, 50);

    expect((await settlement.startSession({ petId: PET_ID, startEnergy: 100 })).ok).toBe(true);
  });

  it('a finalized run still owing settlement does NOT block the next one', async () => {
    // Gameplay is over and its share of the day is already committed, so the
    // Mine must not stay shut while a relay problem resolves.
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');
    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 50 });
    expect(readMineSession(PUBKEY, started.sessionId)?.status).toBe('finalized');

    const next = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(next.ok).toBe(true);
    // And the unsettled reward is still owed, not discarded.
    expect(readMineSession(PUBKEY, started.sessionId)?.coinReward).toBe(50);
  });

});

/**
 * Energy is the boundary; nothing else trims a run.
 *
 * These are the counterparts of the removed daily-cap tests: what used to be
 * clamped must now be paid in full, and repeated runs must stay possible.
 */
describe('a run pays its full value, with no account ceiling', () => {
  it('freezes and settles the whole raw reward', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    const { frozen } = await mineRun(settlement, 350);

    expect(frozen).toEqual({ ok: true, coinReward: 350 });
    expect(coinCalls).toEqual([{ opId: expect.stringContaining('coin'), amount: 350 }]);
  });

  it('a very large legitimate reward is not trimmed', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    // Far beyond anything the old 200/day ceiling would have allowed.
    await mineRun(settlement, 5_000);

    expect(coinCalls[0].amount).toBe(5_000);
  });

  it('repeated sequential runs each pay in full; no budget accumulates', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    for (let i = 0; i < 10; i += 1) await mineRun(settlement, 50);

    expect(coinCalls.map((c) => c.amount)).toEqual(Array(10).fill(50));
    expect(coinCalls.reduce((total, c) => total + c.amount, 0)).toBe(500);
  });

  it('nothing about a run depends on the calendar', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);
    await mineRun(settlement, 120);

    // Cross a UTC midnight: no window resets, because there is no window.
    nowRef.ms = Date.UTC(2026, 7, 29, 12);
    await mineRun(settlement, 120);

    expect(coinCalls.map((c) => c.amount)).toEqual([120, 120]);
    // No record carries a window key any more.
    for (const record of readMineSessions(PUBKEY)) {
      expect(record).not.toHaveProperty('windowKey');
    }
  });

  it('a negative or fractional reward is still normalised', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    await mineRun(settlement, 12.9);
    await mineRun(settlement, -5);

    expect(coinCalls).toEqual([{ opId: expect.stringContaining('coin'), amount: 12 }]);
  });

  it('settling twice still grants once', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');
    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 77 });

    await settlement.settleSession(started.sessionId);
    await settlement.settleSession(started.sessionId);

    expect(coinCalls).toHaveLength(1);
    expect(coinCalls[0].amount).toBe(77);
  });

  it('a second finalize cannot change the frozen reward', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 60 });
    const second = await settlement.finalizeSession(started.sessionId, {
      energyDelta: 1,
      coinReward: 9_999,
    });

    expect(second).toEqual({ ok: true, coinReward: 60 });
    expect(readMineSession(PUBKEY, started.sessionId)?.coinReward).toBe(60);
  });
});
