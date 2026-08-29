/**
 * The Mine's daily Coin ceiling, end to end through the durable session.
 *
 * The policy module proves the arithmetic; this proves the parts that can
 * actually leak value: that the budget is spent exactly once per run, that a
 * reload or a recovery replays the frozen number rather than re-deriving it,
 * that two runs finishing together cannot both claim the same remainder, and
 * that the window really does roll over at UTC midnight.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMineSettlement } from './mine-settlement';
import {
  clearMineSessions,
  mineAwardedCoinsInWindow,
  pruneMineSessions,
  persistMineSession,
  readMineSession,
} from './mine-session-ledger';
import { MINE_DAILY_COIN_CAP, mineRewardWindowKey } from './policy';
import type { CoinWallet } from '@/inventory/coin-wallet';
import type { EnergySettler } from './energy-settlement';

const PUBKEY = 'a'.repeat(64);
const PET_ID = 'pet-1';

/** Midday UTC, so a test can step to the next day without ambiguity. */
const DAY_ONE = Date.UTC(2026, 7, 28, 12);
const DAY_TWO = Date.UTC(2026, 7, 29, 12);

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
  const started = settlement.startSession({ petId: PET_ID, startEnergy: 100 });
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

describe('a normal day of mining is never clipped', () => {
  it('a full-energy run pays its whole reward', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    const { frozen } = await mineRun(settlement, 50);

    expect(frozen).toMatchObject({ ok: true, coinReward: 50, capped: false });
    expect(coinCalls).toEqual([{ opId: expect.stringContaining('coin'), amount: 50 }]);
    expect(settlement.rewardBudget()).toMatchObject({
      cap: MINE_DAILY_COIN_CAP,
      awarded: 50,
      remaining: 150,
    });
  });

  it('four ordinary runs fit inside the day', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    for (let i = 0; i < 4; i += 1) await mineRun(settlement, 50);

    expect(coinCalls.map((c) => c.amount)).toEqual([50, 50, 50, 50]);
    expect(settlement.rewardBudget().remaining).toBe(0);
  });
});

describe('the ceiling binds', () => {
  it('trims the run that crosses it, and says so', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    await mineRun(settlement, 180);
    const { frozen } = await mineRun(settlement, 50);

    expect(frozen).toMatchObject({ ok: true, coinReward: 20, capped: true });
    expect(coinCalls.map((c) => c.amount)).toEqual([180, 20]);
    expect(mineAwardedCoinsInWindow(PUBKEY, mineRewardWindowKey(DAY_ONE))).toBe(200);
  });

  it('refuses to START a run once the day is spent — no energy is charged', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    await mineRun(settlement, MINE_DAILY_COIN_CAP);
    const blocked = settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(blocked).toEqual({ ok: false, reason: 'daily-cap-reached' });
    // Nothing was recorded, so nothing can later charge energy for it.
    expect(coinCalls).toHaveLength(1);
    expect(settlement.rewardBudget().remaining).toBe(0);
  });

  it('never pays past the cap however many runs are attempted', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);

    for (let i = 0; i < 12; i += 1) await mineRun(settlement, 50);

    const paid = coinCalls.reduce((total, call) => total + call.amount, 0);
    expect(paid).toBe(MINE_DAILY_COIN_CAP);
  });
});

describe('the frozen number survives reload and recovery', () => {
  it('a reload cannot reset the day: the ledger is the budget', async () => {
    const nowRef = { ms: DAY_ONE };
    const first = makeSettlement(nowRef);
    await mineRun(first.settlement, 150);

    // A fresh settlement instance is what a reload produces.
    const second = makeSettlement(nowRef);
    expect(second.settlement.rewardBudget()).toMatchObject({ awarded: 150, remaining: 50 });

    const { frozen } = await mineRun(second.settlement, 50);
    expect(frozen).toMatchObject({ coinReward: 50, capped: false });
    expect(second.settlement.rewardBudget().remaining).toBe(0);
  });

  it('recovery settles the capped number, never the raw one', async () => {
    const nowRef = { ms: DAY_ONE };
    const first = makeSettlement(nowRef);
    // Fill most of the day, then finalize a run that gets trimmed but never
    // settles — the shape a crash right after finalization leaves behind.
    await mineRun(first.settlement, 190);
    const started = first.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');
    await first.settlement.finalizeSession(started.sessionId, {
      energyDelta: 80,
      coinReward: 50,
    });
    expect(readMineSession(PUBKEY, started.sessionId)?.coinReward).toBe(10);

    const second = makeSettlement(nowRef);
    await second.settlement.recoverSessions();

    expect(second.coinCalls).toEqual([
      { opId: expect.stringContaining(started.sessionId), amount: 10 },
    ]);
  });

  it('a second finalize spends no further budget', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const started = settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 60 });
    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 60 });

    expect(mineAwardedCoinsInWindow(PUBKEY, mineRewardWindowKey(DAY_ONE))).toBe(60);
  });

  it('an abandoned run holds none of the day', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const started = settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    settlement.abandonSession(started.sessionId);

    expect(settlement.rewardBudget().remaining).toBe(MINE_DAILY_COIN_CAP);
  });
});

