/**
 * The theater state machine.
 *
 * These are the rules the room's appearance is derived from, tested where they
 * are cheapest to test. The behavioural half — that the components actually obey
 * them — lives in `TheaterStage.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import {
  INITIAL_THEATER_STATE,
  isControlCardVisible,
  isCurtainOpen,
  isPlayerMounted,
  showsMediaInput,
  theaterReducer,
  type TheaterEvent,
  type TheaterLocalState,
} from './theater-state';
import { AMBIGUOUS_PLAYBACK_MESSAGE, type MediaError } from './youtube-player';

const MEDIA = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
const OTHER = { provider: 'youtube', id: 'abcdefghijk' } as const;

const ERROR: MediaError = {
  code: 'embedding-disabled',
  message: AMBIGUOUS_PLAYBACK_MESSAGE,
  retryable: false,
};

/** Fold a sequence of events, the way the component does. */
function run(...events: TheaterEvent[]): TheaterLocalState {
  return events.reduce(theaterReducer, INITIAL_THEATER_STATE);
}

const seated = () => run({ type: 'sit', seatId: 'theater-seat-a1' });
const loading = () => run({ type: 'sit', seatId: 'theater-seat-a1' }, { type: 'submit', media: MEDIA });
const ready = () =>
  run({ type: 'sit', seatId: 'theater-seat-a1' }, { type: 'submit', media: MEDIA }, { type: 'player-ready' });

describe('theaterReducer', () => {
  it('starts not seated, with no player and no error', () => {
    expect(INITIAL_THEATER_STATE.status).toBe('not-seated');
    expect(isPlayerMounted(INITIAL_THEATER_STATE)).toBe(false);
    expect(INITIAL_THEATER_STATE.error).toBeNull();
  });

  it('cannot be driven anywhere by a player it does not have', () => {
    // Every player signal is ignored while nobody is sitting down. This is the
    // invariant that makes "an idle theater cannot show a player error" true.
    expect(run({ type: 'player-ready' })).toEqual(INITIAL_THEATER_STATE);
    expect(run({ type: 'player-error', error: ERROR })).toEqual(INITIAL_THEATER_STATE);
    expect(run({ type: 'submit', media: MEDIA })).toEqual(INITIAL_THEATER_STATE);
  });

  it('sits down into an idle seat, not into a video', () => {
    const state = seated();
    expect(state.status).toBe('seated-idle');
    expect(state.seatId).toBe('theater-seat-a1');
    expect(isPlayerMounted(state)).toBe(false);
    expect(showsMediaInput(state)).toBe(true);
  });

  it('re-arriving at the SAME seat changes nothing', () => {
    // A duplicate arrival must not tear down a playing video.
    const playing = ready();
    expect(theaterReducer(playing, { type: 'sit', seatId: 'theater-seat-a1' })).toBe(playing);
  });

  it('moving to a DIFFERENT seat resets the theater UI', () => {
    const next = theaterReducer(ready(), { type: 'sit', seatId: 'theater-seat-c3' });
    expect(next.status).toBe('seated-idle');
    expect(next.seatId).toBe('theater-seat-c3');
    expect(next.request).toBeNull();
    expect(isCurtainOpen(next)).toBe(false);
  });

  it('standing up from any state returns to a clean, empty theater', () => {
    for (const state of [seated(), loading(), ready(), theaterReducer(loading(), { type: 'player-error', error: ERROR })]) {
      expect(theaterReducer(state, { type: 'stand' })).toEqual(INITIAL_THEATER_STATE);
    }
  });

  it('mounts a player only once a video has been submitted', () => {
    expect(isPlayerMounted(seated())).toBe(false);
    expect(isPlayerMounted(loading())).toBe(true);
    expect(loading().request?.media).toEqual(MEDIA);
  });

  it('carries a start offset through to the request', () => {
    const state = run({ type: 'sit', seatId: 'theater-seat-a1' }, { type: 'submit', media: MEDIA, startSeconds: 90 });
    expect(state.request).toEqual({ media: MEDIA, startSeconds: 90 });
  });

  it('opens the curtain on readiness and on nothing else', () => {
    expect(isCurtainOpen(INITIAL_THEATER_STATE)).toBe(false);
    expect(isCurtainOpen(seated())).toBe(false);
    expect(isCurtainOpen(loading())).toBe(false);
    expect(isCurtainOpen(ready())).toBe(true);
    expect(isCurtainOpen(theaterReducer(loading(), { type: 'player-error', error: ERROR }))).toBe(false);
  });

  it('ignores a readiness signal that arrives late or twice', () => {
    // Nothing may resurrect a video that already errored or was replaced.
    const errored = theaterReducer(loading(), { type: 'player-error', error: ERROR });
    expect(theaterReducer(errored, { type: 'player-ready' })).toBe(errored);

    const idle = theaterReducer(ready(), { type: 'change-video' });
    expect(theaterReducer(idle, { type: 'player-ready' })).toBe(idle);

    const alreadyReady = ready();
    expect(theaterReducer(alreadyReady, { type: 'player-ready' })).toBe(alreadyReady);
  });

  it('keeps the curtain up once the film is running', () => {
    // The old curtain fell the moment the pointer moved away. Only an explicit
    // action or a real failure may lower it.
    const playing = ready();
    expect(isCurtainOpen(theaterReducer(playing, { type: 'sit', seatId: 'theater-seat-a1' }))).toBe(true);
    expect(isCurtainOpen(theaterReducer(playing, { type: 'player-ready' }))).toBe(true);
  });

  it('an error keeps the curtain down and puts the input back', () => {
    const state = theaterReducer(loading(), { type: 'player-error', error: ERROR });
    expect(state.status).toBe('video-error');
    expect(state.error).toBe(ERROR);
    expect(isCurtainOpen(state)).toBe(false);
    expect(showsMediaInput(state)).toBe(true);
    // The request survives, so "try again" has something to retry.
    expect(state.request?.media).toEqual(MEDIA);
  });

  it('change video closes the curtain, releases the player and shows the input', () => {
    const state = theaterReducer(ready(), { type: 'change-video' });
    expect(state.status).toBe('seated-idle');
    expect(isCurtainOpen(state)).toBe(false);
    expect(isPlayerMounted(state)).toBe(false);
    expect(showsMediaInput(state)).toBe(true);
    expect(state.seatId).toBe('theater-seat-a1');
  });

  it('change video is a no-op when there is nothing to change', () => {
    expect(theaterReducer(INITIAL_THEATER_STATE, { type: 'change-video' })).toBe(INITIAL_THEATER_STATE);
    const idle = seated();
    expect(theaterReducer(idle, { type: 'change-video' })).toBe(idle);
  });

  it('submitting a second video goes back through loading', () => {
    const next = theaterReducer(theaterReducer(ready(), { type: 'change-video' }), { type: 'submit', media: OTHER });
    expect(next.status).toBe('loading-video');
    expect(next.request?.media).toEqual(OTHER);
    expect(isCurtainOpen(next)).toBe(false);
  });

  it('shows the control card exactly while seated', () => {
    expect(isControlCardVisible(INITIAL_THEATER_STATE)).toBe(false);
    for (const state of [seated(), loading(), ready(), theaterReducer(loading(), { type: 'player-error', error: ERROR })]) {
      expect(isControlCardVisible(state)).toBe(true);
    }
  });

  it('never shows the URL input and the playback controls at once', () => {
    for (const state of [seated(), loading(), ready(), theaterReducer(loading(), { type: 'player-error', error: ERROR })]) {
      expect(showsMediaInput(state) && state.status === 'video-ready').toBe(false);
    }
  });
});
