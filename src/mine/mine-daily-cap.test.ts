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
  readMineSessions,
  MINE_ACTIVE_SESSION_TTL_MS,
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
    const blocked = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });

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
    const started = await first.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
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
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 60 });
    await settlement.finalizeSession(started.sessionId, { energyDelta: 80, coinReward: 60 });

    expect(mineAwardedCoinsInWindow(PUBKEY, mineRewardWindowKey(DAY_ONE))).toBe(60);
  });

  it('an abandoned run holds none of the day', async () => {
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
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

    // Two overlapping runs can no longer be STARTED (see the start-guard
    // suite), so they are written straight into the ledger here. The clamp at
    // finalization is the final authority on the day's budget and must hold on
    // its own, whatever produced the records.
    const a = { ok: true as const, sessionId: 'concurrent-a' };
    const b = { ok: true as const, sessionId: 'concurrent-b' };
    for (const { sessionId } of [a, b]) {
      persistMineSession(PUBKEY, {
        sessionId,
        petId: PET_ID,
        status: 'open',
        startedAt: DAY_ONE,
        startEnergy: 100,
        updatedAt: DAY_ONE,
      });
    }

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

/**
 * F-06.1 — one rewarded run at a time, per account, across tabs.
 *
 * The daily cap already made overlapping runs financially safe, but the second
 * one could still spend a Blobbi's whole energy bar for a reward the first had
 * already claimed. The guard moves that refusal to the start, before any
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
    // Refused means no durable record — so no energy can ever be owed for it.
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

  it('the start guard runs BEFORE the daily-cap check', async () => {
    // Both would refuse; the in-progress reason is the accurate one to show.
    const nowRef = { ms: DAY_ONE };
    const { settlement } = makeSettlement(nowRef);
    await mineRun(settlement, MINE_DAILY_COIN_CAP);
    const blocked = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    expect(blocked).toEqual({ ok: false, reason: 'daily-cap-reached' });

    // Now with a live run as well.
    clearMineSessions();
    const live = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    expect(live.ok).toBe(true);
    expect(await settlement.startSession({ petId: PET_ID, startEnergy: 100 })).toEqual({
      ok: false,
      reason: 'session-in-progress',
    });
  });
});
