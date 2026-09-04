/**
 * The one-time "what happens next" note shown after a player first launches a
 * connected experience from the Station.
 *
 * A LOCAL UI preference in the sense of `src/lib/first-session.ts`: never
 * published, never game state, and losing it costs a repeated sentence at
 * most. Keyed per device and per experience rather than per player, because
 * the note explains the Station, not the account.
 */

const KEY = (experienceId: string) => `blobbi:station:launch-hint-seen:v1:${experienceId}`;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function local(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Has the launch note for this experience been shown on this device? */
export function hasSeenLaunchHint(experienceId: string, store: Storage | null = local()): boolean {
  try {
    return store?.getItem(KEY(experienceId)) === '1';
  } catch {
    return false;
  }
}

export function markLaunchHintSeen(experienceId: string, store: Storage | null = local()): void {
  try {
    store?.setItem(KEY(experienceId), '1');
  } catch {
    // Best effort: a browser that refuses storage sees the note again.
  }
}

/** Test and reset helper. */
export function clearLaunchHint(experienceId: string, store: Storage | null = local()): void {
  try {
    store?.removeItem(KEY(experienceId));
  } catch {
    // Best effort.
  }
}
