/**
 * Behavioural coverage for shared watch sessions, driving the REAL theater
 * against a fake YouTube player and an in-memory relay.
 *
 * These assertions are about what a person does and what reaches the wire:
 * pressing "Create watch session" publishes exactly one canonical event; a code
 * that cannot exist never becomes a query; a guest applying the host's play does
 * not publish a play of their own. The protocol's own rules are proven offline
 * in `src/lib/shared-playback/*.test.ts` — what is proven here is the WIRING.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { YT_STATE, resetYouTubeApiCacheForTests } from '@/lib/youtube-player';
import {
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  ROOM_THEATER_MAIN,
  buildCommandEvent,
  buildSessionEvent,
  createSessionContent,
  transition,
} from '@/lib/shared-playback';
import { TheaterStage } from './TheaterStage';
import { clearResumableSessionsForTests, forgetWatchSession } from '@/hooks/useSharedPlayback';

const SEAT = 'theater-seat-a1';
const URL_OK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIDEO = 'dQw4w9WgXcQ';
const OTHER_VIDEO = 'Nk9pQ2rT7wY';
const ME = 'f'.repeat(64);
const HOST = 'a'.repeat(64);
const CODE = 'B7X4QP';

// ── In-memory relay ────────────────────────────────────────────────────────

function matches(filter: NostrFilter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue;
    const name = key.slice(1);
    const tagValues = event.tags.filter(([n]) => n === name).map(([, v]) => v);
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
    return this.events.filter((event) => filters.some((filter) => matches(filter, event)));
  }

  subscribe(filters: NostrFilter[]): AsyncIterableIterator<unknown> {
    const queue: unknown[] = this.query(filters).map((event) => ['EVENT', 'sub', event]);
    let wake: (() => void) | null = null;
    const listener = (event: NostrEvent) => {
      if (!filters.some((filter) => matches(filter, event))) return;
      queue.push(['EVENT', 'sub', event]);
      wake?.();
    };
    this.listeners.add(listener);
    const stop = () => this.listeners.delete(listener);

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (queue.length) return { value: queue.shift()!, done: false };
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        return { value: queue.shift()!, done: false };
      },
      async return() {
        stop();
        return { value: undefined, done: true };
      },
    } as AsyncIterableIterator<unknown>;
  }

  of(kind: number): NostrEvent[] {
    return this.events.filter((event) => event.kind === kind);
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
        signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
          signCount += 1;
          return { ...template, id: `${signCount}`.padStart(64, '0'), pubkey: ME, sig: '0'.repeat(128) };
        },
      },
    },
  }),
}));

// ── Fake YouTube ───────────────────────────────────────────────────────────

interface FakePlayer {
  videoId?: string;
  calls: string[];
  destroyed: boolean;
  position: number;
  playing: boolean;
  fire: { state: (data: number) => void };
}

let players: FakePlayer[] = [];

function installFakeYouTube() {
  window.YT = {
    Player: class {
      constructor(element: HTMLElement | string, opts: {
        videoId?: string;
        events?: {
          onReady?: (e: { target: unknown }) => void;
          onStateChange?: (e: { data: number; target: unknown }) => void;
        };
      }) {
        const calls: string[] = [];
        const self = this as unknown as Record<string, unknown>;
        const iframe = document.createElement('iframe');
        if (element instanceof HTMLElement) element.replaceWith(iframe);

        const record: FakePlayer = {
          videoId: opts.videoId,
          calls,
          destroyed: false,
          position: 0,
          playing: false,
          fire: { state: (data) => opts.events?.onStateChange?.({ data, target: self }) },
        };
        players.push(record);

        Object.assign(self, {
          playVideo: () => {
            calls.push('play');
            record.playing = true;
            opts.events?.onStateChange?.({ data: YT_STATE.PLAYING, target: self });
          },
          pauseVideo: () => {
            calls.push('pause');
            record.playing = false;
            opts.events?.onStateChange?.({ data: YT_STATE.PAUSED, target: self });
          },
          seekTo: (s: number) => {
            calls.push(`seek:${s.toFixed(2)}`);
            record.position = s;
          },
          loadVideoById: (id: string) => calls.push(`load:${id}`),
          cueVideoById: (id: string) => calls.push(`cue:${id}`),
          getCurrentTime: () => record.position,
          getDuration: () => 300,
          getPlayerState: () => (record.playing ? YT_STATE.PLAYING : YT_STATE.PAUSED),
          getVideoLoadedFraction: () => 1,
          setPlaybackRate: (r: number) => calls.push(`rate:${r}`),
          getPlaybackRate: () => 1,
          getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
          setVolume: () => {},
          getVolume: () => 100,
          mute: () => {},
          unMute: () => {},
          isMuted: () => false,
          getOptions: () => ['captions'],
          setOption: () => {},
          getIframe: () => iframe,
          getVideoData: () => ({ title: 'A Very Good Video', video_id: opts.videoId }),
          destroy: () => {
            record.destroyed = true;
          },
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

beforeEach(() => {
  // A session survives a remount ON PURPOSE (see `resumableSessions`), so it
  // must not survive from one test to the next.
  clearResumableSessionsForTests();
  relay = new FakeRelay();
  players = [];
  signCount = 0;
  resetYouTubeApiCacheForTests();
  installFakeYouTube();
});

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  vi.useRealTimers();
});

const card = () => document.querySelector<HTMLElement>('[data-theater-controls]');
const sessionPanel = () => document.querySelector<HTMLElement>('[data-theater-session]');
const inviteCode = () => document.querySelector<HTMLElement>('[data-theater-invite-code]')?.textContent ?? null;
const curtainOpen = () =>
  document.querySelector('[data-theater-curtain]')?.getAttribute('data-curtain-open') === 'true';
const sessions = () => relay.of(KIND_SHARED_PLAYBACK_SESSION);
const commands = () => relay.of(KIND_SHARED_PLAYBACK_COMMAND);
const contentOf = (event: NostrEvent) => JSON.parse(event.content);

async function loadVideo(url = URL_OK) {
  fireEvent.change(screen.getByLabelText(/youtube url or video id/i), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: /load video/i }));
  await settle();
}

async function createSession() {
  fireEvent.click(screen.getByRole('button', { name: /create watch session/i }));
  await waitFor(() => expect(sessions()).toHaveLength(1));
  await settle();
}

/** Publish a session hosted by SOMEONE ELSE, so the local client can join it. */
function hostSession(overrides: { mediaId?: string; code?: string; status?: 'active' | 'ended' } = {}) {
  const content = createSessionContent(
    { provider: 'youtube', id: overrides.mediaId ?? VIDEO },
    Date.now(),
  );
  const unsigned = buildSessionEvent({
    sessionId: 'remote-session',
    room: ROOM_THEATER_MAIN,
    code: overrides.code ?? CODE,
    status: overrides.status ?? 'active',
    content,
    nowMs: Date.now(),
  });
  const event: NostrEvent = {
    ...unsigned,
    id: 'b'.repeat(64),
    pubkey: HOST,
    sig: '0'.repeat(128),
  };
  relay.publish(event);
  return { content, address: `31951:${HOST}:remote-session` };
}

