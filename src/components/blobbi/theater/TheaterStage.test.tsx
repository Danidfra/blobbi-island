/**
 * Behavioural coverage for the theater.
 *
 * These tests drive the real components against a fake `YT` global. They exist
 * because the previous suite tested the *parts*, the URL parser, the controller
 * against a fake adapter, and every one of them passed while the room was
 * visibly broken: it showed "Couldn't load the video player" to anyone who
 * walked in, and its Load Video button did nothing at all.
 *
 * So the assertions here are about what a person sees and does: is the card
 * there, is the curtain up, did pressing the button reach the player.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { TheaterStage } from './TheaterStage';
import { TestApp } from '@/test/TestApp';
import { AMBIGUOUS_PLAYBACK_MESSAGE, YT_STATE, resetYouTubeApiCacheForTests } from '@/lib/youtube-player';

const API_SRC = 'https://www.youtube.com/iframe_api';
const SEAT = 'theater-seat-a1';
const URL_OK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// ── Fake YouTube ───────────────────────────────────────────────────────────

interface FakePlayer {
  videoId?: string;
  calls: string[];
  fire: { state: (data: number) => void; error: (data: number) => void };
  destroyed: boolean;
}

let players: FakePlayer[] = [];
/** What the next constructed player does once it has "loaded". */
let behaviour: { kind: 'ready' } | { kind: 'error'; code: number } | { kind: 'hang' } = { kind: 'ready' };

interface FakeOptions {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: unknown }) => void;
    onStateChange?: (e: { data: number; target: unknown }) => void;
    onError?: (e: { data: number; target: unknown }) => void;
    onPlaybackRateChange?: (e: { data: number; target: unknown }) => void;
  };
}

function installFakeYouTube() {
  window.YT = {
    Player: class {
      constructor(element: HTMLElement | string, opts: FakeOptions) {
        const calls: string[] = [];
        const self = this as unknown as Record<string, unknown>;
        const iframe = document.createElement('iframe');
        if (element instanceof HTMLElement) element.replaceWith(iframe);

        const record: FakePlayer = {
          videoId: opts.videoId,
          calls,
          destroyed: false,
          fire: {
            state: (data) => opts.events?.onStateChange?.({ data, target: self }),
            error: (data) => opts.events?.onError?.({ data, target: self }),
          },
        };
        players.push(record);

        Object.assign(self, {
          playVideo: () => calls.push('play'),
          pauseVideo: () => calls.push('pause'),
          seekTo: (s: number) => calls.push(`seek:${s}`),
          loadVideoById: (id: string) => calls.push(`load:${id}`),
          cueVideoById: (id: string) => calls.push(`cue:${id}`),
          getCurrentTime: () => 12,
          getDuration: () => 300,
          getPlayerState: () => YT_STATE.PAUSED,
          getVideoLoadedFraction: () => 1,
          setPlaybackRate: (r: number) => calls.push(`rate:${r}`),
          getPlaybackRate: () => 1,
          getAvailablePlaybackRates: () => [0.5, 1, 2],
          setVolume: () => {},
          getVolume: () => 100,
          mute: () => calls.push('mute'),
          unMute: () => calls.push('unmute'),
          isMuted: () => false,
          getOptions: () => ['captions'],
          setOption: (m: string, o: string) => calls.push(`option:${m}.${o}`),
          getIframe: () => iframe,
          getVideoData: () => ({ title: 'A Very Good Video', video_id: opts.videoId }),
          destroy: () => { record.destroyed = true; calls.push('destroy'); },
        });

        // The API answers asynchronously, exactly as the real one does.
        const answer = behaviour;
        queueMicrotask(() => {
          if (answer.kind === 'ready') opts.events?.onReady?.({ target: self });
          else if (answer.kind === 'error') opts.events?.onError?.({ data: answer.code, target: self });
        });
      }
    } as never,
  };
}

