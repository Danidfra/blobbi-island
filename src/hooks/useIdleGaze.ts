import { useEffect, useRef, useState } from "react";

export interface GazeOffset {
  x: number;
  y: number;
}

/**
 * Produces a subtle, organic normalized gaze offset (each axis roughly -1..1)
 * for idle Blobbis, so the eyes behave like a thinking creature rather than
 * drifting continuously.
 *
 * Behaviour (a small state machine driven by one requestAnimationFrame loop):
 *  - pick a gaze point — frequently the neutral center, otherwise a random
 *    point biased toward left/right with a slight up/down component;
 *  - smoothly ease toward that point;
 *  - hold it for a random duration (longer when at neutral — the resting
 *    baseline that future emotions build on);
 *  - then pick a new point and repeat.
 *
 * Keeping the eyes at a neutral baseline between glances mimics how animals
 * look somewhere, return neutral, wait, then look again. When `enabled` is
 * false the loop stops and a zeroed offset is returned, so callers can supply
 * their own (e.g. movement) gaze instead.
 */
export function useIdleGaze(enabled: boolean = true): GazeOffset {
  const [offset, setOffset] = useState<GazeOffset>({ x: 0, y: 0 });
  const frameRef = useRef<number>();

  // Mutable per-instance animation state (kept in a ref so the rAF loop never
  // re-subscribes and we avoid per-frame allocations).
  const stateRef = useRef({
    current: { x: 0, y: 0 }, // where the eyes are now
    from: { x: 0, y: 0 }, // transition start point
    to: { x: 0, y: 0 }, // transition target point (neutral by default)
    transitionStart: 0, // ms timestamp the current transition began
    transitionDuration: 0, // ms to ease from `from` -> `to`
    holdUntil: 0, // ms timestamp to hold `to` until before picking again
  });

  useEffect(() => {
    if (!enabled) {
      setOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
      return;
    }

    const s = stateRef.current;

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    // Choose the next gaze point + how long to ease there and how long to hold.
    const pickNext = (timestamp: number) => {
      // ~45% of the time return to a neutral resting gaze. This makes "looking
      // at nothing" the baseline rather than constant motion.
      const goNeutral = Math.random() < 0.45;

      if (goNeutral) {
        s.to = { x: rand(-0.05, 0.05), y: rand(-0.04, 0.04) };
      } else {
        // Mostly horizontal glances with a smaller vertical component.
        const dir = Math.random() < 0.5 ? -1 : 1;
        s.to = {
          x: dir * rand(0.3, 0.85),
          y: rand(-0.3, 0.25),
        };
      }

      s.from = { ...s.current };
      s.transitionStart = timestamp;
      s.transitionDuration = rand(450, 900); // smooth, eye-like saccade
      // Hold longer at neutral (resting) than when looking at something.
      const holdDuration = goNeutral ? rand(900, 2500) : rand(800, 2200);
      s.holdUntil = timestamp + s.transitionDuration + holdDuration;
    };

    // Prime with an initial neutral target so the first move eases from center.
    pickNext(performance.now());

    // Smootherstep easing for a natural accelerate/decelerate.
    const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

    const tick = (timestamp: number) => {
      const elapsed = timestamp - s.transitionStart;
      const t =
        s.transitionDuration > 0
          ? Math.min(1, elapsed / s.transitionDuration)
          : 1;
      const k = ease(t);

      s.current = {
        x: s.from.x + (s.to.x - s.from.x) * k,
        y: s.from.y + (s.to.y - s.from.y) * k,
      };

      // Once the transition is done and the hold window has passed, pick again.
      if (t >= 1 && timestamp >= s.holdUntil) {
        pickNext(timestamp);
      }

      setOffset((prev) =>
        Math.abs(prev.x - s.current.x) < 0.0005 &&
        Math.abs(prev.y - s.current.y) < 0.0005
          ? prev
          : { x: s.current.x, y: s.current.y }
      );

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [enabled]);

  return offset;
}
