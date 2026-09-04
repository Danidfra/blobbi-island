/**
 * The synchronization loop, driven by a player that actually advances.
 *
 * The bug this file exists for: with a session open, the player jumped back to
 * the beginning every few seconds and the session was unwatchable. The mechanism
 * was the passive drift check running on the HOST, correcting the host's own
 * player toward the host's own last published anchor. Whenever the two
 * disagreed (the commonest way being a play started from YouTube's own controls,
 * which publishes nothing), the check dragged the player back to the canonical
 * position, every tick, forever.
 *
 * The invariant: **the host's player is where positions come from.** It is never
 * corrected against a state derived from itself. Guests converge on the host, and
 * a correction never publishes anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { YT_STATE, resetYouTubeApiCacheForTests } from '@/lib/youtube-player';
import {
  CONTROL_RATE_LIMIT_MS,
  DRIFT_CHECK_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  ROOM_THEATER_MAIN,
  buildSessionEvent,
  createSessionContent,
  transition,
} from '@/lib/shared-playback';
import { TheaterStage } from './TheaterStage';
import { clearResumableSessionsForTests } from '@/hooks/useSharedPlayback';

const SEAT = 'theater-seat-a1';
const VIDEO = 'dQw4w9WgXcQ';
const ME = 'f'.repeat(64);
const HOST = 'a'.repeat(64);
const CODE = 'B7X4QP';
const DURATION = 300;

// ── Relay ──────────────────────────────────────────────────────────────────

function matches(filter: NostrFilter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue;
    const tagValues = event.tags.filter(([n]) => n === key.slice(1)).map(([, v]) => v);
    if (!(values as string[]).some((v) => tagValues.includes(v))) return false;
  }
  return true;
}

class FakeRelay {
  events: NostrEvent[] = [];
  private listeners = new Set<(event: NostrEvent) => void>();
  publish(event: NostrEvent): void {
    this.events.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }
  query(filters: NostrFilter[]): NostrEvent[] {
    return this.events.filter((e) => filters.some((f) => matches(f, e)));
  }
  subscribe(filters: NostrFilter[]): AsyncIterableIterator<unknown> {
    const queue: unknown[] = this.query(filters).map((e) => ['EVENT', 'sub', e]);
    let wake: (() => void) | null = null;
    const listener = (event: NostrEvent) => {
      if (!filters.some((f) => matches(f, event))) return;
      queue.push(['EVENT', 'sub', event]);
      wake?.();
    };
    this.listeners.add(listener);
    const stop = () => this.listeners.delete(listener);
    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if (queue.length) return { value: queue.shift()!, done: false };
        await new Promise<void>((resolve) => { wake = resolve; });
        wake = null;
        return { value: queue.shift()!, done: false };
      },
      async return() { stop(); return { value: undefined, done: true }; },
    } as AsyncIterableIterator<unknown>;
  }
  of(kind: number): NostrEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }
}

let relay = new FakeRelay();
let signCount = 0;

vi.mock('@nostrify/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nostrify/react');
  return {
    ...actual,
    useNostr: () => ({
      nostr: {
        query: async (filters: NostrFilter[]) => relay.query(filters),
        req: (filters: NostrFilter[]) => relay.subscribe(filters),
        event: async (event: NostrEvent) => relay.publish(event),
      },
    }),
  };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: ME,
      signer: {
        signEvent: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
          signCount += 1;
          return { ...t, id: `${signCount}`.padStart(64, '0'), pubkey: ME, sig: '0'.repeat(128) };
        },
      },
    },
  }),
}));

// ── A player whose clock actually runs ─────────────────────────────────────

interface RunningPlayer {
  videoId?: string;
  calls: string[];
  seeks: number[];
  playing: boolean;
  destroyed: boolean;
  /** Position at the last state change, plus elapsed time while playing. */
  anchor: number;
  anchorAt: number;
  /** Start playing WITHOUT going through the controller: YouTube's own button. */
  nativePlay: () => void;
  position: () => number;
}

let players: RunningPlayer[] = [];

