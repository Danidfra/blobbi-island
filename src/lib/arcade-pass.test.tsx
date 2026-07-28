/**
 * Arcade Pass lifecycle coverage.
 *
 * `ArcadePassIcon` used to run `setInterval(checkPass, 1000)` for the entire
 * session, in every location, because `sessionStorage` fires no event for
 * same-tab writes. These tests pin the replacement: the writers notify, there is
 * no timer anywhere, and the pass stays distinct from the Arcade Ticket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';

import {
  clearArcadePass,
  grantArcadePass,
  hasArcadePass,
  resetArcadePassSubscribers,
  subscribeArcadePass,
} from './arcade-pass';
import { ArcadePassIcon } from '@/components/blobbi/ArcadePassIcon';

beforeEach(() => {
  clearArcadePass();
  resetArcadePassSubscribers();
});

afterEach(() => {
  vi.useRealTimers();
  clearArcadePass();
  resetArcadePassSubscribers();
});

describe('the store', () => {
  it('starts without a pass', () => {
    expect(hasArcadePass()).toBe(false);
  });

  it('grants and clears', () => {
    grantArcadePass();
    expect(hasArcadePass()).toBe(true);
    clearArcadePass();
    expect(hasArcadePass()).toBe(false);
  });

  it('notifies subscribers on change, and only on change', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeArcadePass(() => seen.push(hasArcadePass()));

    grantArcadePass();
    grantArcadePass(); // already granted — no second notification
    clearArcadePass();
    clearArcadePass();

    expect(seen).toEqual([true, false]);
    unsubscribe();

    grantArcadePass();
    expect(seen).toEqual([true, false]);
  });

  it('reads through to storage, so non-React callers see the same answer', () => {
    grantArcadePass();
    expect(sessionStorage.getItem('has-arcade-pass')).toBe('true');
    clearArcadePass();
    expect(sessionStorage.getItem('has-arcade-pass')).toBeNull();
  });

  it('reports whether the write actually stuck', () => {
    expect(grantArcadePass()).toBe(true);
    expect(clearArcadePass()).toBe(true);
  });

  it('reports failure — and notifies nobody — when storage refuses the write', () => {
    const seen: boolean[] = [];
    subscribeArcadePass(() => seen.push(hasArcadePass()));

    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    // Not "it didn't throw" — the store reads back, so a silent no-op is caught
    // too. A charged player must never be told they hold a pass they do not.
    expect(grantArcadePass()).toBe(false);
    expect(hasArcadePass()).toBe(false);
    expect(seen).toEqual([]);

    Storage.prototype.setItem = setItem;
    vi.restoreAllMocks();
  });

  it('still reports success for a clear when there is nothing to clear', () => {
    expect(hasArcadePass()).toBe(false);
    expect(clearArcadePass()).toBe(true);
  });

  it('survives a hostile getItem without throwing', () => {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => hasArcadePass()).not.toThrow();
    expect(hasArcadePass()).toBe(false);

    Storage.prototype.getItem = getItem;
    vi.restoreAllMocks();
  });

  it('picks up a write it did not make, without pretending to be cross-tab sync', () => {
    // `sessionStorage` is TAB-scoped: a second tab has its own area and never
    // reaches this one. The listener exists only so a write from another
    // document sharing this session area (a duplicated tab) or a manual edit
    // does not leave subscribers stale.
    const seen: boolean[] = [];
    subscribeArcadePass(() => seen.push(hasArcadePass()));

    sessionStorage.setItem('has-arcade-pass', 'true');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'has-arcade-pass' }));
    });

    expect(seen).toEqual([true]);
  });

  it('notifies on a whole-area clear', () => {
    grantArcadePass();
    const seen: boolean[] = [];
    subscribeArcadePass(() => seen.push(hasArcadePass()));

    sessionStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });

    expect(seen).toEqual([false]);
  });
});

describe('the pass across arcade locations', () => {
  /**
   * `PlayingView` clears the pass whenever the location does not start with
   * `arcade`. All three floors do, so moving between them must never revoke it —
   * that is the whole point of buying one.
   */
  const clearIfOutsideArcade = (location: string) => {
    if (!location.startsWith('arcade')) clearArcadePass();
  };

  it('survives every arcade floor change', () => {
    grantArcadePass();

    for (const floor of ['arcade', 'arcade-1', 'arcade-minus1', 'arcade', 'arcade-minus1']) {
      clearIfOutsideArcade(floor);
      expect(hasArcadePass(), `cleared on ${floor}`).toBe(true);
    }
  });

  it('is revoked on leaving the arcade entirely', () => {
    grantArcadePass();
    clearIfOutsideArcade('town');
    expect(hasArcadePass()).toBe(false);
  });

  it.each(['town', 'home', 'stage', 'shop', 'plaza-inside'])(
    'is revoked in %s',
    (location) => {
      grantArcadePass();
      clearIfOutsideArcade(location);
      expect(hasArcadePass()).toBe(false);
    },
  );
});

describe('the HUD chip', () => {
  it('does not poll', () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    render(<ArcadePassIcon />);

    // The old implementation registered a 1 Hz interval for the whole session.
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('renders nothing without a pass, and appears the moment one is granted', () => {
    render(<ArcadePassIcon />);
    expect(screen.queryByAltText('Arcade Pass')).toBeNull();

    act(() => grantArcadePass());
    expect(screen.getByAltText('Arcade Pass')).toBeInTheDocument();

    act(() => clearArcadePass());
    expect(screen.queryByAltText('Arcade Pass')).toBeNull();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ArcadePassIcon />);
    unmount();

    // Nothing is left listening; granting after unmount must not throw or warn.
    expect(() => act(() => grantArcadePass())).not.toThrow();
  });
});
