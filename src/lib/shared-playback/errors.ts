/**
 * The shared-playback error model.
 *
 * "The theater is broken" is never an acceptable answer, because the things that
 * go wrong here are wildly different problems with wildly different remedies:
 * a mistyped code, a session that ended twenty minutes ago, a video the guest's
 * country cannot play, a relay that dropped the connection. Collapsing them
 * sends the user off to fix the wrong thing.
 *
 * Two properties every error here carries:
 *
 *  - **`fatal`**: whether the SESSION is over. Almost nothing is: a publish
 *    failure is retried, a subscription drop reconnects, and a video the local
 *    player cannot show is a local problem while the session continues for
 *    everyone else.
 *  - **`keepsPlayer`**: whether the local player survives. A Nostr problem must
 *    never destroy a working YouTube embed; the user can always leave the
 *    session and keep watching locally.
 */

import type { RejectionReason } from './types';

export type SharedWatchErrorCode =
  /** The typed code cannot be a code at all (length, alphabet). */
  | 'invalid-invitation'
  /** Well-formed, but no live session answers to it. */
  | 'session-not-found'
  /** More than one session answers to it; joining would be a guess. */
  | 'session-ambiguous'
  /** The session exists and is over. */
  | 'session-closed'
  /** An event tried to steer a session it has no authority over. */
  | 'unauthorized-command'
  /** The provider will not play this media on this device. */
  | 'media-unavailable'
  /** The local player could not be constructed at all. */
  | 'player-failed'
  /** A relay refused, or never acknowledged, a publish. */
  | 'publish-failed'
  /** The subscription could not be established or was lost. */
  | 'subscribe-failed'
  /** Temporarily out of touch; recovery is in progress. */
  | 'reconnecting'
  /** No canonical update for longer than the host-away window. */
  | 'host-unavailable'
  /** The session speaks a schema version this client does not implement. */
  | 'unsupported-version'
  /** Structurally invalid event from the host. */
  | 'malformed-event'
  /** Sessions need a signer; local playback does not. */
  | 'not-signed-in';

export interface SharedWatchError {
  code: SharedWatchErrorCode;
  /** Shown to a person. Honest about what is and is not known. */
  message: string;
  /** The session cannot continue. */
  fatal: boolean;
  /** The local player is unaffected and playback can continue. */
  keepsPlayer: boolean;
  /** Free-form context for debug logs. Never rendered. */
  detail?: string;
}

const CATALOG: Record<SharedWatchErrorCode, Omit<SharedWatchError, 'code' | 'detail'>> = {
  'invalid-invitation': {
    message: 'That code does not look right. Codes are 6 characters, like B7X4QP.',
    fatal: false,
    keepsPlayer: true,
  },
  'session-not-found': {
    message: 'No active watch session with that code.',
    fatal: false,
    keepsPlayer: true,
  },
  'session-ambiguous': {
    message: 'That code matches more than one session right now. Ask the host to start a new one.',
    fatal: false,
    keepsPlayer: true,
  },
  'session-closed': {
    message: 'The host ended this watch session.',
    fatal: true,
    keepsPlayer: true,
  },
  'unauthorized-command': {
    message: 'Ignored a playback command that was not signed by the host.',
    fatal: false,
    keepsPlayer: true,
  },
  'media-unavailable': {
    message: 'This video cannot be played here. The session continues without it on your screen.',
    fatal: false,
    keepsPlayer: true,
  },
  'player-failed': {
    message: "Couldn't start the video player.",
    fatal: false,
    keepsPlayer: false,
  },
  'publish-failed': {
    message: 'Not synced: retrying.',
    fatal: false,
    keepsPlayer: true,
  },
  'subscribe-failed': {
    message: "Lost the connection to the session. Reconnecting…",
    fatal: false,
    keepsPlayer: true,
  },
  reconnecting: {
    message: 'Reconnecting…',
    fatal: false,
    keepsPlayer: true,
  },
  'host-unavailable': {
    message: 'The host may have disconnected. Playback continues.',
    fatal: false,
    keepsPlayer: true,
  },
  'unsupported-version': {
    message: 'This session uses a newer version of Blobbi Island. Time to update.',
    fatal: true,
    keepsPlayer: true,
  },
  'malformed-event': {
    message: 'Ignored an unreadable session update.',
    fatal: false,
    keepsPlayer: true,
  },
  'not-signed-in': {
    message: 'Log in to start or join a watch session.',
    fatal: false,
    keepsPlayer: true,
  },
};

export function sharedWatchError(code: SharedWatchErrorCode, detail?: string): SharedWatchError {
  return { code, ...CATALOG[code], ...(detail ? { detail } : {}) };
}

/**
 * Map a parser rejection onto the user-facing model.
 *
 * Most rejections are silent-by-design: on an open relay, junk under a custom
 * kind is background noise, not something to interrupt anyone about. Only the
 * two that mean something to a person, "this client is too old" and "someone
 * tried to command a session they do not own": get promoted.
 */
export function errorForRejection(reason: RejectionReason): SharedWatchError | null {
  switch (reason) {
    case 'unsupported-version':
      return sharedWatchError('unsupported-version', reason);
    case 'unauthorized-signer':
      return sharedWatchError('unauthorized-command', reason);
    case 'unsupported-media':
      return sharedWatchError('media-unavailable', reason);
    default:
      return null;
  }
}
