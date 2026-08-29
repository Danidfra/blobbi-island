/**
 * A redeemed Arcade Pass must survive everything except its own expiry.
 *
 * ## The defect this pins
 *
 * The pass used to be a visit-scoped waiver bought for 20 Coins, and the app
 * deleted it on the way out of the arcade:
 *
 * ```
 *   LocationProvider mount
 *     → addEventListener('beforeunload', () => sessionStorage.removeItem('has-arcade-pass'))
 *   player buys a pass, rides to floor 1
 *   player hits reload
 *     → beforeunload fires → pass deleted
 *   page comes back
 *     → the elevator refuses them, and they are asked to buy it again
 * ```
 *
 * The handler predated location resume and made sense then: a reload always
 * dumped the player in Town, so they HAD left the arcade. Once a reload
 * restored where they were, the same handler charged them twice for one visit.
 *
 * ## Why the rule is now stricter than "survives a reload"
 *
 * The pass is a **24-hour entitlement redeemed with Arcade Tickets**, and its
 * only boundary is the clock. Leaving the arcade no longer voids it either —
 * doing so would destroy a day of play the moment the player walked into Town.
 *
 * So navigation and unload have NO say in its lifetime, and these tests assert
 * exactly that: every event that used to revoke it now cannot, and the one
 * thing that does end it is time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { vi } from 'vitest';

import { LocationProvider } from './LocationContext';
import { useLocation } from '@/hooks/useLocation';
import type { LocationId } from '@/lib/location-types';
import {
  ARCADE_PASS_DURATION_MS,
  clearArcadePasses,
  grantArcadePass,
  hasActiveArcadePass,
} from '@/arcade/pass/arcade-pass-entitlement';

const PUBKEY = 'f'.repeat(64);
const REDEEMED_AT = 1_700_000_000_000;

/** Redeem a pass at a fixed moment, so expiry is checkable without a fake clock. */
function redeem(id = 'redemption-1'): void {
  grantArcadePass(PUBKEY, { redemptionId: id, nowMs: REDEEMED_AT });
}

const holdsPass = (atMs = REDEEMED_AT + 1000) => hasActiveArcadePass(PUBKEY, atMs);

beforeEach(() => {
  clearArcadePasses();
});

afterEach(() => {
  clearArcadePasses();
});

/** What the browser does on a reload, before the document goes away. */
function fireBeforeUnload(): void {
  window.dispatchEvent(new Event('beforeunload'));
}

describe('Arcade Pass across a reload', () => {
  it('survives the unload half of a page reload', () => {
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);

    redeem();
    expect(holdsPass()).toBe(true);

    // The player hits reload. Nothing about that is "leaving the arcade".
    fireBeforeUnload();

    expect(holdsPass()).toBe(true);
  });

  it('survives a provider unmount/remount, which is all a reload is to React', () => {
    const first = render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);
    redeem();

    fireBeforeUnload();
    first.unmount();

    // ...the page comes back and the provider mounts again.
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);

    expect(holdsPass()).toBe(true);
  });

  it('survives an orientation-change style remount on mobile', () => {
    const { rerender, unmount } = render(
      <LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>,
    );
    redeem();

    rerender(<LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>);
    expect(holdsPass()).toBe(true);

    unmount();
    render(<LocationProvider initialLocation="arcade-minus1">{null}</LocationProvider>);
    expect(holdsPass()).toBe(true);
  });

  it('survives a mobile suspend/resume', () => {
    // Backgrounding a tab fires visibility/pagehide, and on some mobile browsers
    // `beforeunload` too. None of them is a location change, and a location
    // change would not revoke the pass anyway. No device branch exists — this
    // is the same code path desktop takes; only the events differ.
    render(<LocationProvider initialLocation="arcade-1">{null}</LocationProvider>);
    redeem();

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    fireBeforeUnload();

    expect(holdsPass()).toBe(true);
  });
});

describe('leaving the arcade no longer revokes it', () => {
  function Navigator({ to }: { to: LocationId }) {
    const { setCurrentLocation } = useLocation();
    return <button onClick={() => setCurrentLocation(to)}>go</button>;
  }

  async function navigate(from: LocationId, to: LocationId): Promise<void> {
    // Unmounted at the end so a second leg starts from one clean tree — the
    // point being tested is the pass surviving ACROSS these, so the entitlement
    // deliberately outlives the render.
    const { unmount } = render(
      <LocationProvider initialLocation={from}>
        <Navigator to={to} />
      </LocationProvider>,
    );
    redeem();

    act(() => {
      screen.getByText('go').click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600); // the fade-out, after which the location changes
    });
    unmount();
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the pass when the player walks out to Town', async () => {
    // THE behavior change. A 24-hour entitlement that ended at the arcade door
    // would be worth a fraction of what the player redeemed it for.
    await navigate('arcade-1', 'town');
    expect(holdsPass()).toBe(true);
  });

  it('keeps the pass when moving between arcade floors', async () => {
    await navigate('arcade', 'arcade-1');
    expect(holdsPass()).toBe(true);
  });

  it('keeps the pass through a walk out and back in', async () => {
    await navigate('arcade-1', 'town');
    await navigate('town', 'arcade');
    expect(holdsPass()).toBe(true);
  });
});

describe('the clock is the only thing that ends it', () => {
  it('holds for the full 24 hours and not a moment past', () => {
    redeem();

    expect(hasActiveArcadePass(PUBKEY, REDEEMED_AT + ARCADE_PASS_DURATION_MS - 1)).toBe(true);
    expect(hasActiveArcadePass(PUBKEY, REDEEMED_AT + ARCADE_PASS_DURATION_MS)).toBe(false);
  });

  it('does not leak between players', () => {
    redeem();
    expect(hasActiveArcadePass('a'.repeat(64), REDEEMED_AT + 1000)).toBe(false);
  });
});
