/**
 * A thin, typed adapter over the official YouTube IFrame Player API.
 *
 * Why an adapter rather than a wrapper package:
 *
 *  - The API is a script-injection + global-callback API
 *    (`window.onYouTubeIframeAPIReady`) that must be loaded exactly once per
 *    page. A promise-memoised loader is the only sane React fit, and it is about
 *    thirty lines: not worth a dependency the project would have to audit.
 *  - It gives the playback controller a small, mockable surface
 *    ({@link MediaPlayerAdapter}) instead of a global. Every correctness-critical
 *    decision above this file can then be tested without a browser or a network.
 *  - It is the seam where a second provider (self-hosted MP4, NIP-71 video) can
 *    be added later without touching anything above it.
 *
 * Nothing here scrapes YouTube or touches an unofficial endpoint: the embed API
 * is the entire integration.
 */

// ── Minimal typings for the parts of the IFrame API we use ─────────────────

/** `YT.PlayerState` values. Numeric because that is what `onStateChange` emits. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export type YouTubePlayerState = (typeof YT_STATE)[keyof typeof YT_STATE];

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): YouTubePlayerState;
  getVideoLoadedFraction(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getOptions(module?: string): string[];
  setOption(module: string, option: string, value: unknown): void;
  getIframe(): HTMLIFrameElement;
  /**
   * Not in the published IFrame API reference, but present on every embed and
   * the only way to learn a title without a second network request. Treated as
   * optional and read through `safe()`: an absent title is a missing nicety, not
   * a failure, so the UI simply shows no title.
   */
  getVideoData?(): { title?: string; video_id?: string } | undefined;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      /** The origin the iframe is served from. See {@link YOUTUBE_EMBED_HOST}. */
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: { data: YouTubePlayerState; target: YouTubePlayer }) => void;
        onError?: (event: { data: number; target: YouTubePlayer }) => void;
        onPlaybackRateChange?: (event: { data: number; target: YouTubePlayer }) => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// ── Error mapping ──────────────────────────────────────────────────────────

export type MediaErrorCode =
  | 'invalid-video'
  | 'html5-error'
  | 'unavailable'
  | 'embedding-disabled'
  | 'identification-failed'
  | 'api-load-failed'
  | 'region-blocked'
  | 'unknown';

export interface MediaError {
  code: MediaErrorCode;
  /** Short, user-facing sentence. */
  message: string;
  /** Whether retrying the same video could plausibly succeed. */
  retryable: boolean;
}

/**
 * The honest sentence for everything the API cannot actually distinguish.
 *
 * YouTube reports `100` for "removed OR private", and `101`/`150` for "embedding
 * disabled": but region blocks and age restrictions surface as `101`/`150` too.
 * Naming one of those causes would be a guess presented as a diagnosis, and a
 * wrong diagnosis sends the user off to fix the wrong thing. Where the code does
 * not narrow it down, say what is certain (it will not play here) and what to do
 * (try another video).
 */
export const AMBIGUOUS_PLAYBACK_MESSAGE =
  'This video is unavailable or cannot be played inside Blobbi Island. Try another YouTube video.';

/**
 * Translate a YouTube `onError` code into something a player can be told.
 *
 * The `code` is kept distinct per API code even where the *message* is shared,
 * so a future caller can still branch on the cause without the UI over-claiming
 * one to the user.
 */
export function mapYouTubeError(code: number): MediaError {
  switch (code) {
    // 2 = malformed parameter. Unambiguous, and actionable: the input was wrong.
    case 2:
      return { code: 'invalid-video', message: "That doesn't look like a valid YouTube video ID.", retryable: false };
    // 5 = the HTML5 player itself failed. Unambiguous, and worth retrying.
    case 5:
      return { code: 'html5-error', message: 'The video player ran into a problem with this video.', retryable: true };
    // 100 = "not found": removed OR private, indistinguishable from here.
    case 100:
      return { code: 'unavailable', message: AMBIGUOUS_PLAYBACK_MESSAGE, retryable: false };
    // 101/150 = documented as embedding-disabled, but also what region and age
    // restrictions come back as. Do not name a cause.
    case 101:
    case 150:
      return { code: 'embedding-disabled', message: AMBIGUOUS_PLAYBACK_MESSAGE, retryable: false };
    // 153 = the embed could not identify the requesting page. That IS specific.
    case 153:
      return { code: 'identification-failed', message: "YouTube wouldn't accept this player.", retryable: true };
    default:
      return { code: 'unknown', message: AMBIGUOUS_PLAYBACK_MESSAGE, retryable: true };
  }
}

