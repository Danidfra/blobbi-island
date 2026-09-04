/**
 * A reload mid-run must not lock the player out of the Mine.
 *
 * The scenario behind this file: start a trip, reload the page, press Start,
 * and read "You already have a mining trip in progress" for up to a minute and
 * a half. The unmount cleanup that abandons a run never fires on a reload, so
 * the `open` record survived with a fresh heartbeat, and nothing could tell it
 * apart from a run another tab was playing.
 *
 * Ownership is what tells them apart: every record carries the id of the tab
 * that opened it, scoped to that tab and surviving its reloads. A reloaded
 * tab recognises its own debris immediately; another tab's run still waits
 * for its heartbeat to go quiet.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createMineSettlement } from './mine-settlement';
import {
  clearMineSessions,
  mineSessionOwnerId,
  readMineSession,
  readMineSessions,
  resetMineSessionOwnerId,
  MINE_ACTIVE_SESSION_TTL_MS,
} from './mine-session-ledger';
import type { CoinWallet } from '@/inventory/coin-wallet';
import type { EnergySettler } from './energy-settlement';

const PUBKEY = 'b'.repeat(64);
const PET_ID = 'pet-1';
const T0 = Date.UTC(2026, 8, 4, 12);

function makeTab(nowRef: { ms: number }, ownerId?: string) {
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
    ownerId,
  });
  return { settlement, coinCalls };
}

function openSessions() {
  return readMineSessions(PUBKEY).filter((r) => r.status === 'open');
}

beforeEach(() => {
  clearMineSessions();
  resetMineSessionOwnerId();
});
afterEach(() => {
  clearMineSessions();
  resetMineSessionOwnerId();
});

describe('the tab identity', () => {
  it('is stable across reads (a reload of the same tab keeps it)', () => {
    expect(mineSessionOwnerId()).toBe(mineSessionOwnerId());
    expect(sessionStorage.getItem('blobbi:mine:owner')).toBe(mineSessionOwnerId());
  });

  it('is minted afresh for a new tab', () => {
    const first = mineSessionOwnerId();
    resetMineSessionOwnerId();
    expect(mineSessionOwnerId()).not.toBe(first);
  });
});

describe('refresh with an active mining trip', () => {
  it('lets the reloaded tab start again at once, abandoning its orphaned run', async () => {
    const nowRef = { ms: T0 };
    // The tab before the reload: real owner id from sessionStorage.
    const before = makeTab(nowRef);
    const run = await before.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!run.ok) throw new Error('start failed');
    before.settlement.heartbeatSession(run.sessionId);

    // The reload: a NEW settlement instance, one second later, same tab
    // (sessionStorage survived), no unmount cleanup ever ran.
    nowRef.ms += 1_000;
    const after = makeTab(nowRef);
    const next = await after.settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(next.ok).toBe(true);
    expect(readMineSession(PUBKEY, run.sessionId)).toMatchObject({
      status: 'abandoned',
      note: 'orphaned-by-reload',
    });
    expect(openSessions()).toHaveLength(1);
  });

  it('startup recovery on the reloaded tab frees the Mine before Start is even pressed', async () => {
    const nowRef = { ms: T0 };
    const before = makeTab(nowRef);
    const run = await before.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!run.ok) throw new Error('start failed');

    nowRef.ms += 1_000;
    const after = makeTab(nowRef);
    const results = await after.settlement.recoverSessions();

    // Nothing was owed, so nothing settles; the debris is simply gone.
    expect(results).toEqual([]);
    expect(readMineSession(PUBKEY, run.sessionId)?.status).toBe('abandoned');
    expect(after.coinCalls).toEqual([]);
  });

  it('charges nothing for the abandoned run', async () => {
    const nowRef = { ms: T0 };
    const before = makeTab(nowRef);
    const run = await before.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!run.ok) throw new Error('start failed');

    const after = makeTab(nowRef);
    await after.settlement.recoverSessions();
    const settled = await after.settlement.settleSession(run.sessionId);

    expect(settled).toEqual({ phase: 'settled', coinReward: 0, coinApplied: false });
    expect(readMineSession(PUBKEY, run.sessionId)?.energyDelta).toBeUndefined();
  });
});

describe('another tab’s trip', () => {
  it('still blocks while it heartbeats (duplicate start prevention)', async () => {
    const nowRef = { ms: T0 };
    const tabA = makeTab(nowRef, 'tab-a');
    const tabB = makeTab(nowRef, 'tab-b');
    const live = await tabA.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!live.ok) throw new Error('start failed');

    nowRef.ms += 30_000;
    tabA.settlement.heartbeatSession(live.sessionId);
    expect(await tabB.settlement.startSession({ petId: PET_ID, startEnergy: 100 })).toEqual({
      ok: false,
      reason: 'session-in-progress',
    });
    // Recovery in tab B leaves the live run alone too.
    await tabB.settlement.recoverSessions();
    expect(readMineSession(PUBKEY, live.sessionId)?.status).toBe('open');
  });

  it('is recovered as stale once it goes quiet', async () => {
    const nowRef = { ms: T0 };
    const tabA = makeTab(nowRef, 'tab-a');
    const tabB = makeTab(nowRef, 'tab-b');
    const live = await tabA.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!live.ok) throw new Error('start failed');

    nowRef.ms += MINE_ACTIVE_SESSION_TTL_MS + 1_000;
    const next = await tabB.settlement.startSession({ petId: PET_ID, startEnergy: 100 });

    expect(next.ok).toBe(true);
    expect(readMineSession(PUBKEY, live.sessionId)).toMatchObject({
      status: 'abandoned',
      note: 'stale-open-session',
    });
  });

  it('a record written before ownership existed is treated as foreign', async () => {
    const nowRef = { ms: T0 };
    const legacy = makeTab(nowRef, 'legacy-tab');
    const live = await legacy.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!live.ok) throw new Error('start failed');
    // Strip the owner, as an older build would have written it.
    const raw = JSON.parse(localStorage.getItem('blobbi:mine:sessions') ?? '{}');
    delete raw[PUBKEY][live.sessionId].ownerId;
    localStorage.setItem('blobbi:mine:sessions', JSON.stringify(raw));

    const mine = makeTab(nowRef);
    expect(await mine.settlement.startSession({ petId: PET_ID, startEnergy: 100 })).toEqual({
      ok: false,
      reason: 'session-in-progress',
    });
  });
});

describe('what a reload can resume', () => {
  it('resumes SETTLEMENT of a finished run under its original operation ids, never gameplay', async () => {
    const nowRef = { ms: T0 };
    const before = makeTab(nowRef);
    const run = await before.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!run.ok) throw new Error('start failed');
    await before.settlement.finalizeSession(run.sessionId, { energyDelta: 80, coinReward: 35 });
    // The reload lands between finalization and settlement.

    const after = makeTab(nowRef);
    const results = await after.settlement.recoverSessions();

    expect(results).toEqual([{ phase: 'settled', coinReward: 35, coinApplied: true }]);
    expect(after.coinCalls).toEqual([{ opId: `mine:${run.sessionId}:coin`, amount: 35 }]);
    expect(readMineSession(PUBKEY, run.sessionId)?.status).toBe('settled');
  });
});

describe('normal completion', () => {
  it('clears ownership: a finished run never blocks, whoever finished it', async () => {
    const nowRef = { ms: T0 };
    const tab = makeTab(nowRef);
    const run = await tab.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!run.ok) throw new Error('start failed');
    await tab.settlement.finalizeSession(run.sessionId, { energyDelta: 80, coinReward: 10 });
    await tab.settlement.settleSession(run.sessionId);

    expect(openSessions()).toHaveLength(0);
    const other = makeTab(nowRef, 'tab-b');
    expect((await other.settlement.startSession({ petId: PET_ID, startEnergy: 100 })).ok).toBe(true);
    expect((await tab.settlement.startSession({ petId: PET_ID, startEnergy: 100 })).ok).toBe(false);
  });
});
