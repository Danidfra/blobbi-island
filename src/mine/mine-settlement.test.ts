/**
 * Mine session settlement, the lifecycle, and what a failure costs.
 *
 * The behaviour being replaced: energy was published on every click, so an
 * interruption left the cost paid and the reward unearned. Everything here is
 * about the inverse guarantee, **an interrupted run costs nothing, and a
 * partial settlement always leaves the player up, never down.**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMineSettlement } from './mine-settlement';
import {
  clearMineSessions,
  mineCoinOpId,
  mineEnergyOpId,
  readMineSession,
  pruneMineSessions,
  persistMineSession,
  unresolvedMineSessions,
  MINE_SESSION_RETENTION_MS,
  MINE_ACTIVE_SESSION_TTL_MS,
} from './mine-session-ledger';
import type { CoinWallet } from '@/inventory/coin-wallet';
import type { EnergySettler, EnergySettlementOutcome } from './energy-settlement';

const PUBKEY = 'f'.repeat(64);
const PET_ID = 'blobbi-aa-bb';

type CoinBehaviour = 'applied' | 'already-applied' | 'ambiguous' | 'throws';

function makeDeps(options: {
  coin?: CoinBehaviour;
  energy?: EnergySettlementOutcome['status'];
  /** Which tab this instance models; distinct ids model distinct tabs. */
  ownerId?: string;
} = {}) {
  const coinCalls: { opId: string; amount: number }[] = [];
  const energyCalls: { opId: string; amount: number; petId: string }[] = [];

  const wallet = {
    grantCoins: vi.fn(async (op: { opId: string; amount: number }) => {
      coinCalls.push({ opId: op.opId, amount: op.amount });
      const behaviour = options.coin ?? 'applied';
      if (behaviour === 'throws') throw new Error('provably unsent');
      if (behaviour === 'ambiguous') {
        return { status: 'ambiguous', reason: 'publish-timeout' } as const;
      }
      if (behaviour === 'already-applied') return { status: 'already-applied' } as const;
      return { status: 'applied', balance: 100, verified: true } as const;
    }),
    spendCoins: vi.fn(),
    readBalance: vi.fn(),
    reconcileOp: vi.fn(),
  } as unknown as CoinWallet;

  const settleEnergyDelta: EnergySettler['settleEnergyDelta'] = async (op) => {
    energyCalls.push({ opId: op.opId, amount: op.amount, petId: op.petId });
    const status = options.energy ?? 'applied';
    if (status === 'applied') {
      return { status: 'applied', energyAfter: 20, appliedDelta: op.amount, verified: true };
    }
    if (status === 'already-applied') return { status: 'already-applied' };
    if (status === 'ambiguous') return { status: 'ambiguous', reason: 'publish-timeout' };
    if (status === 'blocked') return { status: 'blocked', blockedBy: 'ambiguous' };
    return { status: 'failed', reason: 'sign-failed' };
  };
  const settler: EnergySettler = {
    settleEnergyDelta: vi.fn(settleEnergyDelta),
    reconcileEnergyOp: vi.fn(async () => null),
  };

  const settlement = createMineSettlement({
    pubkey: PUBKEY,
    wallet,
    settler,
    now: () => 1_700_000_000_000,
    ownerId: options.ownerId,
  });
  return { settlement, wallet, settler, coinCalls, energyCalls };
}

/** Start + play + finish, without any UI. */
async function runToFinish(
  settlement: ReturnType<typeof makeDeps>['settlement'],
  values: { energyDelta: number; coinReward: number },
) {
  const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
  if (!started.ok) throw new Error('start failed');
  const frozen = await settlement.finalizeSession(started.sessionId, values);
  expect(frozen.ok).toBe(true);
  return started.sessionId;
}

beforeEach(() => clearMineSessions());
afterEach(() => {
  clearMineSessions();
  vi.restoreAllMocks();
});