describe('concurrent settlement cannot exceed the day', () => {
  it('two runs finishing together split the remainder instead of both taking it', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement, coinCalls } = makeSettlement(nowRef);
    await mineRun(settlement, 170); // 30 left

    const a = settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    const b = settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!a.ok || !b.ok) throw new Error('start failed');

    // Both finalize without awaiting in between — the interleaving the queued
    // lock exists for.
    const [frozenA, frozenB] = await Promise.all([
      settlement.finalizeSession(a.sessionId, { energyDelta: 80, coinReward: 50 }),
      settlement.finalizeSession(b.sessionId, { energyDelta: 80, coinReward: 50 }),
    ]);
    await Promise.all([
      settlement.settleSession(a.sessionId),
      settlement.settleSession(b.sessionId),
    ]);

    // One takes the whole remainder, the other takes nothing. The lock makes
    // that split deterministic in TOTAL even though the order is not.
    const rewards = [frozenA, frozenB]
      .map((f) => (f.ok ? f.coinReward : -1))
      .sort((x, y) => y - x);
    expect(rewards).toEqual([30, 0]);
    // 170 from the first run + 30 from the pair. Never 170 + 30 + 30.
    const paid = coinCalls.reduce((total, call) => total + call.amount, 0);
    expect(paid).toBe(MINE_DAILY_COIN_CAP);
    expect(mineAwardedCoinsInWindow(PUBKEY, mineRewardWindowKey(DAY_ONE))).toBe(200);
  });
});

describe('the window rolls over at UTC midnight', () => {
  it('the next UTC day restores the full budget, exactly once', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    await mineRun(settlement, MINE_DAILY_COIN_CAP);
    expect(settlement.rewardBudget().remaining).toBe(0);

    nowRef.ms = DAY_TWO;
    expect(settlement.rewardBudget()).toMatchObject({
      windowKey: '2026-08-29',
      awarded: 0,
      remaining: MINE_DAILY_COIN_CAP,
    });

    await mineRun(settlement, 50);
    // Yesterday's 200 is untouched; today has spent 50 and no more.
    expect(mineAwardedCoinsInWindow(PUBKEY, '2026-08-28')).toBe(MINE_DAILY_COIN_CAP);
    expect(mineAwardedCoinsInWindow(PUBKEY, '2026-08-29')).toBe(50);
    expect(settlement.rewardBudget().remaining).toBe(150);
  });

  it('pruning never hands back budget the player already spent today', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    await mineRun(settlement, 120);

    // A settled record from earlier today, older than the 24 h retention:
    // without the window guard this would be pruned and refund the budget.
    const windowKey = mineRewardWindowKey(DAY_ONE);
    persistMineSession(PUBKEY, {
      sessionId: 'stale-but-today',
      petId: PET_ID,
      status: 'settled',
      startedAt: DAY_ONE - 100_000_000,
      startEnergy: 100,
      energyDelta: 80,
      coinReward: 40,
      windowKey,
      updatedAt: DAY_ONE - 100_000_000,
    });
    expect(settlement.rewardBudget().awarded).toBe(160);

    pruneMineSessions(PUBKEY, DAY_ONE, windowKey);

    expect(readMineSession(PUBKEY, 'stale-but-today')).not.toBeNull();
    expect(settlement.rewardBudget().awarded).toBe(160);
  });

  it('still prunes yesterday, so the ledger stays bounded', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    await mineRun(settlement, 50);

    // Strictly past the 24 h retention window (DAY_TWO is exactly 24 h after
    // DAY_ONE, and the comparison is `>`).
    const laterOnDayTwo = DAY_TWO + 60 * 60 * 1000;
    nowRef.ms = laterOnDayTwo;
    pruneMineSessions(PUBKEY, laterOnDayTwo, mineRewardWindowKey(laterOnDayTwo));

    expect(mineAwardedCoinsInWindow(PUBKEY, '2026-08-28')).toBe(0);
    expect(settlement.rewardBudget().remaining).toBe(MINE_DAILY_COIN_CAP);
  });
});
