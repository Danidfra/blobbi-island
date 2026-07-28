import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  API_LOAD_ERROR,
  REGION_BLOCK_TIMEOUT_MS,
  REGION_BLOCKED_ERROR,
  createYouTubeAdapter,
  type MediaError,
  type PlayerPhase,
} from '@/lib/youtube-player';
import {
  LocalTheaterPlaybackController,
  type TheaterPlaybackController,
  type TheaterPlaybackSnapshot,
} from '@/lib/theater-playback';
import type { PlaybackCommand, PlaybackState } from '@/lib/theater-playback';
import type { TheaterMediaRequest } from '@/lib/theater-state';

/** Position polling cadence. Cheap, local, and never produces network traffic. */
const TICK_INTERVAL_MS = 250;

/** Buffering longer than this is worth telling the user about. */
const BUFFER_WARN_MS = 15_000;

const IDLE_SNAPSHOT: TheaterPlaybackSnapshot = {
  media: null,
  status: 'paused',
  position: 0,
  rate: 1,
  updatedAt: 0,
  phase: 'idle',
  currentTime: 0,
  duration: 0,
  title: null,
  error: null,
  muted: false,
  volume: 100,
  captionsEnabled: false,
  availableRates: [1],
  autoplayBlocked: false,
  stalled: false,
  playerPlaying: false,
};

export interface UseTheaterPlaybackResult {
  /** Attach to the element the player should fill. */
  hostRef: React.RefObject<HTMLDivElement>;
  /** Null until a video has been requested AND the player is built. */
  controller: TheaterPlaybackController | null;
  snapshot: TheaterPlaybackSnapshot;
  /** Failure to construct a player at all (as opposed to a bad video). */
  fatalError: MediaError | null;
  /** Tear down and rebuild the player for the current request. */
  retry: () => void;
}

/**
 * Own the lifetime of a theater player and expose it as a controller.
 *
 * **A player exists only while `request` is non-null.** That single rule is what
 * fixes the theater's two visible bugs at once:
 *
 *  - The screen used to build a player at mount with no video id. The IFrame API
 *    answers `new YT.Player(el, { videoId: undefined })` with error 2 and never
 *    fires `onReady`, so construction always failed and the room permanently
 *    displayed the player-build error — including to people who had not sat down
 *    or chosen anything.
 *  - Because construction always failed, `controller` was always null, so the
 *    "Load Video" button called `controller?.setMedia(...)` on nothing and did
 *    nothing, silently.
 *
 * Now the API script is fetched, and a player constructed, only once a valid
 * video id exists. Absence of a video is an idle state, not an error state.
 *
 * **Destruction is not optional.** `PlayingView` remounts on a location change,
 * but an orphaned YouTube iframe keeps playing audio, so the cleanup below is
 * what makes "walk out of the theater" mean silence.
 */
export interface UseTheaterPlaybackOptions {
  /**
   * The publication seam. Called for every command the LOCAL controller
   * produces, including the `set-media` issued while adopting a freshly built
   * player — which is exactly the event shared playback needs when a host
   * changes video, and is why the listener is installed at construction rather
   * than attached by a later effect.
   *
   * Local playback passes nothing and publishes nothing.
   */
  onCommand?: (command: PlaybackCommand, state: PlaybackState) => void;
}

