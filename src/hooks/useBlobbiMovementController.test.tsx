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

  it('snapTo pins a pose anchor even inside a blocker: a chair cushion is furniture, not floor', () => {
    const { result, onMoveComplete } = mount({}, { x: 60, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.snapTo({ x: 70, y: 50 }); // on the furniture footprint
    });

    expect(result.current.position).toEqual({ x: 70, y: 50 });
    expect(onMoveComplete).toHaveBeenCalledWith({ x: 70, y: 50 });
  });

  it('standing up from a pose anchor inside a blocker puts the feet on free floor first, then walks', () => {
    const { result, onMoveStart } = mount({}, { x: 60, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.snapTo({ x: 70, y: 50 }); // seated: inside the footprint
    });
    act(() => {
      result.current.goTo({ x: 10, y: 50 });
    });

    // The walk was accepted, from a start that is no longer inside the blocker.
    expect(onMoveStart).toHaveBeenCalledWith({ x: 10, y: 50 });
    expect(result.current.isMoving).toBe(true);
    const start = result.current.getCurrentPosition();
    const inside = start.x >= 60 && start.x <= 80 && start.y >= 40 && start.y <= 60;
    expect(inside).toBe(false);

    runFrames(() => result.current.isMoving);
    expect(result.current.position.x).toBeCloseTo(10, 0);
  });

  it('a blocker between start and target is WALKED AROUND, not stopped at', () => {
    // This used to be the "ends the walk at the collision edge" test: the
    // Blobbi met the obstacle at x=20 and gave up there, several body-lengths
    // short of floor it could plainly have reached. It routes now.
    const blocker = { x: 20, y: 40, width: 20, height: 20 };
    const { result, onMoveComplete } = mount({}, blocker);

    act(() => {
      result.current.goTo({ x: 45, y: 50 }); // target itself is NOT blocked
    });
    runFrames(() => result.current.isMoving);

    expect(result.current.isMoving).toBe(false);
    // It got there, rather than halting at the blocker's near edge.
    expect(result.current.position.x).toBeCloseTo(45, 1);
    expect(result.current.position.y).toBeCloseTo(50, 1);
    // Completion still reports the caller's destination, once.
    expect(onMoveComplete).toHaveBeenCalledOnce();
    expect(onMoveComplete).toHaveBeenCalledWith({ x: 45, y: 50 });
  });

  it('completes exactly once for a routed walk, not once per waypoint', () => {
    const { result, onMoveComplete } = mount({}, { x: 20, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 45, y: 50 });
    });
    runFrames(() => result.current.isMoving);

    // The detour corner is an internal step, not an arrival.
    expect(onMoveComplete).toHaveBeenCalledTimes(1);
  });

  it('reports the DESTINATION to onMoveStart, never a detour waypoint', () => {
    const { result, onMoveStart } = mount({}, { x: 20, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 45, y: 50 });
    });

    // Presence and the pose controller are told where the player is going.
    expect(onMoveStart).toHaveBeenCalledExactlyOnceWith({ x: 45, y: 50 });
  });

  it('refuses to set off when no route exists at all', () => {
    // A wall of blockers with no way round inside the boundary.
    const { result, onMoveStart } = mount({}, { x: 20, y: 0, width: 20, height: 100 });

    act(() => {
      result.current.goTo({ x: 60, y: 50 });
    });

    expect(result.current.isMoving).toBe(false);
    expect(onMoveStart).not.toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);
  });

  it('a new destination mid-detour abandons the old route', () => {
    const { result } = mount({}, { x: 20, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 45, y: 50 });
    });
    runFrames(() => result.current.isMoving, 4); // part-way round the obstacle

    act(() => {
      result.current.goTo({ x: 10, y: 90 });
    });
    runFrames(() => result.current.isMoving);

    expect(result.current.position.x).toBeCloseTo(10, 1);
    expect(result.current.position.y).toBeCloseTo(90, 1);
  });

  it('stop() drops the whole route, not just the leg in progress', () => {
    const { result } = mount({}, { x: 20, y: 40, width: 20, height: 20 });

    act(() => {
      result.current.goTo({ x: 45, y: 50 });
    });
    runFrames(() => result.current.isMoving, 4);
    const stoppedAt = result.current.position;

    act(() => result.current.stop());
    runFrames(() => true, 10);

    expect(result.current.isMoving).toBe(false);
    expect(result.current.position).toEqual(stoppedAt);
  });
});
