/**
 * A legitimately purchased Arcade Pass must survive a page reload.
 *
 * ## The defect this pins
 *
 * `sessionStorage` survives a reload in the same tab — that is what it is for.
 * The pass disappeared anyway, and not because of storage semantics: this app
 * deleted it on the way out.
 *
 * ```
 *   LocationProvider mount
 *     → addEventListener('beforeunload', () => sessionStorage.removeItem('has-arcade-pass'))
 *   player buys a pass (20 coins), rides to floor 1
 *   player hits reload
 *     → beforeunload fires
 *     → pass deleted
 *   page comes back
 *     → hasArcadePass() === false
 *     → the elevator refuses them, and they are asked to buy it again
 * ```
 *
 * The handler predated location resume and made sense then: a reload always
 * dumped the player in Town, so they HAD left the arcade and the pass was
 * rightly void. Now that a reload restores where they were, the same handler
 * charges a player twice for one visit.
 *
 * The product rule is unchanged and is enforced elsewhere (`PlayingView` clears
 * the pass whenever the location stops being an arcade location). These tests
 * assert the distinction that rule depends on: **leaving the arcade voids the
 * pass; reloading inside it does not.**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { LocationProvider } from './LocationContext';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import {
  grantArcadePass,
  hasArcadePass,
  clearArcadePass,
  subscribeArcadePass,
  resetArcadePassSubscribers,
} from '@/lib/arcade-pass';

beforeEach(() => {
  clearArcadePass();
});

afterEach(() => {
  clearArcadePass();
  resetArcadePassSubscribers();
});

/** What the browser does on a reload, before the document goes away. */
function fireBeforeUnload(): void {
  window.dispatchEvent(new Event('beforeunload'));
}

describe('Arcade Pass across a reload', () => {
  it('survives the unload half of a page reload', () => {
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);

    grantArcadePass();
    expect(hasArcadePass()).toBe(true);

    // The player hits reload. Nothing about that is "leaving the arcade".
    fireBeforeUnload();

    expect(hasArcadePass()).toBe(true);
  });

  it('survives a provider unmount/remount, which is all a reload is to React', () => {
    const first = render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);
    grantArcadePass();

    fireBeforeUnload();
    first.unmount();

    // ...the page comes back and the provider mounts again.
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);

    expect(hasArcadePass()).toBe(true);
  });

  it('survives an orientation-change style remount on mobile', () => {
    const { rerender, unmount } = render(
      <LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>,
    );
    grantArcadePass();

    rerender(<LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>);
    expect(hasArcadePass()).toBe(true);

    unmount();
    render(<LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>);
    expect(hasArcadePass()).toBe(true);
  });

  it('survives a mobile suspend/resume inside the freshness window', () => {
    // Backgrounding a tab fires visibility/pagehide, and on some mobile browsers
    // `beforeunload` too. None of them is a location change, so none may revoke
    // the pass. No device branch exists — this is the same code path desktop
    // takes; only the events differ.
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);
    grantArcadePass();

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    fireBeforeUnload();

    expect(hasArcadePass()).toBe(true);
  });

  describe('an actual exit still revokes it', () => {
    function Navigator({ to }: { to: LocationId }) {
      const { setCurrentLocation } = useLocation();
      return <button onClick={() => setCurrentLocation(to)}>go</button>;
    }

    it('walking out of the arcade revokes the pass', async () => {
      vi.useFakeTimers();
      try {
        render(
          <LocationProvider initialLocation="arcade-1">
            <Navigator to="town" />
          </LocationProvider>,
        );
        grantArcadePass();
        expect(hasArcadePass()).toBe(true);

        act(() => {
          screen.getByText('go').click();
        });
        await act(async () => {
          vi.advanceTimersByTime(600); // the fade-out, after which the location changes
        });

        expect(hasArcadePass()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moving between arcade floors keeps it', async () => {
      vi.useFakeTimers();
      try {
        render(
          <LocationProvider initialLocation="arcade">
            <Navigator to="arcade-1" />
          </LocationProvider>,
        );
        grantArcadePass();

        act(() => {
          screen.getByText('go').click();
        });
        await act(async () => {
          vi.advanceTimersByTime(600);
        });

        expect(hasArcadePass()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('notifies subscribers when it revokes, instead of silently deleting the key', async () => {
      // The old code wrote `sessionStorage.removeItem` directly, which fires no
      // storage event in the same tab and told no subscriber — so the HUD chip
      // kept showing a pass the player no longer had.
      vi.useFakeTimers();
      const seen: boolean[] = [];
      try {
        const unsubscribe = subscribeArcadePass(() => seen.push(hasArcadePass()));
        render(
          <LocationProvider initialLocation="arcade-1">
            <Navigator to="town" />
          </LocationProvider>,
        );
        grantArcadePass();

        act(() => {
          screen.getByText('go').click();
        });
        await act(async () => {
          vi.advanceTimersByTime(600);
        });

        unsubscribe();
        expect(seen).toEqual([true, false]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
