/**
 * The turn back to the front: the heading while walking (every direction,
 * diagonals by their larger axis), the heading kept through the short grace
 * after the walk, the front once settled; a walk resumed within the grace
 * (a waypoint, a changed destination) never flicks the body; an interrupted
 * walk settles the same way.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTLE_MS, movementFacingOf, useMovementFacing } from './useMovementFacing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('the facing from movement', () => {
  it('while moving, faces the heading in every direction, diagonals by the larger axis', () => {
    expect(movementFacingOf(true, false, { x: 1, y: 0 })).toBe('right');
    expect(movementFacingOf(true, false, { x: -1, y: 0 })).toBe('left');
    expect(movementFacingOf(true, false, { x: 0, y: 1 })).toBe('front');
    expect(movementFacingOf(true, false, { x: 0, y: -1 })).toBe('back');
    expect(movementFacingOf(true, false, { x: 0.8, y: -0.3 })).toBe('right');
    expect(movementFacingOf(true, false, { x: 0.3, y: -0.8 })).toBe('back');
    expect(movementFacingOf(true, false, { x: -0.5, y: 0.7 })).toBe('front');
  });

  it('once settled after a walk, faces the front (no movement facing at all); with no heading, the same', () => {
    expect(movementFacingOf(false, true, { x: -1, y: 0 })).toBeUndefined();
    expect(movementFacingOf(false, false, { x: -1, y: 0 })).toBe('left');
    expect(movementFacingOf(true, false, null)).toBeUndefined();
  });
});

describe('useMovementFacing', () => {
  it('keeps the heading for the grace after a walk ends, then turns to the front', () => {
    const { result, rerender } = renderHook(({ moving, heading }) => useMovementFacing(moving, heading), {
      initialProps: { moving: true, heading: { x: -1, y: 0 } },
    });
    expect(result.current).toBe('left');
    rerender({ moving: false, heading: { x: -1, y: 0 } });
    expect(result.current).toBe('left');
    tick(SETTLE_MS - 1);
    expect(result.current).toBe('left');
    tick(1);
    expect(result.current).toBeUndefined();
  });

  it('a walk resumed within the grace (a new destination) never shows the front in between', () => {
    const { result, rerender } = renderHook(({ moving, heading }) => useMovementFacing(moving, heading), {
      initialProps: { moving: true, heading: { x: 1, y: 0 } },
    });
    rerender({ moving: false, heading: { x: 1, y: 0 } });
    tick(SETTLE_MS / 2);
    expect(result.current).toBe('right');
    rerender({ moving: true, heading: { x: 0, y: -1 } });
    expect(result.current).toBe('back');
    tick(SETTLE_MS * 2);
    // Still walking: still the heading
    expect(result.current).toBe('back');
    rerender({ moving: false, heading: { x: 0, y: -1 } });
    tick(SETTLE_MS);
    expect(result.current).toBeUndefined();
  });

  it('an interrupted walk settles to the front like a finished one', () => {
    const { result, rerender } = renderHook(({ moving, heading }) => useMovementFacing(moving, heading), {
      initialProps: { moving: true, heading: { x: 1, y: 0.2 } },
    });
    rerender({ moving: false, heading: { x: 1, y: 0.2 } }); // stop() mid-walk
    tick(SETTLE_MS);
    expect(result.current).toBeUndefined();
  });

  it('a body that never moved faces the front from the start', () => {
    const { result } = renderHook(() => useMovementFacing(false, { x: 0, y: 0 }));
    expect(result.current).toBeUndefined();
  });
});
