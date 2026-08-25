import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { THEATER_CONTROL_CARD_RECT, THEATER_Z } from '@/lib/theater-layout';
import type { TheaterPlaybackController, TheaterPlaybackSnapshot } from '@/lib/theater-playback';
import type { TheaterLocalState } from '@/lib/theater-state';
import type { MediaError } from '@/lib/youtube-player';
import { TheaterMediaInput } from './TheaterMediaInput';
import { TheaterMediaShelf } from './TheaterMediaShelf';
import { useIslandSafetyPolicy } from '@/safety';
import {
  allowsOpenMediaEntry,
  type ApprovedMedia,
  type TheaterMediaDenial,
} from '@/theater-media';
import { TheaterSessionPanel } from './TheaterSessionPanel';
import { GuestControls, HostControls, type TheaterRole } from './TheaterControls';
import type { SharedWatchState } from '@/hooks/useSharedPlayback';

interface TheaterControlCardProps {
  state: TheaterLocalState;
  role: TheaterRole;
  controller: TheaterPlaybackController | null;
  snapshot: TheaterPlaybackSnapshot;
  /** The player could not be built at all — distinct from a bad video. */
  fatalError: MediaError | null;
  onRetryPlayer: () => void;
  onSubmit: (videoId: string, startSeconds?: number) => void;
  onChangeVideo: () => void;
  shared: SharedWatchState;
  participants: number;
  canPublish: boolean;
  onCreateSession: () => void;
  onJoinSession: (code: string) => void;
  onLeaveSession: () => void;
  onEndSession: () => void;
  onDismissSessionError: () => void;
  /** Why the last media reference was refused, or `null`. */
  blockedMedia: TheaterMediaDenial | null;
  /** The approved-media list for the shelf. Defaults to the bundled catalog. */
  catalog?: readonly ApprovedMedia[];
}

const FULLSCREEN_DENIED_MESSAGE =
  "Your browser wouldn't open fullscreen from here. Use the ⛶ button inside the video instead.";

/**
 * The theater's one piece of UI, on the stage wall below the screen.
 *
 * It holds BOTH halves of the interaction — choosing what to watch and
 * controlling it — because the theater artwork paints a curtain over the top of
 * the screen. Controls placed on the screen itself are partly hidden by the
 * scenery, which is why nothing essential lives there.
 *
 * It renders one of four things, chosen by the state machine and nothing else:
 *
 * | state | card |
 * | --- | --- |
 * | `seated-idle` | URL input |
 * | `loading-video` | spinner + "Loading…", input suppressed so a second submit can't race |
 * | `video-ready` | title + full playback controls |
 * | `video-error` | friendly sentence + the URL input again, ready for another try |
 *
 * It is not rendered at all when nobody is sitting down.
 */
