/**
 * The in-world moment: what it shows, that it shows it once, and that it
 * goes away on its own.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';

import type { CareFeedback } from '@/inventory';

import { CareReactionOverlay } from './CareReaction';
import { CARE_REACTION_MS, careActorClass, useCareReaction } from './useCareReaction';

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
  vi.useRealTimers();
});

function reducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') && matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const farmFeed: CareFeedback = {
  id: 'spend-1',
  action: 'feed',
  quantity: 1,
  itemName: 'Strawberry',
  statDeltas: { hunger: 25, happiness: 0, health: 0, hygiene: 0, energy: 0 },
  experienceGained: 5,
  provenance: 'Nostr Farm',
};

const islandFeed: CareFeedback = { ...farmFeed, id: 'care-1', itemName: 'Apple', provenance: undefined };

describe('CareReactionOverlay', () => {
  it('renders nothing at rest', () => {
    const { container } = render(<CareReactionOverlay feedback={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the real gain and, for another game, the source, as a polite status', () => {
    render(<CareReactionOverlay feedback={farmFeed} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-care-reaction-id', 'spend-1');
    expect(status).toHaveTextContent('+25 Hunger');
    expect(status).toHaveTextContent('From Nostr Farm');
    expect(status.querySelector('[data-care-gain="hunger"]')).not.toBeNull();
    expect(status.querySelector('[data-care-provenance-cue]')).not.toBeNull();
    // Motion on, by default.
    expect(status.querySelector('[data-care-gain]')!.className).toContain('animate-care-float');
    // No protocol vocabulary.
    expect(status.textContent).not.toMatch(/1416|31633|farm:main|relay/);
  });

  it('an Island item shows the gain and no source', () => {
    render(<CareReactionOverlay feedback={islandFeed} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('+25 Hunger');
    expect(status.textContent).not.toContain('From');
    expect(status.querySelector('[data-care-provenance-cue]')).toBeNull();
  });

  it('shows only stats that moved: a full Blobbi gets the moment without a fake gain', () => {
    render(
      <CareReactionOverlay
        feedback={{ ...farmFeed, statDeltas: { hunger: 0, happiness: 0, health: 0, hygiene: 0, energy: 0 } }}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.querySelectorAll('[data-care-gain]')).toHaveLength(0);
    expect(status).toHaveTextContent('From Nostr Farm');
  });

  it('a batch shows the applied total', () => {
    render(<CareReactionOverlay feedback={{ ...farmFeed, quantity: 3, statDeltas: { ...farmFeed.statDeltas, hunger: 75 } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('+75 Hunger');
  });

  it('keeps the information and drops the motion under reduced motion', () => {
    reducedMotion(true);
    render(<CareReactionOverlay feedback={farmFeed} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('+25 Hunger');
    for (const chip of status.querySelectorAll('span')) {
      expect(chip.className).not.toContain('animate-care-float');
    }
    expect(careActorClass(true, true)).not.toContain('animate-care-bounce');
    expect(careActorClass(true, false)).toContain('animate-care-bounce');
    expect(careActorClass(false, false)).not.toContain('animate-care-bounce');
  });
});

describe('useCareReaction', () => {
  it('shows a moment, then clears it on its own', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCareReaction());
    expect(result.current.feedback).toBeNull();
    act(() => result.current.show(farmFeed));
    expect(result.current.feedback?.id).toBe('spend-1');
    act(() => {
      vi.advanceTimersByTime(CARE_REACTION_MS - 1);
    });
    expect(result.current.feedback?.id).toBe('spend-1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.feedback).toBeNull();
  });

  it('the same logical action reported twice plays once', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCareReaction());
    act(() => result.current.show(farmFeed));
    act(() => {
      vi.advanceTimersByTime(CARE_REACTION_MS - 100);
    });
    // A re-report of the SAME id (optimistic then confirmed, a re-render)
    // neither restarts nor extends the moment.
    act(() => result.current.show({ ...farmFeed }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.feedback).toBeNull();
  });

  it('a new action replaces what is still on screen and gets its own full moment', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCareReaction());
    act(() => result.current.show(farmFeed));
    act(() => {
      vi.advanceTimersByTime(CARE_REACTION_MS - 100);
    });
    act(() => result.current.show({ ...farmFeed, id: 'spend-2' }));
    expect(result.current.feedback?.id).toBe('spend-2');
    act(() => {
      vi.advanceTimersByTime(CARE_REACTION_MS - 1);
    });
    expect(result.current.feedback?.id).toBe('spend-2');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.feedback).toBeNull();
  });

  it('the bounce is on while a moment is on screen, and off at rest', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCareReaction());
    expect(careActorClass(result.current.feedback !== null, false)).toBe('origin-bottom');
    act(() => result.current.show(islandFeed));
    expect(careActorClass(result.current.feedback !== null, false)).toContain('animate-care-bounce');
  });
});
