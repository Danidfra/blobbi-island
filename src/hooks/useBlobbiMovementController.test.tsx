/**
 * Movement-controller lifecycle (Phase 3), under CONTROLLED animation frames.
 *
 * These pin the guarantees the extraction exists to provide:
 *
 *  - exactly one active rAF loop, retargeting included;
 *  - movement runs independently of parent re-renders / callback identity;
 *  - completion fires exactly once, with the target;
 *  - `snapTo` cancels an active walk safely and completes at the pose;
 *  - `stop` cancels without completing;
 *  - unmount cancels the loop;
 *  - blocked targets are ignored; a blocker collision ends the walk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  MovementBlockerProvider,
  useMovementBlocker,
} from '@/contexts/MovementBlockerContext';
import {
  useBlobbiMovementController,
  type BlobbiMovementControllerOptions,
} from './useBlobbiMovementController';
import type { Boundary } from '@/lib/boundaries';

// ── Controlled rAF ──────────────────────────────────────────────────────────

let rafQueue: Map<number, FrameRequestCallback>;
let rafId: number;
let now: number;

function pendingFrames(): number {
  return rafQueue.size;
}

/** Run every queued callback once, advancing the clock by `ms`. */
function step(ms: number) {
  now += ms;
  const callbacks = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of callbacks) cb(now);
}

/** Step 16 ms frames until movement settles (bounded, like a real 60 fps run). */
function runFrames(isMoving: () => boolean, max = 500) {
  for (let i = 0; i < max && (isMoving() || pendingFrames() > 0); i++) {
    act(() => step(16));
  }
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  now = 1000;
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

// ── Harness ─────────────────────────────────────────────────────────────────

const BOUNDARY: Boundary = { shape: 'rectangle', x: [0, 100], y: [0, 100] };

/** Optionally seeds a blocker into the provider before the hook mounts. */
function BlockerSeed({ rect }: { rect: { x: number; y: number; width: number; height: number } }) {
  const { addBlocker } = useMovementBlocker();
  React.useEffect(() => {
    addBlocker({ id: 'test-blocker', rect });
  }, [addBlocker, rect]);
  return null;
}

function mount(
  options: Partial<BlobbiMovementControllerOptions> = {},
  blockerRect?: { x: number; y: number; width: number; height: number },
) {
  const onMoveStart = vi.fn();
  const onMoveComplete = vi.fn();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MovementBlockerProvider>
      {blockerRect && <BlockerSeed rect={blockerRect} />}
      {children}
    </MovementBlockerProvider>
  );

  const view = renderHook(
    (props: Partial<BlobbiMovementControllerOptions>) =>
      useBlobbiMovementController({
        initialPosition: { x: 10, y: 50 },
        movementSpeed: 120,
        boundary: BOUNDARY,
        onMoveStart,
        onMoveComplete,
        ...props,
      }),
    { wrapper, initialProps: options },
  );

  return { ...view, onMoveStart, onMoveComplete };
}

