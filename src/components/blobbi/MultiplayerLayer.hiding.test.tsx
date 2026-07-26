/**
 * Coverage for REMOTE players hidden inside a hiding spot (e.g. a Town bush).
 *
 * Remote hiding must come from explicit presence state — the optional `hiddenIn`
 * field of the existing kind 31950 content — never from "is the player standing
 * roughly where a bush is". These tests push real presence events through the
 * subscription and assert what MultiplayerLayer paints:
 *   - hidden  → no sprite, no ground shadow, no name label (only the empty chat
 *               anchor stays, so the player's messages still work)
 *   - cleared → the Blobbi is painted again
 *   - a payload without the field (older client) renders normally
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

// ---------------------------------------------------------------------------
// Mocks (same shape as the gaze integration test)
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
/** Every event this client publishes, so we can inspect presence payloads. */
const published: Array<{ kind: number; content: string; tags: string[][] }> = [];
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: async (event: { kind: number; content: string; tags: string[][] }) => {
      published.push(event);
    },
    mutate: () => {},
  }),
}));
vi.mock('@/hooks/useLocation', () => ({
  useLocation: () => ({ currentLocation: 'town' }),
}));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({
  useBlobbonautProfile: () => ({ data: {} }),
}));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];

function makeFakeNostr() {
  return {
    req: (filters: Array<{ kinds?: number[] }>) => {
      const queue: NostrEvent[] = [];
      let notify: (() => void) | null = null;
      subscriptions.push({
        kinds: filters[0]?.kinds ?? [],
        push: (event: NostrEvent) => {
          queue.push(event);
          notify?.();
        },
      });
      return (async function* () {
        while (true) {
          while (queue.length > 0) {
            yield ['EVENT', 'sub', queue.shift()];
          }
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
      })();
    },
    query: async () => [],
  };
}

let fakeNostr = makeFakeNostr();
vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: fakeNostr }),
}));

const REMOTE_KEY = 'remotepk:abc';

