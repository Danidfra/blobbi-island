/**
 * Curated media, proven against the real theater.
 *
 * The claims here are about what reaches a PLAYER, not about which controls are
 * on screen. That distinction is the whole phase: a guest can join while an
 * approved video is playing and the host can swap it a second later, so a check
 * on the input surface would cover the one case that never mattered.
 *
 * The load-bearing assertion throughout is `players`: the fake YouTube
 * constructor records every player ever built. If an unapproved video appears
 * there, an iframe for it existed, and no amount of subsequent teardown makes
 * that acceptable.
 *
 * Harness follows `TheaterSession.test.tsx`; the fake relay, fake signer and
 * fake YouTube are the same shapes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { YT_STATE, resetYouTubeApiCacheForTests } from '@/lib/youtube-player';
import {
  KIND_SHARED_PLAYBACK_COMMAND,
  KIND_SHARED_PLAYBACK_SESSION,
  ROOM_THEATER_MAIN,
  buildSessionEvent,
  createSessionContent,
  transition,
} from '@/lib/shared-playback';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import type { ApprovedMedia } from '@/theater-media';
import { TheaterStage } from './TheaterStage';
import { clearResumableSessionsForTests } from '@/hooks/useSharedPlayback';

const SEAT = 'theater-seat-a1';
/** In the fixture catalog. */
const APPROVED = 'dQw4w9WgXcQ';
/** Structurally valid, deliberately not approved. */
const UNAPPROVED = 'Nk9pQ2rT7wY';
const ME = 'f'.repeat(64);
const HOST = 'a'.repeat(64);
const CODE = 'B7X4QP';

const FIXTURE_CATALOG: readonly ApprovedMedia[] = Object.freeze([
  {
    id: 'blobbi:film:approved',
    provider: 'youtube',
    providerMediaId: APPROVED,
    title: 'The Approved Film',
  },
]);

// The fixture reaches the code through `TheaterStage`'s `catalog` prop rather
// than a module mock: the catalog is read through default parameters inside pure
// functions, so a mocked constant would never reach them, the real functions
// close over the real one.

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
    let closed = false;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (!closed) {
          const value = queue.shift();
          if (value !== undefined) return { value, done: false };
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
        return { value: undefined, done: true };
      },
      async return() {
        closed = true;
        this.listeners?.delete?.(listener);
        return { value: undefined, done: true };
      },
    } as unknown as AsyncIterableIterator<unknown>;
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
          return {
            ...template,
            id: `${signCount}`.padStart(64, '0'),
            pubkey: ME,
            sig: '0'.repeat(128),
          };
        },
      },
    },
  }),
}));

// ── Fake YouTube ───────────────────────────────────────────────────────────

interface FakePlayer {
  videoId?: string;
  iframe: HTMLIFrameElement;
  host?: string;
  playerVars?: Record<string, string | number>;
  destroyed: boolean;
}

let players: FakePlayer[] = [];

function installFakeYouTube() {
  window.YT = {
    Player: class {
      constructor(
        element: HTMLElement | string,
        opts: {
          videoId?: string;
          host?: string;
          playerVars?: Record<string, string | number>;
          events?: { onReady?: (e: { target: unknown }) => void };
        },
      ) {
        const self = this as unknown as Record<string, unknown>;
        const iframe = document.createElement('iframe');
        if (element instanceof HTMLElement) element.replaceWith(iframe);

        const record: FakePlayer = {
          videoId: opts.videoId,
          iframe,
          host: opts.host,
          playerVars: opts.playerVars,
          destroyed: false,
        };
        players.push(record);

        Object.assign(self, {
          playVideo: () => {},
          pauseVideo: () => {},
          seekTo: () => {},
          loadVideoById: () => {},
          cueVideoById: () => {},
          getCurrentTime: () => 0,
          getDuration: () => 300,
          getPlayerState: () => YT_STATE.PAUSED,
          getVideoLoadedFraction: () => 1,
          setPlaybackRate: () => {},
          getPlaybackRate: () => 1,
          getAvailablePlaybackRates: () => [1],
          setVolume: () => {},
          getVolume: () => 100,
          mute: () => {},
          unMute: () => {},
          isMuted: () => false,
          getOptions: () => [],
          setOption: () => {},
          getIframe: () => iframe,
          getVideoData: () => ({ title: 'Whatever YouTube Says', video_id: opts.videoId }),
          destroy: () => {
            record.destroyed = true;
          },
        });

        queueMicrotask(() => opts.events?.onReady?.({ target: self }));
      }
    } as never,
  };
}

async function settle(times = 6) {
  await act(async () => {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  clearResumableSessionsForTests();
  relay = new FakeRelay();
  players = [];
  signCount = 0;
  swapCount = 0;
  resetYouTubeApiCacheForTests();
  installFakeYouTube();
});

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  vi.useRealTimers();
});

function mount(profile: ExperienceProfile) {
  return render(
    <IslandSafetyProvider profile={profile}>
      <TheaterStage seatId={SEAT} catalog={FIXTURE_CATALOG} />
    </IslandSafetyProvider>,
  );
}

