/**
 * `useReducedMotion` coverage.
 *
 * `src/test/setup.ts` installs a permanently non-matching `matchMedia` stub, so
 * each test here installs its own controllable one and restores the original
 * afterwards.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';

import { useReducedMotion } from './useReducedMotion';

type Listener = (event: MediaQueryListEvent) => void;

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

interface FakeMedia {
  /** Flip the preference and notify subscribers, as the OS would. */
  set(value: boolean): void;
  listenerCount(): number;
  removals(): number;
}

function installMatchMedia(initial: boolean, api: 'modern' | 'legacy' = 'modern'): FakeMedia {
  const listeners = new Set<Listener>();
  let removals = 0;

  // A plain, MUTABLE `matches` property: spreading an object with a getter would
  // freeze its value at spread time, which is exactly the trap this stub exists
  // to avoid.
  const mql: Record<string, unknown> = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    dispatchEvent: () => true,
  };

  if (api === 'modern') {
    mql.addEventListener = (_type: string, l: Listener) => listeners.add(l);
    mql.removeEventListener = (_type: string, l: Listener) => {
      removals += 1;
      listeners.delete(l);
    };
  } else {
    mql.addListener = (l: Listener) => listeners.add(l);
    mql.removeListener = (l: Listener) => {
      removals += 1;
      listeners.delete(l);
    };
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql as unknown as MediaQueryList,
  });

  return {
    set(value: boolean) {
      mql.matches = value;
      [...listeners].forEach((l) => l({ matches: value } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
    removals: () => removals,
  };
}

function Probe() {
  const reduced = useReducedMotion();
  return <span data-testid="reduced">{reduced ? 'reduced' : 'full'}</span>;
}

const reading = () => screen.getByTestId('reduced').textContent;

describe('useReducedMotion', () => {
  it('reports the current preference', () => {
    installMatchMedia(true);
    render(<Probe />);
    expect(reading()).toBe('reduced');
  });

  it('defaults to full motion when the preference is not set', () => {
    installMatchMedia(false);
    render(<Probe />);
    expect(reading()).toBe('full');
  });

  it('reacts when the preference changes', () => {
    const media = installMatchMedia(false);
    render(<Probe />);
    expect(reading()).toBe('full');

    act(() => media.set(true));
    expect(reading()).toBe('reduced');

    act(() => media.set(false));
    expect(reading()).toBe('full');
  });

  it('works through the deprecated addListener API', () => {
    const media = installMatchMedia(false, 'legacy');
    render(<Probe />);

    act(() => media.set(true));
    expect(reading()).toBe('reduced');
  });

  it('degrades to full motion when matchMedia is missing entirely', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    render(<Probe />);
    expect(reading()).toBe('full');
  });

  it('removes its listener on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
    expect(media.removals()).toBeGreaterThanOrEqual(1);
  });
});
