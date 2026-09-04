/**
 * Who is a REMOTE actor, and who is us.
 *
 * Presence is a broadcast. Every kind 31950 the local client publishes comes
 * straight back down its own subscription, so "is this someone else?" is not a
 * detail of the ingest function; it is the boundary that decides whether an
 * actor exists at all. Get it wrong and the player watches a second copy of
 * their own Blobbi trail them around the island, drawn from their own kind
 * 31124, moving along their own published path a beat behind them.
 *
 * TWO INDEPENDENT INVARIANTS, because they fail in different ways:
 *
 *   1. `event.pubkey === localPubkey`: the canonical identity rule. One
 *      account is one actor (see §multi-session below), so our own key is
 *      never a remote player.
 *
 *   2. the presence carries OUR session id, the backstop. The session id is
 *      generated per mounted presence hook and published in the `d` tag, so an
 *      event carrying it came from this very client no matter what the first
 *      rule believes about our key. This is the check that holds when the
 *      first one cannot: before the local identity has resolved, or if it is
 *      ever stale.
 *
 * And the precondition that makes both meaningful:
 *
 *   0. an unknown local identity admits NOBODY. If we cannot say who we are,
 *      we cannot say that somebody else is not us, and the safe answer to "is
 *      this a stranger?" is no. Presence is advisory and self-healing, the
 *      next heartbeat, ~25 s away at worst, arrives once identity is known,
 *      so the cost of refusing is a brief empty room, against drawing a
 *      phantom that never leaves.
 *
 * §multi-session. One pubkey is deliberately ONE visible actor: the ingest
 * keeps only the newest session per author (`latestSessionByPubkeyRef`) and
 * evicts the rest. Opening a second tab, or the same account on a phone, moves
 * that account's Blobbi to the newer session rather than showing two. So there
 * is no legitimate case where the local player's own key should appear as a
 * remote actor: not another tab, not another device, not a reconnect.
 */

/** Why a presence event may not become a remote actor. */
export type PresenceIdentityRefusal =
  | 'own-session'
  | 'unknown-local-identity'
  | 'own-pubkey';

export type PresenceIdentityAdmission =
  | { ok: true }
  | { ok: false; reason: PresenceIdentityRefusal };

export interface PresenceIdentityInput {
  /** The local player's pubkey, or `''`/undefined while it is still unknown. */
  localPubkey: string | undefined | null;
  /** This client's presence session id (the `d` tag it publishes, minus the prefix). */
  localSessionId: string;
  /** The author of the incoming presence event. */
  eventPubkey: string;
  /** The incoming event's session id, or null when it has no usable `d` tag. */
  eventSessionId: string | null;
}

const ADMIT: PresenceIdentityAdmission = Object.freeze({ ok: true });

/**
 * Decide whether an incoming presence event may become a remote actor.
 *
 * Pure and total: it never throws and never looks at anything but identity, so
 * it can be called as the first thing the ingest does, before a JSON parse, a
 * visual fetch or any state write.
 */
export function admitRemotePresence(input: PresenceIdentityInput): PresenceIdentityAdmission {
  const { localPubkey, localSessionId, eventPubkey, eventSessionId } = input;

  // Checked FIRST, and independently of identity: this is the rule that still
  // works when we do not yet know who we are.
  if (eventSessionId && localSessionId && eventSessionId === localSessionId) {
    return { ok: false, reason: 'own-session' };
  }

  if (!localPubkey) {
    return { ok: false, reason: 'unknown-local-identity' };
  }

  if (eventPubkey === localPubkey) {
    return { ok: false, reason: 'own-pubkey' };
  }

  return ADMIT;
}