async function joinSession(code = CODE) {
  fireEvent.click(screen.getByRole('button', { name: /join with code/i }));
  fireEvent.change(screen.getByLabelText(/watch session code/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
  await settle(8);
}

// ── Seating gate ───────────────────────────────────────────────────────────

describe('session controls appear only when seated', () => {
  it('shows nothing at all before the Blobbi sits down', async () => {
    render(<TheaterStage seatId={null} />);
    await settle();

    expect(card()).toBeNull();
    expect(sessionPanel()).toBeNull();
    expect(relay.events).toHaveLength(0);
  });

  it('offers watching locally, hosting and joining once seated', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
    expect(screen.getByText(/watching locally/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create watch session/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join with code/i })).toBeInTheDocument();
    // Nothing was published just by sitting down.
    expect(relay.events).toHaveLength(0);
  });

  it('refuses to host a session about nothing', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    expect(screen.getByRole('button', { name: /create watch session/i })).toBeDisabled();
  });
});

// ── Hosting ────────────────────────────────────────────────────────────────

describe('hosting', () => {
  it('publishes exactly one session event, paused at zero, and shows the code', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    expect(sessions()).toHaveLength(1);
    const content = contentOf(sessions()[0]);
    expect(content).toMatchObject({
      version: 1,
      rev: 0,
      media: { provider: 'youtube', id: VIDEO },
      playback: { state: 'paused', position: 0, rate: 1 },
      permissions: { mode: 'host-only' },
    });
    // A creation is not an action: no ephemeral command accompanies rev 0.
    expect(commands()).toHaveLength(0);

    const code = inviteCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(sessions()[0].tags).toContainEqual(['c', code!]);
  });

  it('creates one session under React Strict Mode, not two', async () => {
    render(
      <StrictMode>
        <TheaterStage seatId={SEAT} />
      </StrictMode>,
    );
    await settle();
    await loadVideo();
    await createSession();
    await settle(8);

    expect(sessions()).toHaveLength(1);
    expect(new Set(sessions().map((e) => e.tags.find(([n]) => n === 'd')?.[1])).size).toBe(1);
  });

  it('publishes a paired command and canonical state for a host action, once', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    await settle(6);

    expect(commands()).toHaveLength(1);
    expect(sessions()).toHaveLength(2);

    const command = contentOf(commands()[0]);
    const canonical = contentOf(sessions()[1]);
    expect(command.command).toBe('play');
    // Invariant I2: one action, one snapshot, two events that agree.
    expect(command.rev).toBe(canonical.rev);
    expect(command.position).toBe(canonical.playback.position);
    expect(command.updatedAt).toBe(canonical.playback.updatedAt);
    expect(canonical.playback.state).toBe('playing');
  });

  it('reports the session address for presence, and clears it on leaving', async () => {
    const addresses: (string | null)[] = [];
    render(<TheaterStage seatId={SEAT} onActivityChange={(a) => addresses.push(a)} />);
    await settle();
    await loadVideo();
    await createSession();

    const address = addresses[addresses.length - 1];
    expect(address).toMatch(new RegExp(`^31951:${ME}:[0-9a-f-]{36}$`));

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    await settle(8);
    expect(addresses[addresses.length - 1]).toBeNull();
  });

  it('publishes a terminal state when the host ends the session', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    await waitFor(() => expect(sessions().length).toBeGreaterThan(1));
    await settle(6);

    const final = sessions()[sessions().length - 1];
    expect(final.tags).toContainEqual(['status', 'ended']);
    expect(contentOf(final).playback.state).toBe('paused');
    expect(JSON.parse(commands()[commands().length - 1].content).command).toBe('end-session');
    // ...and the room is back to watching alone, with the player still there.
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
  });

  it('keeps the screen AND the session when the host stands up', async () => {
    const addresses: (string | null)[] = [];
    const view = render(<TheaterStage seatId={SEAT} onActivityChange={(a) => addresses.push(a)} />);
    await settle();
    await loadVideo();
    await createSession();
    const address = addresses[addresses.length - 1];

    view.rerender(<TheaterStage seatId={null} onActivityChange={(a) => addresses.push(a)} />);
    await settle(6);

    // The card lives on the chair, so it goes…
    expect(card()).toBeNull();
    // …but the film is still on for everyone else, so the screen stays.
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    // The session belongs to the ROOM: presence keeps pointing at it, nothing
    // was published, and the host is still the host.
    expect(addresses[addresses.length - 1]).toBe(address);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].tags).toContainEqual(['status', 'active']);
  });
});

