/**
 * `prefers-reduced-motion` support — the first in this repository.
 *
 * Generic on purpose: it lives in `src/hooks/` rather than `src/arcade/` because
 * decorative motion is everywhere on the island (bush sway, leaf bursts, tap
 * pops, modal zooms) and every one of them should eventually read this. Nothing
 * outside the arcade is rewired in this pass — that would be a repository-wide
 * animation refactor, which is not this task.
 *
 * ## What it is for, and what it is NOT for
 *
 * Reduced motion suppresses **decoration**: parallax, screen shake, particle
 * bursts, large scale/slide transitions. It must NEVER change:
 *
 *  - **game timing** — a note is due when the audio clock says it is, and the
 *    accessibility setting has no vote;
 *  - **gameplay cues** — an approaching note, a lane highlight, a judgement
 *    readout are information, not flourish. Removing them makes the game
 *    unplayable rather than calmer.
 *
 * ## SSR / jsdom safety
 *
 * `matchMedia` is missing in some environments and, in older WebKit, exposes
 * only the deprecated `addListener`. Both are handled: no `matchMedia` means
 * "motion is fine" (the safe default that changes nothing), and the legacy API
 * is used when the modern one is absent.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function getMediaQueryList(): LegacyMediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(QUERY) as LegacyMediaQueryList;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const mql = getMediaQueryList();
  if (!mql) return () => {};

  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // Safari < 14 and jsdom stubs that only implement the deprecated API.
  if (typeof mql.addListener === 'function') {
    mql.addListener(onChange);
    return () => mql.removeListener?.(onChange);
  }
  return () => {};
}

/** Boolean snapshot — a primitive, so `useSyncExternalStore` cannot tear. */
function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

/** Server render: assume motion is allowed, so nothing is suppressed by default. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * True when the user has asked the OS to reduce motion.
 *
 * Reacts to changes in the preference (toggling it in system settings updates
 * every subscriber without a reload).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
