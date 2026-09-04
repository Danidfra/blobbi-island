/**
 * Event builders for both kinds.
 *
 * Both events for one action are built from ONE immutable snapshot, the same
 * `rev`, the same `updatedAt`, the same `position`: because invariant I2 says
 * they describe the same state, and the only way to guarantee that is to never
 * recompute anything per event.
 *
 * The multi-letter tags (`provider`, `media`, `status`) are denormalized mirrors
 * for readability and tooling. Relays index single-letter tags only, so nothing
 * may ever filter on them; on any disagreement, `content` wins (§4.1).
 */

import {
  CLIENT_TAG,
  COMMAND_TTL_MS,
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  PROTOCOL_TAG,
  SESSION_TTL_MS,
} from './constants';
import type {
  SessionStatus,
  SharedPlaybackCommand,
  SharedPlaybackSessionContent,
  UnsignedSharedEvent,
} from './types';

export interface BuildSessionEventInput {
  /** The `d` tag, a fresh UUIDv4, never reused across sessions. */
  sessionId: string;
  /** The `r` tag, stable across sessions in the same room. */
  room: string;
  /** The `c` tag. Required while active; MAY be dropped on the final event. */
  code: string | null;
  status: SessionStatus;
  content: SharedPlaybackSessionContent;
  /** Host wall clock, milliseconds. */
  nowMs: number;
  /** Defaults to the rolling 4 h TTL; an ended session uses a short one. */
  ttlMs?: number;
}

export function buildSessionEvent({
  sessionId,
  room,
  code,
  status,
  content,
  nowMs,
  ttlMs = SESSION_TTL_MS,
}: BuildSessionEventInput): UnsignedSharedEvent {
  const createdAt = Math.floor(nowMs / 1000);
  const expiration = Math.floor((nowMs + ttlMs) / 1000);

  const tags: string[][] = [
    ['d', sessionId],
    ['r', room],
    ...(code ? [['c', code]] : []),
    ['t', PROTOCOL_TAG],
    ['t', content.media.provider],
    ['provider', content.media.provider],
    ['media', content.media.id],
    ['status', status],
    ['client', CLIENT_TAG],
    [
      'alt',
      status === 'ended'
        ? 'Shared playback session ended'
        : 'Shared playback session in the Blobbi Island theater',
    ],
    ['expiration', String(expiration)],
  ];

  return {
    kind: KIND_SHARED_PLAYBACK_SESSION,
    content: JSON.stringify(content),
    tags,
    created_at: createdAt,
  };
}

export interface BuildCommandEventInput {
  /** `31951:<host-pubkey>:<session-d>`. */
  address: string;
  hostPubkey: string;
  command: SharedPlaybackCommand;
  /** Host wall clock, milliseconds. */
  nowMs: number;
  /** Optional relay hint carried as the `a` tag's third element. */
  relayHint?: string;
}

export function buildCommandEvent({
  address,
  hostPubkey,
  command,
  nowMs,
  relayHint,
}: BuildCommandEventInput): UnsignedSharedEvent {
  const createdAt = Math.floor(nowMs / 1000);
  // 30 s: long enough to survive relay hops and a brief stall, short enough that
  // a replayed command is already invalid on arrival.
  const expiration = Math.floor((nowMs + COMMAND_TTL_MS) / 1000);

  return {
    kind: KIND_SHARED_PLAYBACK_COMMAND,
    content: JSON.stringify(command),
    tags: [
      relayHint ? ['a', address, relayHint] : ['a', address],
      ['p', hostPubkey],
      ['t', PROTOCOL_TAG],
      ['client', CLIENT_TAG],
      ['alt', `Shared playback command: ${command.command}`],
      ['expiration', String(expiration)],
    ],
    created_at: createdAt,
  };
}