/** Every video an iframe was ever constructed for. */
const loadedVideos = () => players.map((player) => player.videoId);
const sessionPanel = () => document.querySelector<HTMLElement>('[data-theater-session]');
const commands = () => relay.of(KIND_SHARED_PLAYBACK_COMMAND);

/** Publish a session hosted by someone else, so the local client can join it. */
function hostSession(mediaId: string) {
  const content = createSessionContent({ provider: 'youtube', id: mediaId }, Date.now());
  const unsigned = buildSessionEvent({
    sessionId: 'remote-session',
    room: ROOM_THEATER_MAIN,
    code: CODE,
    status: 'active',
    content,
    nowMs: Date.now(),
  });
  relay.publish({ ...unsigned, id: 'b'.repeat(64), pubkey: HOST, sig: '0'.repeat(128) });
  return content;
}

let swapCount = 0;

/**
 * The host swaps to a different video, mid-session.
 *
 * Published as a canonical session update rather than an ephemeral command,
 * because that is the path a guest MUST honour: a client that ignored 21951 is
 * still corrected by the next 31951, so gating only the command would leave the
 * authoritative route open.
 */
function hostSwapsTo(content: ReturnType<typeof createSessionContent>, mediaId: string) {
  const next = transition(
    content,
    { type: 'set-media', media: { provider: 'youtube', id: mediaId } },
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
  swapCount += 1;
  act(() => {
    relay.publish({
      ...unsigned,
      id: `${swapCount}`.padStart(64, 'd'),
      pubkey: HOST,
      sig: '0'.repeat(128),
    });
  });
  return next.content;
}

async function joinSession() {
  fireEvent.click(screen.getByRole('button', { name: /join with code/i }));
  fireEvent.change(screen.getByLabelText(/watch session code/i), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
  await settle(10);
}

// ── The chooser ────────────────────────────────────────────────────────────

describe('the chooser reflects the capability', () => {
  it('offers a URL box under open entry', async () => {
    mount('standard');
    await settle();

    expect(screen.getByLabelText(/youtube url or video id/i)).toBeInTheDocument();
    expect(document.querySelector('[data-theater-media-shelf]')).toBeNull();
  });

  it('offers a shelf under curated entry, with no URL box in the tree', async () => {
    // Absence, not disablement: there is nothing to re-enable and nothing to
    // explain.
    mount('family');
    await settle();

    expect(screen.queryByLabelText(/youtube url or video id/i)).toBeNull();
    expect(document.querySelector('[data-theater-media-shelf]')).not.toBeNull();
  });

  it('names shelf entries from the catalog', async () => {
    mount('family');
    await settle();

    expect(screen.getByRole('button', { name: 'The Approved Film' })).toBeInTheDocument();
  });

  it('says nothing about age', async () => {
    const { container } = mount('family');
    await settle();

    expect(container.textContent?.toLowerCase() ?? '').not.toMatch(/child|kid|age|young|parent/);
  });
});

// ── The local setter ───────────────────────────────────────────────────────

describe('choosing locally', () => {
  it('plays an approved film from the shelf', async () => {
    mount('family');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'The Approved Film' }));
    await settle();

    expect(loadedVideos()).toEqual([APPROVED]);
  });

  it('plays anything supported under open entry', async () => {
    mount('standard');
    await settle();

    fireEvent.change(screen.getByLabelText(/youtube url or video id/i), {
      target: { value: `https://www.youtube.com/watch?v=${UNAPPROVED}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /load video/i }));
    await settle();

    expect(loadedVideos()).toEqual([UNAPPROVED]);
  });
});

// ── The receive boundary: the case that matters ────────────────────────────

describe('a host swapping the video after a guest has joined', () => {
  it('plays the approved video the session started on', async () => {
    const content = hostSession(APPROVED);
    mount('family');
    await settle();
    await joinSession();

    expect(loadedVideos()).toEqual([APPROVED]);
    expect(content.media.id).toBe(APPROVED);
  });

  it('never builds a player for the unapproved swap', async () => {
    // THE test. The guest is already watching something approved; the host
    // changes it. The new video must never reach a player at all; not briefly,
    // not muted, not paused.
    const content = hostSession(APPROVED);
    mount('family');
    await settle();
    await joinSession();
    expect(loadedVideos()).toEqual([APPROVED]);

    hostSwapsTo(content, UNAPPROVED);
    await settle(10);

    expect(loadedVideos()).not.toContain(UNAPPROVED);
  });

  it('leaves the session rather than staying synchronised to it', async () => {
    // Deliberate over "keep the last video" or "pause and explain": the host can
    // swap again immediately, so staying turns one refusal into a loop of them.
    const content = hostSession(APPROVED);
    mount('family');
    await settle();
    await joinSession();

    hostSwapsTo(content, UNAPPROVED);
    await settle(10);

    await waitFor(() =>
      expect(sessionPanel()?.getAttribute('data-theater-session')).not.toBe('joined'),
    );
  });

  it('does not load the video however many times the host tries', async () => {
    // The annoyance loop, checked directly.
    const content = hostSession(APPROVED);
    mount('family');
    await settle();
    await joinSession();

    let next = content;
    for (let i = 0; i < 3; i += 1) {
      next = hostSwapsTo(next, UNAPPROVED);
      await settle(6);
    }

    expect(loadedVideos()).not.toContain(UNAPPROVED);
  });

  it('follows an unapproved swap under open entry, unchanged', async () => {
    // Standard behaviour must not move.
    const content = hostSession(APPROVED);
    mount('standard');
    await settle();
    await joinSession();

    hostSwapsTo(content, UNAPPROVED);
    await settle(10);

    await waitFor(() => expect(loadedVideos()).toContain(UNAPPROVED));
  });
});

// ── Join-time ──────────────────────────────────────────────────────────────

describe('joining a session that is already on unapproved media', () => {
  it('never loads it', async () => {
    // No one-frame leak: admission runs before the state machine is told there
    // is media, so no player is ever constructed.
    hostSession(UNAPPROVED);
    mount('family');
    await settle();
    await joinSession();

    expect(loadedVideos()).toEqual([]);
  });

  it('does not remain in the session', async () => {
    hostSession(UNAPPROVED);
    mount('family');
    await settle();
    await joinSession();

    await waitFor(() =>
      expect(sessionPanel()?.getAttribute('data-theater-session')).not.toBe('joined'),
    );
  });

  it('joins normally under open entry', async () => {
    hostSession(UNAPPROVED);
    mount('standard');
    await settle();
    await joinSession();

    await waitFor(() => expect(loadedVideos()).toEqual([UNAPPROVED]));
  });
});

// ── The publication seam ───────────────────────────────────────────────────

describe('a curated host cannot broadcast unapproved media', () => {
  it('publishes nothing when there is nothing approved to publish', async () => {
    mount('family');
    await settle();

    // There is no URL box to type into, so the only route to a set-media command
    // is the shelf, and the shelf only holds approved entries.
    fireEvent.click(screen.getByRole('button', { name: 'The Approved Film' }));
    await settle();

    const setMedia = commands().filter((event) =>
      JSON.parse(event.content).command === 'set-media',
    );
    for (const event of setMedia) {
      expect(JSON.parse(event.content).media.id).toBe(APPROVED);
    }
  });
});

// ── The iframe ─────────────────────────────────────────────────────────────

describe('the embed', () => {
  it('is served from the privacy-enhanced host in every experience', async () => {
    mount('standard');
    await settle();
    fireEvent.change(screen.getByLabelText(/youtube url or video id/i), {
      target: { value: `https://www.youtube.com/watch?v=${APPROVED}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /load video/i }));
    await settle();

    expect(players[0].host).toBe('https://www.youtube-nocookie.com');
  });

  it('permits fullscreen under open entry', async () => {
    mount('standard');
    await settle();
    fireEvent.change(screen.getByLabelText(/youtube url or video id/i), {
      target: { value: `https://www.youtube.com/watch?v=${APPROVED}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /load video/i }));
    await settle();

    expect(players[0].playerVars?.fs).toBe(1);
    expect(players[0].iframe.getAttribute('allow')).toContain('fullscreen');
    expect(players[0].iframe.getAttribute('allowfullscreen')).toBe('true');
  });

  it('denies fullscreen at the iframe, not by hiding a button', async () => {
    // A frame that never received `allowfullscreen` cannot be talked into
    // fullscreen by any control, including the browser's own. Picture-in-picture
    // goes with it: it is the other way out of the island's frame.
    mount('family');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'The Approved Film' }));
    await settle();

    expect(players[0].playerVars?.fs).toBe(0);
    expect(players[0].iframe.getAttribute('allow')).not.toContain('fullscreen');
    expect(players[0].iframe.getAttribute('allow')).not.toContain('picture-in-picture');
    expect(players[0].iframe.hasAttribute('allowfullscreen')).toBe(false);
  });

  it('keeps the JS API origin so session sync still works', async () => {
    mount('family');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'The Approved Film' }));
    await settle();

    expect(players[0].playerVars?.enablejsapi).toBe(1);
    expect(players[0].playerVars?.origin).toBe(window.location.origin);
  });
});

// ── Sessions still work ────────────────────────────────────────────────────

describe('regression', () => {
  it('still offers hosting and joining under both experiences', async () => {
    for (const profile of ['standard', 'family'] as const) {
      const view = mount(profile);
      await settle();
      expect(screen.getByRole('button', { name: /join with code/i })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('publishes a session when a curated host picks an approved film', async () => {
    mount('family');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'The Approved Film' }));
    // The host can only create a session around media that is actually on
    // screen, so wait for the player before pressing it.
    await waitFor(() => expect(players).toHaveLength(1));
    await settle(10);

    fireEvent.click(screen.getByRole('button', { name: /create watch session/i }));
    await waitFor(() => expect(relay.of(KIND_SHARED_PLAYBACK_SESSION)).toHaveLength(1));
    expect(JSON.parse(relay.of(KIND_SHARED_PLAYBACK_SESSION)[0].content).media.id).toBe(APPROVED);
  });
});
