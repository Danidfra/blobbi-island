/**
 * First-session UI preferences — what a player has already seen, per device.
 *
 * Every value here is a LOCAL UI preference: whether the welcome card was
 * dismissed, whether the arrival moment already played this visit, whether
 * the initial Coin grant was celebrated, whether the player folded the action
 * dock away. None of it is game state, none of it is economy state, and none
 * of it is ever published to Nostr. Losing it (a new device, cleared storage)
 * costs a repeated welcome at most — never a repeated grant, because the
 * grant itself is decided by its durable marker (`economy-entry.ts`), and the
 * celebration only ever reacts to that decision.
 *
 * Keyed by pubkey where the fact is about the PLAYER (welcome, coin
 * celebration); session-scoped where it is about this VISIT (arrival); device
 * scoped where it is about this BROWSER (dock). Storage is optional: every
 * read falls back to "not seen" and every write is best-effort.
 */

const WELCOME_KEY = (pubkey: string) => `blobbi:first-session:welcome-seen:v1:${pubkey}`;
const COIN_CELEBRATION_KEY = (pubkey: string) => `blobbi:first-session:coin-grant-celebrated:v1:${pubkey}`;
const ARRIVAL_KEY = (pubkey: string) => `blobbi:first-session:arrival-seen:${pubkey}`;
const DOCK_COLLAPSED_KEY = 'blobbi:ui:action-dock-collapsed';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function local(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function read(store: Storage | null, key: string): boolean {
  try {
    return store?.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(store: Storage | null, key: string, value: boolean): void {
  try {
    if (value) store?.setItem(key, '1');
    else store?.removeItem(key);
  } catch {
    // Best effort: a browser that refuses storage just sees the card again.
  }
}

/** Has this player dismissed the welcome card on this device? */
export function hasSeenWelcome(pubkey: string): boolean {
  return read(local(), WELCOME_KEY(pubkey));
}
export function markWelcomeSeen(pubkey: string): void {
  write(local(), WELCOME_KEY(pubkey), true);
}

/** Has the initial Coin grant already been celebrated for this player here? */
export function hasCelebratedCoinGrant(pubkey: string): boolean {
  return read(local(), COIN_CELEBRATION_KEY(pubkey));
}
export function markCoinGrantCelebrated(pubkey: string): void {
  write(local(), COIN_CELEBRATION_KEY(pubkey), true);
}

/** Has the Island-arrival moment already played during THIS visit (tab session)? */
export function hasSeenArrivalThisSession(pubkey: string): boolean {
  return read(session(), ARRIVAL_KEY(pubkey));
}
export function markArrivalSeen(pubkey: string): void {
  write(session(), ARRIVAL_KEY(pubkey), true);
}

/**
 * Did the player fold the action dock away? Visible is the default; only an
 * explicit collapse is remembered, and only for this visit.
 */
export function readDockCollapsed(): boolean {
  return read(session(), DOCK_COLLAPSED_KEY);
}
export function writeDockCollapsed(collapsed: boolean): void {
  write(session(), DOCK_COLLAPSED_KEY, collapsed);
}

/** Tests only. */
export function clearFirstSessionPreferences(): void {
  try {
    for (const store of [local(), session()]) {
      if (!store) continue;
      const keys: string[] = [];
      const s = store as unknown as globalThis.Storage;
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i);
        if (key && (key.startsWith('blobbi:first-session:') || key === DOCK_COLLAPSED_KEY)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    }
  } catch {
    // nothing to clear
  }
}