describe('a complete run settles Coins first, then energy', () => {
  it('energy 100 → consumes 80, reward 37 → both applied, session settled', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps();
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    const result = await settlement.settleSession(sessionId);

    expect(result).toEqual({ phase: 'settled', coinReward: 37, coinApplied: true });
    expect(coinCalls).toEqual([{ opId: mineCoinOpId(sessionId), amount: 37 }]);
    expect(energyCalls).toEqual([
      { opId: mineEnergyOpId(sessionId), amount: 80, petId: PET_ID },
    ]);
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('settled');
  });

  it('settling the SAME session twice moves each side once', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps();
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    await settlement.settleSession(sessionId);
    const second = await settlement.settleSession(sessionId);

    expect(second.phase).toBe('settled');
    expect(coinCalls).toHaveLength(1);
    expect(energyCalls).toHaveLength(1);
  });

  it('a zero reward still settles the energy cost', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps();
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 0 });

    const result = await settlement.settleSession(sessionId);

    expect(result.phase).toBe('settled');
    expect(coinCalls).toHaveLength(0); // nothing to grant
    expect(energyCalls).toHaveLength(1);
  });

  it('freezes the numbers: a second finalize cannot change them', async () => {
    const { settlement } = makeDeps();
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    await settlement.finalizeSession(sessionId, { energyDelta: 1, coinReward: 9999 });

    const record = readMineSession(PUBKEY, sessionId);
    expect(record?.energyDelta).toBe(80);
    expect(record?.coinReward).toBe(37);
  });
});

describe('partial failure always leaves the player UP', () => {
  it('an AMBIGUOUS Coin grant does not charge energy', async () => {
    const { settlement, energyCalls } = makeDeps({ coin: 'ambiguous' });
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    const result = await settlement.settleSession(sessionId);

    expect(result.phase).toBe('coin-pending');
    // The whole point: no energy is spent against an unconfirmed reward.
    expect(energyCalls).toHaveLength(0);
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('coin-pending');
  });

  it('a provably-unsent Coin grant leaves the session recoverable, energy untouched', async () => {
    const { settlement, energyCalls } = makeDeps({ coin: 'throws' });
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    const result = await settlement.settleSession(sessionId);

    expect(result.phase).toBe('unresolved');
    expect(energyCalls).toHaveLength(0);
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('coin-pending');
  });

  it('Coin applied but energy failing keeps the Coins and retries energy later', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps({ energy: 'failed' });
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    const result = await settlement.settleSession(sessionId);

    expect(result).toEqual({ phase: 'energy-pending', coinReward: 37, coinApplied: true });
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('energy-pending');

    // A later attempt re-uses the SAME ids and does not re-grant the Coins.
    await settlement.settleSession(sessionId);
    expect(coinCalls).toHaveLength(1);
    expect(energyCalls).toHaveLength(2);
    expect(energyCalls[0].opId).toBe(energyCalls[1].opId);
  });

  it('an AMBIGUOUS energy publish is never blind-retried into a second subtraction', async () => {
    const { settlement } = makeDeps({ energy: 'ambiguous' });
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });

    const result = await settlement.settleSession(sessionId);

    expect(result.phase).toBe('energy-pending');
    // The energy settler owns the no-blind-retry rule (its ledger blocks a
    // second publish); the session simply stays pending under the same id.
    expect(readMineSession(PUBKEY, sessionId)?.energyStatus).toBe('ambiguous');
  });
});

describe('an interrupted run costs nothing', () => {
  it('abandoning an open session owes no Coins and no energy', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps();
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    settlement.abandonSession(started.sessionId);

    expect(readMineSession(PUBKEY, started.sessionId)?.status).toBe('abandoned');
    // Settling an abandoned session is a no-op.
    await settlement.settleSession(started.sessionId);
    expect(coinCalls).toHaveLength(0);
    expect(energyCalls).toHaveLength(0);
  });

  it('recovery abandons a STALE open session instead of inventing a reward', async () => {
    const { settlement, coinCalls, energyCalls } = makeDeps();
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');
    // Age it past the liveness window: the tab that owned it is gone.
    const record = readMineSession(PUBKEY, started.sessionId)!;
    persistMineSession(PUBKEY, {
      ...record,
      updatedAt: record.updatedAt - MINE_ACTIVE_SESSION_TTL_MS - 1_000,
    });

    const results = await settlement.recoverSessions();

    expect(results).toEqual([]);
    expect(readMineSession(PUBKEY, started.sessionId)?.status).toBe('abandoned');
    expect(coinCalls).toHaveLength(0);
    expect(energyCalls).toHaveLength(0);
  });

  it('recovery LEAVES a live open session alone, another tab may be playing it', async () => {
    const firstTab = makeDeps({ ownerId: 'tab-a' });
    const started = await firstTab.settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    // Opening the cave in a second tab runs recovery. Abandoning here would
    // silently void the run someone is playing in the first tab.
    const secondTab = makeDeps({ ownerId: 'tab-b' });
    await secondTab.settlement.recoverSessions();

    expect(readMineSession(PUBKEY, started.sessionId)?.status).toBe('open');
  });

  it('an unfinalized session can never be settled', async () => {
    const { settlement, coinCalls } = makeDeps();
    const started = await settlement.startSession({ petId: PET_ID, startEnergy: 100 });
    if (!started.ok) throw new Error('start failed');

    const result = await settlement.settleSession(started.sessionId);

    expect(result.phase).toBe('unresolved');
    expect(coinCalls).toHaveLength(0);
  });
});

