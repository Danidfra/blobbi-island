/**
 * State for the in-world moment after a consumption. See `CareReaction.tsx`
 * for the readout it drives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CareFeedback } from '@/inventory';
import { cn } from '@/lib/utils';

/** How long the whole moment stays on screen. Short: it must never block. */
export const CARE_REACTION_MS = 1800;

export interface CareReactionState {
  /** The moment on screen, or `null` when the Blobbi is at rest. */
  feedback: CareFeedback | null;
  /** Show one logical consumption. Same id as the current one: ignored. */
  show: (feedback: CareFeedback) => void;
  clear: () => void;
}

export function useCareReaction(durationMs: number = CARE_REACTION_MS): CareReactionState {
  const [feedback, setFeedback] = useState<CareFeedback | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownId = useRef<string | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setFeedback(null);
  }, []);

  const show = useCallback(
    (next: CareFeedback) => {
      if (shownId.current === next.id) return;
      shownId.current = next.id;
      if (timer.current) clearTimeout(timer.current);
      setFeedback(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setFeedback((current) => (current?.id === next.id ? null : current));
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { feedback, show, clear };
}

/**
 * Classes for the element that IS the Blobbi on a stage: the bounce while a
 * reaction is on screen, nothing otherwise. Bottom origin so the feet stay
 * on the floor.
 */
export function careActorClass(reacting: boolean, reducedMotion: boolean): string {
  return cn('origin-bottom', reacting && !reducedMotion && 'animate-care-bounce');
}
