/**
 * The host's publication path (§11).
 *
 * ```
 * 1. compute the resulting canonical state (rev, media, state, position, rate)
 * 2. apply it OPTIMISTICALLY to the host's own player      ← caller, via `optimistic`
 * 3. publish 21951  (ephemeral command)  — fire-and-forget
 * 4. publish 31951  (canonical state)    — awaited, retried with backoff
 * 5. commit rev
 * ```
 *
 * Three properties this file exists to guarantee:
 *
 *  - **One snapshot, two events.** The command and the canonical state are built
 *    from the same computed transition, so invariant I2 cannot be violated by a
 *    later recomputation.
 *  - **Reserve → commit → release.** A revision is only *committed* when the
 *    addressable publish is accepted. A failed publish leaves the number free,
 *    so the host never ends up publishing `rev + 2` at a relay still holding
 *    `rev − 1`.
 *  - **Bounded traffic.** Control publishes are coalesced into one per rate
 *    window. That is safe precisely because every command carries an ABSOLUTE
 *    state: superseding a pending publish with a newer one loses nothing a
 *    receiver needed.
 */

import { buildCommandEvent, buildSessionEvent } from './builders';
import {
  CONTROL_RATE_LIMIT_MS,
  ENDED_TTL_MS,
  SESSION_TTL_MS,
} from './constants';
import { sessionAddress } from './address';
import { sharedWatchError, type SharedWatchError } from './errors';
import { createSessionContent, keepaliveContent, transition, type SessionAction } from './session-state';
import type {
  SessionStatus,
  SharedMediaRef,
  SharedPlaybackCommand,
  SharedPlaybackSessionContent,
  UnsignedSharedEvent,
} from './types';

export type PublishFn = (event: UnsignedSharedEvent) => Promise<void>;

export interface SessionPublisherOptions {
  /** Signs and sends. Must reject on failure — a swallowed error is a lie. */
  publish: PublishFn;
  hostPubkey: string;
  sessionId: string;
  room: string;
  code: string;
  relayHint?: string;
  now?: () => number;
  /** Minimum gap between control publishes. */
  rateLimitMs?: number;
  /** Attempts for the addressable publish, including the first. */
  retries?: number;
  retryDelayMs?: number;
  delay?: (ms: number) => Promise<void>;
  /** Canonical state was accepted by a relay. */
  onCommit?: (content: SharedPlaybackSessionContent, status: SessionStatus) => void;
  /**
   * A control publish failed permanently. The argument is the state that is
   * still canonical, so the caller can put its optimistically-moved player back.
   */
  onRollback?: (content: SharedPlaybackSessionContent | null) => void;
  onError?: (error: SharedWatchError) => void;
  /** Every event actually handed to `publish`. Diagnostics and tests. */
  onPublished?: (event: UnsignedSharedEvent) => void;
}

