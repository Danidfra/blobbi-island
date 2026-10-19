/**
 * Leaving for a world: the goodbye in order, the page asked to go exactly
 * once and only after the Blobbi has gone, repeated taps ignored, Stay at
 * any moment before, reduced motion without the wiggle, an immediate go when
 * no Blobbi can act, a refused navigation brought back at once, and a
 * navigation that never happened brought back after the wait.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRESENCE, useBlobbiPresence } from './useBlobbiPresence';
import { DEPARTURE, useWorldDeparture } from './useWorldDeparture';
import { worldById, type OpenWorld, type World } from './worlds';

const pixel = worldById('pixel', {})!;
const home = worldById('home', {})!;
const closed: OpenWorld = { ...pixel, url: null, open: false };

function setup({ canAct = true, reducedMotion = false, went = true, hang = false } = {}) {
  const navigate = vi.fn<(world: World & { url: string }) => Promise<boolean>>(async () => {
    if (hang) return new Promise<boolean>(() => {});
    return went;
  });
  const hook = renderHook(() => {
    const presence = useBlobbiPresence({ reducedMotion });
    const departure = useWorldDeparture({ presence, canAct, reducedMotion, navigate });
    return { presence, departure };
  });
  return { hook, navigate };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('leaving for another world', () => {
  it('notices, waves, dissolves, and only then asks the page to go: once, with the checked address and nothing else', async () => {
    const { hook, navigate } = setup();
    act(() => void expect(hook.result.current.departure.go(pixel)).toBe(true));
    expect(hook.result.current.departure.phase).toBe('noticing');
    expect(hook.result.current.departure.world?.id).toBe('pixel');
    await tick(DEPARTURE.noticeMs);
    expect(hook.result.current.departure.phase).toBe('waving');
    expect(navigate).not.toHaveBeenCalled();
    await tick(DEPARTURE.waveMs);
    expect(hook.result.current.departure.phase).toBe('leaving');
    expect(hook.result.current.presence.state).toBe('departing');
    expect(navigate).not.toHaveBeenCalled();
    await tick(PRESENCE.departMs);
    expect(hook.result.current.presence.state).toBe('absent');
    expect(hook.result.current.departure.phase).toBe('gone');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatchObject({ id: 'pixel', url: 'https://pixel.blobbi.pet/' });
    await tick(10_000);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('repeated taps, and a tap on another world, start nothing more', async () => {
    const { hook, navigate } = setup();
    act(() => void hook.result.current.departure.go(pixel));
    act(() => void expect(hook.result.current.departure.go(pixel)).toBe(false));
    act(() => void expect(hook.result.current.departure.go(home)).toBe(false));
    expect(hook.result.current.departure.world?.id).toBe('pixel');
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + PRESENCE.departMs);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toMatchObject({ id: 'pixel' });
    // Gone: still nothing more
    act(() => void expect(hook.result.current.departure.go(home)).toBe(false));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a world that is not open is refused', () => {
    const { hook, navigate } = setup();
    act(() => void expect(hook.result.current.departure.go(closed)).toBe(false));
    expect(hook.result.current.departure.phase).toBe('idle');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Stay ends it before the page goes: the Blobbi is simply here', async () => {
    const { hook, navigate } = setup();
    act(() => void hook.result.current.departure.go(pixel));
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + 200);
    expect(hook.result.current.presence.state).toBe('departing');
    act(() => hook.result.current.departure.cancel());
    expect(hook.result.current.departure.phase).toBe('idle');
    expect(hook.result.current.departure.world).toBeNull();
    expect(hook.result.current.presence.state).toBe('present');
    await tick(10_000);
    expect(navigate).not.toHaveBeenCalled();
    expect(hook.result.current.presence.state).toBe('present');
  });

  it('under reduced motion there is no wave, and the departure is the short fade', async () => {
    const { hook, navigate } = setup({ reducedMotion: true });
    act(() => void hook.result.current.departure.go(pixel));
    await tick(DEPARTURE.reducedNoticeMs);
    expect(hook.result.current.departure.phase).toBe('leaving');
    await tick(PRESENCE.reducedMs);
    expect(hook.result.current.departure.phase).toBe('gone');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('with no Blobbi to act, the page goes at once', async () => {
    const { hook, navigate } = setup({ canAct: false });
    act(() => void hook.result.current.departure.go(pixel));
    expect(hook.result.current.departure.phase).toBe('gone');
    await tick(0);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a navigation the boundary refused brings the Blobbi back at once, and Try again asks once more', async () => {
    const { hook, navigate } = setup({ went: false });
    act(() => void hook.result.current.departure.go(pixel));
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + PRESENCE.departMs);
    expect(navigate).toHaveBeenCalledTimes(1);
    await tick(0);
    expect(hook.result.current.departure.phase).toBe('failed');
    expect(hook.result.current.presence.state).toBe('arriving');
    await tick(PRESENCE.arriveMs);
    expect(hook.result.current.presence.state).toBe('present');
    act(() => void expect(hook.result.current.departure.retry()).toBe(true));
    expect(hook.result.current.departure.phase).toBe('noticing');
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + PRESENCE.departMs + 10);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('a navigation that never happened (the page still here after the wait) brings the Blobbi back', async () => {
    const { hook, navigate } = setup({ hang: true });
    act(() => void hook.result.current.departure.go(pixel));
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + PRESENCE.departMs);
    expect(hook.result.current.departure.phase).toBe('gone');
    expect(navigate).toHaveBeenCalledTimes(1);
    await tick(DEPARTURE.failMs - 1);
    expect(hook.result.current.departure.phase).toBe('gone');
    await tick(1);
    expect(hook.result.current.departure.phase).toBe('failed');
    expect(hook.result.current.presence.state).toBe('arriving');
    // OK dismisses the card; the Blobbi stays
    act(() => hook.result.current.departure.cancel());
    expect(hook.result.current.departure.phase).toBe('idle');
    await tick(PRESENCE.arriveMs);
    expect(hook.result.current.presence.state).toBe('present');
  });

  it('coming back from the other world with Back (a cached page) restores the Blobbi here', async () => {
    const { hook } = setup({ hang: true });
    act(() => void hook.result.current.departure.go(pixel));
    await tick(DEPARTURE.noticeMs + DEPARTURE.waveMs + PRESENCE.departMs);
    expect(hook.result.current.presence.state).toBe('absent');
    act(() => {
      const e = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(e, 'persisted', { value: true });
      window.dispatchEvent(e);
    });
    expect(hook.result.current.departure.phase).toBe('idle');
    expect(hook.result.current.presence.state).toBe('arriving');
    await tick(PRESENCE.arriveMs);
    expect(hook.result.current.presence.state).toBe('present');
  });
});
