/**
 * The most recent message from each visible player, held in memory so a report
 * taken moments later still has something to point at.
 *
 * ## Why this has to exist
 *
 * Kind 21201 is ephemeral with a ~10 second expiration. A player reads something
 * upsetting, opens the player's card, picks Report, and by then the event is
 * gone from the relay and from the bubble layer. Without a short-lived record,
 * every report about a message would be a report about nothing.
 *
 * ## Why it is memory-only, and why it is one message
 *
 * Deliberately NOT persisted, and deliberately not a transcript.
 *
 * Keeping a room's chat history on disk to make reporting easier would build a
 * log of everything every child was told, on the child's own device, for a
 * feature they use once. The narrow version, the single latest message per
 * player, in RAM, dropped when they leave the room, is enough to file a report
 * about what just happened and cannot become anything else.
 *
 * It also holds the SIGNED original event rather than a copy of the text,
 * because that is what makes a report verifiable: a reviewer can check the
 * signature and know the reported pubkey really published it.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** How many players' latest messages are remembered at once. */
export const MAX_REMEMBERED_SENDERS = 50;

export interface RecentMessage {
  /** The signed original, verbatim. */
  readonly event: NostrEvent;
  /** How this build classified it: `text` | `quick` | `template` | `emote`. */
  readonly messageClass: string;
  /** What this build actually rendered, the local meaning of the ids. */
  readonly renderedText: string;
  /** Local receive time, unix ms. */
  readonly receivedAt: number;
}

const recent = new Map<string, RecentMessage>();

/**
 * Remember one message.
 *
 * Re-inserting moves the key to the back of the Map's insertion order, so the
 * eviction below sheds the least recently heard sender.
 */
export function rememberMessage(pubkey: string, message: RecentMessage): void {
  if (!pubkey) return;
  const key = pubkey.toLowerCase();
  recent.delete(key);
  recent.set(key, message);
  while (recent.size > MAX_REMEMBERED_SENDERS) {
    const oldest = recent.keys().next();
    if (oldest.done) break;
    recent.delete(oldest.value);
  }
}

/** The latest remembered message from this player, or `null`. */
export function recentMessageFrom(pubkey: string): RecentMessage | null {
  if (!pubkey) return null;
  return recent.get(pubkey.toLowerCase()) ?? null;
}

/** Forget one player's message, used when they are muted or blocked. */
export function forgetMessagesFrom(pubkey: string): void {
  if (pubkey) recent.delete(pubkey.toLowerCase());
}

/**
 * Forget everything.
 *
 * Called on a location change: context from a room the player has left is not
 * context they need, and holding it would turn a per-room buffer into a session
 * log by accident.
 */
export function clearRecentMessages(): void {
  recent.clear();
}