describe('recovery resumes finalized work under the original ids', () => {
  it('finishes a session left in coin-pending after a reload', async () => {
    // First attempt: the Coin grant was ambiguous.
    const first = makeDeps({ coin: 'ambiguous' });
    const sessionId = await runToFinish(first.settlement, { energyDelta: 80, coinReward: 37 });
    await first.settlement.settleSession(sessionId);
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('coin-pending');

    // "Reload": a fresh service over the SAME durable ledger, relay healthy.
    const second = makeDeps({ coin: 'already-applied' });
    const results = await second.settlement.recoverSessions();

    expect(results.map((r) => r.phase)).toEqual(['settled']);
    expect(second.coinCalls[0].opId).toBe(mineCoinOpId(sessionId));
    expect(second.energyCalls[0].opId).toBe(mineEnergyOpId(sessionId));
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('settled');
  });

  it('a session left in energy-pending resumes energy only', async () => {
    const first = makeDeps({ energy: 'failed' });
    const sessionId = await runToFinish(first.settlement, { energyDelta: 80, coinReward: 37 });
    await first.settlement.settleSession(sessionId);

    const second = makeDeps();
    await second.settlement.recoverSessions();

    // Coins were already applied, so recovery does not grant again.
    expect(second.coinCalls).toHaveLength(0);
    expect(second.energyCalls).toHaveLength(1);
    expect(readMineSession(PUBKEY, sessionId)?.status).toBe('settled');
  });

  it('settled sessions need no action', async () => {
    const { settlement } = makeDeps();
    const sessionId = await runToFinish(settlement, { energyDelta: 80, coinReward: 37 });
    await settlement.settleSession(sessionId);

    const again = makeDeps();
    const results = await again.settlement.recoverSessions();
    expect(results).toEqual([]);
    expect(again.coinCalls).toHaveLength(0);
  });
});

describe('operation identities are deterministic', () => {
  it('derive from the session, so a retry never mints a new id', () => {
    expect(mineCoinOpId('s1')).toBe('mine:s1:coin');
    expect(mineEnergyOpId('s1')).toBe('mine:s1:energy');
    // Namespaced, so the Coin and energy ledgers can never collide.
    expect(mineCoinOpId('s1')).not.toBe(mineEnergyOpId('s1'));
  });
});

describe('the durable ledger is bounded and corruption-tolerant', () => {
  it('prunes terminal records past the retention window', () => {
    persistMineSession(PUBKEY, {
      sessionId: 'old', petId: PET_ID, status: 'settled',
      startedAt: 0, startEnergy: 100, updatedAt: 0,
    });
    persistMineSession(PUBKEY, {
      sessionId: 'recent', petId: PET_ID, status: 'settled',
      startedAt: 0, startEnergy: 100, updatedAt: MINE_SESSION_RETENTION_MS,
    });
    persistMineSession(PUBKEY, {
      sessionId: 'owing', petId: PET_ID, status: 'energy-pending',
      startedAt: 0, startEnergy: 100, updatedAt: 0,
    });

    pruneMineSessions(PUBKEY, MINE_SESSION_RETENTION_MS + 1);

    expect(readMineSession(PUBKEY, 'old')).toBeNull();
    expect(readMineSession(PUBKEY, 'recent')).not.toBeNull();
    // An unresolved session is NEVER pruned, however old.
    expect(readMineSession(PUBKEY, 'owing')).not.toBeNull();
  });

  it('one malformed record does not hide the others', () => {
    persistMineSession(PUBKEY, {
      sessionId: 'good', petId: PET_ID, status: 'energy-pending',
      startedAt: 0, startEnergy: 100, updatedAt: 0,
    });
    const raw = JSON.parse(localStorage.getItem('blobbi:mine:sessions') ?? '{}');
    raw[PUBKEY].broken = { sessionId: 42, nonsense: true };
    localStorage.setItem('blobbi:mine:sessions', JSON.stringify(raw));

    const sessions = unresolvedMineSessions(PUBKEY);
    expect(sessions.map((s) => s.sessionId)).toEqual(['good']);
  });

  it('survives entirely unparseable storage', () => {
    localStorage.setItem('blobbi:mine:sessions', 'not json');
    expect(() => unresolvedMineSessions(PUBKEY)).not.toThrow();
    expect(unresolvedMineSessions(PUBKEY)).toEqual([]);
  });
});