describe('useBlobbiMovementController lifecycle', () => {
  it('walks to the target and completes exactly once, with the target', () => {
    const { result, onMoveStart, onMoveComplete } = mount();

    act(() => {
      result.current.goTo({ x: 12, y: 50 }); // ~21 world px away
    });
    expect(onMoveStart).toHaveBeenCalledOnce();
    expect(onMoveStart).toHaveBeenCalledWith({ x: 12, y: 50 });
    expect(result.current.isMoving).toBe(true);
    expect(pendingFrames()).toBe(1);

    // ~21 world px away at 120 px/s ≈ 175 ms of 16 ms frames.
    act(() => step(16));
    expect(result.current.isMoving).toBe(true);
    runFrames(() => result.current.isMoving);
    act(() => step(16)); // idempotence: extra frames must not re-complete

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position).toEqual({ x: 12, y: 50 });
    expect(onMoveComplete).toHaveBeenCalledOnce();
    expect(onMoveComplete).toHaveBeenCalledWith({ x: 12, y: 50 });
    expect(pendingFrames()).toBe(0);
  });

  it('retargets mid-walk with exactly one active loop and one completion', () => {
    const { result, onMoveComplete } = mount();

    act(() => {
      result.current.goTo({ x: 90, y: 50 });
    });
    act(() => step(16));
    act(() => step(16));
    expect(pendingFrames()).toBe(1);

    // Retarget close by while the first walk is in flight.
    const retarget = { x: result.current.position.x + 1, y: 50 };
    act(() => {
      result.current.goTo(retarget);
    });
    expect(pendingFrames()).toBe(1); // redirected, not stacked

    runFrames(() => result.current.isMoving);

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position).toEqual(retarget);
    expect(onMoveComplete).toHaveBeenCalledOnce();
    expect(onMoveComplete).toHaveBeenCalledWith(retarget);
    expect(pendingFrames()).toBe(0);
  });

  it('survives parent re-renders and callback identity changes mid-walk', () => {
    const { result, rerender } = mount();

    act(() => {
      result.current.goTo({ x: 14, y: 50 });
    });
    act(() => step(16));

    // Parent re-render with a NEW completion callback identity mid-walk.
    const lateComplete = vi.fn();
    rerender({ onMoveComplete: lateComplete });
    expect(pendingFrames()).toBe(1); // the in-flight loop was not restarted

    runFrames(() => result.current.isMoving);

    expect(result.current.isMoving).toBe(false);
    // The LATEST callback receives the completion (latest-ref pattern).
    expect(lateComplete).toHaveBeenCalledOnce();
    expect(lateComplete).toHaveBeenCalledWith({ x: 14, y: 50 });
  });

  it('snapTo during an active walk cancels the loop and completes at the pose', () => {
    const { result, onMoveComplete } = mount();

    act(() => {
      result.current.goTo({ x: 90, y: 50 });
    });
    act(() => step(100));
    expect(result.current.isMoving).toBe(true);

    act(() => {
      result.current.snapTo({ x: 42, y: 33 });
    });

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position).toEqual({ x: 42, y: 33 });
    expect(onMoveComplete).toHaveBeenCalledOnce();
    expect(onMoveComplete).toHaveBeenCalledWith({ x: 42, y: 33 });
    expect(pendingFrames()).toBe(0);

    // A stray late frame must not resurrect the cancelled walk.
    act(() => step(100));
    expect(result.current.position).toEqual({ x: 42, y: 33 });
    expect(onMoveComplete).toHaveBeenCalledOnce();
  });

  it('stop cancels in place without completing', () => {
    const { result, onMoveComplete } = mount();

    act(() => {
      result.current.goTo({ x: 90, y: 50 });
    });
    act(() => step(100));
    const midwalk = result.current.position;

    act(() => {
      result.current.stop();
    });

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position).toEqual(midwalk);
    expect(onMoveComplete).not.toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);
  });

  it('unmount cancels the rAF loop', () => {
    const { result, unmount } = mount();

    act(() => {
      result.current.goTo({ x: 90, y: 50 });
    });
    expect(pendingFrames()).toBe(1);

    unmount();
    expect(pendingFrames()).toBe(0);
  });

  it('a blocked target is ignored entirely (no movement start)', () => {
    const { result, onMoveStart } = mount({}, { x: 60, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 70, y: 50 }); // inside the blocker
    });

    expect(result.current.isMoving).toBe(false);
    expect(onMoveStart).not.toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);
  });

  it('colliding with a blocker mid-walk ends the walk at the collision edge', () => {
    // Blocker between the start (x=10) and an allowed target beyond it.
    const { result, onMoveComplete } = mount({}, { x: 20, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 45, y: 50 }); // target itself is NOT blocked
    });

    // Walk until a step lands inside the blocker (edge at x=20).
    runFrames(() => result.current.isMoving);

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position.x).toBeLessThanOrEqual(20);
    // Historical contract: completion reports the TARGET (what the walk was
    // for), while the position stays at the stop point.
    expect(onMoveComplete).toHaveBeenCalledOnce();
    expect(onMoveComplete).toHaveBeenCalledWith({ x: 45, y: 50 });
  });
});
