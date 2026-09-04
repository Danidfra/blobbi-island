/**
 * Publishing PRESENCE (kind:31950): the one place where signing and sending
 * are two different failures.
 *
 * Presence is republished on every walk, every location change and every
 * heartbeat. `useNostrPublish` was never built for that: it signs and sends
 * in one opaque step (so a caller cannot tell "the player declined to sign"
 * from "the relay was slow"), it reports a timeout as success, and it logs an
 * error per attempt. When a signer extension refused presence, every walk
 * asked again: an unbounded loop of prompts and console errors that the
 * player could only stop by leaving.
 *
 * This publisher separates the two stages:
 *
 * - **signing**: a throw here is the SIGNER (or the player behind it)
 *   declining. It is surfaced as {@link PresenceSignerRefusedError} so the
 *   presence lifecycle can stop asking. Extensions word their refusals
 *   differently (and some throw plain strings), so the classification is by
 *   STAGE, not by message: nothing that happens inside `signEvent` is a
 *   network problem;
 * - **sending**: a relay timeout stays best-effort (presence is addressable
 *   and re-sent constantly; a lost heartbeat costs nothing), exactly as
 *   before; any other relay error is transient and thrown as-is.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

/** The signer (or the player) declined to sign a presence event. Permanent for the lifecycle. */
export class PresenceSignerRefusedError extends Error {
  constructor(readonly cause?: unknown) {
    super('The signer declined to sign presence');
    this.name = 'PresenceSignerRefusedError';
  }
}

export function isPresenceSignerRefusal(error: unknown): error is PresenceSignerRefusedError {
  return error instanceof PresenceSignerRefusedError;
}

/** The narrow relay surface the publisher needs. */
export interface PresencePublishNostr {
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface CreatePresencePublisherOptions {
  user: Pick<NUser, 'pubkey' | 'signer'>;
  nostr: PresencePublishNostr;
  /** Per-publish relay budget. A timeout is best-effort, not a failure. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** An unsigned event as the presence helpers build it. */
type PresenceTemplate = Record<string, unknown> & {
  kind?: number;
  content?: string;
  tags?: string[][];
  created_at?: number;
};

/**
 * A `publish` for `useIslandPresence`: sign as the player, then send.
 *
 * Adds the `client` tag the generic hook always added, so a presence event
 * published this way is byte-for-byte what it used to be.
 */
export function createPresencePublisher({
  user,
  nostr,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreatePresencePublisherOptions): (event: Record<string, unknown>) => Promise<void> {
  return async (template: PresenceTemplate) => {
    const tags = [...(template.tags ?? [])];
    if (!tags.some(([name]) => name === 'client')) tags.push(['client', 'blobbi']);

    let signed: NostrEvent;
    try {
      signed = await user.signer.signEvent({
        kind: template.kind ?? 31950,
        content: template.content ?? '',
        tags,
        created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      });
    } catch (error) {
      throw new PresenceSignerRefusedError(error);
    }

    try {
      await nostr.event(signed, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      // Silence from the relay is not a failure for presence: the next
      // heartbeat or move republishes the whole state anyway.
      if (name === 'TimeoutError' || name === 'AbortError') return;
      throw error;
    }
  };
}
