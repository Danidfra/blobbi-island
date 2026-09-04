/**
 * Cooldowns, in one place, for both directions.
 *
 * ## Why a tap costs more than a sentence
 *
 * The deployed client used a single 500 ms send throttle, which was sized for
 * typing: composing a message is itself the rate limit, and 500 ms only stops
 * a held Enter key. Quick phrases and emotes remove that natural friction
 * entirely: a phrase is one tap, an emote is one tap, and a child discovering
 * the emote grid will tap it as fast as it responds.
 *
 * So the cheaper the input, the higher the floor: free text keeps its 500 ms
 * (deliberately unchanged, so Standard chat feels exactly as it does today) and
 * the one-tap classes get 1000 ms. That is still responsive; you can wave, then
 * clap a second later, while making a stream of emotes over someone's head
 * impossible rather than merely rude.
 *
 * ## Inbound is enforced separately, on purpose
 *
 * A send-side cooldown protects nobody: it lives in the client the sender
 * controls. {@link createInboundThrottle} is the half that actually bounds what
 * a player is subjected to, and it runs on the receiver against the sender's
 * pubkey.
 *
 * It also replaces something that was doing this job by accident. The previous
 * receive path deduplicated on `pubkey:sessionId` within 2 s, which suppressed
 * *every* second message from a sender in that window, including two different
 * ones. That worked as a crude rate limit and was wrong as a deduplicator, and
 * it would have made "wave, then heart" silently drop the heart. Duplicate
 * suppression now keys on the event id, where it belongs, and the rate limit is
 * stated here where it can be reasoned about.
 *
 * This module is pure: `now` is a parameter, never a clock read, so every bound
 * is testable without faking time.
 */

import type { IslandMessageClass } from './message';

/**
 * Minimum milliseconds between two SENT messages of each class.
 *
 * Per class rather than shared: a cooldown on emotes should not stop you
 * answering a question, and the classes have genuinely different abuse shapes.
 */
export const SEND_COOLDOWN_MS: Readonly<Record<IslandMessageClass, number>> = Object.freeze({
  /** Unchanged from the deployed value, so Standard free-text chat is untouched. */
  text: 500,
  quick: 1000,
  template: 1000,
  emote: 1000,
});

/**
 * Minimum milliseconds between two messages RENDERED from the same sender.
 *
 * Sized against the FASTEST send cooldown, not the slowest: free text may be
 * sent every 500 ms, so anything at or above that would throttle a player who is
 * simply typing quickly, a receiver-side limit that punishes well-behaved
 * clients is a bug, not a protection. 400 ms leaves headroom for clock skew and
 * still bounds one sender to ~2.5 messages a second.
 *
 * A rejected message is dropped, never queued: a queue would turn a flood into a
 * delayed flood.
 *
 * Note this is considerably more permissive than what shipped, where a
 * `pubkey:sessionId` dedupe key silently discarded every second message from a
 * sender within 2 s, including two DIFFERENT ones. That was duplicate
 * suppression doing rate limiting by accident, and doing both badly.
 */
export const INBOUND_MIN_INTERVAL_MS = 400;

/**
 * How long a sender's last-seen timestamp is remembered.
 *
 * Bounds the throttle's memory: entries older than this are pruned, so a room
 * that thousands of players pass through does not accumulate an entry each.
 */
const INBOUND_ENTRY_TTL_MS = 30_000;

/** How many senders may be tracked before the oldest entries are dropped early. */
const INBOUND_MAX_TRACKED_SENDERS = 512;

export interface InboundThrottle {
  /**
   * Whether a message from this sender may be rendered now.
   *
   * Calling it RECORDS the decision, so it must be called exactly once per
   * message and only after cheaper checks (parse, location, policy) have passed,
   * otherwise a stream of malformed events would consume a well-behaved
   * sender's budget.
   */
  admit(senderKey: string, now: number): boolean;
  /** Tracked-sender count. For tests and diagnostics. */
  size(): number;
}

/**
 * A per-sender minimum-interval gate with bounded memory.
 *
 * Deliberately not a token bucket: a bucket lets a sender bank silence and spend
 * it as a burst, which is the exact shape of "type nothing for a minute, then
 * put twenty emotes over someone's head".
 */
export function createInboundThrottle(
  minIntervalMs: number = INBOUND_MIN_INTERVAL_MS,
): InboundThrottle {
  const lastSeen = new Map<string, number>();

  const prune = (now: number) => {
    for (const [key, at] of lastSeen) {
      if (now - at > INBOUND_ENTRY_TTL_MS) lastSeen.delete(key);
    }
    // Insertion order is oldest-first for a Map that is only ever set with fresh
    // keys or re-set, so dropping from the front sheds the least recently added.
    while (lastSeen.size > INBOUND_MAX_TRACKED_SENDERS) {
      const oldest = lastSeen.keys().next();
      if (oldest.done) break;
      lastSeen.delete(oldest.value);
    }
  };

  return {
    admit(senderKey: string, now: number): boolean {
      const previous = lastSeen.get(senderKey);
      if (previous !== undefined && now - previous < minIntervalMs) return false;
      // Re-set rather than update so the key moves to the back of the insertion
      // order and the eviction above stays approximately least-recently-used.
      lastSeen.delete(senderKey);
      lastSeen.set(senderKey, now);
      prune(now);
      return true;
    },
    size: () => lastSeen.size,
  };
}
