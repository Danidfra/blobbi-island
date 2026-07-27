/**
 * The theater's local state machine.
 *
 * Everything the room shows — whether the control card exists, whether the
 * yellow curtain is up, whether a player is mounted at all — is derived from ONE
 * value here. That is the point: the previous version scattered the same
 * information across `sittingIn`, `hasMedia`, `changingVideo`, `fatalError`,
 * `snapshot.error` and `snapshot.phase`, and those booleans could (and did)
 * describe states that cannot exist — a player error while nobody is sitting
 * down, an open curtain with nothing loaded, a "Load Video" button wired to a
 * controller that was never built.
 *
 * The transitions, in full:
 *
 * ```
 *                    ┌──────────────┐
 *                    │  not-seated  │◄──────── stand / leave, from anywhere
 *                    └──────┬───────┘
 *                       sit │
 *                    ┌──────▼───────┐
 *          ┌────────►│ seated-idle  │  URL input, curtain CLOSED
 *          │         └──────┬───────┘
 *          │          submit│ (valid id only)
 *          │         ┌──────▼───────┐
 *  change- │         │ loading-video│  spinner, curtain STILL CLOSED
 *  video   │         └──┬────────┬──┘
 *          │    ready   │        │  error
 *          │         ┌──▼─────┐ ┌▼─────────────┐
 *          ├─────────┤ video- │ │ video-error  │  friendly copy + input,
 *          │         │ ready  │ │              │  curtain CLOSED
 *          │         └────────┘ └──────┬───────┘
 *          └───────────────────────────┘
 * ```
 *
 * Two rules the room depends on:
 *
 *  - **The curtain rises on `video-ready` and on nothing else.** Not on mount,
 *    not on hover, not because an iframe appeared. And once up it stays up:
 *    there is no transition out of `video-ready` that is not an explicit user
 *    action (change video, stand up, leave) or a real playback failure.
 *  - **A player exists only while `request` is set.** No seat, no player; no
 *    chosen video, no player. An idle theater cannot produce a player error
 *    because it has no player.
 */

import type { MediaRef } from '@/lib/theater-playback';
import type { MediaError } from '@/lib/youtube-player';

export type TheaterLocalStatus =
  | 'not-seated'
  | 'seated-idle'
  | 'loading-video'
  | 'video-ready'
  | 'video-error';

/** What the user asked to watch. The only thing that mounts a player. */
export interface TheaterMediaRequest {
  media: MediaRef;
  startSeconds?: number;
}

export interface TheaterLocalState {
  status: TheaterLocalStatus;
  /** The seat the local Blobbi actually arrived at, or null. */
  seatId: string | null;
  /** Non-null exactly when a player should be mounted. */
  request: TheaterMediaRequest | null;
  /** Set only in `video-error`. */
  error: MediaError | null;
}

export const INITIAL_THEATER_STATE: TheaterLocalState = {
  status: 'not-seated',
  seatId: null,
  request: null,
  error: null,
};

export type TheaterEvent =
  /** CONFIRMED arrival at a seat — never a click. */
  | { type: 'sit'; seatId: string }
  /** Movement started, the location changed, or the seat was otherwise left. */
  | { type: 'stand' }
  /** A parsed, valid video id was submitted. */
  | { type: 'submit'; media: MediaRef; startSeconds?: number }
  /** The player reported the requested media is ready/cued/playing. */
  | { type: 'player-ready' }
  | { type: 'player-error'; error: MediaError }
  /** "Change video": back to the input, curtain down, player released. */
  | { type: 'change-video' };

export function theaterReducer(state: TheaterLocalState, event: TheaterEvent): TheaterLocalState {
  switch (event.type) {
    case 'sit': {
      // Re-arriving at the seat you are already in changes nothing — a new
      // object here would tear down a playing video for no reason.
      if (state.status !== 'not-seated' && state.seatId === event.seatId) return state;
      // A DIFFERENT seat is a fresh sitting: the video is released and the card
      // returns to the input, rather than appearing to follow you around.
      return { status: 'seated-idle', seatId: event.seatId, request: null, error: null };
    }

    case 'stand':
      if (state.status === 'not-seated') return state;
      return INITIAL_THEATER_STATE;

    case 'submit':
      // Only a seated player can put something on the screen.
      if (state.status === 'not-seated') return state;
      return {
        status: 'loading-video',
        seatId: state.seatId,
        request: { media: event.media, startSeconds: event.startSeconds },
        error: null,
      };

    case 'player-ready':
      // Readiness only means something while a load is outstanding. Late or
      // duplicate ready signals must not resurrect a video that errored or was
      // replaced by the URL input.
      if (state.status !== 'loading-video') return state;
      return { ...state, status: 'video-ready', error: null };

    case 'player-error':
      if (state.status !== 'loading-video' && state.status !== 'video-ready') return state;
      return { ...state, status: 'video-error', error: event.error };

    case 'change-video':
      if (state.status === 'not-seated' || state.status === 'seated-idle') return state;
      return { status: 'seated-idle', seatId: state.seatId, request: null, error: null };
  }
}

// ── Derived UI facts ───────────────────────────────────────────────────────
// Every one of these is a pure function of the state, so no two parts of the
// room can disagree about what is happening.

/** The control card exists only while the local Blobbi is sitting in a seat. */
export function isControlCardVisible(state: TheaterLocalState): boolean {
  return state.status !== 'not-seated';
}

/**
 * The movable yellow curtain.
 *
 * Closed for every state but one. It does not respond to hover, to touch, or to
 * a player merely existing.
 */
export function isCurtainOpen(state: TheaterLocalState): boolean {
  return state.status === 'video-ready';
}

/** Whether a YouTube player should exist right now. */
export function isPlayerMounted(state: TheaterLocalState): boolean {
  return state.request !== null;
}

/** Whether the card shows the URL field (as opposed to playback controls). */
export function showsMediaInput(state: TheaterLocalState): boolean {
  return state.status === 'seated-idle' || state.status === 'video-error';
}
