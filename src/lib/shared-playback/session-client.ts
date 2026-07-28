/**
 * The client-side session state machine.
 *
 * Everything a participant knows about the session it is in, and every rule for
 * changing it, with no React, no relay and no player anywhere near it. The hook
 * above this file does I/O; this file decides what an arriving event MEANS.
 *
 * The three questions it answers, which are the ones that go wrong in a
 * synchronized player:
 *
 *  1. **Is this event mine to believe?** Right session address, right host
 *     pubkey — checked again here even though the parser checked, because the
 *     parser validates one event while this validates it against the session
 *     this client actually joined.
 *  2. **Is it newer than what I have?** `rev` first, then `created_at`, then
 *     event id (§7). A late `21951` cannot rewind a player, and an old `31951`
 *     cannot overwrite a newer one.
 *  3. **Does the player need to move?** Distinguishing "the state changed" from
 *     "the host said the same thing again" is what stops a 20 s keepalive from
 *     causing a corrective seek every 20 s.
 */

import { isNewerCanonical, isStaleRevision, type RevisionOrder } from './ordering';
import { applyCommandToContent } from './session-state';
import {
  driftAction,
  estimateClockOffset,
  expectedPosition,
  pushClockSample,
  type DriftAction,
} from './timing';
import type {
  SharedPlaybackCommand,
  SharedPlaybackSession,
  SharedPlaybackSessionContent,
} from './types';

/** `-1` means "nothing has been applied yet", so `rev: 0` is still newer. */
export const NO_REVISION = -1;

export type SessionRole = 'host' | 'guest';

export interface SessionClientState {
  /** `31951:<host>:<d>` — fixed for the lifetime of this client state. */
  address: string;
  hostPubkey: string;
  role: SessionRole;
  /** The last accepted canonical record, tags included. */
  session: SharedPlaybackSession | null;
  /** The last accepted canonical content, possibly advanced by a command. */
  content: SharedPlaybackSessionContent | null;
  /** Ordering key of the canonical event currently held. */
  canonicalOrder: RevisionOrder | null;
  /** Highest revision actually applied to the player. */
  lastAppliedRev: number;
  /** Local clock (ms) when the last canonical event was accepted. */
  lastCanonicalAtMs: number;
  /** Rolling `receivedAt − updatedAt` samples, newest last, max 8. */
  clockSamples: number[];
  /** Median of the above, clamped. Zero until the first sample. */
  clockOffsetMs: number;
  /** Terminal: the host ended the session. */
  ended: boolean;
}

export function createSessionClient(input: {
  address: string;
  hostPubkey: string;
  role: SessionRole;
}): SessionClientState {
  return {
    address: input.address,
    hostPubkey: input.hostPubkey,
    role: input.role,
    session: null,
    content: null,
    canonicalOrder: null,
    lastAppliedRev: NO_REVISION,
    lastCanonicalAtMs: 0,
    clockSamples: [],
    clockOffsetMs: 0,
    ended: false,
  };
}

/** Why an event changed nothing. Kept for debug logs and honest UI. */
export type IngestRejection = 'stale' | 'ended' | 'wrong-session' | 'wrong-host' | 'not-ready';

export interface IngestResult {
  state: SessionClientState;
  /** The player should be reconciled to the new canonical state. */
  changed: boolean;
  /** The media identity changed: a different video has to be loaded. */
  mediaChanged: boolean;
  /** The session reached its terminal state on this event. */
  ended: boolean;
  /** Present exactly when nothing was applied. */
  ignored?: IngestRejection;
}

function unchanged(state: SessionClientState, ignored: IngestRejection): IngestResult {
  return { state, changed: false, mediaChanged: false, ended: false, ignored };
}

/**
 * Accept (or refuse) a canonical `31951`.
 *
 * A keepalive — same `rev`, refreshed anchor — is adopted as the record but
 * reports `changed: false`: the state was already applied, and the fresher
 * anchor simply makes the next passive drift check more accurate.
 */