function presenceEvent(opts: {
  ts: number;
  state: 'idle' | 'moving';
  at: { x: number; y: number };
  hiddenIn?: string;
  /** Publisher's monotonic sequence; omit to emulate a client without it. */
  seq?: number;
}): NostrEvent {
  const { ts, state, at, hiddenIn, seq } = opts;
  return {
    id: `evt-${ts}-${seq ?? 'legacy'}-${state}-${hiddenIn ?? 'none'}`,
    kind: 31950,
    pubkey: 'remotepk',
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state,
      location: 'town',
      anchor: { x: at.x, y: at.y, ts },
      ...(state === 'moving'
        ? { goal: { from: at, to: { x: 50, y: 66 }, v: 120, ts } }
        : {}),
      blobbiD: 'remote-blobbi',
      ...(hiddenIn ? { hiddenIn } : {}),
      ...(seq !== undefined ? { seq } : {}),
    }),
    tags: [
      ['d', 'session:abc'],
      ['a', '31124:remotepk:remote-blobbi'],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

function Harness({ hiddenIn = null }: { hiddenIn?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <PhotoBoothProvider>
      <MovementBlockerProvider>
        <div ref={containerRef} data-testid="world" data-world-surface>
          <MultiplayerLayer
            containerRef={containerRef}
            currentBlobbiD="local-blobbi"
            startPosition={{ x: 50, y: 66 }}
            hiddenIn={hiddenIn}
          />
        </div>
      </MovementBlockerProvider>
    </PhotoBoothProvider>
  );
}

/** Presence events this client published that advertise a hiding spot. */
const hidePublishes = () =>
  published.filter(
    (e) => e.kind === 31950 && typeof JSON.parse(e.content).hiddenIn === 'string',
  );

beforeEach(() => {
  subscriptions = [];
  published.length = 0;
  fakeNostr = makeFakeNostr();
  // Freeze the presence animation loop: these tests assert rendering from
  // presence state, not interpolation.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const { container, rerender } = render(<Harness />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
  expect(presenceSub, 'presence subscription should exist').toBeTruthy();

  const push = async (event: NostrEvent) => {
    await act(async () => {
      presenceSub!.push(event);
    });
    await act(async () => {});
  };

  const remote = () =>
    container.querySelector(`[data-player-key="${REMOTE_KEY}"]`) as HTMLElement | null;

  const setLocalHiddenIn = async (hiddenIn: string | null) => {
    await act(async () => {
      rerender(<Harness hiddenIn={hiddenIn} />);
    });
    await act(async () => {});
  };

  const rerenderSame = async (hiddenIn: string | null) => setLocalHiddenIn(hiddenIn);

  return { container, push, remote, setLocalHiddenIn, rerenderSame };
}

const TS = 1_800_000_000;

describe('remote players hidden in a hiding spot', () => {
  it('renders a normal remote player when no hiding state is published', async () => {
    const h = await setup();

    await h.push(presenceEvent({ ts: TS, seq: 1, state: 'idle', at: { x: 8, y: 73 } }));

    const el = h.remote();
    expect(el).toBeTruthy();
    expect(el!.children.length).toBeGreaterThan(0);
    expect(el!.hasAttribute('data-hidden-in')).toBe(false);
  });

  it('does not render a remote Blobbi whose presence says it is hidden', async () => {
    const h = await setup();

    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: { x: 8, y: 73 }, hiddenIn: 'town-bush-1' }),
    );

    const el = h.remote();
    // The anchor stays (chat bubbles portal into it) but nothing of the Blobbi
    // is painted: no sprite, no shadow, no hover name label.
    expect(el).toBeTruthy();
    expect(el!.getAttribute('data-hidden-in')).toBe('town-bush-1');
    expect(el!.children.length).toBe(0);
    expect(el!.className).toContain('pointer-events-none');
  });

  it('renders the remote Blobbi again once the hiding state is cleared', async () => {
    const h = await setup();

    await h.push(
      presenceEvent({ ts: TS, seq: 1, state: 'idle', at: { x: 8, y: 73 }, hiddenIn: 'town-bush-1' }),
    );
    expect(h.remote()!.children.length).toBe(0);

    // Walking away publishes a `moving` presence with no hiddenIn.
    await h.push(presenceEvent({ ts: TS + 2, seq: 2, state: 'moving', at: { x: 8, y: 73 } }));

    const el = h.remote();
    expect(el!.hasAttribute('data-hidden-in')).toBe(false);
    expect(el!.children.length).toBeGreaterThan(0);
  });

  it('ignores an older or re-delivered presence that would re-hide the player', async () => {
    const h = await setup();

    const hide = presenceEvent({
      ts: TS, seq: 1, state: 'idle', at: { x: 8, y: 73 }, hiddenIn: 'town-bush-1',
    });
    await h.push(hide);
    // Newest state: left the bush.
    await h.push(presenceEvent({ ts: TS + 5, seq: 2, state: 'moving', at: { x: 8, y: 73 } }));
    expect(h.remote()!.children.length).toBeGreaterThan(0);

    // Relays re-deliver the older hide (same event, and an older-second variant).
    await h.push(hide);
    await h.push(
      presenceEvent({ ts: TS + 1, seq: 1, state: 'idle', at: { x: 8, y: 73 }, hiddenIn: 'town-bush-1' }),
    );

    const el = h.remote();
    expect(el!.hasAttribute('data-hidden-in')).toBe(false);
    expect(el!.children.length).toBeGreaterThan(0);
  });

  it('ignores a hide delivered AFTER a move stamped in the same second', async () => {
    const h = await setup();

    // The real sequence this protects: arrive + hide, then immediately click
    // elsewhere. Both publishes land in the same `created_at` second, and the
    // relay delivers them in the wrong order — the move first, the hide second.
    // Only the monotonic `seq` can order them.
    const hide = presenceEvent({
      ts: TS, seq: 7, state: 'idle', at: { x: 8, y: 91 }, hiddenIn: 'town-bush-3',
    });
    const move = presenceEvent({ ts: TS, seq: 8, state: 'moving', at: { x: 8, y: 91 } });

    await h.push(move);
    await h.push(hide);

    const el = h.remote();
    expect(el!.hasAttribute('data-hidden-in')).toBe(false);
    expect(el!.children.length).toBeGreaterThan(0);
  });

  it('still applies a hide that legitimately follows a move in the same second', async () => {
    const h = await setup();

    // Same second, correct order (walk away, then hide somewhere else): the newer
    // seq wins, so the hide is applied rather than being dropped as a duplicate.
    await h.push(presenceEvent({ ts: TS, seq: 7, state: 'moving', at: { x: 50, y: 70 } }));
    await h.push(
      presenceEvent({ ts: TS, seq: 8, state: 'idle', at: { x: 8, y: 91 }, hiddenIn: 'town-bush-3' }),
    );

    const el = h.remote();
    expect(el!.getAttribute('data-hidden-in')).toBe('town-bush-3');
    expect(el!.children.length).toBe(0);
  });

  it('falls back to created_at ordering for clients that send no seq', async () => {
    const h = await setup();

    // Documented limitation, unchanged from before: without `seq` a same-second
    // pair cannot be ordered, so the last delivered wins. Legacy publishers keep
    // working exactly as they did — they simply do not gain the guarantee.
    await h.push(presenceEvent({ ts: TS, state: 'moving', at: { x: 8, y: 91 } }));
    await h.push(
      presenceEvent({ ts: TS, state: 'idle', at: { x: 8, y: 91 }, hiddenIn: 'town-bush-3' }),
    );
    expect(h.remote()!.getAttribute('data-hidden-in')).toBe('town-bush-3');

    // A strictly older second is still dropped, as before.
    await h.push(presenceEvent({ ts: TS - 5, state: 'moving', at: { x: 8, y: 91 } }));
    expect(h.remote()!.getAttribute('data-hidden-in')).toBe('town-bush-3');
  });

  it('publishes the local hiding spot once per arrival, in the presence content', async () => {
    const h = await setup();
    expect(hidePublishes()).toHaveLength(0);

    await h.setLocalHiddenIn('town-bush-2');

    const hides = hidePublishes();
    expect(hides).toHaveLength(1);
    const content = JSON.parse(hides[0].content);
    expect(content.hiddenIn).toBe('town-bush-2');
    expect(content.location).toBe('town');
    // Reuses the presence kind and its tag shape — no new event kind.
    expect(hides[0].kind).toBe(31950);
    expect(hides[0].tags).toEqual(
      expect.arrayContaining([['t', 'blobbi:presence'], ['t', 'loc:town']]),
    );

    // Every presence we publish is stamped with a strictly increasing sequence,
    // so observers can order our updates without relying on created_at.
    const seqs = published
      .filter((e) => e.kind === 31950)
      .map((e) => JSON.parse(e.content).seq as number);
    expect(seqs.every((n) => typeof n === 'number')).toBe(true);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('does not republish the hide while the player stays in the same bush', async () => {
    const h = await setup();
    await h.setLocalHiddenIn('town-bush-2');
    expect(hidePublishes()).toHaveLength(1);

    // Re-renders (own render churn, other players moving) must not re-publish.
    await h.rerenderSame('town-bush-2');
    await h.push(presenceEvent({ ts: TS, seq: 1, state: 'moving', at: { x: 20, y: 70 } }));
    await h.rerenderSame('town-bush-2');

    expect(hidePublishes()).toHaveLength(1);
  });

  it('stops advertising the hiding spot once the player leaves it', async () => {
    const h = await setup();
    await h.setLocalHiddenIn('town-bush-2');
    await h.setLocalHiddenIn(null);

    // No further hide-bearing presence is published after leaving.
    const before = hidePublishes().length;
    await h.rerenderSame(null);
    expect(hidePublishes()).toHaveLength(before);
    expect(before).toBe(1);
  });

  it('keeps rendering players from clients that never send the field', async () => {
    const h = await setup();

    // Byte-for-byte an old-client payload: no hiddenIn key anywhere.
    const legacy = presenceEvent({ ts: TS, state: 'idle', at: { x: 8, y: 73 } });
    expect(legacy.content).not.toContain('hiddenIn');
    expect(legacy.content).not.toContain('seq');
    await h.push(legacy);

    expect(h.remote()!.children.length).toBeGreaterThan(0);
  });
});
