/**
 * Shared Playback Session, wire types.
 *
 * These are the shapes that travel on relays. They are deliberately separate
 * from the theater's local `PlaybackState` (`src/lib/theater-playback.ts`): the
 * local one is what a player is doing, this one is what a *session* says. The
 * two are mapped explicitly at the controller seam, never assumed identical.
 *
 * Nothing in `src/lib/shared-playback/**` may import React, the DOM, the seat
 * system, presence, chat or rendering; see the protocol document §14.3. That
 * rule is enforced by `decoupling.test.ts`, not by good intentions.
 */

/** Every provider this protocol version understands. */
export type MediaProvider = 'youtube';

export interface SharedMediaRef {
  provider: MediaProvider;
  id: string;
}

/** Playback intent. `playing` means "the timeline is advancing". */
export type SharedPlaybackStatus = 'playing' | 'paused';

/** Session lifecycle. Only ever moves `active → ended`. */
export type SessionStatus = 'active' | 'ended';

/** The canonical state carried by a kind 31951 event's content. */
export interface SharedPlaybackSessionContent {
  version: 1;
  /** Monotonic per canonical action. `0` is the creation revision. */
  rev: number;
  media: SharedMediaRef;
  playback: {
    state: SharedPlaybackStatus;
    /** Seconds, at the instant `updatedAt` was sampled. */
    position: number;
    /** Host wall clock, unix MILLISECONDS (deliberately not `created_at`). */
    updatedAt: number;
    rate: number;
  };
  permissions: {
    /** v1 accepts this value and no other. */
    mode: 'host-only';
  };
}

/** Everything a client knows about one session, tags included. */
export interface SharedPlaybackSession {
  /** `31951:<host-pubkey>:<d>`: the only identifier other systems may hold. */
  address: string;
  hostPubkey: string;
  /** The `d` tag: a fresh UUIDv4 per session, never reused. */
  sessionId: string;
  /** The `r` tag: stable across sessions in the same room. */
  room: string;
  /** The `c` tag: the 6-character invitation code, absent on some end events. */
  code: string | null;
  status: SessionStatus;
  /** NIP-40 expiration, unix seconds. */
  expiration: number;
  /** The event's `created_at`, unix seconds. Coarse tie-breaker only (§7). */
  createdAt: number;
  /** The event id, the final tie-breaker (§7). */
  eventId: string;
  content: SharedPlaybackSessionContent;
}

/** Presentation-only metadata on a seek. No client behavior may depend on it. */
export type SharedSeekReason = 'direct' | 'skip-forward' | 'skip-backward' | 'restart';

/**
 * The kind 21951 content union.
 *
 * Every variant carries an ABSOLUTE resulting position; never a delta. A
 * relative command is only correct for a client that received every previous
 * command, which is exactly the assumption a lossy ephemeral channel breaks.
 */
export type SharedPlaybackCommand =
  | { version: 1; command: 'play'; rev: number; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'pause'; rev: number; position: number; updatedAt: number; rate: number }
  | {
      version: 1;
      command: 'seek';
      rev: number;
      position: number;
      updatedAt: number;
      rate: number;
      reason?: SharedSeekReason;
    }
  | {
      version: 1;
      command: 'set-media';
      rev: number;
      media: SharedMediaRef;
      state: SharedPlaybackStatus;
      position: number;
      updatedAt: number;
      rate: number;
    }
  | { version: 1; command: 'set-rate'; rev: number; position: number; updatedAt: number; rate: number }
  | { version: 1; command: 'end-session'; rev: number; position: number; updatedAt: number };

export type SharedPlaybackCommandType = SharedPlaybackCommand['command'];

/** An unsigned event, ready for a signer. */
export interface UnsignedSharedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

/**
 * Why an event was refused.
 *
 * Rejections are values rather than exceptions because every one of them is a
 * NORMAL occurrence on an open relay: anyone may publish anything under these
 * kind numbers. The reason is kept so the UI can distinguish "that code is not a
 * session" from "that session ended", and so debug logs say something useful.
 */
export type RejectionReason =
  | 'wrong-kind'
  | 'missing-tag'
  | 'expired'
  | 'malformed-content'
  | 'unsupported-version'
  | 'unsupported-permissions'
  | 'bad-revision'
  | 'bad-position'
  | 'bad-rate'
  | 'clock-inconsistent'
  | 'unsupported-media'
  | 'wrong-session'
  | 'unauthorized-signer'
  | 'session-ended'
  | 'unknown-command';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: RejectionReason };

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function fail<T>(reason: RejectionReason): ParseResult<T> {
  return { ok: false, reason };
}
