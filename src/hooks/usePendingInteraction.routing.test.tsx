/**
 * Walk-to-interact, now that a blocked walk DETOURS instead of stopping.
 *
 * The requirement is narrow and important: the action fires when the Blobbi
 * reaches the FINAL requested target, and never when it passes through a detour
 * waypoint on the way. Detour waypoints sit at a blocker's corner, and a corner
 * can easily be within arrival threshold of something — so "close to somewhere"
 * must not be mistaken for "arrived".
 *
 * The Blobbi is driven along a REAL planned route rather than a scripted line,
 * so the positions the hook sees are the positions the room would actually
 * produce. What is faked is only the frame clock: the claims here are about
 * where the walk was when the action fired, not about how many frames it took.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { planRoute, type RouteBlocker } from '@/lib/blobbi-route';
import type { Boundary } from '@/lib/boundaries';
import type { Position } from '@/lib/types';
import type { MovableBlobbiRef } from '@/components/blobbi/MovableBlobbi';
import { usePendingInteraction } from './usePendingInteraction';

const ROOM: Boundary = { shape: 'rectangle', x: [0, 100], y: [0, 100] };

/** One wide obstacle straight between the start and the target. */
const SHELF: RouteBlocker = { x: 40, y: 40, width: 20, height: 20 };

const START: Position = { x: 10, y: 50 };
const TARGET: Position = { x: 90, y: 50 };

// ── Controlled rAF ──────────────────────────────────────────────────────────

let rafQueue: Map<number, FrameRequestCallback>;
let rafId: number;

function step() {
  const callbacks = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of callbacks) cb(performance.now());
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafId += 1;
    rafQueue.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A Blobbi that walks a real planned route, one sampled point per frame.
 *
 * `advance()` moves it to the next sample. Nothing here knows about the pending
 * interaction, which is the point: the hook only ever sees positions.
 */
function makeWalker(route: Position[]) {
  const samples: Position[] = [];
  let from = START;
  for (const leg of route) {
    // Ten samples per leg: enough that a waypoint is genuinely stood on for a
    // frame, which is the situation this file exists to test.
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      samples.push({
        x: from.x + (leg.x - from.x) * t,
        y: from.y + (leg.y - from.y) * t,
      });
    }
    from = leg;
  }

  let index = -1;
  const goTo = vi.fn();
  const ref = {
    current: {
      goTo,
      snapTo: vi.fn(),
      stop: vi.fn(),
      getCurrentPosition: () => (index < 0 ? START : samples[index]),
    },
  } as unknown as React.RefObject<MovableBlobbiRef>;

  return {
    ref,
    goTo,
    samples,
    /** Step the walk one sample and run the hook's frame. */
    advance() {
      if (index < samples.length - 1) index += 1;
      act(() => step());
    },
    position: () => (index < 0 ? START : samples[index]),
  };
}

describe('a routed walk fires its interaction at the destination', () => {
  const route = planRoute(START, TARGET, ROOM, [SHELF])!;

  it('the route really does detour — otherwise this file proves nothing', () => {
    expect(route.length).toBeGreaterThan(1);
    expect(route[route.length - 1]).toEqual(TARGET);
  });

  it('fires exactly once, and only after reaching the final target', () => {
    const walker = makeWalker(route);
    const action = vi.fn();
    const { result } = renderHook(() =>
      usePendingInteraction({ blobbiRef: walker.ref, cancelKey: 'room' }),
    );

    act(() => {
      result.current.requestInteraction({ target: TARGET, action });
    });
    expect(walker.goTo).toHaveBeenCalledWith(TARGET);

    // Walk the whole route. Record where the Blobbi was the moment it fired.
    let firedAt: Position | null = null;
    for (let i = 0; i < walker.samples.length + 5; i++) {
      const before = action.mock.calls.length;
      walker.advance();
      if (action.mock.calls.length > before && !firedAt) {
        firedAt = walker.position();
      }
    }

    expect(action).toHaveBeenCalledTimes(1);
    expect(firedAt).not.toBeNull();
    // At the destination — not at any waypoint the route passed through.
    expect(Math.hypot(firedAt!.x - TARGET.x, firedAt!.y - TARGET.y)).toBeLessThan(6);
    for (const waypoint of route.slice(0, -1)) {
      expect(
        Math.hypot(firedAt!.x - waypoint.x, firedAt!.y - waypoint.y),
      ).toBeGreaterThan(6);
    }
  });

  it('does not fire while the walk is still on a detour leg', () => {
    const walker = makeWalker(route);
    const action = vi.fn();
    const { result } = renderHook(() =>
      usePendingInteraction({ blobbiRef: walker.ref, cancelKey: 'room' }),
    );
    act(() => {
      result.current.requestInteraction({ target: TARGET, action });
    });

    // Every sample except the final leg's last few.
    for (let i = 0; i < walker.samples.length - 3; i++) walker.advance();
    expect(action).not.toHaveBeenCalled();
    expect(result.current.hasPending()).toBe(true);
  });

  it('cancelling mid-detour drops the pending action for good', () => {
    const walker = makeWalker(route);
    const action = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() =>
      usePendingInteraction({ blobbiRef: walker.ref, cancelKey: 'room' }),
    );
    act(() => {
      result.current.requestInteraction({ target: TARGET, action, onCancel });
    });

    for (let i = 0; i < 12; i++) walker.advance();
    act(() => result.current.cancel());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.hasPending()).toBe(false);

    // Finish the walk anyway: arriving must no longer fire anything.
    for (let i = 0; i < walker.samples.length; i++) walker.advance();
    expect(action).not.toHaveBeenCalled();
  });

  it('a second request replaces the first, and only the new one fires', () => {
    const walker = makeWalker(route);
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() =>
      usePendingInteraction({ blobbiRef: walker.ref, cancelKey: 'room' }),
    );

    act(() => {
      result.current.requestInteraction({ target: TARGET, action: first });
    });
    for (let i = 0; i < 8; i++) walker.advance();
    act(() => {
      result.current.requestInteraction({ target: TARGET, action: second });
    });
    for (let i = 0; i < walker.samples.length; i++) walker.advance();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
