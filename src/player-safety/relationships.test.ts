/**
 * The canonical relationship store.
 *
 * The assertions that matter most are the ones about NOT losing a block: a
 * corrupt record, a full store, an unrelated write, or an unmute must never be
 * able to restore someone the player removed. Everything else in this phase is
 * downstream of this file being right.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSafetyAccount, setSafetyAccount } from './account-scope';

import {
  MAX_TRACKED_PLAYERS,
  NO_RELATIONSHIP,
  PLAYER_SAFETY_STORAGE_KEY,
  clearAllRelationships,
  isBlocked,
  isCommunicationSilenced,
  isMuted,
  listRelationships,
  relationshipFor,
  relationshipsSnapshot,
  setPlayerBlocked,
  setPlayerMuted,
  subscribeRelationships,
} from './relationships';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const pubkeyAt = (index: number) => index.toString(16).padStart(64, '0');

/*
  Relationships are ACCOUNT-SCOPED now, so these run as a signed-in player.
  `KEY` is where that player's list actually lives; the isolation between
  accounts is proven in `account-scope.test.ts`.
*/
const ME = 'f'.repeat(64);
const KEY = `${PLAYER_SAFETY_STORAGE_KEY}:${ME}`;

beforeEach(() => {
  localStorage.clear();
  resetSafetyAccount();
  setSafetyAccount(ME);
  clearAllRelationships();
});

afterEach(() => {
  localStorage.clear();
  resetSafetyAccount();
  vi.restoreAllMocks();
});

describe('the two bits are independent', () => {
  it('starts neutral', () => {
    expect(relationshipFor(A)).toEqual({ muted: false, blocked: false });
    expect(relationshipFor(A)).toBe(NO_RELATIONSHIP);
  });

  it('mutes without blocking', () => {
    setPlayerMuted(A, true);
    expect(relationshipFor(A)).toEqual({ muted: true, blocked: false });
    expect(isBlocked(A)).toBe(false);
  });

  it('blocks without setting the mute bit', () => {
    setPlayerBlocked(A, true);
    expect(relationshipFor(A)).toEqual({ muted: false, blocked: true });
  });

  it('keeps a mute when a block is lifted', () => {
    // Each step was a decision the player made; undoing one must not undo the
    // other.
    setPlayerMuted(A, true);
    setPlayerBlocked(A, true);
    setPlayerBlocked(A, false);
    expect(relationshipFor(A)).toEqual({ muted: true, blocked: false });
  });

  it('keeps a block when a mute is lifted', () => {
    setPlayerMuted(A, true);
    setPlayerBlocked(A, true);
    setPlayerMuted(A, false);
    expect(relationshipFor(A)).toEqual({ muted: false, blocked: true });
  });
});

describe('precedence: blocking implies silence', () => {
  it('silences a muted player', () => {
    setPlayerMuted(A, true);
    expect(isCommunicationSilenced(A)).toBe(true);
  });

  it('silences a blocked player even though the mute bit is unset', () => {
    // The rule the ingest paths depend on. If this were `muted` only, a blocked
    // player's messages would still render.
    setPlayerBlocked(A, true);
    expect(isMuted(A)).toBe(false);
    expect(isCommunicationSilenced(A)).toBe(true);
  });

  it('does not silence a stranger', () => {
    setPlayerBlocked(A, true);
    expect(isCommunicationSilenced(B)).toBe(false);
  });
});

describe('persistence', () => {
  it('survives a reload', () => {
    setPlayerBlocked(A, true);
    setPlayerMuted(B, true);

    // A reload is a fresh module read against the same storage.
    expect(isBlocked(A)).toBe(true);
    expect(isMuted(B)).toBe(true);
    expect(localStorage.getItem(KEY)).toContain(A);
  });

  it('keeps an unblock unblocked', () => {
    setPlayerBlocked(A, true);
    setPlayerBlocked(A, false);
    expect(isBlocked(A)).toBe(false);
    expect(listRelationships()).toEqual([]);
  });

  it('drops records that say nothing rather than keeping tombstones', () => {
    setPlayerMuted(A, true);
    setPlayerMuted(A, false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reports a failed write instead of claiming success', () => {
    // Storage can refuse (private browsing, quota). A player told "blocked" who
    // is not blocked after a reload is the failure this guards.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('nope');
    });
    expect(setPlayerBlocked(A, true)).toBe(false);
  });
});