/** Render, then let the fake player's microtask + React effects settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const card = () => document.querySelector<HTMLElement>('[data-theater-controls]');
const status = () => card()?.getAttribute('data-theater-status') ?? null;
const curtain = () => document.querySelector<HTMLElement>('[data-theater-curtain]');
const curtainOpen = () => curtain()?.getAttribute('data-curtain-open') === 'true';
const videoSurface = () => document.querySelector('[data-theater-screen]');

async function loadVideo(url = URL_OK) {
  fireEvent.change(screen.getByLabelText(/youtube url or video id/i), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: /load video/i }));
  await settle();
}

beforeEach(() => {
  players = [];
  behaviour = { kind: 'ready' };
  resetYouTubeApiCacheForTests();
  document.querySelectorAll(`script[src="${API_SRC}"]`).forEach((el) => el.remove());
  installFakeYouTube();
});

afterEach(() => {
  // Deliberately NOT vi.restoreAllMocks(): the shared test setup installs
  // ResizeObserver as a vi.fn() with an implementation, and restoring it strips
  // that implementation out from under Radix's slider for every later test.
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});

// ── Seating gate ───────────────────────────────────────────────────────────

describe('TheaterStage: before sitting down', () => {
  it('renders no card, no player and no error', async () => {
    render(<TheaterStage seatId={null} />, { wrapper: TestApp });
    await settle();

    expect(card()).toBeNull();
    expect(videoSurface()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/youtube url or video id/i)).toBeNull();
  });

  it('does not even fetch the YouTube API', async () => {
    // The old screen built a player at mount. Nobody standing in the aisle
    // should cost a network request, let alone an error message.
    resetYouTubeApiCacheForTests();
    delete window.YT;
    render(<TheaterStage seatId={null} />, { wrapper: TestApp });
    await settle();
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(0);
    expect(players).toHaveLength(0);
  });

  it('keeps the curtain closed', async () => {
    render(<TheaterStage seatId={null} />, { wrapper: TestApp });
    await settle();
    expect(curtainOpen()).toBe(false);
  });
});

// ── Seated, nothing chosen ─────────────────────────────────────────────────

describe('TheaterStage: seated with nothing playing', () => {
  it('shows the card with the URL input, and still no player', async () => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();

    expect(status()).toBe('seated-idle');
    expect(screen.getByLabelText(/youtube url or video id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load video/i })).toBeInTheDocument();
    expect(players).toHaveLength(0);
    expect(videoSurface()).toBeNull();
  });

  it('shows no player error before a video has been submitted', async () => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/couldn't/i)).toBeNull();
  });

  it('keeps the curtain closed', async () => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    expect(curtainOpen()).toBe(false);
  });

  it('appears only after arrival: mounting unseated then seating flips it on', async () => {
    const { rerender } = render(<TheaterStage seatId={null} />, { wrapper: TestApp });
    await settle();
    expect(card()).toBeNull();

    rerender(<TheaterStage seatId={SEAT} />);
    await settle();
    expect(card()).not.toBeNull();
  });
});

// ── Submitting a video ─────────────────────────────────────────────────────

describe('TheaterStage: loading a video', () => {
  it('reaches the player with the parsed id when Load Video is pressed', async () => {
    // The bug this pins: the button used to call `controller?.setMedia(...)` on
    // a controller that was always null, and nothing happened, silently.
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    expect(players).toHaveLength(1);
    expect(players[0].videoId).toBe('dQw4w9WgXcQ');
  });

  it.each([
    ['watch URL', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['short link', 'https://youtu.be/dQw4w9WgXcQ'],
    ['embed URL', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['shorts URL', 'https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['bare id', 'dQw4w9WgXcQ'],
    ['padded input', '   dQw4w9WgXcQ   '],
  ])('accepts a %s through the form, not just the parser', async (_label, input) => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo(input);

    expect(players).toHaveLength(1);
    expect(players[0].videoId).toBe('dQw4w9WgXcQ');
  });

  it('rejects malformed input without building a player', async () => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo('https://vimeo.com/12345');

    expect(players).toHaveLength(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(status()).toBe('seated-idle');
    expect(curtainOpen()).toBe(false);
  });

  it('submits via Enter as well as the button, and never navigates', async () => {
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();

    const form = document.querySelector('form')!;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent.change(screen.getByLabelText(/youtube url or video id/i), { target: { value: URL_OK } });
    await act(async () => {
      form.dispatchEvent(submitEvent);
      await Promise.resolve();
    });

    expect(submitEvent.defaultPrevented).toBe(true);
    await settle();
    expect(players).toHaveLength(1);
  });

  it('keeps the curtain closed while loading and says what it is doing', async () => {
    behaviour = { kind: 'hang' };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    expect(status()).toBe('loading-video');
    expect(screen.getByText(/loading video/i)).toBeInTheDocument();
    expect(curtainOpen()).toBe(false);
  });

  it('blocks a duplicate submission while one is in flight', async () => {
    behaviour = { kind: 'hang' };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    // The input is replaced by the loading row, so there is nothing to submit
    // twice: the strongest possible form of "disabled".
    expect(screen.queryByRole('button', { name: /load video/i })).toBeNull();
    expect(players).toHaveLength(1);
  });

  it('offers a way out while loading', async () => {
    behaviour = { kind: 'hang' };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    fireEvent.click(screen.getByRole('button', { name: /change video/i }));
    await settle();
    expect(status()).toBe('seated-idle');
    // A player that never became ready has no adapter to destroy, so the guard
    // is the DOM: the iframe is unmounted, which is what stops it.
    expect(videoSurface()).toBeNull();
  });
});

// ── Ready ──────────────────────────────────────────────────────────────────

describe('TheaterStage: video ready', () => {
  async function readyStage() {
    const view = render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();
    await waitFor(() => expect(status()).toBe('video-ready'));
    return view;
  }

  it('opens the curtain only once the player reports readiness', async () => {
    behaviour = { kind: 'hang' };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    // The iframe has mounted. That is NOT a reason to open the curtain.
    expect(videoSurface()).not.toBeNull();
    expect(curtainOpen()).toBe(false);
  });

  it('opens the curtain when the video is ready', async () => {
    await readyStage();
    expect(curtainOpen()).toBe(true);
  });

  it('keeps the curtain open without hover, and does not let hover close it', async () => {
    await readyStage();
    const block = curtain()!;

    fireEvent.mouseEnter(block);
    fireEvent.mouseLeave(block);
    fireEvent.touchStart(block);
    fireEvent.touchEnd(block);
    fireEvent.pointerOver(block);

    expect(curtainOpen()).toBe(true);
  });

  it('shows the full control surface', async () => {
    await readyStage();
    for (const name of [/^play$/i, /^restart$/i, /skip back 10/i, /skip forward 10/i, /playback speed/i, /^fullscreen$/i, /captions/i, /change video/i, /^mute$/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Timeline')).toBeInTheDocument();
  });

  it('routes every control through the controller to the player', async () => {
    await readyStage();
    const calls = () => players[0].calls;

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    expect(calls()).toContain('play');

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(calls()).toContain('pause');

    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(calls()).toContain('seek:0');

    fireEvent.click(screen.getByRole('button', { name: /skip forward 10/i }));
    expect(calls().some((c) => c.startsWith('seek:'))).toBe(true);
  });

  it('shows a title when the embed offers one', async () => {
    await readyStage();
    await waitFor(() => expect(screen.getByText('A Very Good Video')).toBeInTheDocument());
  });

  it('says so honestly when the browser refuses fullscreen', async () => {
    await readyStage();
    // jsdom has no Fullscreen API at all, which is exactly the refusal case.
    fireEvent.click(screen.getByRole('button', { name: /fullscreen/i }));
    await waitFor(() => expect(screen.getByText(/wouldn't open fullscreen/i)).toBeInTheDocument());
  });

  it('closes the curtain and releases the player on Change video', async () => {
    await readyStage();
    expect(curtainOpen()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /change video/i }));
    await settle();

    expect(curtainOpen()).toBe(false);
    expect(status()).toBe('seated-idle');
    expect(screen.getByLabelText(/youtube url or video id/i)).toBeInTheDocument();
    expect(players[0].destroyed).toBe(true);
  });

  it('closes the curtain, hides the card and stops the audio when the seat is left', async () => {
    const { rerender } = await readyStage();

    rerender(<TheaterStage seatId={null} />);
    await settle();

    expect(card()).toBeNull();
    expect(curtainOpen()).toBe(false);
    expect(videoSurface()).toBeNull();
    expect(players[0].destroyed).toBe(true);
  });

  it('resets rather than following the Blobbi to another seat', async () => {
    const { rerender } = await readyStage();

    rerender(<TheaterStage seatId="theater-seat-c3" />);
    await settle();

    expect(status()).toBe('seated-idle');
    expect(curtainOpen()).toBe(false);
    expect(players[0].destroyed).toBe(true);
  });

  it('comes back clean after leaving and re-entering', async () => {
    const { rerender } = await readyStage();
    rerender(<TheaterStage seatId={null} />);
    await settle();
    rerender(<TheaterStage seatId={SEAT} />);
    await settle();

    expect(status()).toBe('seated-idle');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(curtainOpen()).toBe(false);
  });
});

// ── Failures ───────────────────────────────────────────────────────────────

describe('TheaterStage: failure states', () => {
  it.each([
    [100, 'unavailable or private'],
    [101, 'embedding disabled'],
    [150, 'embedding disabled'],
  ])('reports YouTube error %s with honest, non-committal copy', async (code) => {
    behaviour = { kind: 'error', code };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    await waitFor(() => expect(status()).toBe('video-error'));
    expect(screen.getByRole('alert')).toHaveTextContent(AMBIGUOUS_PLAYBACK_MESSAGE);
    // No guess about which of the possible causes it was.
    expect(card()!.textContent).not.toMatch(/private|region|deleted|the owner/i);
  });

  it('keeps the curtain closed and the input available after a failure', async () => {
    behaviour = { kind: 'error', code: 150 };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();
    await waitFor(() => expect(status()).toBe('video-error'));

    expect(curtainOpen()).toBe(false);
    expect(screen.getByLabelText(/youtube url or video id/i)).toBeInTheDocument();
  });

  it('lets the next video be tried immediately after a failure', async () => {
    behaviour = { kind: 'error', code: 100 };
    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();
    await waitFor(() => expect(status()).toBe('video-error'));

    behaviour = { kind: 'ready' };
    await loadVideo('https://youtu.be/abcdefghijk');
    await waitFor(() => expect(status()).toBe('video-ready'));

    expect(players).toHaveLength(2);
    expect(players[1].videoId).toBe('abcdefghijk');
    expect(curtainOpen()).toBe(true);
  });

  it('reports a genuinely unreachable API separately, with a retry', async () => {
    // No `YT` at all and a script that fails: the projector, not the film.
    delete window.YT;
    resetYouTubeApiCacheForTests();

    render(<TheaterStage seatId={SEAT} />, { wrapper: TestApp });
    await settle();
    await loadVideo();

    const script = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    expect(script).not.toBeNull();
    await act(async () => {
      script!.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't reach youtube/i));
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(curtainOpen()).toBe(false);
  });
});

// ── Strict Mode ────────────────────────────────────────────────────────────

describe('TheaterStage: React Strict Mode', () => {
  it('survives double-invoked effects with one live player and one script', async () => {
    delete window.YT;
    resetYouTubeApiCacheForTests();

    render(
      <StrictMode>
        <TheaterStage seatId={SEAT} />
      </StrictMode>,
      { wrapper: TestApp },
    );
    await settle();
    await loadVideo();

    // Strict Mode mounts, unmounts and remounts the effect. Whatever it built
    // the first time must be gone, and exactly one script tag may exist.
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(1);

    installFakeYouTube();
    window.onYouTubeIframeAPIReady?.();
    await settle();

    await waitFor(() => expect(status()).toBe('video-ready'));
    const live = players.filter((p) => !p.destroyed);
    expect(live).toHaveLength(1);
  });
});