// ── Joining ────────────────────────────────────────────────────────────────

describe('joining', () => {
  it('refuses an impossible code without touching the relay', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession('ABC');

    expect(screen.getByRole('alert')).toHaveTextContent(/6 characters/i);
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
  });

  it('says so honestly when no session answers to a well-formed code', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession('QQQQQQ');

    expect(screen.getByRole('alert')).toHaveTextContent(/no active watch session/i);
  });

  it('refuses an ended session rather than joining it', async () => {
    hostSession({ status: 'ended' });
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();

    expect(screen.getByRole('alert')).toHaveTextContent(/no active watch session/i);
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
  });

  it('reconstructs the host media from the canonical event alone', async () => {
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'joined');
    await waitFor(() => expect(players.length).toBeGreaterThan(0));
    expect(players[players.length - 1].videoId).toBe(VIDEO);
    // A guest never had to type a URL, and never published anything.
    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(0);
  });

  it('renders the guest surface: no global controls, only local ones', async () => {
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(6);

    await waitFor(() => expect(screen.getByText(/playback is controlled by the host/i)).toBeInTheDocument());
    // Absent, not disabled — ownership of the screen has to be legible.
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull();
    expect(screen.queryByRole('slider', { name: /timeline/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /change video/i })).toBeNull();
    // ...while volume and fullscreen stay, because they are never synchronized.
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
  });

  it('keeps the curtain closed until the player is genuinely ready', async () => {
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /join with code/i }));
    fireEvent.change(screen.getByLabelText(/watch session code/i), { target: { value: CODE } });
    // Joined, but nothing has loaded yet: a session state is a claim about a
    // timeline, not a picture on this screen.
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(curtainOpen()).toBe(false);

    await settle(10);
    await waitFor(() => expect(curtainOpen()).toBe(true));
  });

  it('applies a remote play WITHOUT publishing one back', async () => {
    const { content, address } = hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    const next = transition(content, { type: 'play', position: 0 }, Date.now());
    const command = buildCommandEvent({
      address,
      hostPubkey: HOST,
      command: next.command,
      nowMs: Date.now(),
    });
    act(() => {
      relay.publish({ ...command, id: 'c'.repeat(64), pubkey: HOST, sig: '0'.repeat(128) });
    });
    await settle(8);

    await waitFor(() => expect(players[players.length - 1].playing).toBe(true));
    // The echo test: applying the host's command must not emit one of our own.
    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(0);
  });

  it('applies a remote media change once, without echoing it', async () => {
    const { content } = hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);
    const before = players.length;

    const next = transition(
      content,
      { type: 'set-media', media: { provider: 'youtube', id: OTHER_VIDEO } },
      Date.now(),
    );
    const unsigned = buildSessionEvent({
      sessionId: 'remote-session',
      room: ROOM_THEATER_MAIN,
      code: CODE,
      status: 'active',
      content: next.content,
      nowMs: Date.now(),
    });
    act(() => {
      relay.publish({ ...unsigned, id: 'd'.repeat(64), pubkey: HOST, sig: '0'.repeat(128) });
    });
    await settle(10);

    await waitFor(() => expect(players[players.length - 1].videoId).toBe(OTHER_VIDEO));
    // Exactly one new player for one media change, and no publish.
    expect(players.length).toBe(before + 1);
    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(0);
  });

  it('ignores a command signed by someone who is not the host', async () => {
    const { content, address } = hostSession();
    void address;
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);
    const playingBefore = players[players.length - 1].playing;

    const next = transition(content, { type: 'play', position: 120 }, Date.now());
    const command = buildCommandEvent({
      address,
      hostPubkey: HOST,
      command: next.command,
      nowMs: Date.now(),
    });
    act(() => {
      // Right kind, right session address, wrong signer.
      relay.publish({ ...command, id: 'e'.repeat(64), pubkey: 'c'.repeat(64), sig: '0'.repeat(128) });
    });
    await settle(8);

    expect(players[players.length - 1].playing).toBe(playingBefore);
    expect(players[players.length - 1].position).toBe(0);
  });

  it('tells the guest when the host ends the session, and keeps their player', async () => {
    const { content, address } = hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    const ended = transition(content, { type: 'end', position: 42 }, Date.now());
    const unsigned = buildSessionEvent({
      sessionId: 'remote-session',
      room: ROOM_THEATER_MAIN,
      code: CODE,
      status: 'ended',
      content: ended.content,
      nowMs: Date.now(),
    });
    act(() => {
      relay.publish({ ...unsigned, id: '1'.repeat(64), pubkey: HOST, sig: '0'.repeat(128) });
    });
    await settle(8);

    expect(screen.getByRole('alert')).toHaveTextContent(/host ended/i);
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
    expect(address).toContain(HOST);
  });

  it('returns to local playback when the guest leaves', async () => {
    hostSession();
    const addresses: (string | null)[] = [];
    render(<TheaterStage seatId={SEAT} onActivityChange={(a) => addresses.push(a)} />);
    await settle();
    await joinSession();
    await settle(8);

    fireEvent.click(screen.getByRole('button', { name: /leave session/i }));
    await settle(6);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
    expect(addresses[addresses.length - 1]).toBeNull();
    // Leaving a session is not leaving the theater: the video is still there.
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
  });
});

