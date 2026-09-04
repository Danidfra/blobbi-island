/**
 * The in-game notice store: bounded to two, oldest out first, gone on its
 * own after the dwell, and nothing more than presentation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  GAME_NOTICE_TTL_MS,
  MAX_VISIBLE_GAME_NOTICES,
  clearGameNotices,
  dismissGameNotice,
  gameNoticesSnapshot,
  showGameNotice,
  subscribeGameNotices,
} from './game-notices';

const titles = () => gameNoticesSnapshot().map((n) => n.title);

beforeEach(() => {
  vi.useFakeTimers();
  clearGameNotices();
});
afterEach(() => {
  clearGameNotices();
  vi.useRealTimers();
});

describe('the stack', () => {
  it('holds one, then two', () => {
    showGameNotice({ title: 'A' });
    expect(titles()).toEqual(['A']);
    showGameNotice({ title: 'B' });
    expect(titles()).toEqual(['A', 'B']);
  });

  it('a third evicts the OLDEST at once: A goes, B stays, C appears', () => {
    showGameNotice({ title: 'A' });
    showGameNotice({ title: 'B' });
    showGameNotice({ title: 'C' });
    expect(titles()).toEqual(['B', 'C']);
    showGameNotice({ title: 'D' });
    expect(titles()).toEqual(['C', 'D']);
    expect(MAX_VISIBLE_GAME_NOTICES).toBe(2);
  });

  it('never queues a backlog: ten rapid notices leave exactly the two newest', () => {
    for (let i = 0; i < 10; i += 1) showGameNotice({ title: `N${i}` });
    expect(titles()).toEqual(['N8', 'N9']);
  });

  it('notifies subscribers on every change, with a stable snapshot between changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGameNotices(listener);
    showGameNotice({ title: 'A' });
    const snapshot = gameNoticesSnapshot();
    expect(gameNoticesSnapshot()).toBe(snapshot);
    showGameNotice({ title: 'B' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    showGameNotice({ title: 'C' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('the dwell', () => {
  it('a notice leaves on its own after the dwell time, the same the Farm uses', () => {
    showGameNotice({ title: 'A' });
    vi.advanceTimersByTime(GAME_NOTICE_TTL_MS - 1);
    expect(titles()).toEqual(['A']);
    vi.advanceTimersByTime(1);
    expect(titles()).toEqual([]);
    expect(GAME_NOTICE_TTL_MS).toBe(7000);
  });

  it('an evicted notice\'s timer cannot remove a later notice, and dismiss is immediate', () => {
    showGameNotice({ title: 'A' });
    showGameNotice({ title: 'B' });
    const c = showGameNotice({ title: 'C' });
    vi.advanceTimersByTime(GAME_NOTICE_TTL_MS + 10);
    expect(titles()).toEqual([]);
    const d = showGameNotice({ title: 'D' });
    dismissGameNotice(c); // stale id: no-op
    expect(titles()).toEqual(['D']);
    dismissGameNotice(d);
    expect(titles()).toEqual([]);
  });

  it('carries the content through untouched', () => {
    showGameNotice({ title: '+1 Strawberry', description: 'Received from Nostr Farm', imageUrl: 'https://img/s.webp', emoji: '🍓' });
    expect(gameNoticesSnapshot()[0]).toMatchObject({ title: '+1 Strawberry', description: 'Received from Nostr Farm', imageUrl: 'https://img/s.webp', emoji: '🍓' });
  });
});
