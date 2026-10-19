/**
 * The presence controller: the four states, the two journeys with their
 * timings, settle without a journey, cancel only for a journey under way,
 * and reduced motion's short fades.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRESENCE, useBlobbiPresence } from './useBlobbiPresence';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('the Blobbi presence controller', () => {
  it('starts present, departs over the departure time, and is then absent', () => {
    const { result } = renderHook(() => useBlobbiPresence());
    expect(result.current.state).toBe('present');
    let began = false;
    act(() => void (began = result.current.controller.leave()));
    expect(began).toBe(true);
    expect(result.current.state).toBe('departing');
    tick(PRESENCE.departMs - 1);
    expect(result.current.state).toBe('departing');
    tick(1);
    expect(result.current.state).toBe('absent');
    // A second leave does nothing once it is gone
    act(() => void expect(result.current.controller.leave()).toBe(false));
  });

  it('arrives over the arrival time, and a second enter while arriving is refused', () => {
    const { result } = renderHook(() => useBlobbiPresence({ initial: 'absent' }));
    act(() => void expect(result.current.controller.enter()).toBe(true));
    expect(result.current.state).toBe('arriving');
    act(() => void expect(result.current.controller.enter()).toBe(false));
    tick(PRESENCE.arriveMs);
    expect(result.current.state).toBe('present');
    act(() => void expect(result.current.controller.enter()).toBe(false));
  });

  it('settle is at once, with no journey, and clears a journey under way', () => {
    const { result } = renderHook(() => useBlobbiPresence());
    act(() => void result.current.controller.leave());
    act(() => result.current.controller.settle('absent'));
    expect(result.current.state).toBe('absent');
    tick(PRESENCE.departMs * 2);
    expect(result.current.state).toBe('absent');
    act(() => result.current.controller.settle('present'));
    expect(result.current.state).toBe('present');
  });

  it('cancel ends only a journey under way: present again; a finished departure stays absent', () => {
    const { result } = renderHook(() => useBlobbiPresence());
    act(() => void result.current.controller.leave());
    act(() => result.current.controller.cancel());
    expect(result.current.state).toBe('present');
    tick(PRESENCE.departMs * 2);
    expect(result.current.state).toBe('present');
    act(() => void result.current.controller.leave());
    tick(PRESENCE.departMs);
    act(() => result.current.controller.cancel());
    expect(result.current.state).toBe('absent');
  });

  it('under reduced motion both journeys are the short fade', () => {
    const { result } = renderHook(() => useBlobbiPresence({ reducedMotion: true }));
    act(() => void result.current.controller.leave());
    tick(PRESENCE.reducedMs);
    expect(result.current.state).toBe('absent');
    act(() => void result.current.controller.enter());
    tick(PRESENCE.reducedMs);
    expect(result.current.state).toBe('present');
  });

  it('the controller is one object for the life of the hook, and reads the live state', () => {
    const { result, rerender } = renderHook(() => useBlobbiPresence());
    const first = result.current.controller;
    rerender();
    expect(result.current.controller).toBe(first);
    act(() => void first.leave());
    expect(first.getState()).toBe('departing');
  });
});
