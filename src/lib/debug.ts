/**
 * Gated debug logging.
 *
 * Verbose `[blobbi-debug]` style logs are noisy and must never run in
 * production. They are off by default and only emit when running a development
 * build AND the developer opts in via `localStorage['blobbi-debug'] = '1'`.
 *
 * Usage:
 *   import { dbg } from '@/lib/debug';
 *   dbg('[blobbi-debug][modal] opening', { id });
 *
 * For multiplayer-specific spam, set `localStorage['blobbi-debug-mp'] = '1'`
 * (handled separately in useIslandPresence).
 */
const debugEnabled = (key: string): boolean => {
  if (import.meta.env.MODE !== 'development') return false;
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key) === '1';
};

/** General gated debug logger. No-op unless explicitly enabled in dev. */
export function dbg(...args: unknown[]): void {
  if (debugEnabled('blobbi-debug')) {
    console.log(...args);
  }
}