function installRunningYouTube() {
  window.YT = {
    Player: class {
      constructor(element: HTMLElement | string, opts: {
        videoId?: string;
        events?: {
          onReady?: (e: { target: unknown }) => void;
          onStateChange?: (e: { data: number; target: unknown }) => void;
        };
      }) {
        const self = this as unknown as Record<string, unknown>;
        const iframe = document.createElement('iframe');
        if (element instanceof HTMLElement) element.replaceWith(iframe);

        const record: RunningPlayer = {
          videoId: opts.videoId,
          calls: [],
          seeks: [],
          playing: false,
          destroyed: false,
          anchor: 0,
          anchorAt: Date.now(),
          nativePlay: () => {
            record.anchor = record.position();
            record.anchorAt = Date.now();
            record.playing = true;
            opts.events?.onStateChange?.({ data: YT_STATE.PLAYING, target: self });
          },
          position: () =>
            record.playing ? record.anchor + (Date.now() - record.anchorAt) / 1000 : record.anchor,
        };
        players.push(record);

        Object.assign(self, {
          playVideo: () => { record.calls.push('play'); record.nativePlay(); },
          pauseVideo: () => {
            record.calls.push('pause');
            record.anchor = record.position();
            record.playing = false;
            opts.events?.onStateChange?.({ data: YT_STATE.PAUSED, target: self });
          },
          seekTo: (s: number) => {
            record.calls.push(`seek:${s.toFixed(2)}`);
            record.seeks.push(s);
            record.anchor = s;
            record.anchorAt = Date.now();
          },
          loadVideoById: () => {},
          cueVideoById: () => {},
          getCurrentTime: () => record.position(),
          getDuration: () => DURATION,
          getPlayerState: () => (record.playing ? YT_STATE.PLAYING : YT_STATE.PAUSED),
          getVideoLoadedFraction: () => 1,
          setPlaybackRate: (r: number) => record.calls.push(`rate:${r}`),
          getPlaybackRate: () => 1,
          getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
          setVolume: () => {}, getVolume: () => 100,
          mute: () => {}, unMute: () => {}, isMuted: () => false,
          getOptions: () => ['captions'], setOption: () => {},
          getIframe: () => iframe,
          getVideoData: () => ({ title: 'A Very Good Video', video_id: opts.videoId }),
          destroy: () => { record.destroyed = true; },
        });

        queueMicrotask(() => opts.events?.onReady?.({ target: self }));
      }
    } as never,
  };
}

async function settle(times = 4) {
  await act(async () => {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
  });
}