export function TheaterControlCard({
  state,
  role,
  controller,
  snapshot,
  fatalError,
  onRetryPlayer,
  onSubmit,
  blockedMedia,
  catalog,
  onChangeVideo,
  shared,
  participants,
  canPublish,
  onCreateSession,
  onJoinSession,
  onLeaveSession,
  onEndSession,
  onDismissSessionError,
}: TheaterControlCardProps) {
  const [fullscreenDenied, setFullscreenDenied] = useState(false);
  const policy = useIslandSafetyPolicy();
  const isHost = role === 'host';

  return (
    <div
      data-theater-controls
      data-theater-status={state.status}
      data-block-move
      // The BACKGROUND is what got lighter — `bg-black/45` instead of `/60` —
      // so more of the room shows through the card. Everything drawn on top of
      // it (text, icons, buttons, inputs) keeps its own full opacity, and the
      // blur stays, which is what holds the contrast up over busy scenery.
      className="absolute flex flex-col items-stretch gap-1.5 rounded-xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-sm"
      style={{
        left: `${THEATER_CONTROL_CARD_RECT.leftPercent}%`,
        top: `${THEATER_CONTROL_CARD_RECT.topPercent}%`,
        width: `${THEATER_CONTROL_CARD_RECT.widthPercent}%`,
        zIndex: THEATER_Z.controls,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* The projector itself failed (script blocked, offline). Retryable, and
          the only state where the card offers a retry rather than a new video. */}
      {fatalError && (
        <div className="flex items-center gap-2">
          <p role="alert" className="flex-1 text-xs text-amber-200/90">
            {fatalError.message}
          </p>
          <button
            type="button"
            onClick={onRetryPlayer}
            className="shrink-0 rounded-full border border-white/25 px-3 py-1 text-xs text-white/80 transition-colors hover:text-white"
          >
            Try again
          </button>
        </div>
      )}

      {/* A video YouTube refused. Say what is certain, offer the next attempt. */}
      {state.status === 'video-error' && state.error && !fatalError && (
        <p role="alert" className="px-1 text-xs text-amber-200/90">
          {state.error.message}
        </p>
      )}

      {state.status === 'loading-video' && !fatalError && (
        <div className="flex items-center gap-2 py-1">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/70" />
          <p className="flex-1 text-xs text-white/70">
            {snapshot.stalled ? 'Still loading — this one is taking a while…' : 'Loading video…'}
          </p>
          <button
            type="button"
            onClick={onChangeVideo}
            className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 transition-colors hover:text-white"
          >
            Change video
          </button>
        </div>
      )}

      {/* Idle or failed: choose something. Host only — a guest cannot pick. */}
      {isHost && (state.status === 'seated-idle' || state.status === 'video-error') && !fatalError && (
        /*
          Which chooser exists is decided by the capability, not by disabling a
          control: an experience without open entry has no URL box in the tree at
          all, so there is nothing to re-enable and nothing to explain.

          This is presentation. `TheaterStage` admits every media reference
          before it dispatches, so the shelf is the convenient way to pick
          approved media rather than the thing that makes it approved.
        */
        allowsOpenMediaEntry(policy) ? (
          <TheaterMediaInput onLoad={onSubmit} autoFocus={state.status === 'video-error'} />
        ) : (
          <TheaterMediaShelf onSelect={(id) => onSubmit(id)} catalog={catalog} />
        )
      )}

      {blockedMedia && (
        /*
          Neutral, and deliberately says nothing about who the player is: a
          profile is an experience configuration, not an age assertion.
        */
        <p role="alert" className="px-1 text-xs text-white/70">
          {blockedMedia === 'not-approved'
            ? "That video isn't part of this experience."
            : "That video can't be played here."}
        </p>
      )}

      {!isHost && state.status === 'seated-idle' && (
        <p className="px-1 py-1 text-xs text-white/60">Waiting for the host to pick something…</p>
      )}

      {state.status === 'video-ready' && controller && (
        <>
          {/* Title, when the provider actually offers one. No placeholder and no
              guess: an embed that reports no title simply has no title line. */}
          {snapshot.title && (
            <p className="truncate px-1 text-xs font-medium text-white/85" title={snapshot.title}>
              {snapshot.title}
            </p>
          )}
          {isHost ? (
            <HostControls
              controller={controller}
              snapshot={snapshot}
              onChangeVideo={onChangeVideo}
              onFullscreenDenied={() => setFullscreenDenied(true)}
            />
          ) : (
            <GuestControls
              controller={controller}
              snapshot={snapshot}
              onFullscreenDenied={() => setFullscreenDenied(true)}
            />
          )}
          {snapshot.autoplayBlocked && (
            <button
              type="button"
              onClick={() => controller.play()}
              className="self-start rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-black"
            >
              Tap to watch
            </button>
          )}
          {fullscreenDenied && (
            <p role="alert" className="px-1 text-[11px] text-amber-200/90">
              {FULLSCREEN_DENIED_MESSAGE}
            </p>
          )}
        </>
      )}

      {/* A session problem is NOT a player problem: it gets its own line, and
          the video above it keeps playing. */}
      {shared.error && (
        <div className="flex items-center gap-2">
          <p role="alert" data-theater-session-error={shared.error.code} className="flex-1 px-1 text-[11px] text-amber-200/90">
            {shared.error.message}
          </p>
          <button
            type="button"
            onClick={onDismissSessionError}
            aria-label="Dismiss session message"
            className="shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-white/60 transition-colors hover:text-white"
          >
            OK
          </button>
        </div>
      )}

      {/* Watching together is a property of the room you are already in, so the
          session controls live in this card rather than in a dialog over it. */}
      <TheaterSessionPanel
        shared={shared}
        hasMedia={snapshot.media !== null}
        canPublish={canPublish}
        participants={participants}
        onCreate={onCreateSession}
        onJoin={onJoinSession}
        onLeave={onLeaveSession}
        onEnd={onEndSession}
      />
    </div>
  );
}
