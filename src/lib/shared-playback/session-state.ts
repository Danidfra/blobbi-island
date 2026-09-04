/**
 * Canonical state transitions.
 *
 * One function per side of the contract:
 *
 *  - {@link transition}, the HOST's: an intent plus the current canonical state
 *    produce ONE snapshot, from which both the ephemeral command and the
 *    addressable state are built. Invariant I2 (both events describe the same
 *    state) holds because there is only ever one computation.
 *  - {@link applyCommandToContent}, the GUEST's: a validated command folds into
 *    the canonical state it holds, so a client that only ever sees commands
 *    still ends up with the same content the host published.
 *
 * Nothing here touches a player, a relay or a clock: `nowMs` is passed in.
 */

import { CONTENT_VERSION, MAX_POSITION_S, MAX_RATE, MIN_RATE } from './constants';
import { expectedPosition } from './timing';
import type {
  SharedMediaRef,
  SharedPlaybackCommand,
  SharedPlaybackSessionContent,
  SharedPlaybackStatus,
  SharedSeekReason,
} from './types';

/** Keep every position the protocol emits inside the bounds receivers enforce. */
function boundPosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(MAX_POSITION_S, Math.max(0, position));
}

function boundRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/**
 * A brand-new session: paused, at zero, `rev: 0`.
 *
 * Deliberate (§12.2): it guarantees the first thing every participant does is a
 * gesture-driven play, which sidesteps autoplay blocking for the host and makes
 * the first `play` a clean `rev: 1` transition.
 */
export function createSessionContent(media: SharedMediaRef, nowMs: number): SharedPlaybackSessionContent {
  return {
    version: CONTENT_VERSION,
    rev: 0,
    media,
    playback: { state: 'paused', position: 0, updatedAt: nowMs, rate: 1 },
    permissions: { mode: 'host-only' },
  };
}

/** A host intent, before it becomes a revision. */
export type SessionAction =
  | { type: 'play'; position: number }
  | { type: 'pause'; position: number }
  | { type: 'seek'; position: number; reason?: SharedSeekReason }
  | { type: 'set-media'; media: SharedMediaRef; state?: SharedPlaybackStatus }
  | { type: 'set-rate'; rate: number; position: number }
  | { type: 'end'; position: number };

export interface SessionTransition {
  content: SharedPlaybackSessionContent;
  command: SharedPlaybackCommand;
  /** `ended` only for the terminal transition. */
  status: 'active' | 'ended';
}

/**
 * Compute the next canonical state and its matching command.
 *
 * `rev` is `current.rev + 1` for every action; it is *reserved* here and only
 * *committed* when the addressable publish is accepted (§11.2). A caller that
 * abandons the action (signing declined, the player refused) must drop this
 * whole object, not half-apply it.
 */
export function transition(
  current: SharedPlaybackSessionContent,
  action: SessionAction,
  nowMs: number,
): SessionTransition {
  const rev = current.rev + 1;
  const updatedAt = nowMs;
  const rate = current.playback.rate;

  switch (action.type) {
    case 'play': {
      const position = boundPosition(action.position);
      return {
        status: 'active',
        content: { ...current, rev, playback: { state: 'playing', position, updatedAt, rate } },
        command: { version: CONTENT_VERSION, command: 'play', rev, position, updatedAt, rate },
      };
    }

    case 'pause': {
      const position = boundPosition(action.position);
      return {
        status: 'active',
        content: { ...current, rev, playback: { state: 'paused', position, updatedAt, rate } },
        command: { version: CONTENT_VERSION, command: 'pause', rev, position, updatedAt, rate },
      };
    }

    case 'seek': {
      // A seek never changes play/pause, "jump there and carry on doing what we
      // were doing" is what every seek control in the UI means.
      const position = boundPosition(action.position);
      return {
        status: 'active',
        content: { ...current, rev, playback: { ...current.playback, position, updatedAt } },
        command: {
          version: CONTENT_VERSION,
          command: 'seek',
          rev,
          position,
          updatedAt,
          rate,
          ...(action.reason ? { reason: action.reason } : {}),
        },
      };
    }

    case 'set-media': {
      // Play/pause intent is PRESERVED across a media change (§10 #7): a session
      // that was playing keeps playing, from the top of the new video.
      const state = action.state ?? current.playback.state;
      return {
        status: 'active',
        content: {
          ...current,
          rev,
          media: action.media,
          playback: { state, position: 0, updatedAt, rate },
        },
        command: {
          version: CONTENT_VERSION,
          command: 'set-media',
          rev,
          media: action.media,
          state,
          position: 0,
          updatedAt,
          rate,
        },
      };
    }

    case 'set-rate': {
      const nextRate = boundRate(action.rate);
      const position = boundPosition(action.position);
      return {
        status: 'active',
        content: {
          ...current,
          rev,
          playback: { ...current.playback, position, updatedAt, rate: nextRate },
        },
        command: {
          version: CONTENT_VERSION,
          command: 'set-rate',
          rev,
          position,
          updatedAt,
          rate: nextRate,
        },
      };
    }

    case 'end': {
      const position = boundPosition(action.position);
      return {
        status: 'ended',
        content: { ...current, rev, playback: { state: 'paused', position, updatedAt, rate } },
        command: { version: CONTENT_VERSION, command: 'end-session', rev, position, updatedAt },
      };
    }
  }
}

