/**
 * A fixed-timestep game loop, as a hook — the shared piece of every arcade game
 * that simulates something.
 *
 * Blobbi Dance did not need this: a rhythm game reads a clock (the audio one)
 * and draws whatever it says, so a dropped frame costs a frame of animation and
 * nothing else. A game with **physics** cannot work that way. If the simulation
 * advances by "however long the last frame took", the puck behaves differently
 * on a 60 Hz laptop and a 120 Hz phone, and a single long frame — a garbage
 * collection, a tab switch, a resize — advances it by a step large enough to
 * pass straight through a wall.
 *
 * So: **the simulation advances in fixed steps, and rendering happens whenever
 * the browser is ready.** That is the standard decoupled loop, and the three
 * things it must get right are all here rather than in each game.
 *
 * ## 1. The accumulator
 *
 * Real elapsed time goes into a bucket; whole `stepMs` chunks come out. A 16.7 ms
 * frame at an 8.3 ms step runs two steps and leaves 0.1 ms in the bucket for
 * next time, so the simulation clock tracks the wall clock without ever taking
 * an irregular step.
 *
 * ## 2. The spiral-of-death guard
 *
 * A frame that reports 4 seconds — because the tab was hidden, the laptop slept,
 * or a modal blocked the main thread — would queue 480 steps, which takes longer
 * than a frame, which grows the next delta, which queues more steps. The bucket
 * is therefore capped at {@link FixedStepLoopOptions.maxCatchUpMs}: time beyond
 * it is DISCARDED, not simulated. The game skips ahead rather than fast-forwarding
 * through physics nobody watched, which is exactly what the brief means by "do
 * not allow a hidden tab to produce a giant physics step".
 *
 * ## 3. Restarting cleanly
 *
 * Going inactive cancels the frame and CLEARS the accumulator. Coming back
 * re-anchors to the current time, so a five-minute pause contributes zero steps —
 * without this, `active` flipping back on would immediately hit the cap and burn
 * a full catch-up budget on time the player spent away.
 *
 * ## What it deliberately does not do
 *
 * No interpolation between steps. It would be correct, and at a 120 Hz
 * simulation it buys nothing a person can see while costing every game an extra
 * "previous state" to keep. No React state: `onStep` and `onRender` are read
 * through a ref, so a parent re-rendering with new inline callbacks never
 * re-binds the loop — re-binding is how a second loop appears and everything
 * silently runs at double speed.
 */

import { useEffect, useRef } from 'react';

export interface FixedStepLoopOptions {
  /**
   * The loop runs only while this is true. Flipping it off cancels the frame,
   * clears the accumulator, and leaves nothing scheduled.
   */
  readonly active: boolean;
  /** Simulation step, in milliseconds. */
  readonly stepMs: number;
  /**
   * Most real time one frame may contribute, in milliseconds. Anything beyond
   * it is dropped. Default 250 ms — about four steps' worth of catch-up at
   * 60 Hz, enough to ride out a stutter and far too little to matter after a
   * tab switch.
   */
  readonly maxCatchUpMs?: number;
  /** Advance the simulation by exactly `stepMs`. `dt` is in SECONDS. */
  readonly onStep: (dt: number) => void;
  /**
   * Draw. Called at most once per animation frame, AFTER that frame's steps.
   *
   * Separate from `onStep` because they run at different rates and for
   * different reasons: skipping a render loses a picture, skipping a step loses
   * the game.
   */
  readonly onRender?: () => void;
  /**
   * Clock, injectable so a test can drive the loop deterministically. Defaults
   * to `performance.now()` where it exists — monotonic, and unaffected by the
   * system clock being adjusted mid-match.
   */
  readonly now?: () => number;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Run `onStep` at a fixed rate and `onRender` once per frame while `active`.
 *
 * Returns nothing. Everything it owns — the frame handle and the accumulator —
 * is released when `active` goes false or the component unmounts, so a closed
 * dialog can never leave a simulation running.
 */
export function useFixedStepLoop({
  active,
  stepMs,
  maxCatchUpMs = 250,
  onStep,
  onRender,
  now = defaultNow,
}: FixedStepLoopOptions): void {
  const callbacksRef = useRef({ onStep, onRender, now });
  callbacksRef.current = { onStep, onRender, now };

  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof requestAnimationFrame !== 'function') return;

    let cancelled = false;
    let accumulator = 0;
    let last = callbacksRef.current.now();
    const dtSeconds = stepMs / 1000;

    const tick = () => {
      if (cancelled) return;
      frameRef.current = requestAnimationFrame(tick);

      const current = callbacksRef.current.now();
      // A negative delta is impossible from a monotonic clock and trivial from a
      // stubbed one; treating it as zero keeps a test honest instead of running
      // the simulation backwards.
      const delta = Math.max(0, current - last);
      last = current;

      accumulator = Math.min(accumulator + delta, maxCatchUpMs);

      while (accumulator >= stepMs) {
        accumulator -= stepMs;
        callbacksRef.current.onStep(dtSeconds);
        if (cancelled) return;
      }

      callbacksRef.current.onRender?.();
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, stepMs, maxCatchUpMs]);
}
