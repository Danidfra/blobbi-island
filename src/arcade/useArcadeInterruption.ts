/**
 * Pause-on-interruption: the shared rule that a game never advances while the
 * player is not looking at it.
 *
 * Two signals, both conservative:
 *
 *  - **`visibilitychange` → hidden.** The tab was backgrounded. Browsers throttle
 *    or stop `requestAnimationFrame` there, so a rhythm game left running would
 *    not merely be unfair, it would desynchronise from its own audio clock.
 *  - **`window` blur.** Focus went to another window, a devtools panel, or an OS
 *    dialog. The tab is still "visible", so `visibilitychange` says nothing.
 *
 * ## The two are NOT equally severe: Phase 3 split them
 *
 * Phase 2 treated both as a pause. Building a real rhythm game on top of this
 * showed they are different events with different consequences, so the hook now
 * reports WHICH one happened and the game decides:
 *
 * | signal | what is actually true | what Blobbi Dance does |
 * | --- | --- | --- |
 * | `hidden` | `requestAnimationFrame` is throttled or stopped, and `AudioContext.currentTime` keeps advancing regardless. A run left alone silently accumulates misses the player never had a chance to answer. | **abort** |
 * | `blur` | the tab is still visible and still rendering; the player can see the notes and hear the music. They clicked a devtools panel or a second monitor. | **pause** |
 *
 * Aborting on blur was the original Phase 3 behaviour and it is hostile: losing
 * a sixty-eight second run to an OS dialog is worse than any timing problem it
 * could prevent, and pausing loses nothing because the clock is re-anchored on
 * resume rather than trusted to have frozen.
 *
 * Callers that do not care may pass a single `onInterrupt`; the reason is still
 * supplied, so nothing is hidden from a caller that later wants it.
 *
 * ## What this deliberately does NOT do
 *
 * - **No automatic resume.** Coming back to a game that is already running is
 *   how players lose runs to a countdown they never saw. The shell resumes on an
 *   explicit action.
 * - **No background continuation.** There is no "keep playing while hidden" path
 *   and there must not be one.
 * - **No `focus`/`pageshow` handling.** They fire in enough odd combinations on
 *   mobile Safari (bfcache restores, keyboard dismissals, PWA switches) that
 *   acting on them would produce spurious state changes. Interrupting
 *   conservatively and resuming explicitly needs neither.
 */

import { useEffect, useRef } from 'react';

/** Which signal fired. `hidden` is strictly more severe than `blur`. */
export type ArcadeInterruptionReason = 'hidden' | 'blur';

export interface UseArcadeInterruptionOptions {
  /**
   * Only `true` while a run is genuinely advancing (`playing`, and optionally
   * `countdown`). When false, no listeners are bound at all.
   */
  active: boolean;
  /** Called at most once per interruption, with the reason. */
  onInterrupt: (reason: ArcadeInterruptionReason) => void;
}

export function useArcadeInterruption({
  active,
  onInterrupt,
}: UseArcadeInterruptionOptions): void {
  // Read through a ref so a new inline callback each render cannot re-bind the
  // listeners: re-binding is how duplicate listeners appear.
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;

  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onInterruptRef.current('hidden');
    };
    const onBlur = () => onInterruptRef.current('blur');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [active]);
}