describe('corruption tolerance', () => {
  it.each([
    ['malformed JSON', '{not json'],
    ['an array', '[]'],
    ['a string', '"blocked"'],
    ['null', 'null'],
    ['a missing players key', '{"v":1}'],
    ['players as an array', '{"v":1,"players":[]}'],
  ])('reads %s as no relationships rather than throwing', (_label, raw) => {
    localStorage.setItem(KEY, raw);
    expect(() => listRelationships()).not.toThrow();
    expect(listRelationships()).toEqual([]);
    expect(isBlocked(A)).toBe(false);
  });

  it('ignores entries that are not pubkeys', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, players: { 'not-a-key': { b: 1 }, [A]: { b: 1 } } }),
    );
    expect(listRelationships().map((entry) => entry.pubkey)).toEqual([A]);
  });

  it('survives a corrupt neighbour and still blocks the valid entry', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, players: { [A]: { b: 1 }, [B]: 'garbage', [C]: { m: 1 } } }),
    );
    expect(isBlocked(A)).toBe(true);
    expect(isMuted(C)).toBe(true);
  });

  it('refuses to record a relationship against junk', () => {
    expect(setPlayerBlocked('not-a-pubkey', true)).toBe(false);
    expect(setPlayerBlocked('', true)).toBe(false);
    expect(listRelationships()).toEqual([]);
  });

  it('treats a pubkey case-insensitively', () => {
    setPlayerBlocked(A.toUpperCase(), true);
    expect(isBlocked(A)).toBe(true);
  });
});

describe('bounds never cost a block', () => {
  it('evicts an old MUTE to make room', () => {
    for (let i = 0; i < MAX_TRACKED_PLAYERS; i += 1) {
      setPlayerMuted(pubkeyAt(i), true, 1000 + i);
    }
    expect(listRelationships()).toHaveLength(MAX_TRACKED_PLAYERS);

    setPlayerBlocked(A, true, 999_999);
    expect(isBlocked(A)).toBe(true);
    // The oldest mute made way, and the total held.
    expect(isMuted(pubkeyAt(0))).toBe(false);
    expect(listRelationships()).toHaveLength(MAX_TRACKED_PLAYERS);
  });

  it('grows past the cap rather than dropping a block', () => {
    // The deliberate exception. A size limit must never silently restore
    // someone the player removed, so the cap yields instead.
    for (let i = 0; i < MAX_TRACKED_PLAYERS; i += 1) {
      setPlayerBlocked(pubkeyAt(i), true, 1000 + i);
    }
    setPlayerBlocked(A, true, 999_999);

    expect(listRelationships()).toHaveLength(MAX_TRACKED_PLAYERS + 1);
    for (let i = 0; i < MAX_TRACKED_PLAYERS; i += 1) {
      expect(isBlocked(pubkeyAt(i))).toBe(true);
    }
    expect(isBlocked(A)).toBe(true);
  });
});

describe('snapshots and subscriptions', () => {
  it('returns a stable snapshot between changes', () => {
    // `useSyncExternalStore` re-renders forever if this identity changes.
    setPlayerBlocked(A, true);
    expect(relationshipsSnapshot()).toBe(relationshipsSnapshot());
  });

  it('returns a new snapshot after a real change', () => {
    const before = relationshipsSnapshot();
    setPlayerBlocked(A, true);
    expect(relationshipsSnapshot()).not.toBe(before);
  });

  it('notifies subscribers on a change', () => {
    const seen = vi.fn();
    const stop = subscribeRelationships(seen);
    setPlayerBlocked(A, true);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not notify when nothing moved', () => {
    setPlayerBlocked(A, true);
    const seen = vi.fn();
    const stop = subscribeRelationships(seen);
    setPlayerBlocked(A, true);
    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it('stops notifying after unsubscribe', () => {
    const seen = vi.fn();
    subscribeRelationships(seen)();
    setPlayerBlocked(A, true);
    expect(seen).not.toHaveBeenCalled();
  });

  it('picks up a change made in another tab', () => {
    // `localStorage` fires `storage` in every OTHER document of the origin, so
    // this is what cross-tab propagation actually looks like.
    const seen = vi.fn();
    const stop = subscribeRelationships(seen);

    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, players: { [B]: { b: 1, at: 1 } } }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    expect(seen).toHaveBeenCalled();
    expect(isBlocked(B)).toBe(true);
    stop();
  });

  it('ignores storage events for unrelated keys', () => {
    const seen = vi.fn();
    const stop = subscribeRelationships(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});
