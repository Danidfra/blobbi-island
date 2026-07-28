import { useCallback, useEffect, useReducer, useRef } from 'react';
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
import { useSharedPlayback } from '@/hooks/useSharedPlayback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { SharedMediaRef } from '@/lib/shared-playback';
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
   * Force a control surface. Normally the ROLE IS DERIVED from the shared
   * session — hosting or watching alone gives you the host surface, joining
   * someone else's session gives you the guest one — and this exists only for
   * harnesses that want to see one surface without a relay.
   */
  role?: TheaterRole;
  /**
   * Report which shared activity the local player is participating in, as the
   * session ADDRESS STRING and nothing else (protocol §14.2). `PlayingView`
   * forwards it to presence; presence never becomes the session store.
   */
  onActivityChange?: (sessionAddress: string | null) => void;
  /**
   * How many visible players presence says are in this session, INCLUDING the
   * local one. Advisory and self-expiring, exactly like seat occupancy: the
   * session event carries no participant list by design (§14.1).
   */
  participants?: number;
}

/**
 * The theater: screen, curtain, controls, and — when there is one — a shared
 * watch session.
 *
 * Everything visible is a function of `theaterReducer`'s state plus the shared
 * layer's `SharedWatchState`. The properties the tests pin down:
 *
 *  - **Nothing but scenery exists until the Blobbi is sitting down.** No card,
 *    no player, no API script, no session, no error.
 *  - **The curtain rises only on confirmed player readiness** — never because a
 *    session said "playing", which is a claim about a timeline, not about
 *    whether this screen has a picture on it.
 *  - **Standing up releases the player AND the session.** Leaving the seat means
 *    silence, and it means the presence reference stops pointing at a session
 *    the player has walked away from.
 */
export function TheaterStage({
  seatId,
  role,
  onActivityChange,
  participants = 1,
}: TheaterStageProps) {
  const [state, dispatch] = useReducer(theaterReducer, INITIAL_THEATER_STATE);
  const { user } = useCurrentUser();
  // What is on screen right now, readable from effects without making them
  // depend on it.
  const requestRef = useRef(state.request);
  requestRef.current = state.request;

  // The single bridge from seating to the theater. `seatId` is the confirmed
  // arrival state; anything else (a walk in progress, a different room) is null
  // and stands the viewer up.
  //
  // `retain` is the whole of the seat/screen split: with a shared session
  // attached, standing up vacates the CHAIR and nothing else — the film is still
  // running for everyone else in the room, so the screen keeps playing and only
  // the control card goes away. Watching alone keeps the original behaviour:
  // walking away from your own film stops it.
  useEffect(() => {
    const retain = sharedModeRef.current !== 'local';
    if (seatId) dispatch({ type: 'sit', seatId, retain });
    else dispatch({ type: 'stand', retain });
  }, [seatId]);

  // `onLocalCommand` is stable, but it is read through a ref anyway so the
  // player is never rebuilt by a callback identity change.
  const localCommandRef = useRef<(command: Parameters<ReturnType<typeof useSharedPlayback>['onLocalCommand']>[0]) => void>(
    () => {},
  );
  const { hostRef, controller, snapshot, fatalError, retry } = useTheaterPlayback(state.request, {
    onCommand: (command) => localCommandRef.current(command),
  });

  const handleRequestMedia = useCallback((media: SharedMediaRef) => {
    // The SESSION asked for this video; the theater state machine still decides
    // what a player is and when it exists.
    dispatch({ type: 'submit', media: { provider: 'youtube', id: media.id } });
  }, []);

  const {
    shared,
    createSession,
    joinSession,
    leaveSession,
    endSession,
    dismissError,
    onLocalCommand,
  } = useSharedPlayback({ controller, snapshot, onRequestMedia: handleRequestMedia });

  localCommandRef.current = onLocalCommand;
  // Read inside the seat effect without making the session part of its
  // dependencies: sitting down is the trigger, the session is just context.
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const sharedModeRef = useRef(shared.mode);
  sharedModeRef.current = shared.mode;

  // Presence carries the session ADDRESS and nothing else — no rev, no position,
  // no media (§14.3). It is set after a session is actually established and
  // cleared the instant one is not.
  useEffect(() => {
    onActivityChange?.(shared.sessionAddress);
  }, [onActivityChange, shared.sessionAddress]);

  // A watch session belongs to being IN THE THEATER, not to one chair.
  //
  // Standing up, wandering across the room and moving to another seat all leave
  // the session untouched: the only ways out are the explicit Leave/End buttons
  // and walking out of the theater (handled by `PlayingView`, which owns the
  // location and forgets the session there). This component deliberately does
  // NOT tie session membership to `seatId` — it used to, and standing up
  // silently dropped a host out of the session it had created, with no way back
  // in since only its own pubkey can author that session.
  //
  // The local PLAYER is still torn down when the seat is left (the approved
  // local behaviour), so sitting down again rebuilds it from canonical state.
  useEffect(() => {
    if (!seatId) return;
    if (sharedRef.current.mode === 'local') return;
    const media = sharedRef.current.media;
    if (!media) return;
    // FALLBACK, not the seat-change path. Retaining means the screen never went
    // away, so there is normally nothing to restore here. This covers the case
    // where a player genuinely does not exist — the theater was remounted, or
    // the session was joined from a cold start — and puts the session's media
    // back without the viewer choosing anything. The shared layer catches the
    // new player up to the session's position when it reports ready.
    if (requestRef.current !== null) return;
    dispatch({ type: 'submit', media: { provider: 'youtube', id: media.id } });
  }, [seatId, shared.media?.id, shared.mode]);

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
  // Global controls are ABSENT for a guest, not disabled, so ownership of the
  // screen is legible at a glance (§6.2).
  const effectiveRole: TheaterRole = role ?? (shared.mode === 'joined' ? 'guest' : 'host');

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
          role={effectiveRole}
          controller={controller}
          snapshot={snapshot}
          fatalError={fatalError}
          onRetryPlayer={handleRetryPlayer}
          onSubmit={handleSubmit}
          onChangeVideo={handleChangeVideo}
          shared={shared}
          participants={participants}
          canPublish={Boolean(user)}
          onCreateSession={() => {
            if (snapshot.media) void createSession(snapshot.media);
          }}
          onJoinSession={(code) => void joinSession(code)}
          onLeaveSession={leaveSession}
          onEndSession={() => void endSession()}
          onDismissSessionError={dismissError}
        />
      )}
    </>
  );
}