export function ingestCanonical(
  state: SessionClientState,
  session: SharedPlaybackSession,
  receivedAtMs: number,
): IngestResult {
  if (session.address !== state.address) return unchanged(state, 'wrong-session');
  if (session.hostPubkey !== state.hostPubkey) return unchanged(state, 'wrong-host');

  const incoming: RevisionOrder = {
    rev: session.content.rev,
    createdAt: session.createdAt,
    eventId: session.eventId,
  };
  if (!isNewerCanonical(state.canonicalOrder, incoming)) return unchanged(state, 'stale');

  // Every accepted event from the host is a free clock sample — including
  // keepalives, which is what keeps the estimate fresh through a long pause.
  const clockSamples = pushClockSample(state.clockSamples, receivedAtMs - session.content.playback.updatedAt);

  const applies = !isStaleRevision(state.lastAppliedRev, session.content.rev);
  const mediaChanged = state.content?.media.id !== session.content.media.id;
  const ended = session.status === 'ended';

  const next: SessionClientState = {
    ...state,
    session,
    content: session.content,
    canonicalOrder: incoming,
    lastAppliedRev: applies ? session.content.rev : state.lastAppliedRev,
    lastCanonicalAtMs: receivedAtMs,
    clockSamples,
    clockOffsetMs: estimateClockOffset(clockSamples),
    ended: state.ended || ended,
  };

  return {
    state: next,
    // An ended session is applied once — the final position — and then nothing
    // more is ever synchronized for it.
    changed: applies,
    mediaChanged: applies && Boolean(mediaChanged),
    ended,
  };
}

/**
 * Accept (or refuse) an ephemeral `21951`.
 *
 * This is the low-latency path: it is applied immediately and reconciled later
 * against the matching canonical event, which by I2 says the same thing and is
 * therefore a no-op when it lands.
 */
export function ingestCommand(
  state: SessionClientState,
  command: SharedPlaybackCommand,
  receivedAtMs: number,
): IngestResult {
  if (state.ended) return unchanged(state, 'ended');
  // A command is a state DELTA against canonical content. Without that content
  // there is nothing to fold it into, and the canonical query already in flight
  // will deliver the whole truth in a moment.
  if (!state.content) return unchanged(state, 'not-ready');
  if (isStaleRevision(state.lastAppliedRev, command.rev)) return unchanged(state, 'stale');

  const content = applyCommandToContent(state.content, command);
  const clockSamples = pushClockSample(state.clockSamples, receivedAtMs - command.updatedAt);
  const mediaChanged = state.content.media.id !== content.media.id;
  const ended = command.command === 'end-session';

  return {
    state: {
      ...state,
      content,
      lastAppliedRev: command.rev,
      clockSamples,
      clockOffsetMs: estimateClockOffset(clockSamples),
      ended: state.ended || ended,
    },
    changed: true,
    mediaChanged,
    ended,
  };
}

/** Where this client's playhead should be at `nowMs`, or `null` with no state. */
export function expectedNow(
  state: SessionClientState,
  nowMs: number,
  duration = 0,
): number | null {
  if (!state.content) return null;
  return expectedPosition(state.content.playback, nowMs, state.clockOffsetMs, duration);
}

/**
 * The passive drift decision (§8.3). Reads; never publishes; never seeks.
 *
 * Correction is suspended — `'ignore'` — whenever the player cannot answer
 * honestly (buffering, not ready) or cannot comply (an unmatchable rate). A
 * client that corrects against a meaningless `getCurrentTime()` produces a
 * seek→buffer→drift→seek loop, which is worse than being two seconds late.
 */
export function evaluateDrift(
  state: SessionClientState,
  input: {
    playerPosition: number;
    nowMs: number;
    duration?: number;
    playerReady: boolean;
    buffering: boolean;
    rateMatched: boolean;
    /** Local ms since the last corrective seek, for the settle window. */
    msSinceLastSeek: number;
    settleMs: number;
  },
): { action: DriftAction; drift: number; target: number | null } {
  const target = expectedNow(state, input.nowMs, input.duration);
  if (target === null || state.ended) return { action: 'ignore', drift: 0, target: null };
  if (!input.playerReady || input.buffering || !input.rateMatched) {
    return { action: 'ignore', drift: 0, target };
  }
  if (input.msSinceLastSeek < input.settleMs) return { action: 'ignore', drift: 0, target };

  const drift = input.playerPosition - target;
  return { action: driftAction(drift), drift, target };
}
