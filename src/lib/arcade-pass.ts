/**
 * The Arcade Pass — temporary floor access, and the single place its lifecycle
 * lives.
 *
 * ## What the pass is (and is not)
 *
 * | | Arcade **Pass** | Arcade **Ticket** |
 * | --- | --- | --- |
 * | what | temporary floor ACCESS | persistent reward CURRENCY |
 * | stored in | `sessionStorage` | kind:31633 inventory |
 * | lifetime | until you leave the arcade | until you spend it |
 * | shape | boolean | integer quantity |
 *
 * They are deliberately **not merged**. Converting the pass into a kind:31632
 * inventory item is a product decision with its own consequences (does it expire?
 * is it tradable? what happens to the ones already sold?), and it is explicitly
 * out of scope here. What IS in scope is that the pass stops being read by
 * polling.
 *
 * ## The pass is TAB-SCOPED, on purpose
 *
 * `sessionStorage` is per tab (strictly, per browsing-context session): opening
 * the island in a second tab starts without a pass, and buying one there does
 * not appear here. That is the intended product behaviour, not a limitation
 * being worked around — the pass is temporary access for the visit you are
 * currently making, and it is cleared the moment you leave the arcade.
 *
 * It is therefore **not** cross-tab state, and this module does not try to make
 * it behave like any. The `storage` listener below exists only so that a write
 * this module did not perform (another document sharing this session-storage
 * area, e.g. a duplicated tab, or a devtools/manual edit) does not leave
 * subscribers showing a stale value. Under normal single-tab use it never fires.
 *
 * ## Why this module exists
 *
 * `ArcadePassIcon` ran `setInterval(checkPass, 1000)` for the entire session, in
 * every location, because storage fires no event for same-tab writes. That is a
 * poll standing in for a notification. Here the writers *are* the notification:
 * `grantArcadePass()` and `clearArcadePass()` tell subscribers directly.
 *
 * ## Why the snapshot is read fresh every time
 *
 * `useSyncExternalStore` requires a snapshot that is stable between renders
 * unless it genuinely changed. A boolean satisfies that by value, so there is no
 * cached copy to go stale — which matters, because the spawn-point helper reads
 * the pass outside React entirely.
 *
 * ## Writes report whether they actually happened
 *
 * Storage can be unavailable or throw (Safari private browsing, a storage quota,
 * a hardened profile). A write that quietly failed while the caller believed it
 * succeeded is how a player pays 20 coins and receives nothing, so
 * {@link grantArcadePass} and {@link clearArcadePass} READ BACK and return
 * whether the value they intended is now actually stored.
 */

const STORAGE_KEY = 'has-arcade-pass';

const listeners = new Set<() => void>();
let storageListenerAttached = false;

function emit(): void {
  // Copy first: a listener that unsubscribes during notification must not
  // perturb the iteration.
  [...listeners].forEach((listener) => listener());
}

/**
 * Whether the player currently holds an Arcade Pass.
 *
 * Safe outside React and outside a browser: storage access is guarded, and a
 * blocked/absent `sessionStorage` reads as "no pass" rather than throwing.
 */
export function hasArcadePass(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Write the flag and report whether it actually stuck.
 *
 * The read-back is the whole point: `setItem` can throw (private browsing,
 * quota) and, in some hardened environments, can silently do nothing. Trusting
 * "it didn't throw" is not the same as "it is stored", and the difference
 * decides whether a paying player gets what they paid for.
 */
function write(granted: boolean): boolean {
  const before = hasArcadePass();
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (granted) sessionStorage.setItem(STORAGE_KEY, 'true');
      else sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* fall through — the read-back below decides the outcome */
  }

  const after = hasArcadePass();
  // Notify only on a REAL change. A failed write must not wake subscribers into
  // re-reading a value that did not move.
  if (after !== before) emit();
  return after === granted;
}

/**
 * Grant the pass. Returns `false` when storage refused the write.
 *
 * Call this **only after** the coin charge has been published successfully —
 * see `ArcadePassModal`. Granting first and charging later is how the arcade
 * ended up giving away unlimited free passes.
 *
 * The caller MUST check the return value: a charged player who silently
 * received nothing is worse than one who is told what happened.
 */
export function grantArcadePass(): boolean {
  return write(true);
}

/**
 * Revoke the pass. Called when the player leaves the arcade.
 *
 * Returns `false` only if the flag is somehow still readable afterwards; with no
 * storage at all there is nothing to revoke, so it reports success.
 */
export function clearArcadePass(): boolean {
  return write(false);
}

/** Subscribe to pass changes. Returns an unsubscribe function. */
export function subscribeArcadePass(onChange: () => void): () => void {
  listeners.add(onChange);

  // One shared `storage` listener for the whole module, attached lazily so a
  // module import never touches `window`, and removed when nobody is listening.
  // It is NOT cross-tab synchronisation — see the note at the top of this file:
  // `sessionStorage` is tab-scoped, so this only catches a write some other
  // document in the same session-storage area (or a manual edit) performed.
  if (!storageListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    storageListenerAttached = true;
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && storageListenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      storageListenerAttached = false;
    }
  };
}

function onStorage(event: StorageEvent): void {
  // `key === null` means the whole storage area was cleared.
  if (event.key === null || event.key === STORAGE_KEY) emit();
}

/** Test/harness seam: drop every subscriber and detach the storage listener. */
export function resetArcadePassSubscribers(): void {
  listeners.clear();
  if (storageListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('storage', onStorage);
    storageListenerAttached = false;
  }
}
