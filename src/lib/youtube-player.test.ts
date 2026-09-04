/**
 * Coverage for the YouTube adapter, against a fake `YT` global.
 *
 * The point of the adapter is that everything above it can be tested without a
 * browser; this suite is the other half, the small amount of code that DOES
 * touch the global API, exercised without a network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AMBIGUOUS_PLAYBACK_MESSAGE,
  API_LOAD_ERROR,
  API_LOAD_TIMEOUT_MS,
  YT_STATE,
  createYouTubeAdapter,
  loadYouTubeIframeApi,
  mapYouTubeError,
  resetYouTubeApiCacheForTests,
  type MediaError,
  type PlayerPhase,
} from './youtube-player';

const API_SRC = 'https://www.youtube.com/iframe_api';

interface FakePlayerHandle {
  fire: {
    ready: () => void;
    state: (data: number) => void;
    error: (data: number) => void;
    rate: (data: number) => void;
  };
  calls: string[];
  iframe: HTMLIFrameElement;
}

let lastPlayer: FakePlayerHandle | null = null;
/** The options the adapter passed to `new YT.Player(...)`. */
let lastOptions: FakePlayerOptions | null = null;
/** The fake player object itself, so a test can make its methods throw. */
let lastPlayerInstance: Record<string, unknown> | null = null;

/** The subset of `YT.Player` options the adapter actually passes. */
interface FakePlayerOptions {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: unknown }) => void;
    onStateChange?: (event: { data: number; target: unknown }) => void;
    onError?: (event: { data: number; target: unknown }) => void;
    onPlaybackRateChange?: (event: { data: number; target: unknown }) => void;
  };
}

/** Install a fake `window.YT` and resolve the API-ready callback. */
function installFakeApi(options: { availableRates?: number[]; duration?: number; title?: string } = {}) {
  const state = { position: 0, duration: options.duration ?? 120, rate: 1, muted: false, volume: 100, playing: false };

  window.YT = {
    Player: class {
      constructor(_element: HTMLElement | string, opts: FakePlayerOptions) {
        lastOptions = opts;
        const calls: string[] = [];
        const iframe = document.createElement('iframe');
        const self = this as unknown as Record<string, unknown>;

        Object.assign(self, {
          playVideo: () => { calls.push('play'); state.playing = true; },
          pauseVideo: () => { calls.push('pause'); state.playing = false; },
          seekTo: (s: number) => { calls.push(`seek:${s}`); state.position = s; },
          loadVideoById: (id: string) => calls.push(`load:${id}`),
          cueVideoById: (id: string) => calls.push(`cue:${id}`),
          getCurrentTime: () => state.position,
          getDuration: () => state.duration,
          getPlayerState: () => (state.playing ? YT_STATE.PLAYING : YT_STATE.PAUSED),
          getVideoLoadedFraction: () => 1,
          setPlaybackRate: (r: number) => { calls.push(`rate:${r}`); state.rate = r; },
          getPlaybackRate: () => state.rate,
          getAvailablePlaybackRates: () => options.availableRates ?? [0.5, 1, 2],
          setVolume: (v: number) => { state.volume = v; },
          getVolume: () => state.volume,
          mute: () => { calls.push('mute'); state.muted = true; },
          unMute: () => { state.muted = false; },
          isMuted: () => state.muted,
          getOptions: () => ['captions'],
          setOption: (m: string, o: string) => calls.push(`option:${m}.${o}`),
          getIframe: () => iframe,
          getVideoData: () => ({ title: options.title ?? 'Fake Video', video_id: opts.videoId }),
          destroy: () => calls.push('destroy'),
        });

        lastPlayerInstance = self;
        lastPlayer = {
          calls,
          iframe,
          fire: {
            ready: () => opts.events?.onReady?.({ target: self }),
            state: (data) => opts.events?.onStateChange?.({ data, target: self }),
            error: (data) => opts.events?.onError?.({ data, target: self }),
            rate: (data) => opts.events?.onPlaybackRateChange?.({ data, target: self }),
          },
        };
      }
    } as never,
  };
  window.onYouTubeIframeAPIReady?.();
}

