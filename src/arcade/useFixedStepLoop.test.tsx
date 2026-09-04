/**
 * The shared fixed-step loop, the three things it must get right.
 *
 * Every assertion here is about a failure that would be invisible in a browser
 * until it was catastrophic: a simulation that runs at a different speed on
 * different hardware, a hidden tab that comes back and advances the world by
 * four seconds in one step, and a paused game that quietly leaves a frame loop
 * running behind a closed dialog.
 *
 * `requestAnimationFrame` and the clock are both stubbed, so the loop is driven
 * by hand and nothing waits for a real frame.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { useFixedStepLoop } from './useFixedStepLoop';

/** A hand-driven `requestAnimationFrame`. */
function installFrameDriver() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  let clock = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });

  return {
    now: () => clock,
    /** Advance the clock by `ms` and run whatever frames are queued. */
    frame(ms: number) {
      clock += ms;
      const due = [...pending.entries()];
      pending.clear();
      act(() => {
        for (const [, cb] of due) cb(clock);
      });
    },
    get scheduled() {
      return pending.size;
    },
  };
}

interface HarnessProps {
  active: boolean;
  stepMs: number;
  maxCatchUpMs?: number;
  onStep: (dt: number) => void;
  onRender?: () => void;
  now: () => number;
}

function Harness(props: HarnessProps) {
  useFixedStepLoop(props);
  return null;
}

let driver: ReturnType<typeof installFrameDriver>;

beforeEach(() => {
  driver = installFrameDriver();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the accumulator', () => {
  it('runs whole steps and keeps the remainder for next time', () => {
    const onStep = vi.fn();
    render(
      <Harness active stepMs={10} onStep={onStep} now={driver.now} />,
    );

    // 25 ms → two steps, 5 ms left in the bucket.
    driver.frame(25);
    expect(onStep).toHaveBeenCalledTimes(2);

    // Another 25 ms → 30 ms available → three steps.
    driver.frame(25);
    expect(onStep).toHaveBeenCalledTimes(5);
  });

  it('always advances by exactly the fixed step, in seconds', () => {
    const onStep = vi.fn();
    render(<Harness active stepMs={8} onStep={onStep} now={driver.now} />);

    driver.frame(40);
    expect(onStep).toHaveBeenCalledTimes(5);
    for (const call of onStep.mock.calls) expect(call[0]).toBeCloseTo(0.008, 9);
  });

  it('runs no step at all for a frame shorter than one step', () => {
    const onStep = vi.fn();
    render(<Harness active stepMs={16} onStep={onStep} now={driver.now} />);

    driver.frame(5);
    expect(onStep).not.toHaveBeenCalled();
    // But the time is not lost: it accumulates.
    driver.frame(12);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('gives the same number of steps whatever the frame rate', () => {
    // The property the whole design exists for: 60 Hz and 120 Hz simulate the
    // same amount of world per second of wall clock.
    const slow = vi.fn();
    const fast = vi.fn();
    const slowDriver = driver;
    render(<Harness active stepMs={10} onStep={slow} now={slowDriver.now} />);
    for (let i = 0; i < 10; i += 1) slowDriver.frame(16);

    vi.unstubAllGlobals();
    const fastDriver = installFrameDriver();
    render(<Harness active stepMs={10} onStep={fast} now={fastDriver.now} />);
    for (let i = 0; i < 20; i += 1) fastDriver.frame(8);

    expect(slow.mock.calls.length).toBe(fast.mock.calls.length);
  });
});

describe('the spiral-of-death guard', () => {
  it('discards time beyond the catch-up cap instead of simulating it', () => {
    // A hidden tab, a sleeping laptop, a blocked main thread. Without the cap
    // this would queue four hundred steps, which takes longer than a frame,
    // which grows the next delta.
    const onStep = vi.fn();
    render(
      <Harness active stepMs={10} maxCatchUpMs={100} onStep={onStep} now={driver.now} />,
    );

    driver.frame(4_000);
    expect(onStep).toHaveBeenCalledTimes(10);
  });

  it('is back to normal on the very next frame', () => {
    const onStep = vi.fn();
    render(
      <Harness active stepMs={10} maxCatchUpMs={100} onStep={onStep} now={driver.now} />,
    );
    driver.frame(4_000);
    onStep.mockClear();

    driver.frame(20);
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});

describe('rendering', () => {
  it('happens once per frame, after that frame’s steps', () => {
    const order: string[] = [];
    render(
      <Harness
        active
        stepMs={10}
        onStep={() => order.push('step')}
        onRender={() => order.push('render')}
        now={driver.now}
      />,
    );

    driver.frame(25);
    expect(order).toEqual(['step', 'step', 'render']);
  });

  it('happens even on a frame with no step in it', () => {
    // A dropped step costs the game; a dropped render costs a picture. They are
    // separate for exactly this reason.
    const onRender = vi.fn();
    render(
      <Harness active stepMs={100} onStep={() => {}} onRender={onRender} now={driver.now} />,
    );
    driver.frame(5);
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  it('schedules nothing while inactive', () => {
    const onStep = vi.fn();
    render(<Harness active={false} stepMs={10} onStep={onStep} now={driver.now} />);
    expect(driver.scheduled).toBe(0);
    driver.frame(100);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('cancels its frame when it goes inactive', () => {
    const onStep = vi.fn();
    const view = render(
      <Harness active stepMs={10} onStep={onStep} now={driver.now} />,
    );
    driver.frame(20);
    expect(onStep).toHaveBeenCalledTimes(2);

    view.rerender(<Harness active={false} stepMs={10} onStep={onStep} now={driver.now} />);
    expect(driver.scheduled).toBe(0);

    driver.frame(1_000);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('leaves nothing running after unmount', () => {
    // The guarantee a closed dialog depends on.
    const onStep = vi.fn();
    const view = render(<Harness active stepMs={10} onStep={onStep} now={driver.now} />);
    driver.frame(20);
    view.unmount();

    expect(driver.scheduled).toBe(0);
    driver.frame(1_000);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('contributes no steps for the time spent paused', () => {
    // Without re-anchoring the clock on resume, a five-minute pause would come
    // back and immediately burn the whole catch-up budget on time nobody
    // played.
    const onStep = vi.fn();
    const view = render(<Harness active stepMs={10} onStep={onStep} now={driver.now} />);
    driver.frame(20);
    onStep.mockClear();

    view.rerender(<Harness active={false} stepMs={10} onStep={onStep} now={driver.now} />);
    driver.frame(300_000);
    view.rerender(<Harness active stepMs={10} onStep={onStep} now={driver.now} />);

    driver.frame(10);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('does not re-bind when the parent re-renders with new inline callbacks', () => {
    // Re-binding is how a second loop appears and everything runs at double
    // speed. The callbacks are read through a ref precisely to prevent it.
    const calls: number[] = [];
    const view = render(
      <Harness active stepMs={10} onStep={() => calls.push(1)} now={driver.now} />,
    );
    view.rerender(
      <Harness active stepMs={10} onStep={() => calls.push(2)} now={driver.now} />,
    );

    driver.frame(10);
    // One step, through the LATEST callback.
    expect(calls).toEqual([2]);
    expect(driver.scheduled).toBe(1);
  });
});

describe('a hostile clock', () => {
  it('treats a backwards jump as no time at all', () => {
    let time = 1_000;
    const onStep = vi.fn();
    render(<Harness active stepMs={10} onStep={onStep} now={() => time} />);

    time = 500;
    driver.frame(0);
    expect(onStep).not.toHaveBeenCalled();

    time = 520;
    driver.frame(0);
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});