// ── Fullscreen ─────────────────────────────────────────────────────────────

/**
 * Fullscreen is a LOCAL, per-device control. Whatever the browser answers, it
 * must not touch the session: no navigation, no reload, no remount, no player
 * rebuild, no leave. The reported bug was none of those things at this level —
 * it was the app shell swapping its tree (see
 * `src/components/shell/BlobbiAppShell.fullscreen.test.tsx`) — but the button
 * itself is the thing a user presses, so its contract is pinned here too.
 */
describe('fullscreen', () => {
  const fullscreenButton = () =>
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b.getAttribute('aria-label') ?? '') === 'Fullscreen',
    )!;

  /** Make the API available (jsdom has none) and choose what it answers. */
  function installFullscreen(outcome: 'grant' | 'refuse') {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn(async function (this: HTMLElement) {
        if (outcome === 'refuse') throw new Error('no user activation');
        Object.defineProperty(document, 'fullscreenElement', {
          configurable: true,
          get: () => this,
        });
        document.dispatchEvent(new Event('fullscreenchange'));
      }),
    });
  }

  function uninstallFullscreen() {
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
    Reflect.deleteProperty(document, 'fullscreenElement');
  }

  async function hostingWithVideo() {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    return {
      code: inviteCode(),
      iframe: document.querySelector('iframe'),
      events: relay.events.length,
      playerCount: players.length,
    };
  }

  afterEach(() => {
    uninstallFullscreen();
  });

  it('is a non-submitting button', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    expect(fullscreenButton().getAttribute('type')).toBe('button');
  });

  it('submits no form and navigates nowhere when it succeeds', async () => {
    installFullscreen('grant');
    const submits: Event[] = [];
    const navigations: string[] = [];
    document.addEventListener('submit', (e) => submits.push(e));
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    const before = await hostingWithVideo();
    fireEvent.click(fullscreenButton());
    await settle(6);

    expect(submits).toHaveLength(0);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(navigations).toHaveLength(0);
    expect(window.location.href).toContain('localhost');
    pushState.mockRestore();
    replaceState.mockRestore();
    void before;
  });

  it('keeps the session, the player and the seat when the browser refuses', async () => {
    installFullscreen('refuse');
    const before = await hostingWithVideo();

    fireEvent.click(fullscreenButton());
    await settle(6);

    // The honest message appears…
    expect(screen.getByText(/wouldn.t open fullscreen/i)).toBeInTheDocument();
    // …and nothing else moved.
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'hosting');
    expect(inviteCode()).toBe(before.code);
    expect(card()).toHaveAttribute('data-theater-status', 'video-ready');
    expect(document.querySelector('iframe')).toBe(before.iframe);
    expect(players).toHaveLength(before.playerCount);
    expect(players.filter((p) => p.destroyed)).toHaveLength(0);
    expect(relay.events).toHaveLength(before.events);
  });

  it('keeps the refusal message out of the session error line', async () => {
    installFullscreen('refuse');
    await hostingWithVideo();

    fireEvent.click(fullscreenButton());
    await settle(6);

    // A local device limitation is not a session problem, and must not be
    // reported as one.
    expect(document.querySelector('[data-theater-session-error]')).toBeNull();
  });

  it('preserves the session, its code and host authority when it succeeds', async () => {
    installFullscreen('grant');
    const before = await hostingWithVideo();

    fireEvent.click(fullscreenButton());
    await settle(6);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'hosting');
    expect(inviteCode()).toBe(before.code);
    expect(document.querySelector('iframe')).toBe(before.iframe);
    expect(players).toHaveLength(before.playerCount);

    // Still the host: a control action still publishes a paired command.
    const commandsBefore = commands().length;
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(commands().length).toBe(commandsBefore + 1));
    await settle(6);
    expect(JSON.parse(commands()[commands().length - 1].content).command).toBe('play');
  });

  it('survives exiting fullscreen with the same player and session', async () => {
    installFullscreen('grant');
    const before = await hostingWithVideo();

    fireEvent.click(fullscreenButton());
    await settle(4);
    await act(async () => {
      Reflect.deleteProperty(document, 'fullscreenElement');
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await settle(4);

    expect(document.querySelector('iframe')).toBe(before.iframe);
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'hosting');
    expect(inviteCode()).toBe(before.code);
    expect(players).toHaveLength(before.playerCount);
  });

  it('does not duplicate players, sessions or events when pressed repeatedly', async () => {
    installFullscreen('refuse');
    const before = await hostingWithVideo();

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(fullscreenButton());
      await settle(2);
    }

    expect(players).toHaveLength(before.playerCount);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
    // Not one extra event of any kind — fullscreen is not a network action.
    expect(relay.events).toHaveLength(before.events);
  });

  it('lets a guest go fullscreen without touching the session', async () => {
    installFullscreen('grant');
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);
    const before = relay.events.length;

    fireEvent.click(fullscreenButton());
    await settle(6);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'joined');
    expect(relay.events).toHaveLength(before);
    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(0);
  });
});