/**
 * A video that refuses to start reports no error code at all; it simply never
 * reaches PLAYING. That could be a region block, a silent embed refusal or a
 * dead network, so the inferred error uses the ambiguous copy too.
 */
export const REGION_BLOCK_TIMEOUT_MS = 10_000;

export const REGION_BLOCKED_ERROR: MediaError = {
  code: 'region-blocked',
  message: `This video won't start. ${AMBIGUOUS_PLAYBACK_MESSAGE}`,
  retryable: true,
};

export const API_LOAD_ERROR: MediaError = {
  code: 'api-load-failed',
  message: "Couldn't reach YouTube to start the player. Check your connection and try again.",
  retryable: true,
};

// ── API loading ────────────────────────────────────────────────────────────

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

/**
 * The origin the player iframe is served from.
 *
 * `youtube-nocookie.com` rather than `youtube.com`, for BOTH experiences; this
 * is a privacy improvement, not a Family restriction. YouTube's "privacy-enhanced
 * mode" defers the tracking cookies it would otherwise set on load, and since the
 * theater embeds a video on behalf of a player who did not ask to be measured,
 * deferring them is simply the better default.
 *
 * It is a supported option of the IFrame Player API (`host`), not a URL rewrite:
 * the API script still loads from `www.youtube.com`, `postMessage` origin
 * handling is the API's own, and every player method behaves identically. The
 * CSP already allowed this host, `frame-src` names both, so nothing there
 * changes either.
 *
 * What it does NOT do is stop YouTube seeing the request. The embed is still a
 * cross-origin iframe: it receives the player's IP and User-Agent, and once a
 * video actually plays it may set storage of its own. See
 * `docs/theater-media-safety.md` §9 for the honest limits.
 */
export const YOUTUBE_EMBED_HOST = 'https://www.youtube-nocookie.com';

/** How long the script may take before the loader calls it a failure. */
export const API_LOAD_TIMEOUT_MS = 15_000;

/**
 * How often to re-check `window.YT` while waiting.
 *
 * The global-callback contract is one-shot and page-global: if the API has
 * already fired `onYouTubeIframeAPIReady` before this module registered (another
 * consumer, a previous mount, a hot reload, a script tag in `index.html`), it
 * will never fire again and a callback-only loader would wait forever. Polling
 * a boolean every 100 ms is the cheap, honest fallback.
 */
const API_POLL_INTERVAL_MS = 100;

let apiPromise: Promise<YouTubeApi> | null = null;

/**
 * Load the IFrame API script once per page and resolve with the `YT` namespace.
 *
 * The contract this has to satisfy, in full:
 *
 *  - **already loaded** → resolve synchronously from `window.YT`;
 *  - **currently loading** → every caller shares one promise and one script tag,
 *    however many components mount at once (React Strict Mode mounts each effect
 *    twice, so this is the normal case, not an edge case);
 *  - **script tag already present** but the ready callback already fired → the
 *    poll below resolves it;
 *  - **failed load** → reject AND clear the memo, so a retry genuinely retries
 *    instead of re-returning the rejected promise forever;
 *  - **unmount during loading** → nothing to do here; the promise is page-scoped
 *    and the caller ignores its result.
 *
 * It also never *replaces* `window.onYouTubeIframeAPIReady`: an existing handler
 * is captured and called first, so a second consumer on the page keeps working.
 */
export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API requires a browser'));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  const promise = new Promise<YouTubeApi>((resolve, reject) => {
    let settled = false;
    let pollId: number | null = null;
    let timeoutId: number | null = null;

    const finish = (result: YouTubeApi | Error) => {
      if (settled) return;
      settled = true;
      if (pollId !== null) window.clearInterval(pollId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    // Chain rather than overwrite: another consumer may have registered first,
    // and clobbering their callback would break them silently.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) finish(window.YT);
      else finish(new Error('YouTube IFrame API loaded without a Player'));
    };

    // The fallback for "the callback already fired before we registered".
    pollId = window.setInterval(() => {
      if (window.YT?.Player) finish(window.YT);
    }, API_POLL_INTERVAL_MS);

    timeoutId = window.setTimeout(
      () => finish(new Error('YouTube IFrame API timed out')),
      API_LOAD_TIMEOUT_MS,
    );

    const onScriptError = () => finish(new Error('YouTube IFrame API script failed'));

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_SRC}"]`);
    if (existing) {
      existing.addEventListener('error', onScriptError);
      return;
    }

    const script = document.createElement('script');
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.addEventListener('error', onScriptError);
    document.head.appendChild(script);
  }).catch((error) => {
    // Only clear the memo if it still points at THIS attempt: a later successful
    // call must not be wiped by an earlier failure resolving late.
    if (apiPromise === promise) apiPromise = null;
    throw error;
  });

  apiPromise = promise;
  return apiPromise;
}

