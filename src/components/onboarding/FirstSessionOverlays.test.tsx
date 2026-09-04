/**
 * The first-session moments: shown for a new player, dismissible, remembered,
 * and never a second Coin party.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LocationContext } from '@/contexts/LocationContextValue';
import { clearFirstSessionPreferences, hasSeenWelcome } from '@/lib/first-session';
import type { EconomyEntrySnapshot } from '@/inventory/useEconomyEntry';
import {
  ARRIVAL_DURATION_MS,
  COIN_CELEBRATION_DURATION_MS,
  FirstSessionOverlays,
} from './FirstSessionOverlays';

const PUBKEY = 'c'.repeat(64);
let currentUser: { pubkey: string } | null = { pubkey: PUBKEY };
let economy: EconomyEntrySnapshot = { phase: 'idle', canRetry: false };
let reducedMotion = false;

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: currentUser }) }));
vi.mock('@/inventory/useEconomyEntry', () => ({
  useEconomyEntryStatus: () => ({ ...economy, retry: () => {} }),
}));
vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => reducedMotion }));

const setIsMapModalOpen = vi.fn();

function Overlays({ inWorld = true }: { inWorld?: boolean }) {
  return (
    <LocationContext.Provider
      value={{
        currentLocation: 'town',
        setCurrentLocation: vi.fn(),
        previousLocation: null,
        isMapModalOpen: false,
        setIsMapModalOpen,
        isTransitioning: false,
      }}
    >
      <FirstSessionOverlays inWorld={inWorld} />
    </LocationContext.Provider>
  );
}

const arrival = () => document.querySelector('[data-island-arrival]');
const celebration = () => document.querySelector('[data-coin-grant-celebration]');
const welcome = () => document.querySelector('[data-first-session-welcome]');
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  clearFirstSessionPreferences();
  currentUser = { pubkey: PUBKEY };
  economy = { phase: 'idle', canRetry: false };
  reducedMotion = false;
  setIsMapModalOpen.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('arriving', () => {
  it('plays the Island arrival once per visit, then hands control back', () => {
    render(<Overlays />);
    expect(arrival()).not.toBeNull();
    expect(arrival()!.textContent).toContain('Blobbi Island');
    expect(welcome()).toBeNull(); // not yet: one moment at a time
    advance(ARRIVAL_DURATION_MS + 1);
    expect(arrival()).toBeNull();
    expect(welcome()).not.toBeNull();
  });

  it('does not replay on a remount within the same visit (a room change, a shell remount)', () => {
    const first = render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    first.unmount();
    render(<Overlays />);
    expect(arrival()).toBeNull();
  });

  it('shows nothing before the world is mounted', () => {
    render(<Overlays inWorld={false} />);
    expect(arrival()).toBeNull();
    expect(welcome()).toBeNull();
  });

  it('respects reduced motion: same words, no sweeping animation', () => {
    reducedMotion = true;
    render(<Overlays />);
    expect(arrival()).toHaveAttribute('data-reduced-motion');
    expect(arrival()!.className).not.toContain('blobbi-arrival-veil');
  });
});

describe('the welcome', () => {
  it('tells a new player how to move, what to do first and that there is more', () => {
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    const card = welcome()!;
    expect(card.textContent).toMatch(/Tap somewhere to walk around/);
    expect(card.textContent).toMatch(/Beach/);
    expect(card.textContent).toMatch(/treasure/i);
    expect(card.textContent).toMatch(/Map/);
    for (const jargon of ['nostr', 'relay', 'kind:', 'npub', 'event']) {
      expect(card.textContent!.toLowerCase()).not.toContain(jargon);
    }
  });

  it('is dismissible and stays dismissed', () => {
    const first = render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    expect(welcome()).toBeNull();
    expect(hasSeenWelcome(PUBKEY)).toBe(true);
    first.unmount();
    render(<Overlays />);
    expect(welcome()).toBeNull();
  });

  it('"Show map" opens the map and counts as dismissed', () => {
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    fireEvent.click(screen.getByRole('button', { name: /Show map/ }));
    expect(setIsMapModalOpen).toHaveBeenCalledWith(true);
    expect(welcome()).toBeNull();
    expect(hasSeenWelcome(PUBKEY)).toBe(true);
  });

  it('is per player: another player on this device gets their own welcome', () => {
    const first = render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    first.unmount();
    currentUser = { pubkey: 'd'.repeat(64) };
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    expect(welcome()).not.toBeNull();
  });
});

describe('the initial 200 Coins', () => {
  it('is celebrated when — and only when — the real grant reports it was applied by this run', () => {
    economy = { phase: 'applied', alreadyApplied: false, canRetry: false };
    render(<Overlays />);
    expect(celebration()).toBeNull(); // arrival first
    advance(ARRIVAL_DURATION_MS + 1);
    expect(celebration()).not.toBeNull();
    expect(celebration()!.textContent).toContain('+200 Coins');
    expect(celebration()!.textContent).toContain('A little something to get started.');
    expect(welcome()).toBeNull(); // the welcome waits its turn
    advance(COIN_CELEBRATION_DURATION_MS + 1);
    expect(celebration()).toBeNull();
    expect(welcome()).not.toBeNull();
  });

  it('is NOT shown for a grant that was already applied earlier (a returning player)', () => {
    economy = { phase: 'applied', alreadyApplied: true, canRetry: false };
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    expect(celebration()).toBeNull();
  });

  it('is never repeated: a remount with the same status stays quiet', () => {
    economy = { phase: 'applied', alreadyApplied: false, canRetry: false };
    const first = render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    expect(celebration()).not.toBeNull();
    first.unmount();
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + COIN_CELEBRATION_DURATION_MS + 2);
    expect(celebration()).toBeNull();
  });

  it('celebrates a grant that lands AFTER the arrival, once, and can be tapped away', () => {
    const view = render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    expect(celebration()).toBeNull();
    economy = { phase: 'applied', alreadyApplied: false, canRetry: false };
    view.rerender(<Overlays />);
    expect(celebration()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /You received 200 Coins/ }));
    expect(celebration()).toBeNull();
    view.rerender(<Overlays />);
    expect(celebration()).toBeNull();
  });

  it('is not the welcome: the welcome never claims a reward', () => {
    render(<Overlays />);
    advance(ARRIVAL_DURATION_MS + 1);
    expect(welcome()!.textContent).not.toMatch(/\+200|Coins/);
  });
});
