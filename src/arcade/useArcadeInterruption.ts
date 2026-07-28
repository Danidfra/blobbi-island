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
 * Both are treated as **pause**, never as abort: the player has not left the
 * machine, and losing a run to an alt-tab would be hostile.
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
 *   acting on them would produce spurious state changes. Pausing conservatively
 *   and resuming explicitly needs neither.
 */

import { useEffect, useRef } from 'react';

export interface UseArcadeInterruptionOptions {
  /**
   * Only `true` while a run is genuinely advancing (`playing`, and optionally
   * `countdown`). When false, no listeners are bound at all.
   */
  active: boolean;
  /** Called at most once per interruption. */
  onPause: () => void;
}

export function useArcadeInterruption({ active, onPause }: UseArcadeInterruptionOptions): void {
  // Read through a ref so a new inline callback each render cannot re-bind the
  // listeners — re-binding is how duplicate listeners appear.
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;

  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const pause = () => onPauseRef.current();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') pause();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', pause);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', pause);
    };
  }, [active]);
}