/** Advance real+fake time together, so the running player's clock moves. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  clearResumableSessionsForTests();
  relay = new FakeRelay();
  players = [];
  signCount = 0;
  resetYouTubeApiCacheForTests();
  installRunningYouTube();
  view = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
});

const player = () => players[players.length - 1];
const commands = () => relay.of(KIND_SHARED_PLAYBACK_COMMAND);
const sessions = () => relay.of(KIND_SHARED_PLAYBACK_SESSION);
const contentOf = (e: NostrEvent) => JSON.parse(e.content);

async function loadVideo() {
  fireEvent.change(screen.getByLabelText(/youtube url or video id/i), {
    target: { value: `https://www.youtube.com/watch?v=${VIDEO}` },
  });
  fireEvent.click(screen.getByRole('button', { name: /load video/i }));
  await settle();
}

let view: ReturnType<typeof render> | null = null;

async function hostASession() {
  view = render(<TheaterStage seatId={SEAT} />);
  await settle();
  await loadVideo();
  fireEvent.click(screen.getByRole('button', { name: /create watch session/i }));
  await waitFor(() => expect(sessions()).toHaveLength(1));
  await settle();
}

// ── Host ───────────────────────────────────────────────────────────────────

describe('the host is never corrected against its own state', () => {
  it('does not drag the player back when playback started outside our controls', async () => {
    // The exact reported case: the user pressed play on the YouTube embed, so
    // nothing was published and canonical is still "paused at 0": while the
    // player is happily advancing.
    await hostASession();
    act(() => player().nativePlay());
    await advance(4000);

    const before = player().seeks.length;
    for (let tick = 0; tick < 4; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    expect(player().seeks.slice(before)).toEqual([]);
    expect(player().position()).toBeGreaterThan(15);
  });

  it('leaves an ordinary hosted playback alone across many drift intervals', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);

    const seeksAfterPlay = player().seeks.length;
    for (let tick = 0; tick < 6; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    expect(player().seeks).toHaveLength(seeksAfterPlay);
    expect(player().position()).toBeGreaterThan(25);
  });

  it('publishes nothing from a passive drift check', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    // Let the play's own (rate-limited) publish land first, so what follows can
    // only be traffic the passive check caused.
    await advance(CONTROL_RATE_LIMIT_MS + 500);

    const before = relay.events.length;
    for (let tick = 0; tick < 3; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    // Only keepalives may have been added, and they carry no command.
    const added = relay.events.slice(before);
    expect(added.every((e) => e.kind === KIND_SHARED_PLAYBACK_SESSION)).toBe(true);
    expect(added.map((e) => contentOf(e).rev).every((rev) => rev === 1)).toBe(true);
  });

  it('re-anchors the keepalive from the LIVE player, not from arithmetic', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);

    // The player stalls: it stops advancing while the session still says playing.
    await advance(3000);
    act(() => {
      players[players.length - 1].playing = false; // a stall, not a pause command
    });
    const stalledAt = player().position();

    await advance(KEEPALIVE_INTERVAL_MS + 1000);

    const keepalives = sessions().filter((e) => contentOf(e).rev === 1);
    const last = contentOf(keepalives[keepalives.length - 1]);
    // Honest about where the host actually is, instead of pretending the
    // timeline advanced: which would leave every guest ahead of the host.
    expect(last.playback.position).toBeCloseTo(stalledAt, 0);
    expect(last.rev).toBe(1);
  });

  it('keeps a paused session pinned and publishes no correction', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    await advance(3000);
    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));
    await settle(6);
    await advance(CONTROL_RATE_LIMIT_MS + 500);

    const pause = contentOf(sessions()[sessions().length - 1]);
    expect(pause.playback.state).toBe('paused');
    const commandsBefore = commands().length;
    for (let tick = 0; tick < 3; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    expect(commands()).toHaveLength(commandsBefore);
    // Every keepalive of the PAUSED revision repeats the same playhead: a paused
    // session is time-independent, and nothing but a host action may move it.
    const keepalives = sessions().filter((e) => contentOf(e).rev === pause.rev);
    expect(keepalives.length).toBeGreaterThan(1);
    for (const keepalive of keepalives) {
      expect(contentOf(keepalive).playback.position).toBeCloseTo(pause.playback.position, 1);
    }
  });
});

// ── Guest ──────────────────────────────────────────────────────────────────

function publishHostSession(content: ReturnType<typeof createSessionContent>) {
  const unsigned = buildSessionEvent({
    sessionId: 'remote-session',
    room: ROOM_THEATER_MAIN,
    code: CODE,
    status: 'active',
    content,
    nowMs: Date.now(),
  });
  relay.publish({ ...unsigned, id: `${content.rev}`.padStart(64, 'b'), pubkey: HOST, sig: '0'.repeat(128) });
}

async function joinAsGuest() {
  view = render(<TheaterStage seatId={SEAT} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /join with code/i }));
  fireEvent.change(screen.getByLabelText(/watch session code/i), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
  await settle(10);
}

describe('a guest converges instead of oscillating', () => {
  it('seeks once for a large drift, then leaves the player alone', async () => {
    const base = createSessionContent({ provider: 'youtube', id: VIDEO }, Date.now());
    const playing = transition(base, { type: 'play', position: 120 }, Date.now()).content;
    publishHostSession(playing);

    await joinAsGuest();
    await advance(1000);
    const afterJoin = player().seeks.length;
    expect(afterJoin).toBeGreaterThan(0);
    expect(player().seeks[afterJoin - 1]).toBeGreaterThanOrEqual(120);

    // Now it is in step: three more checks must not touch it.
    for (let tick = 0; tick < 3; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);
    expect(player().seeks).toHaveLength(afterJoin);
  });

  it('never seeks repeatedly to the same target', async () => {
    const base = createSessionContent({ provider: 'youtube', id: VIDEO }, Date.now());
    publishHostSession(transition(base, { type: 'play', position: 60 }, Date.now()).content);

    await joinAsGuest();
    for (let tick = 0; tick < 5; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    const rounded = player().seeks.map((s) => Math.round(s));
    const duplicates = rounded.filter((s, i) => rounded.indexOf(s) !== i);
    expect(duplicates).toEqual([]);
  });

  it('publishes nothing at all while following', async () => {
    const base = createSessionContent({ provider: 'youtube', id: VIDEO }, Date.now());
    publishHostSession(transition(base, { type: 'play', position: 10 }, Date.now()).content);

    await joinAsGuest();
    const before = relay.events.filter((e) => e.pubkey === ME).length;
    for (let tick = 0; tick < 4; tick += 1) await advance(DRIFT_CHECK_INTERVAL_MS);

    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(before);
  });

  it('holds position when the session is paused', async () => {
    const base = createSessionContent({ provider: 'youtube', id: VIDEO }, Date.now());
    publishHostSession(transition(base, { type: 'seek', position: 45 }, Date.now()).content);

    await joinAsGuest();
    await advance(DRIFT_CHECK_INTERVAL_MS * 3);

    expect(player().playing).toBe(false);
    expect(player().position()).toBeCloseTo(45, 0);
  });
});

// ── Rebuilt players ────────────────────────────────────────────────────────

describe('a player rebuilt after a seat change', () => {
  it('carries a HOST across a seat change with no rebuild and no seek', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    await advance(20_000);
    const same = player();
    const seeksBefore = same.seeks.length;

    // Stand up: the chair is vacated, the screen is not.
    view!.rerender(<TheaterStage seatId={null} />);
    await settle(6);
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
    expect(same.playing).toBe(true);

    // Sit down again, in a different chair.
    view!.rerender(<TheaterStage seatId="theater-seat-b3" />);
    await settle(10);
    await advance(1000);

    // Same player object, still playing, and nothing had to be corrected: there
    // was never a moment when it was out of step to correct.
    expect(players).toHaveLength(1);
    expect(player()).toBe(same);
    expect(same.playing).toBe(true);
    expect(same.seeks).toHaveLength(seeksBefore);
  });

  it('rebuilds a HOST from canonical state when there really is no player', async () => {
    // The cold path: the theater was remounted (a shell relayout, Strict Mode),
    // so the session survives but the player does not.
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    await advance(20_000);
    const positionBefore = player().position();

    view!.unmount();
    await settle(4);
    view = render(<TheaterStage seatId={SEAT} />);
    await settle(12);
    await advance(1000);

    const rebuilt = player();
    expect(rebuilt.destroyed).toBe(false);
    expect(rebuilt.position()).toBeGreaterThan(positionBefore - 2);
    expect(rebuilt.playing).toBe(true);
  });

  it('keeps the session advancing while the host is standing', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    await advance(20_000);

    view!.rerender(<TheaterStage seatId={null} />);
    await settle(6);
    const anchorOnStanding = contentOf(sessions()[sessions().length - 1]).playback.position;

    // Two keepalives with nobody sitting down.
    await advance(KEEPALIVE_INTERVAL_MS * 2 + 1000);

    const latest = contentOf(sessions()[sessions().length - 1]).playback.position;
    // The film did not stop for everyone else because the host stood up.
    expect(latest).toBeGreaterThan(anchorOnStanding + 30);
  });

  it('keeps the session advancing when the host has NO player at all', async () => {
    await hostASession();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await settle(6);
    await advance(20_000);
    const anchorBefore = contentOf(sessions()[sessions().length - 1]).playback.position;

    view!.unmount();
    await settle(4);
    await advance(KEEPALIVE_INTERVAL_MS * 2 + 1000);

    // Nothing publishes once the theater is gone, so the last anchor stands,
    // and it is never rewound by a player that is not there.
    const latest = contentOf(sessions()[sessions().length - 1]).playback.position;
    expect(latest).toBeGreaterThanOrEqual(anchorBefore);
  });

  it('carries a GUEST across a seat change with the same player', async () => {
    const base = createSessionContent({ provider: 'youtube', id: VIDEO }, Date.now());
    publishHostSession(transition(base, { type: 'play', position: 90 }, Date.now()).content);

    await joinAsGuest();
    await advance(2000);
    expect(player().playing).toBe(true);
    const same = player();
    const seeksBefore = same.seeks.length;

    view!.rerender(<TheaterStage seatId={null} />);
    await settle(6);
    view!.rerender(<TheaterStage seatId="theater-seat-b3" />);
    await settle(10);
    await advance(1000);

    expect(players).toHaveLength(1);
    expect(player()).toBe(same);
    expect(same.playing).toBe(true);
    expect(same.position()).toBeGreaterThan(90);
    expect(same.seeks).toHaveLength(seeksBefore);
  });
});