interface PendingTransition {
  content: SharedPlaybackSessionContent;
  command: SharedPlaybackCommand;
  status: SessionStatus;
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SessionPublisher {
  readonly address: string;
  readonly hostPubkey: string;
  readonly sessionId: string;

  private opts: Required<
    Pick<SessionPublisherOptions, 'now' | 'rateLimitMs' | 'retries' | 'retryDelayMs' | 'delay'>
  > &
    SessionPublisherOptions;

  /** The last state a relay accepted. The only thing `rev` is counted from. */
  private committedContent: SharedPlaybackSessionContent | null = null;
  private committedStatus: SessionStatus = 'active';
  /** The newest intent, waiting for the rate window. */
  private pending: PendingTransition | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastControlPublishAt = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(options: SessionPublisherOptions) {
    this.opts = {
      now: Date.now,
      rateLimitMs: CONTROL_RATE_LIMIT_MS,
      retries: 3,
      retryDelayMs: 2000,
      delay: defaultDelay,
      ...options,
    };
    this.hostPubkey = options.hostPubkey;
    this.sessionId = options.sessionId;
    this.address = sessionAddress(options.hostPubkey, options.sessionId);
  }

  get content(): SharedPlaybackSessionContent | null {
    return this.committedContent;
  }

  get status(): SessionStatus {
    return this.committedStatus;
  }

  /** The state the host's own player should be showing, pending publish or not. */
  get intended(): SharedPlaybackSessionContent | null {
    return this.pending?.content ?? this.committedContent;
  }

  /**
   * Adopt a session that already exists on a relay, instead of creating one.
   *
   * Used when a host resumes its OWN session after the UI was remounted: the
   * canonical event read back from the relay becomes the committed state, so the
   * next action publishes `rev + 1` against the revision the relay actually
   * holds rather than restarting the count and colliding with itself.
   */
  adopt(content: SharedPlaybackSessionContent, status: SessionStatus): void {
    this.committedContent = content;
    this.committedStatus = status;
  }

  /**
   * Publish `rev 0`: paused, at zero.
   *
   * Awaited and retried — until this lands there is no session, so there is
   * nothing to be optimistic about.
   */
  async create(media: SharedMediaRef): Promise<SharedPlaybackSessionContent | null> {
    const content = createSessionContent(media, this.opts.now());
    const published = await this.publishCanonical(content, 'active');
    if (!published) return null;
    this.committedContent = content;
    this.committedStatus = 'active';
    this.opts.onCommit?.(content, 'active');
    return content;
  }

  /**
   * Register a host action.
   *
   * `optimistic` receives the resulting state BEFORE anything is published and
   * may veto it by returning `false` — the host's player refusing to start is
   * the autoplay case, and publishing "playing" for a player that is not playing
   * would desynchronize every guest to a state that does not exist.
   */
  commit(
    action: SessionAction,
    optimistic?: (content: SharedPlaybackSessionContent) => boolean | void,
  ): SharedPlaybackSessionContent | null {
    if (this.disposed || !this.committedContent) return null;
    if (this.committedStatus === 'ended') return null;

    // Successive actions inside one rate window build on each other, but the
    // revision is always exactly one past what a relay has accepted: coalescing
    // must not create gaps, and a failed publish must not consume a number.
    const base = this.pending?.content ?? this.committedContent;
    const next = transition(base, action, this.opts.now());
    const rev = this.committedContent.rev + 1;
    const staged: PendingTransition = {
      status: next.status,
      content: { ...next.content, rev },
      command: { ...next.command, rev },
    };

    if (optimistic?.(staged.content) === false) return null;

    this.pending = staged;
    this.scheduleFlush();
    return staged.content;
  }

  /** End the session: awaited, flushed immediately, short expiration. */
  async end(position: number): Promise<boolean> {
    if (!this.committedContent || this.committedStatus === 'ended') return false;
    this.cancelFlush();
    this.pending = null;

    const next = transition(this.committedContent, { type: 'end', position }, this.opts.now());
    const rev = this.committedContent.rev + 1;
    const content = { ...next.content, rev };
    const command = { ...next.command, rev };

    this.publishCommand(command);
    // Retried hard: an un-ended session lingers until its expiration, and the
    // ephemeral command alone is not durable.
    const published = await this.publishCanonical(content, 'ended', ENDED_TTL_MS);
    if (published) {
      this.committedContent = content;
      this.committedStatus = 'ended';
      this.opts.onCommit?.(content, 'ended');
    }
    return published;
  }

  /**
   * The 20 s keepalive: same revision, refreshed anchor and expiration.
   *
   * `live` is the host player's ACTUAL position. Given it, the anchor is
   * re-stated from the player rather than extrapolated from the previous anchor
   * — the difference matters the moment the host's playback stalls, buffers or
   * is nudged outside our controls: extrapolation would keep publishing a
   * timeline the host is no longer on, and every guest would follow the fiction
   * instead of the host. Without it (no player, not ready), the arithmetic
   * re-anchor is still correct and is used.
   *
   * Skipped while a control publish is pending — that publish supersedes it and
   * carries a fresher expiration anyway.
   */
  async keepalive(live?: { position: number }): Promise<void> {
    if (this.disposed || !this.committedContent) return;
    if (this.committedStatus === 'ended' || this.pending) return;

    const content = keepaliveContent(this.committedContent, this.opts.now(), live);
    const published = await this.publishCanonical(content, 'active');
    if (published) {
      this.committedContent = content;
      this.opts.onCommit?.(content, 'active');
    }
  }

  /** Publish any pending control action now, ignoring the rate window. */
  async flush(): Promise<void> {
    this.cancelFlush();
    if (this.inFlight) await this.inFlight;
    if (!this.pending) return;
    const publish = this.publishPending();
    this.inFlight = publish;
    try {
      await publish;
    } finally {
      if (this.inFlight === publish) this.inFlight = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelFlush();
    this.pending = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    const elapsed = this.opts.now() - this.lastControlPublishAt;
    const wait = Math.max(0, this.opts.rateLimitMs - elapsed);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, wait);
  }

  private cancelFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async publishPending(): Promise<void> {
    const staged = this.pending;
    if (!staged) return;
    this.pending = null;
    this.lastControlPublishAt = this.opts.now();

    // Ephemeral first: it is the latency path and one small write. Waiting for
    // the addressable publish would add a round trip to every guest's reaction.
    this.publishCommand(staged.command);

    const published = await this.publishCanonical(staged.content, staged.status);
    if (published) {
      this.committedContent = staged.content;
      this.committedStatus = staged.status;
      this.opts.onCommit?.(staged.content, staged.status);
      return;
    }

    // Permanent failure: the revision is released (never committed), so the next
    // action reuses the number, and the caller is told to put its player back.
    this.opts.onError?.(sharedWatchError('publish-failed', 'canonical state'));
    this.opts.onRollback?.(this.committedContent);
  }

  /** Fire-and-forget. A dropped command is corrected by the canonical event. */
  private publishCommand(command: SharedPlaybackCommand): void {
    const event = buildCommandEvent({
      address: this.address,
      hostPubkey: this.hostPubkey,
      command,
      nowMs: this.opts.now(),
      relayHint: this.opts.relayHint,
    });
    this.opts.onPublished?.(event);
    // No corrective action on failure by design (§11.3): guests receive the same
    // change through their canonical subscription, just at normal latency.
    void this.opts.publish(event).catch(() => undefined);
  }

  private async publishCanonical(
    content: SharedPlaybackSessionContent,
    status: SessionStatus,
    ttlMs: number = SESSION_TTL_MS,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < this.opts.retries; attempt += 1) {
      if (this.disposed && attempt > 0) return false;
      // Rebuilt each attempt so `expiration` stays fresh; the CONTENT — rev,
      // position, updatedAt — is byte-identical, which is what makes the retry
      // idempotent against an addressable replacement.
      const event = buildSessionEvent({
        sessionId: this.sessionId,
        room: this.opts.room,
        code: this.opts.code,
        status,
        content,
        nowMs: this.opts.now(),
        ttlMs,
      });
      this.opts.onPublished?.(event);
      try {
        await this.opts.publish(event);
        return true;
      } catch {
        if (attempt < this.opts.retries - 1) await this.opts.delay(this.opts.retryDelayMs);
      }
    }
    return false;
  }
}
