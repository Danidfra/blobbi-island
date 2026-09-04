/**
 * Beach reward ledger, reservations, the daily window, the abandonment rule
 * and the one-way status doors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  abandonBeachReward,
  beachRewardedCount,
  clearBeachRewardOps,
  effectiveBeachWindowKey,
  finalizeBeachReward,
  readBeachRewardOp,
  reserveBeachReward,
  resolveBeachReward,
  unresolvedBeachRewardOps,
  updateBeachRewardParticipation,
} from './beach-reward-ledger';

const PUBKEY = 'e'.repeat(64);
const WINDOW = '2026-08-02';
const NOW = 1_800_000_000_000;

function reserve(opId: string, limit = 10) {
  return reserveBeachReward({
    pubkey: PUBKEY,
    opId,
    roundKey: `round-${opId}`,
    windowKey: WINDOW,
    limit,
    now: NOW,
  });
}

beforeEach(() => clearBeachRewardOps());
afterEach(() => clearBeachRewardOps());

describe('reservations and the daily limit', () => {
  it('reserves up to the limit and refuses the next one', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(reserve(`op-${i}`)).toMatchObject({ ok: true });
    }
    expect(beachRewardedCount(PUBKEY, WINDOW)).toBe(10);
    expect(reserve('op-11')).toEqual({ ok: false, reason: 'limit-reached' });
  });

  it('every consuming status counts against the window', () => {
    reserve('op-a');
    finalizeBeachReward(PUBKEY, 'op-a', 12, NOW);
    reserve('op-b');
    resolveBeachReward(PUBKEY, 'op-b', 'applied', NOW);
    reserve('op-c');
    abandonBeachReward(PUBKEY, 'op-c', true, NOW); // crossed threshold → consumed
    expect(beachRewardedCount(PUBKEY, WINDOW)).toBe(3);
  });

  it('an early abandonment RELEASES the slot', () => {
    reserve('op-early');
    abandonBeachReward(PUBKEY, 'op-early', false, NOW);
    expect(readBeachRewardOp(PUBKEY, 'op-early')).toBeNull();
    expect(beachRewardedCount(PUBKEY, WINDOW)).toBe(0);
  });

  it('a finalized reward is never abandoned, the intent survives', () => {
    reserve('op-keep');
    finalizeBeachReward(PUBKEY, 'op-keep', 9, NOW);
    abandonBeachReward(PUBKEY, 'op-keep', false, NOW);
    expect(readBeachRewardOp(PUBKEY, 'op-keep')?.status).toBe('finalized');
  });
});

describe('window monotonicity (clock rollback)', () => {
  it('the effective window never moves backwards past one with operations', () => {
    reserveBeachReward({
      pubkey: PUBKEY,
      opId: 'op-future',
      roundKey: 'r',
      windowKey: '2026-08-05',
      limit: 10,
      now: NOW,
    });
    // The system clock now says an EARLIER day: the later window keeps counting.
    expect(effectiveBeachWindowKey(PUBKEY, '2026-08-02')).toBe('2026-08-05');
    // A genuinely later day wins normally.
    expect(effectiveBeachWindowKey(PUBKEY, '2026-08-09')).toBe('2026-08-09');
  });
});

describe('status doors and participation', () => {
  it('participation only grows and only while reserved', () => {
    reserve('op-p');
    updateBeachRewardParticipation(PUBKEY, 'op-p', { digs: 2, activeSeconds: 12 }, NOW);
    updateBeachRewardParticipation(PUBKEY, 'op-p', { digs: 1, activeSeconds: 30 }, NOW);
    const op = readBeachRewardOp(PUBKEY, 'op-p')!;
    expect(op.digs).toBe(2); // never shrinks
    expect(op.activeSeconds).toBe(30);
  });

  it('applied is terminal; ambiguous only advances to applied', () => {
    reserve('op-doors');
    finalizeBeachReward(PUBKEY, 'op-doors', 8, NOW);
    resolveBeachReward(PUBKEY, 'op-doors', 'ambiguous', NOW);
    // Ambiguous cannot be re-expressed as reserved/finalized…
    expect(finalizeBeachReward(PUBKEY, 'op-doors', 8, NOW)).toBe(false);
    // …but reconciles to applied.
    expect(resolveBeachReward(PUBKEY, 'op-doors', 'applied', NOW)).toBe(true);
    // And applied never regresses.
    resolveBeachReward(PUBKEY, 'op-doors', 'ambiguous', NOW);
    expect(readBeachRewardOp(PUBKEY, 'op-doors')?.status).toBe('applied');
  });

  it('unresolved ops surface reserved, finalized and ambiguous records', () => {
    reserve('op-r');
    reserve('op-f');
    finalizeBeachReward(PUBKEY, 'op-f', 10, NOW);
    reserve('op-am');
    finalizeBeachReward(PUBKEY, 'op-am', 10, NOW);
    resolveBeachReward(PUBKEY, 'op-am', 'ambiguous', NOW);
    reserve('op-done');
    finalizeBeachReward(PUBKEY, 'op-done', 10, NOW);
    resolveBeachReward(PUBKEY, 'op-done', 'applied', NOW);

    const unresolved = unresolvedBeachRewardOps(PUBKEY).map((op) => op.opId);
    expect(unresolved.sort()).toEqual(['op-am', 'op-f', 'op-r']);
  });
});