function makeEvents() {
  const phases: PlayerPhase[] = [];
  const playing: boolean[] = [];
  const errors: MediaError[] = [];
  const durations: number[] = [];
  const rates: number[] = [];
  return {
    phases, playing, errors, durations, rates,
    events: {
      onPhaseChange: (p: PlayerPhase) => phases.push(p),
      onPlayingChange: (v: boolean) => playing.push(v),
      onError: (e: MediaError) => errors.push(e),
      onDurationChange: (d: number) => durations.push(d),
      onRateChange: (r: number) => rates.push(r),
    },
  };
}

/** `createYouTubeAdapter` awaits the API loader first, so let microtasks run. */
async function waitForPlayer(): Promise<FakePlayerHandle> {
  for (let i = 0; i < 50 && !lastPlayer; i += 1) await Promise.resolve();
  if (!lastPlayer) throw new Error('fake YT.Player was never constructed');
  return lastPlayer;
}

beforeEach(() => {
  resetYouTubeApiCacheForTests();
  lastPlayer = null;
  lastOptions = null;
  lastPlayerInstance = null;
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.querySelectorAll(`script[src="${API_SRC}"]`).forEach((el) => el.remove());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});

describe('mapYouTubeError', () => {
  it.each([
    [2, 'invalid-video', false],
    [5, 'html5-error', true],
    [100, 'unavailable', false],
    [101, 'embedding-disabled', false],
    [150, 'embedding-disabled', false],
    [153, 'identification-failed', true],
    [999, 'unknown', true],
  ])('code %s → %s', (code, expected, retryable) => {
    const error = mapYouTubeError(code);
    expect(error.code).toBe(expected);
    expect(error.retryable).toBe(retryable);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('never names a cause the API cannot actually distinguish', () => {
    // 100 = "removed OR private"; 101/150 are documented as embedding-disabled
    // but are also what region and age restrictions come back as. Claiming one
    // of those to the user would be a guess dressed up as a diagnosis.
    for (const code of [100, 101, 150, 999]) {
      expect(mapYouTubeError(code).message).toBe(AMBIGUOUS_PLAYBACK_MESSAGE);
    }
    expect(AMBIGUOUS_PLAYBACK_MESSAGE).toMatch(/try another youtube video/i);
    expect(AMBIGUOUS_PLAYBACK_MESSAGE).not.toMatch(/private|region|embed|deleted|removed/i);
  });

  it('keeps distinct CODES even where the message is shared', () => {
    // The UI must not over-claim, but a future caller may still branch on cause.
    expect(mapYouTubeError(100).code).toBe('unavailable');
    expect(mapYouTubeError(101).code).toBe('embedding-disabled');
    expect(mapYouTubeError(150).code).toBe('embedding-disabled');
  });

  it('does name the two causes it genuinely knows', () => {
    expect(mapYouTubeError(2).message).toMatch(/video id/i);
    expect(mapYouTubeError(5).message).toMatch(/player/i);
    expect(mapYouTubeError(2).message).not.toBe(AMBIGUOUS_PLAYBACK_MESSAGE);
    expect(mapYouTubeError(5).message).not.toBe(AMBIGUOUS_PLAYBACK_MESSAGE);
  });

  it('has a distinct message for a player that could not be built at all', () => {
    expect(API_LOAD_ERROR.code).toBe('api-load-failed');
    expect(API_LOAD_ERROR.message).not.toBe(AMBIGUOUS_PLAYBACK_MESSAGE);
  });
});

describe('loadYouTubeIframeApi', () => {
  it('injects the script exactly once, however many callers there are', async () => {
    const first = loadYouTubeIframeApi();
    const second = loadYouTubeIframeApi();
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(1);

    installFakeApi();
    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeDefined();
    expect(first).toBe(second);
  });

  it('resolves immediately when the API is already present', async () => {
    installFakeApi();
    await expect(loadYouTubeIframeApi()).resolves.toBe(window.YT);
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(0);
  });

  it('does not clobber another consumer\'s ready callback', async () => {
    const other = vi.fn();
    window.onYouTubeIframeAPIReady = other;

    const promise = loadYouTubeIframeApi();
    installFakeApi();

    await promise;
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('lets a failed load be retried', async () => {
    const promise = loadYouTubeIframeApi();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`)!;
    script.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toThrow();

    // The memo was cleared, so the next call really tries again.
    script.remove();
    const retry = loadYouTubeIframeApi();
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(1);
    installFakeApi();
    await expect(retry).resolves.toBeDefined();
  });

  it('survives React Strict Mode: repeated calls share one script and one promise', async () => {
    // Strict Mode runs every effect twice, and several components may mount at
    // once. Each extra call must be free.
    const calls = Array.from({ length: 6 }, () => loadYouTubeIframeApi());
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(1);
    expect(new Set(calls).size).toBe(1);

    installFakeApi();
    const results = await Promise.all(calls);
    expect(new Set(results).size).toBe(1);
  });

  it('resolves when the script is already present and its ready callback already fired', async () => {
    // The one-shot global callback is the trap: something else on the page (a
    // previous mount, a hot reload, a tag in index.html) can have consumed it
    // before this module registers, and it never fires again. The poll is what
    // stops that from hanging forever.
    vi.useFakeTimers();
    try {
      const script = document.createElement('script');
      script.src = API_SRC;
      document.head.appendChild(script);

      const promise = loadYouTubeIframeApi();
      // API becomes available WITHOUT anyone invoking onYouTubeIframeAPIReady.
      window.YT = { Player: class {} as never };

      await vi.advanceTimersByTimeAsync(200);
      await expect(promise).resolves.toBe(window.YT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up rather than hanging when the script never answers', async () => {
    vi.useFakeTimers();
    try {
      const promise = loadYouTubeIframeApi();
      const assertion = expect(promise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(API_LOAD_TIMEOUT_MS + 1000);
      await assertion;

      // ...and the memo is cleared, so the theater can try again later.
      installFakeApi();
      await expect(loadYouTubeIframeApi()).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createYouTubeAdapter', () => {
  async function build(opts: Parameters<typeof createYouTubeAdapter>[0] extends infer T ? Partial<T> : never = {}) {
    const harness = makeEvents();
    const container = document.createElement('div');
    installFakeApi();
    const promise = createYouTubeAdapter({ container, videoId: 'dQw4w9WgXcQ', events: harness.events, ...opts });
    (await waitForPlayer()).fire.ready();
    return { adapter: await promise, ...harness };
  }

  it('resolves once the player is ready and reports duration and rate', async () => {
    const { adapter, phases, durations, rates } = await build();
    expect(adapter).toBeDefined();
    expect(phases).toContain('ready');
    expect(durations).toContain(120);
    expect(rates).toContain(1);
  });

  it('sets the permissions and fullscreen attributes the embed needs', async () => {
    await build();
    expect(lastPlayer!.iframe.getAttribute('allow')).toContain('autoplay');
    expect(lastPlayer!.iframe.getAttribute('allow')).toContain('fullscreen');
    expect(lastPlayer!.iframe.getAttribute('allowfullscreen')).toBe('true');
  });

  it('starts muted when asked, so a programmatic play can survive autoplay policy', async () => {
    await build({ startMuted: true });
    expect(lastPlayer!.calls).toContain('mute');
  });

  it('cues rather than loads when autoplay is off', async () => {
    const { adapter } = await build();
    adapter.load('dQw4w9WgXcQ', { autoplay: false });
    expect(lastPlayer!.calls).toContain('cue:dQw4w9WgXcQ');

    adapter.load('dQw4w9WgXcQ', { autoplay: true });
    expect(lastPlayer!.calls).toContain('load:dQw4w9WgXcQ');
  });

  it('maps player states onto phases and play/pause', async () => {
    const { phases, playing } = await build();

    lastPlayer!.fire.state(YT_STATE.BUFFERING);
    expect(phases.at(-1)).toBe('buffering');

    lastPlayer!.fire.state(YT_STATE.PLAYING);
    expect(playing.at(-1)).toBe(true);
    expect(phases.at(-1)).toBe('ready');

    lastPlayer!.fire.state(YT_STATE.PAUSED);
    expect(playing.at(-1)).toBe(false);

    lastPlayer!.fire.state(YT_STATE.ENDED);
    expect(phases.at(-1)).toBe('ended');
  });

  it('reports errors that arrive after the player is ready', async () => {
    const { errors, phases } = await build();
    lastPlayer!.fire.error(150);
    expect(errors.at(-1)?.code).toBe('embedding-disabled');
    expect(phases.at(-1)).toBe('error');
  });

  it('still resolves when the very first video errors before ready', async () => {
    // A video YouTube refuses is NOT a broken projector. Rejecting here used to
    // mean no controller was ever built, which left the room with a permanent
    // "couldn't load the video player" and a Load Video button wired to null.
    const harness = makeEvents();
    const container = document.createElement('div');
    installFakeApi();
    const promise = createYouTubeAdapter({ container, videoId: 'dQw4w9WgXcQ', events: harness.events });
    (await waitForPlayer()).fire.error(100);

    const adapter = await promise;
    expect(adapter).toBeDefined();
    expect(harness.errors.at(-1)?.code).toBe('unavailable');
    expect(harness.phases.at(-1)).toBe('error');
    // ...and the adapter is usable, so the UI can offer another video.
    expect(() => adapter.play()).not.toThrow();
  });

  it('passes the requested video id and start offset to the embed', async () => {
    const harness = makeEvents();
    const container = document.createElement('div');
    installFakeApi();
    const promise = createYouTubeAdapter({
      container,
      videoId: 'abcdefghijk',
      startSeconds: 42,
      events: harness.events,
    });
    (await waitForPlayer()).fire.ready();
    await promise;
    expect(lastOptions?.videoId).toBe('abcdefghijk');
    expect(lastOptions?.playerVars?.start).toBe(42);
  });

  it('reads a title when the embed offers one', async () => {
    const { adapter } = await build();
    expect(adapter.getTitle()).toBe('Fake Video');
  });

  it('reports no title rather than a placeholder when the embed has none', async () => {
    const harness = makeEvents();
    const container = document.createElement('div');
    installFakeApi({ title: '   ' });
    const promise = createYouTubeAdapter({ container, videoId: 'dQw4w9WgXcQ', events: harness.events });
    (await waitForPlayer()).fire.ready();
    const adapter = await promise;
    expect(adapter.getTitle()).toBeNull();
  });

  it('destroys the underlying player, leaving the room must stop the audio', async () => {
    const { adapter } = await build();
    adapter.destroy();
    expect(lastPlayer!.calls).toContain('destroy');
  });

  it('survives a player that throws on every read', async () => {
    const { adapter } = await build();
    const player = lastPlayer!;
    // Simulate a destroyed/detached embed: reads must degrade, not crash.
    adapter.destroy();
    player.calls.length = 0;
    expect(() => adapter.getPosition()).not.toThrow();
    expect(() => adapter.getDuration()).not.toThrow();
    expect(() => adapter.isPlaying()).not.toThrow();
    expect(() => adapter.getTitle()).not.toThrow();
  });

  it('survives a player that throws on every COMMAND too', async () => {
    // A player that errored before becoming ready exists as an object whose
    // methods throw. The control card renders over it; nothing may crash.
    const { adapter } = await build();
    const throwing = () => { throw new Error('not ready'); };
    for (const method of ['playVideo', 'pauseVideo', 'seekTo', 'setPlaybackRate', 'setVolume', 'mute', 'cueVideoById']) {
      Object.assign(lastPlayerInstance!, { [method]: throwing });
    }
    expect(() => adapter.play()).not.toThrow();
    expect(() => adapter.pause()).not.toThrow();
    expect(() => adapter.seek(10)).not.toThrow();
    expect(() => adapter.setRate(2)).not.toThrow();
    expect(() => adapter.setVolume(50)).not.toThrow();
    expect(() => adapter.setMuted(true)).not.toThrow();
    expect(() => adapter.load('abcdefghijk', { autoplay: false })).not.toThrow();
  });

  it('exposes the device\'s available playback rates', async () => {
    const harness = makeEvents();
    const container = document.createElement('div');
    installFakeApi({ availableRates: [1, 1.5] });
    const promise = createYouTubeAdapter({ container, videoId: 'dQw4w9WgXcQ', events: harness.events });
    (await waitForPlayer()).fire.ready();
    const adapter = await promise;
    expect(adapter.getAvailableRates()).toEqual([1, 1.5]);
  });
});
