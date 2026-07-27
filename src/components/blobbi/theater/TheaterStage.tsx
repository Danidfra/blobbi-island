import { useCallback, useEffect, useReducer } from 'react';
import { Loader2 } from 'lucide-react';
import { THEATER_PLAYER_RECT, THEATER_Z } from '@/lib/theater-layout';
import {
  INITIAL_THEATER_STATE,
  isControlCardVisible,
  isCurtainOpen,
  isPlayerMounted,
  theaterReducer,
} from '@/lib/theater-state';
import { useTheaterPlayback } from '@/hooks/useTheaterPlayback';
import { TheaterControlCard } from './TheaterControlCard';
import { TheaterCurtain } from './TheaterCurtain';
import type { TheaterRole } from './TheaterControls';

interface TheaterStageProps {
  /**
   * The seat the LOCAL Blobbi has actually ARRIVED at, or null. Owned by
   * `PlayingView` and threaded down explicitly.
   *
   * It is deliberately not inferred from the DOM, from Blobbi coordinates or
   * from a global query: "am I sitting down?" is React state with exactly one
   * owner, and every other answer is a guess that can disagree with it.
   */
  seatId: string | null;
  /**
   * Which control surface to render. Local playback makes you the host of your
   * own screen; the guest surface exists so shared playback only has to choose a
   * role rather than grow a second UI.
   */
  role?: TheaterRole;
}

/**
 * The theater: screen, curtain and controls, driven by one state machine.
 *
 * Everything visible here is a function of `theaterReducer`'s state — see
 * `src/lib/theater-state.ts` for the transition table. The properties that
 * matter, and that the tests pin down:
 *
 *  - **Nothing but scenery exists until the Blobbi is sitting down.** No card,
 *    no player, no API script, no error. An empty theater is idle, not broken.
 *  - **The curtain rises only on confirmed player readiness**, never because an
 *    iframe mounted, and never on hover.
 *  - **Standing up releases the player.** Leaving the seat means silence, and
 *    coming back means starting clean rather than finding a stale error.
 */
export function TheaterStage({ seatId, role = 'host' }: TheaterStageProps) {
  const [state, dispatch] = useReducer(theaterReducer, INITIAL_THEATER_STATE);

  // The single bridge from seating to the theater. `seatId` is the confirmed
  // arrival state; anything else (a walk in progress, a different room) is null
  // and stands the viewer up.
  useEffect(() => {
    if (seatId) dispatch({ type: 'sit', seatId });
    else dispatch({ type: 'stand' });
  }, [seatId]);

  const { hostRef, controller, snapshot, fatalError, retry } = useTheaterPlayback(state.request);

  // Readiness and failure are reported BY the player and consumed by the state
  // machine — the machine never assumes either.
  const playerReady =
    controller !== null &&
    snapshot.media !== null &&
    snapshot.error === null &&
    (snapshot.phase === 'ready' || snapshot.phase === 'buffering' || snapshot.phase === 'ended');

  useEffect(() => {
    if (playerReady) dispatch({ type: 'player-ready' });
  }, [playerReady]);

  useEffect(() => {
    if (snapshot.error) dispatch({ type: 'player-error', error: snapshot.error });
  }, [snapshot.error]);

  useEffect(() => {
    if (fatalError) dispatch({ type: 'player-error', error: fatalError });
  }, [fatalError]);

  const handleSubmit = useCallback((videoId: string, startSeconds?: number) => {
    dispatch({ type: 'submit', media: { provider: 'youtube', id: videoId }, startSeconds });
  }, []);

  const handleChangeVideo = useCallback(() => dispatch({ type: 'change-video' }), []);

  // "Try again" after the projector itself failed: put the machine back into
  // `loading-video` for the SAME request before rebuilding, otherwise a
  // successful second attempt would report readiness into a state that no longer
  // accepts it and the curtain would stay down over a working video.
  const handleRetryPlayer = useCallback(() => {
    if (state.request) {
      dispatch({
        type: 'submit',
        media: state.request.media,
        startSeconds: state.request.startSeconds,
      });
    }
    retry();
  }, [state.request, retry]);

  const showPlayer = isPlayerMounted(state);
  const curtainOpen = isCurtainOpen(state);

  return (
    <>
      {/* ── Video surface, inside the proscenium's transparent rectangle ──
          Mounted only when there is something to play. With no player the
          artwork's own black rectangle shows through, which is exactly what an
          idle theater screen looks like. */}
      {showPlayer && (
        <div
          data-theater-screen
          data-block-move
          className="absolute overflow-hidden bg-black"
          style={{
            left: `${THEATER_PLAYER_RECT.leftPercent}%`,
            top: `${THEATER_PLAYER_RECT.topPercent}%`,
            width: `${THEATER_PLAYER_RECT.widthPercent}%`,
            height: `${THEATER_PLAYER_RECT.heightPercent}%`,
            zIndex: THEATER_Z.screen,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* The IFrame API replaces a child of this box with its iframe. */}
          <div ref={hostRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />

          {/* Buffering mid-film: a spinner, not a skeleton — a short operation.
              Loading a NEW video is reported on the card instead, because the
              curtain is down and nobody can see the screen. */}
          {state.status === 'video-ready' && snapshot.phase === 'buffering' && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25">
              <Loader2 className="h-6 w-6 animate-spin text-white/70" />
              {snapshot.stalled && <p className="text-[11px] text-white/60">Still loading…</p>}
            </div>
          )}
        </div>
      )}

      <TheaterCurtain open={curtainOpen} />

      {isControlCardVisible(state) && (
        <TheaterControlCard
          state={state}
          role={role}
          controller={controller}
          snapshot={snapshot}
          fatalError={fatalError}
          onRetryPlayer={handleRetryPlayer}
          onSubmit={handleSubmit}
          onChangeVideo={handleChangeVideo}
        />
      )}
    </>
  );
}
