/**
 * Two people, one browser.
 *
 * A parent and a child on the same laptop used to share one mute list, one
 * block list and one pile of reports. Nobody asked for that and nobody could
 * see it had happened: the child's blocks silently applied to the parent's
 * island, and the parent could read every report the child had filed.
 *
 * These tests are the proof that a safety decision belongs to the player who
 * made it, and to nobody else on the device.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYER_REPORT_STORAGE_KEY,
  PLAYER_SAFETY_STORAGE_KEY,
  buildPlayerReport,
  isBlocked,
  isMuted,
  listReports,
  setPlayerBlocked,
  setPlayerMuted,
  storeReport,
} from './index';
import { isSelf, resetSafetyAccount, safetyAccount, setSafetyAccount } from './account-scope';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const RUDE = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

const fileReport = (reporter: string, reported: string, id: string, now = Date.now()) => {
  const built = buildPlayerReport({
    reportedPubkey: reported,
    reporterPubkey: reporter,
    category: 'mean',
    islandId: '1',
    location: 'town',
    id,
    now,
  });
  if (!built.ok) throw new Error(`expected a report, got ${built.reason}`);
  return storeReport(built.report);
};

beforeEach(() => {
  localStorage.clear();
  resetSafetyAccount();
});

afterEach(() => {
  localStorage.clear();
  resetSafetyAccount();
});

describe('relationships belong to one account', () => {
  it('does not show A\'s mute to B', () => {
    setSafetyAccount(A);
    expect(setPlayerMuted(RUDE, true)).toBe(true);
    expect(isMuted(RUDE)).toBe(true);

    setSafetyAccount(B);
    expect(isMuted(RUDE)).toBe(false);
  });

  it('does not show A\'s block to B', () => {
    setSafetyAccount(A);
    setPlayerBlocked(RUDE, true);
    expect(isBlocked(RUDE)).toBe(true);

    setSafetyAccount(B);
    expect(isBlocked(RUDE)).toBe(false);
  });

  it('gives A their list back when they return', () => {
    setSafetyAccount(A);
    setPlayerBlocked(RUDE, true);
    setSafetyAccount(B);
    setPlayerBlocked(OTHER, true);

    setSafetyAccount(A);
    expect(isBlocked(RUDE)).toBe(true);
    expect(isBlocked(OTHER)).toBe(false);

    setSafetyAccount(B);
    expect(isBlocked(OTHER)).toBe(true);
    expect(isBlocked(RUDE)).toBe(false);
  });

  it('writes each account under its own key', () => {
    setSafetyAccount(A);
    setPlayerBlocked(RUDE, true);

    expect(localStorage.getItem(`${PLAYER_SAFETY_STORAGE_KEY}:${A}`)).toContain(RUDE);
    // Nothing at the old browser-wide key: that is the leak.
    expect(localStorage.getItem(PLAYER_SAFETY_STORAGE_KEY)).toBeNull();
  });

  it('wakes subscribers when the account changes', () => {
    // Enforcement is live: a world A left mounted must re-prune for B rather
    // than keep hiding whoever A had blocked.
    setSafetyAccount(A);
    setPlayerBlocked(RUDE, true);

    let notified = 0;
    const stop = subscribe(() => { notified += 1; });
    setSafetyAccount(B);
    stop();

    expect(notified).toBeGreaterThan(0);
    expect(isBlocked(RUDE)).toBe(false);
  });
});

describe('reports belong to one account', () => {
  it('does not show A\'s reports to B', () => {
    setSafetyAccount(A);
    expect(fileReport(A, RUDE, 'r-a')).toBe(true);
    expect(listReports()).toHaveLength(1);

    setSafetyAccount(B);
    expect(listReports()).toEqual([]);
  });

  it('gives A their reports back', () => {
    setSafetyAccount(A);
    fileReport(A, RUDE, 'r-a');
    setSafetyAccount(B);
    fileReport(B, OTHER, 'r-b');

    setSafetyAccount(A);
    expect(listReports().map((r) => r.id)).toEqual(['r-a']);
    setSafetyAccount(B);
    expect(listReports().map((r) => r.id)).toEqual(['r-b']);
  });

  it('writes each reporter under their own key', () => {
    setSafetyAccount(A);
    fileReport(A, RUDE, 'r-a');
    expect(localStorage.getItem(`${PLAYER_REPORT_STORAGE_KEY}:${A}`)).toContain('r-a');
    expect(localStorage.getItem(PLAYER_REPORT_STORAGE_KEY)).toBeNull();
  });
});

describe('signed out keeps nothing', () => {
  it('persists nothing at all', () => {
    setSafetyAccount(null);
    setPlayerBlocked(RUDE, true);
    fileReport('', RUDE, 'r-anon');

    // In scope for this session…
    expect(isBlocked(RUDE)).toBe(true);
    // …and written nowhere.
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it('is never inherited by the account that signs in', () => {
    // The obvious implementation of a signed-out bucket hands it to whoever
    // arrives next, which is the leak this whole module exists to close.
    setSafetyAccount(null);
    setPlayerBlocked(RUDE, true);

    setSafetyAccount(A);
    expect(isBlocked(RUDE)).toBe(false);
    expect(listReports()).toEqual([]);
  });

  it('treats a malformed pubkey as signed out rather than as a key', () => {
    setSafetyAccount('not-a-pubkey');
    expect(safetyAccount()).toBeNull();
    setPlayerBlocked(RUDE, true);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});

describe('you are not your own problem', () => {
  it('refuses to mute or block yourself', () => {
    setSafetyAccount(A);
    expect(setPlayerMuted(A, true)).toBe(false);
    expect(setPlayerBlocked(A, true)).toBe(false);
    expect(isMuted(A)).toBe(false);
    expect(isBlocked(A)).toBe(false);
  });

  it('refuses a self-report at the builder', () => {
    setSafetyAccount(A);
    const built = buildPlayerReport({
      reportedPubkey: A,
      reporterPubkey: A,
      category: 'mean',
      islandId: '1',
      location: 'town',
    });
    expect(built).toEqual({ ok: false, reason: 'self-report' });
  });

  it('knows who "self" is, and only while signed in', () => {
    setSafetyAccount(A);
    expect(isSelf(A)).toBe(true);
    expect(isSelf(B)).toBe(false);

    setSafetyAccount(null);
    expect(isSelf(A)).toBe(false);
  });

  it('still lets a player block somebody else', () => {
    setSafetyAccount(A);
    expect(setPlayerBlocked(B, true)).toBe(true);
    expect(isBlocked(B)).toBe(true);
  });
});

describe('a store from a version we do not know', () => {
  it('is not read as though it were this one', () => {
    setSafetyAccount(A);
    localStorage.setItem(
      `${PLAYER_SAFETY_STORAGE_KEY}:${A}`,
      JSON.stringify({ v: 2, players: { [RUDE]: { m: 1, b: 1, at: 1 } } }),
    );
    // Reading a v2 record with v1 rules is how a block quietly becomes a mute.
    expect(isBlocked(RUDE)).toBe(false);
    expect(isMuted(RUDE)).toBe(false);
  });

  it('still reads a record with no version, which is what shipped first', () => {
    setSafetyAccount(A);
    localStorage.setItem(
      `${PLAYER_SAFETY_STORAGE_KEY}:${A}`,
      JSON.stringify({ players: { [RUDE]: { b: 1, at: 1 } } }),
    );
    expect(isBlocked(RUDE)).toBe(true);
  });

  it('refuses an unknown report schema too', () => {
    setSafetyAccount(A);
    localStorage.setItem(
      `${PLAYER_REPORT_STORAGE_KEY}:${A}`,
      JSON.stringify({ v: 99, reports: [{ id: 'x', reportedPubkey: RUDE }] }),
    );
    expect(listReports()).toEqual([]);
  });

  it('survives a corrupt store without throwing', () => {
    setSafetyAccount(A);
    localStorage.setItem(`${PLAYER_SAFETY_STORAGE_KEY}:${A}`, '{not json');
    localStorage.setItem(`${PLAYER_REPORT_STORAGE_KEY}:${A}`, 'nonsense');
    expect(() => isBlocked(RUDE)).not.toThrow();
    expect(() => listReports()).not.toThrow();
    expect(listReports()).toEqual([]);
  });
});

describe('duplicate submits', () => {
  it('does not file the same complaint twice', () => {
    setSafetyAccount(A);
    const now = 1_800_000_000_000;
    expect(fileReport(A, RUDE, 'r-1', now)).toBe(true);
    // A retry mints a new id, which is exactly why dedupe cannot key on it.
    expect(fileReport(A, RUDE, 'r-2', now + 500)).toBe(true);
    expect(listReports()).toHaveLength(1);
  });

  it('still files a genuinely different complaint', () => {
    setSafetyAccount(A);
    const now = 1_800_000_000_000;
    fileReport(A, RUDE, 'r-1', now);

    const other = buildPlayerReport({
      reportedPubkey: RUDE,
      reporterPubkey: A,
      category: 'spam',
      islandId: '1',
      location: 'town',
      id: 'r-3',
      now: now + 500,
    });
    if (!other.ok) throw new Error('expected a report');
    storeReport(other.report);

    expect(listReports()).toHaveLength(2);
  });

  it('files the same complaint again much later', () => {
    setSafetyAccount(A);
    const now = 1_800_000_000_000;
    fileReport(A, RUDE, 'r-1', now);
    fileReport(A, RUDE, 'r-2', now + 10 * 60_000);
    expect(listReports()).toHaveLength(2);
  });
});

// Imported late so the block above reads in one piece.
import { subscribeRelationships as subscribe } from './relationships';
