/**
 * Whose safety decisions these are.
 *
 * ## The problem this exists for
 *
 * Mute, Block and Report were stored under one browser-wide key. Two people
 * sharing a laptop — a parent and a child, two siblings, a family tablet — got
 * one shared list: the child's blocks silently applied to the parent's account,
 * and the parent could read every report the child had filed. Neither ever
 * asked for that, and neither could see it had happened.
 *
 * A safety decision is a statement by ONE player about another. It is not a
 * property of the browser, so it is not stored as one.
 *
 * ## Signed out keeps nothing
 *
 * A signed-out bucket is worse than no bucket: whatever accumulated there would
 * belong to nobody, and the obvious implementation hands it to the first
 * account that signs in — which is precisely the leak this module closes. So a
 * signed-out session gets an in-memory store that is never persisted and never
 * inherited. Nothing is lost by that: the island requires an account, so a
 * signed-out player has nobody to block.
 *
 * ## Still local, still private
 *
 * Scoping by pubkey changes where a decision is written, not whether it leaves
 * the device. Nothing here publishes, and the key is a pubkey the browser
 * already holds — see `docs/player-safety-controls.md`.
 */

/** Lowercase 64-hex, the only shape a Nostr pubkey has. */
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

let activeAccount: string | null = null;
const listeners = new Set<() => void>();

/**
 * Point the safety stores at an account.
 *
 * Called by `PlayerSafetyAccountSync`, which watches the signed-in user. Idempotent:
 * setting the account it already has notifies nobody, so a re-render cannot
 * churn every subscriber in the world layer.
 *
 * An invalid pubkey is treated as SIGNED OUT rather than used as a key. A
 * malformed value would otherwise become a bucket of its own, and a bucket
 * nobody can name is a bucket nobody can clear.
 */
export function setSafetyAccount(pubkey: string | null | undefined): void {
  const next = typeof pubkey === 'string' && PUBKEY_PATTERN.test(pubkey)
    ? pubkey.toLowerCase()
    : null;
  if (next === activeAccount) return;
  activeAccount = next;
  [...listeners].forEach((listener) => listener());
}

/** The account whose decisions are currently in scope, or `null` when signed out. */
export function safetyAccount(): string | null {
  return activeAccount;
}

/**
 * The storage key for one store under the current account, or `null` when
 * there is no account — which the stores read as "keep this in memory only".
 */
export function scopedSafetyKey(base: string): string | null {
  return activeAccount ? `${base}:${activeAccount}` : null;
}

/** Subscribe to account changes. Returns an unsubscribe function. */
export function subscribeSafetyAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Is this the player themselves?
 *
 * Muting or blocking your own account is not a safety decision, it is a way to
 * make your own Blobbi vanish from your own island — and reporting yourself
 * fills the local report store with noise. Rejected at the DATA boundary rather
 * than by hiding a button, because the buttons are not the only caller.
 */
export function isSelf(pubkey: string): boolean {
  return activeAccount !== null && pubkey.toLowerCase() === activeAccount;
}

/**
 * Back to signed out. Tests only.
 *
 * Deliberately does NOT drop the listeners: the stores subscribe at module load
 * and their subscriptions are part of the architecture, not per-test state.
 * Clearing them would leave every later test running against caches that never
 * hear about an account change — which is the one behaviour worth proving.
 */
export function resetSafetyAccount(): void {
  setSafetyAccount(null);
}