/**
 * Fold a validated command into canonical state (the guest's side of I2).
 *
 * The result is what the host's matching `31951` says, so when that event
 * arrives it is a genuine no-op rather than a second correction.
 */
export function applyCommandToContent(
  current: SharedPlaybackSessionContent,
  command: SharedPlaybackCommand,
): SharedPlaybackSessionContent {
  const { rev, position, updatedAt } = command;

  switch (command.command) {
    case 'play':
      return { ...current, rev, playback: { state: 'playing', position, updatedAt, rate: command.rate } };
    case 'pause':
    case 'end-session':
      return {
        ...current,
        rev,
        playback: {
          state: 'paused',
          position,
          updatedAt,
          rate: command.command === 'pause' ? command.rate : current.playback.rate,
        },
      };
    case 'seek':
      return {
        ...current,
        rev,
        playback: { ...current.playback, position, updatedAt, rate: command.rate },
      };
    case 'set-media':
      return {
        ...current,
        rev,
        media: command.media,
        playback: { state: command.state, position, updatedAt, rate: command.rate },
      };
    case 'set-rate':
      return {
        ...current,
        rev,
        playback: { ...current.playback, position, updatedAt, rate: command.rate },
      };
  }
}

/**
 * The 20 s keepalive's content: the SAME revision, re-anchored to now.
 *
 * Why re-anchor instead of republishing the byte-identical event: receivers
 * enforce `|updatedAt − created_at × 1000| ≤ 5 min` (§4.4 (10)), so a frozen
 * `updatedAt` would make the host's own keepalives *invalid* to every receiver
 * after five minutes, precisely during the long pauses the keepalive exists to
 * survive. Re-anchoring also keeps the passive clock-offset samples meaningful
 * (§8.2), which the same frozen timestamp would poison.
 *
 * It is not a state change: `rev`, media, play/pause and rate are untouched, and
 * for a playing session the position is moved to exactly where the previous
 * anchor already says the playhead is. Guests hold `rev`, so they treat it as
 * the no-op it is (§7); only a late joiner or a reconnecting client reads it,
 * and they get a fresher, more accurate anchor for it.
 */
export function keepaliveContent(
  current: SharedPlaybackSessionContent,
  nowMs: number,
  /**
   * Where the host's player actually is, when that is knowable.
   *
   * Preferred over extrapolation for a PLAYING session: the canonical position
   * is defined as a sample of the host's player (§8.1), so the player is the
   * authority on it. Extrapolating instead means that the moment the host
   * stalls, buffers, or is nudged by the provider's own controls, the session
   * keeps publishing a timeline the host is not on, and guests follow that
   * instead of the host.
   */
  live?: { position: number },
): SharedPlaybackSessionContent {
  if (current.playback.state === 'paused') {
    // Time-independent, and only host ACTIONS may move a paused playhead, a
    // stalled or re-buffering player must not be able to rewrite it.
    return { ...current, playback: { ...current.playback, updatedAt: nowMs } };
  }
  const measured = live && Number.isFinite(live.position) ? live.position : null;
  const position = boundPosition(measured ?? expectedPosition(current.playback, nowMs));
  return { ...current, playback: { ...current.playback, position, updatedAt: nowMs } };
}