export function useTheaterPlayback(
  request: TheaterMediaRequest | null,
  options: UseTheaterPlaybackOptions = {},
): UseTheaterPlaybackResult {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in a ref so a new callback identity never rebuilds the player: a
  // rebuilt player is a black screen and a lost position.
  const onCommandRef = useRef(options.onCommand);
  onCommandRef.current = options.onCommand;
  const controllerRef = useRef<LocalTheaterPlaybackController | null>(null);
  const [controller, setController] = useState<LocalTheaterPlaybackController | null>(null);
  const [snapshot, setSnapshot] = useState<TheaterPlaybackSnapshot>(IDLE_SNAPSHOT);
  const [fatalError, setFatalError] = useState<MediaError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The player is built around ONE video id, and a different id builds a new
  // player. Depending on the id (rather than on the request object) means a
  // re-render carrying an equal-but-new object rebuilds nothing.
  const videoId = request?.media.id ?? null;
  const startSeconds = request?.startSeconds;

  const retry = useCallback(() => {
    setFatalError(null);
    setSnapshot(IDLE_SNAPSHOT);
    setAttempt((n) => n + 1);
  }, []);

  // Build (or tear down) the player.
  useEffect(() => {
    if (videoId === null) return;
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let bufferTimer: number | null = null;
    let regionTimer: number | null = null;

    // The API replaces this element with its iframe, so it must be disposable.
    const target = document.createElement('div');
    target.style.width = '100%';
    target.style.height = '100%';
    host.appendChild(target);

    const clearBufferTimer = () => {
      if (bufferTimer !== null) window.clearTimeout(bufferTimer);
      bufferTimer = null;
    };
    const clearRegionTimer = () => {
      if (regionTimer !== null) window.clearTimeout(regionTimer);
      regionTimer = null;
    };

    const onPhaseChange = (phase: PlayerPhase) => {
      const ctrl = controllerRef.current;
      ctrl?.handlePhase(phase);

      clearBufferTimer();
      if (phase === 'buffering') {
        bufferTimer = window.setTimeout(() => {
          controllerRef.current?.handleStalled(true);
        }, BUFFER_WARN_MS);
      } else {
        ctrl?.handleStalled(false);
      }
    };

    const onPlayingChange = (isPlaying: boolean) => {
      const ctrl = controllerRef.current;
      ctrl?.handlePlayingChange(isPlaying);

      clearRegionTimer();
      if (isPlaying) return;
      // A region-blocked video reports no error code: it simply never plays.
      // If the shared state says "playing" and the player still has not started
      // after a generous window, say so rather than looking frozen.
      if (ctrl?.getSnapshot().status === 'playing') {
        regionTimer = window.setTimeout(() => {
          const current = controllerRef.current;
          if (current && !current.getSnapshot().error && current.getSnapshot().status === 'playing') {
            current.handleError(REGION_BLOCKED_ERROR);
          }
        }, REGION_BLOCK_TIMEOUT_MS);
      }
    };

    // An error raised while the player is still being constructed (a private or
    // non-embeddable video never becomes ready) has no controller to land on
    // yet. Hold it and replay it — losing it would leave a spinner forever.
    const held: { error: MediaError | null } = { error: null };

    createYouTubeAdapter({
      container: target,
      videoId,
      startSeconds,
      events: {
        onPhaseChange,
        onPlayingChange,
        onError: (error) => {
          if (controllerRef.current) controllerRef.current.handleError(error);
          else held.error = error;
        },
        onDurationChange: (duration) => controllerRef.current?.handleDuration(duration),
        onRateChange: (rate) => controllerRef.current?.handleRate(rate),
      },
    })
      .then((adapter) => {
        if (cancelled) {
          adapter.destroy();
          return;
        }
        const instance = new LocalTheaterPlaybackController({
          adapter,
          onCommand: (command, state) => onCommandRef.current?.(command, state),
        });
        controllerRef.current = instance;
        // The player was constructed around this video: adopt it into the state
        // WITHOUT re-issuing a load, which would discard the embed's head start.
        instance.setMedia({ provider: 'youtube', id: videoId }, { startSeconds, alreadyLoaded: true });
        // The adapter reports its phase through `events`, but the controller did
        // not exist yet when `onReady` fired, so the very first phase has to be
        // replayed into it. Without this the snapshot stays `idle` forever and
        // the curtain never learns the video came up.
        if (held.error) {
          instance.handlePhase('error');
          instance.handleError(held.error);
        } else {
          instance.handlePhase('ready');
        }
        instance.subscribe(setSnapshot);
        setController(instance);
        setSnapshot(instance.getSnapshot());
      })
      .catch(() => {
        // The adapter only rejects when the API script itself cannot be loaded.
        // A video YouTube refuses still resolves, carrying its error.
        if (!cancelled) setFatalError(API_LOAD_ERROR);
      });

    return () => {
      cancelled = true;
      clearBufferTimer();
      clearRegionTimer();
      controllerRef.current?.destroy();
      controllerRef.current = null;
      setController(null);
      setSnapshot(IDLE_SNAPSHOT);
      setFatalError(null);
      // Belt and braces: `destroy()` removes the iframe, but a failed
      // construction can leave the placeholder behind.
      host.replaceChildren();
    };
    // A different video is a different player. The alternative — keeping the
    // embed and re-cueing it — buys nothing here, because every path that
    // changes the video (Change video, standing up, leaving) already passes
    // through "no request", which tears the player down anyway. One rule instead
    // of two, and no way for a stale player to survive a state it does not match.
  }, [videoId, startSeconds, attempt]);

  // Live position for the timeline. A local interval, never a rAF loop and never
  // a publish — the same discipline the shared drift check will follow.
  useEffect(() => {
    if (!controller) return;
    const id = window.setInterval(() => controller.tick(), TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [controller]);

  return useMemo(
    () => ({ hostRef, controller, snapshot, fatalError, retry }),
    [controller, snapshot, fatalError, retry],
  );
}