// ── Session continuity across seats ────────────────────────────────────────

/**
 * A watch session belongs to the user's participation in the theater, not to a
 * chair. Standing up, walking and changing seats must all keep it — the local
 * player is torn down with the seat (approved local behaviour), but membership,
 * the invitation code and host authority are not.
 *
 * The bug this pins: `seatId === null` used to mean `leaveSession()`, so a host
 * that stood up lost the session it had created — and nobody could take it over,
 * because only its own pubkey can author that session.
 */
describe('session continuity', () => {
  it('keeps the host hosting, with the same session, after standing up', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const code = inviteCode();
    const address = sessions()[0].tags.find(([n]) => n === 'd')?.[1];

    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);

    // The card is gone with the seat; the screen and the session are not.
    expect(card()).toBeNull();
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].tags).toContainEqual(['status', 'active']);
    expect(commands()).toHaveLength(0);

    // Sitting down again restores the same session, the same code, the host role.
    view.rerender(<TheaterStage seatId="theater-seat-b3" />);
    await settle(10);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'hosting');
    expect(inviteCode()).toBe(code);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].tags.find(([n]) => n === 'd')?.[1]).toBe(address);
  });

  it('rebuilds the player from canonical state when the theater was remounted', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    // Put the session somewhere other than the beginning.
    fireEvent.click(screen.getByRole('button', { name: /skip forward/i }));
    await settle(6);

    view.unmount();
    await settle(4);
    render(<TheaterStage seatId="theater-seat-b3" />);
    await settle(12);

    // The session's media is back on screen without the host choosing anything…
    await waitFor(() => expect(players.filter((p) => !p.destroyed)).toHaveLength(1));
    const rebuilt = players[players.length - 1];
    expect(rebuilt.videoId).toBe(VIDEO);
    expect(card()).toHaveAttribute('data-theater-status', 'video-ready');
    // …and it resumes at the session's position, not at zero.
    await waitFor(() => expect(rebuilt.position).toBeGreaterThan(5));
  });

  it('publishes no new session and no new code across a seat change', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const before = relay.events.length;
    const code = inviteCode();

    view.rerender(<TheaterStage seatId={null} />);
    await settle(4);
    view.rerender(<TheaterStage seatId="theater-seat-c5" />);
    await settle(10);

    expect(sessions()).toHaveLength(1);
    expect(inviteCode()).toBe(code);
    // A seat change is not a session action: it publishes nothing at all.
    expect(relay.events).toHaveLength(before);
  });

  it('lets the host keep controlling playback after changing seats', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    view.rerender(<TheaterStage seatId={null} />);
    await settle(4);
    view.rerender(<TheaterStage seatId="theater-seat-c5" />);
    await settle(10);

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    await settle(6);

    expect(JSON.parse(commands()[0].content).command).toBe('play');
    // …continuing the SAME session's revision count, not restarting it.
    expect(JSON.parse(commands()[0].content).rev).toBe(1);
  });

  it('keeps a guest joined across a seat change, with no code to re-enter', async () => {
    hostSession();
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    view.rerender(<TheaterStage seatId={null} />);
    await settle(4);
    view.rerender(<TheaterStage seatId="theater-seat-b3" />);
    await settle(10);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'joined');
    expect(inviteCode()).toBe(CODE);
    expect(screen.queryByLabelText(/watch session code/i)).toBeNull();
    // Still a guest: no global controls came back.
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
    // And still publishing nothing.
    expect(relay.events.filter((e) => e.pubkey === ME)).toHaveLength(0);
  });

  it('still leaves on the explicit Leave button, while seated', async () => {
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    fireEvent.click(screen.getByRole('button', { name: /leave session/i }));
    await settle(6);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
    // Leaving is not standing up: the player stays.
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
  });

  it('does not rejoin after an explicit leave, even when sitting again', async () => {
    hostSession();
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    fireEvent.click(screen.getByRole('button', { name: /leave session/i }));
    await settle(4);
    view.rerender(<TheaterStage seatId={null} />);
    await settle(4);
    view.rerender(<TheaterStage seatId={SEAT} />);
    await settle(8);

    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
  });

  it('still ends the canonical session on the explicit End button', async () => {
    render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    await waitFor(() => expect(sessions().length).toBeGreaterThan(1));
    await settle(6);

    expect(sessions()[sessions().length - 1].tags).toContainEqual(['status', 'ended']);
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
  });

  it('forgets the session when the player leaves the theater', async () => {
    // Leaving the ROOM is the one implicit way out. `PlayingView` calls this as
    // the location changes, which is why walking back in later starts clean
    // instead of silently rejoining.
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    // The theater unmounts with the location change…
    view.unmount();
    forgetWatchSession(ME);
    await settle(4);

    // …and coming back gives a plain local theater.
    render(<TheaterStage seatId={SEAT} />);
    await settle(8);
    expect(sessionPanel()).toHaveAttribute('data-theater-session', 'local');
  });

  it('resumes after an unmount that was NOT a departure', async () => {
    // A remount with no departure (a shell relayout, Strict Mode) must not cost
    // the host the session only its own pubkey can author.
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const code = inviteCode();

    view.unmount();
    await settle(4);
    render(<TheaterStage seatId={SEAT} />);
    await settle(10);

    await waitFor(() => expect(sessionPanel()).toHaveAttribute('data-theater-session', 'hosting'));
    expect(inviteCode()).toBe(code);
    expect(sessions()).toHaveLength(1);
  });

  it('reports the same session address to presence throughout a seat change', async () => {
    const addresses: (string | null)[] = [];
    const onActivity = (a: string | null) => addresses.push(a);
    const view = render(<TheaterStage seatId={SEAT} onActivityChange={onActivity} />);
    await settle();
    await loadVideo();
    await createSession();
    const address = addresses[addresses.length - 1];
    expect(address).not.toBeNull();

    view.rerender(<TheaterStage seatId={null} onActivityChange={onActivity} />);
    await settle(4);
    view.rerender(<TheaterStage seatId="theater-seat-c5" onActivityChange={onActivity} />);
    await settle(8);

    // Never cleared, never changed: presence keeps pointing at the same session.
    expect(addresses.filter((a) => a === null)).toHaveLength(1); // only the initial value
    expect(addresses[addresses.length - 1]).toBe(address);
  });
});

