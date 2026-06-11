import { useEffect, useRef, useState } from "react";

export interface GazeOffset {
  x: number;
  y: number;
}

/**
 * Produces a subtle, smooth, continuously-varying normalized gaze offset
 * (each axis roughly -1..1) for idle Blobbis, so the eyes make small natural
 * micro-movements instead of staying perfectly static.
 *
 * Uses a single requestAnimationFrame loop with layered sine waves (no
 * external animation library, no per-frame allocations beyond the state
 * object). When `enabled` is false the loop stops and a zeroed offset is
 * returned, so callers can supply their own (e.g. movement) gaze instead.
 */
export function useIdleGaze(enabled: boolean = true): GazeOffset {
  const [offset, setOffset] = useState<GazeOffset>({ x: 0, y: 0 });
  const frameRef = useRef<number>();
  // Per-instance phase so multiple Blobbis don't move in lockstep.
  const phaseRef = useRef<number>(Math.random() * Math.PI * 2);

  useEffect(() => {
    if (!enabled) {
      setOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
      return;
    }

    const phase = phaseRef.current;

    const tick = (timestamp: number) => {
      // Slow drift; amplitude kept small so the motion reads as "alive" not jittery.
      const t = timestamp / 1000;
      const x = Math.sin(t * 0.6 + phase) * 0.35 + Math.sin(t * 0.23 + phase) * 0.15;
      const y = Math.sin(t * 0.5 + phase * 1.3) * 0.25;
      setOffset({ x, y });
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