/** Test seam: forget the memoised API promise. */
export function resetYouTubeApiCacheForTests(): void {
  apiPromise = null;
}

// ── Provider-agnostic adapter surface ──────────────────────────────────────

/** Readiness of the underlying player, distinct from the SHARED play/pause state. */
export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'buffering' | 'ended' | 'error';

export interface MediaPlayerEvents {
  onPhaseChange(phase: PlayerPhase): void;
  /** True when the player itself reports it is playing (not the desired state). */
  onPlayingChange(isPlaying: boolean): void;
  onError(error: MediaError): void;
  onDurationChange(duration: number): void;
  onRateChange(rate: number): void;
}

/**
 * The whole surface the playback controller is allowed to use.
 *
 * Keeping it this small is what makes the controller testable against a fake and
 * what will let a shared-playback controller wrap it without knowing YouTube
 * exists.
 */
export interface MediaPlayerAdapter {
  load(videoId: string, options: { autoplay: boolean; startSeconds?: number }): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  getPosition(): number;
  getDuration(): number;
  isPlaying(): boolean;
  setRate(rate: number): void;
  getRate(): number;
  getAvailableRates(): number[];
  setVolume(volume: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Captions availability is per-video and per-device; `null` = unknown. */
  setCaptionsEnabled(enabled: boolean): void;
  /** Title of the loaded media when the provider offers one; `null` otherwise. */
  getTitle(): string | null;
  getElement(): HTMLElement | null;
  destroy(): void;
}

export interface CreateYouTubeAdapterOptions {
  /** The element the API replaces with its iframe. */
  container: HTMLElement;
  /**
   * The video to build the player around. **Required.**
   *
   * `new YT.Player(el)` without one builds an embed for no video at all, which
   * the API answers with error 2 and no `onReady`: the player then never
   * finishes constructing. Constructing a player is therefore something that
   * happens *because* a video was chosen, never in advance of one.
   */
  videoId: string;
  /** Where to start, from a `?t=` offset. */
  startSeconds?: number;
  /** Start muted so a programmatic play can survive autoplay policies. */
  startMuted?: boolean;
  /**
   * Whether the screen may go fullscreen.
   *
   * Enforced at the iframe's own permissions, not by hiding a button: `fs`
   * removes YouTube's control, and withholding `allowfullscreen` plus the
   * `fullscreen` Permissions-Policy token is what actually denies the
   * capability. Hiding the button while the frame still permits it would leave
   * the browser's own picture-in-picture and context menus as a way in.
   */
  allowFullscreen?: boolean;
  events: MediaPlayerEvents;
}

/**
 * Build a {@link MediaPlayerAdapter} backed by a real YouTube embed.
 *
 * Resolves once `onReady` has fired. The caller MUST call `destroy()`: leaving
 * the iframe alive after leaving the theater would keep audio playing in a room
 * the player is no longer standing in.
 */
export async function createYouTubeAdapter({
  container,
  videoId,
  startSeconds,
  startMuted = false,
  allowFullscreen = true,
  events,
}: CreateYouTubeAdapterOptions): Promise<MediaPlayerAdapter> {
  const YT = await loadYouTubeIframeApi();

  const player = await new Promise<YouTubePlayer>((resolve) => {
    let settled = false;
    const instance = new YT.Player(container, {
      videoId,
      host: YOUTUBE_EMBED_HOST,
      playerVars: {
        ...(startSeconds !== undefined ? { start: Math.max(0, Math.floor(startSeconds)) } : {}),
        enablejsapi: 1,
        // iOS otherwise takes the whole screen natively and the world vanishes.
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        fs: allowFullscreen ? 1 : 0,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      },
      events: {
        onReady: () => {
          if (settled) return;
          settled = true;
          // Permissions-Policy for a cross-origin iframe; the API does not set it.
          try {
            const iframe = instance.getIframe();
            // The Permissions-Policy for a cross-origin iframe; the API does not
            // set it. `fullscreen` and `picture-in-picture` are BOTH withheld
            // when fullscreen is denied, picture-in-picture is the other way a
            // video leaves the island's frame.
            iframe.setAttribute(
              'allow',
              allowFullscreen
                ? 'autoplay; encrypted-media; fullscreen; picture-in-picture'
                : 'autoplay; encrypted-media',
            );
            if (allowFullscreen) iframe.setAttribute('allowfullscreen', 'true');
            else iframe.removeAttribute('allowfullscreen');
            iframe.setAttribute('title', 'Theater screen');
          } catch {
            // A missing iframe only costs us fullscreen/autoplay hints.
          }
          if (startMuted) safe(() => { instance.mute(); return true; }, false);
          events.onDurationChange(safe(() => instance.getDuration(), 0));
          events.onRateChange(safe(() => instance.getPlaybackRate(), 1));
          events.onPhaseChange('ready');
          resolve(instance);
        },
        onStateChange: ({ data }) => {
          switch (data) {
            case YT_STATE.BUFFERING:
              events.onPhaseChange('buffering');
              break;
            case YT_STATE.ENDED:
              events.onPlayingChange(false);
              events.onPhaseChange('ended');
              break;
            case YT_STATE.PLAYING:
              events.onDurationChange(safe(() => instance.getDuration(), 0));
              events.onPlayingChange(true);
              events.onPhaseChange('ready');
              break;
            case YT_STATE.PAUSED:
              events.onPlayingChange(false);
              events.onPhaseChange('ready');
              break;
            case YT_STATE.CUED:
              events.onDurationChange(safe(() => instance.getDuration(), 0));
              events.onPhaseChange('ready');
              break;
            default:
              break;
          }
        },
        onPlaybackRateChange: ({ data }) => events.onRateChange(data),
        onError: ({ data, target }) => {
          const error = mapYouTubeError(data);
          events.onError(error);
          events.onPhaseChange('error');
          // A rejected video is NOT a failed player. YouTube frequently reports
          // the error before `onReady` (a private or non-embeddable video never
          // becomes ready at all), and rejecting here used to turn "pick another
          // video" into "the projector is broken": with no controller built, so
          // no way to pick another video either. The player object is real; hand
          // it over and let the error travel as an error.
          if (!settled) {
            settled = true;
            resolve(target);
          }
        },
      },
    });
  });

  // Every call is wrapped: a player that reported an error before it ever became
  // ready still exists as an object, but its methods throw. The UI stays alive
  // and shows the error instead of dying on the next control it renders.
  const run = (fn: () => void): void => {
    safe(() => {
      fn();
      return true;
    }, false);
  };

  return {
    load: (id, { autoplay, startSeconds }) => {
      events.onPhaseChange('loading');
      // `cue` prepares without playing; `load` starts. Guests and a paused host
      // must never hear a frame of audio they did not ask for.
      run(() => (autoplay ? player.loadVideoById(id, startSeconds) : player.cueVideoById(id, startSeconds)));
    },
    play: () => run(() => player.playVideo()),
    pause: () => run(() => player.pauseVideo()),
    seek: (seconds) => run(() => player.seekTo(seconds, true)),
    getPosition: () => safe(() => player.getCurrentTime(), 0),
    getDuration: () => safe(() => player.getDuration(), 0),
    isPlaying: () => safe(() => player.getPlayerState(), YT_STATE.UNSTARTED) === YT_STATE.PLAYING,
    setRate: (rate) => run(() => player.setPlaybackRate(rate)),
    getRate: () => safe(() => player.getPlaybackRate(), 1),
    getAvailableRates: () => safe(() => player.getAvailablePlaybackRates(), [1]),
    setVolume: (volume) => run(() => player.setVolume(volume)),
    getVolume: () => safe(() => player.getVolume(), 100),
    setMuted: (muted) => run(() => (muted ? player.mute() : player.unMute())),
    isMuted: () => safe(() => player.isMuted(), false),
    setCaptionsEnabled: (enabled) => {
      // Caption modules are only present once the video has them; a throw here
      // just means "this video has no captions", which is not an error.
      safe(() => {
        player.setOption('captions', 'track', enabled ? { languageCode: '' } : {});
        return true;
      }, false);
    },
    getTitle: () =>
      safe<string | null>(() => {
        const title = player.getVideoData?.()?.title;
        return typeof title === 'string' && title.trim().length > 0 ? title : null;
      }, null),
    getElement: () => safe<HTMLElement | null>(() => player.getIframe(), null),
    destroy: () => {
      safe(() => {
        player.destroy();
        return true;
      }, false);
    },
  };

  function safe<T>(fn: () => T, fallback: T): T {
    try {
      const value = fn();
      return value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))
        ? fallback
        : value;
    } catch {
      return fallback;
    }
  }
}