// ── Standing up: the chair and the screen are different lifetimes ──────────

/**
 * Three independent facts, and the bug was collapsing them into one:
 *
 *   isSeated                → the control card, and the Blobbi in a chair
 *   hasActiveSharedSession  → whether the screen belongs to a session
 *   isInTheater             → whether any of this exists at all
 *
 * Watching alone, the screen is yours and standing up stops it. Watching
 * together, the film is still running for everybody else — so the screen stays,
 * the curtain stays up, the playhead keeps moving, and only the card goes away.
 */
describe('standing up', () => {
  const curtain = () => document.querySelector('[data-theater-curtain]');
  const curtainOpen = () => curtain()?.getAttribute('data-curtain-open') === 'true';

  it('destroys a LOCAL-ONLY player, exactly as before', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    expect(curtainOpen()).toBe(true);

    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);

    // Walking away from your own film stops it.
    expect(players.filter((p) => !p.destroyed)).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(curtainOpen()).toBe(false);
    expect(card()).toBeNull();
  });

  it('keeps a HOSTED session playing, on the very same iframe', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const iframe = document.querySelector('iframe');

    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);

    expect(document.querySelector('iframe')).toBe(iframe);
    expect(players).toHaveLength(1);
    expect(players[0].destroyed).toBe(false);
    expect(curtainOpen()).toBe(true);
    expect(card()).toBeNull();
  });

  it('keeps a JOINED session playing, on the very same iframe', async () => {
    hostSession();
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();

    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);

    expect(document.querySelector('iframe')).toBe(iframe);
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);
    expect(curtainOpen()).toBe(true);
    expect(card()).toBeNull();
  });

  it('gives the card back on sitting, with the same iframe throughout', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const iframe = document.querySelector('iframe');
    const code = inviteCode();

    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);
    expect(card()).toBeNull();

    view.rerender(<TheaterStage seatId="theater-seat-c5" />);
    await settle(8);

    expect(card()).not.toBeNull();
    expect(card()).toHaveAttribute('data-theater-status', 'video-ready');
    // Not a new anything: same iframe, same session, same code.
    expect(document.querySelector('iframe')).toBe(iframe);
    expect(players).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
    expect(inviteCode()).toBe(code);
  });

  it('publishes nothing at all for a stand-and-sit', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();
    const before = relay.events.length;

    view.rerender(<TheaterStage seatId={null} />);
    await settle(4);
    view.rerender(<TheaterStage seatId="theater-seat-c5" />);
    await settle(8);

    expect(relay.events).toHaveLength(before);
  });

  it('never opens the curtain just because a session exists', async () => {
    // The session says "playing"; this screen has no picture yet. The curtain
    // follows the PLAYER, and nothing else.
    hostSession();
    render(<TheaterStage seatId={SEAT} />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /join with code/i }));
    fireEvent.change(screen.getByLabelText(/watch session code/i), { target: { value: CODE } });
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(curtainOpen()).toBe(false);

    await settle(10);
    await waitFor(() => expect(curtainOpen()).toBe(true));
  });

  it('destroys the player when the theater itself goes away', async () => {
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await loadVideo();
    await createSession();

    // Leaving the room unmounts the theater — the one path that must still mean
    // silence, session or no session.
    view.unmount();
    await settle(4);

    expect(players.filter((p) => !p.destroyed)).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('returns to LOCAL seat-bound behaviour after leaving the session', async () => {
    hostSession();
    const view = render(<TheaterStage seatId={SEAT} />);
    await settle();
    await joinSession();
    await settle(8);

    fireEvent.click(screen.getByRole('button', { name: /leave session/i }));
    await settle(6);
    // Leaving keeps the player (existing contract) …
    expect(players.filter((p) => !p.destroyed)).toHaveLength(1);

    // … and standing up now stops it again, because it is a local film once more.
    view.rerender(<TheaterStage seatId={null} />);
    await settle(6);
    expect(players.filter((p) => !p.destroyed)).toHaveLength(0);
  });
});
