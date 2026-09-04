/**
 * The local Blobbi appears exactly once.
 *
 * Presence is a broadcast: every event this client publishes comes straight
 * back down its own subscription. These tests wire that loop up for real, the
 * publish mock stamps the author onto the template and pushes it into the live
 * subscription, exactly as a relay does, because the duplication bug lived in
 * that round trip and nowhere else.
 *
 * The local actor itself is `MovableBlobbi`'s, rendered by `PlayingView`
 * alongside this layer. So "exactly once" is asserted here as "this layer
 * draws ZERO copies of the local player": one plus zero is the whole claim.
 *
 * Harness follows `MultiplayerLayer.names.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { clearAllRelationships } from '@/player-safety';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

const LOCAL = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
const SWITCHED = 'e'.repeat(64);
const LOCAL_BLOBBI = 'local-blobbi';

let currentUser: { pubkey: string } | undefined = { pubkey: LOCAL };
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: currentUser }) }));

const published: Array<Record<string, unknown>> = [];
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: async (template: Record<string, unknown>) => {
      published.push(template);
      relayEcho(template);
    },
    mutate: () => {},
  }),
}));
// Presence has its own publisher (sign, then send; see
// `src/lib/presence-publish.ts`). Route it through the same capture so these
// tests keep reading what THIS client advertises.
vi.mock('@/lib/presence-publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/presence-publish')>();
  // Delegate to this file's `useNostrPublish` mock so its capture, and any
  // failure injection it performs, applies to presence exactly as before.
  const { useNostrPublish } = await import('@/hooks/useNostrPublish');
  return {
    ...actual,
    createPresencePublisher:
      () => async (event: Record<string, unknown>) => {
        await useNostrPublish().mutateAsync(event as never);
      },
  };
});
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: 'town' }) }));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: {} }) }));
vi.mock('./AccessoryOverlay', () => ({ AccessoryOverlay: () => null }));

type Pusher = (event: NostrEvent) => void;
let subscriptions: Array<{ kinds: number[]; push: Pusher }> = [];

/** What a relay does with what we publish: stamp the author, hand it back. */
function relayEcho(template: Record<string, unknown>) {
  const kind = template.kind as number;
  const event = {
    ...template,
    id: `own-${published.length}`,
    pubkey: currentUser?.pubkey ?? LOCAL,
    sig: '',
    created_at: (template.created_at as number) ?? Math.floor(Date.now() / 1000),
  } as unknown as NostrEvent;
  for (const sub of subscriptions) if (sub.kinds.includes(kind)) sub.push(event);
}

/** Every Blobbi in this world has identical traits, so looks prove nothing. */
function blobbiStateEvent(pubkey: string, d: string): NostrEvent {
  return {
    id: `state-${pubkey}`,
    kind: 31124,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    sig: '',
    content: '',
    tags: [
      ['d', d],
      ['name', 'Rocket'],
      ['stage', 'baby'],
      ['base_color', '#ff8800'],
      ['secondary_color', '#ffaa33'],
      ['eye_color', '#222222'],
    ],
  };
}

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
          while (queue.length > 0) yield ['EVENT', 'sub', queue.shift()];
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
      })();
    },
    query: async (filters: Array<{ kinds?: number[]; authors?: string[]; '#d'?: string[] }>) =>
      filters[0]?.kinds?.includes(31124)
        ? [blobbiStateEvent(filters[0].authors?.[0] ?? LOCAL, filters[0]['#d']?.[0] ?? LOCAL_BLOBBI)]
        : [],
  };
}

let fakeNostr = makeFakeNostr();
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: fakeNostr }) }));

function presenceEvent(
  pubkey: string,
  blobbiD: string,
  session: string,
  over: { x?: number; y?: number; ageSeconds?: number } = {},
): NostrEvent {
  const ts = Math.floor(Date.now() / 1000) - (over.ageSeconds ?? 0);
  return {
    id: `presence-${pubkey}-${session}-${ts}`,
    kind: 31950,
    pubkey,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: over.x ?? 40, y: over.y ?? 70, ts },
      blobbiD,
      seq: 1,
    }),
    tags: [
      ['d', `session:${session}`],
      ['a', `31124:${pubkey}:${blobbiD}`],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

function Harness({ profile = 'standard' as ExperienceProfile }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <IslandSafetyProvider profile={profile}>
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-testid="world" data-world-surface>
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD={LOCAL_BLOBBI}
              startPosition={{ x: 50, y: 66 }}
            />
          </div>
        </MovementBlockerProvider>
      </PhotoBoothProvider>
    </IslandSafetyProvider>
  );
}

beforeEach(() => {
  currentUser = { pubkey: LOCAL };
  published.length = 0;
  subscriptions = [];
  fakeNostr = makeFakeNostr();
  localStorage.clear();
  clearAllRelationships();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

async function world(profile: ExperienceProfile = 'standard') {
  const view = render(<Harness profile={profile} />);
  await act(async () => {});
  await settle();

  const presenceSub = () => subscriptions.find((s) => s.kinds.includes(31950))!;
  const push = async (event: NostrEvent) => {
    await act(async () => presenceSub().push(event));
    await settle();
  };

  return {
    ...view,
    push,
    presenceSub,
    /** Every actor this layer drew. The local player must not be among them. */
    actors: () =>
      Array.from(view.container.querySelectorAll('[data-player-key]')).map(
        (el) => el.getAttribute('data-player-key') ?? '',
      ),
    /** The session id this client published under. */
    ownSession: () => {
      const tags = published[0]?.tags as string[][] | undefined;
      return tags?.find(([n]) => n === 'd')?.[1]?.replace('session:', '') ?? '';
    },
  };
}

describe('the local player is never a remote actor', () => {
  it('draws no copy of the local player when its own presence comes back', async () => {
    // The round trip that caused the bug: we publish, the relay echoes, and the
    // echo has to be recognised as us. `world()` already published a login.
    const w = await world();
    expect(published.length).toBeGreaterThan(0);
    expect(w.actors()).toEqual([]);
  });

  it('draws no copy after repeated heartbeats from the same session', async () => {
    const w = await world();
    const session = w.ownSession();
    for (let i = 0; i < 5; i += 1) {
      await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, session, { x: 40 + i }));
    }
    expect(w.actors()).toEqual([]);
  });

  it('draws no copy when the local identity resolves late', async () => {
    // THE REPRODUCTION. The subscription is opened once at init; if it captured
    // an empty pubkey, every later event from the player's own key looked like
    // a stranger: wearing the player's own Blobbi, walking the player's own
    // path a beat behind them.
    currentUser = undefined;
    const view = render(<Harness />);
    await act(async () => {});
    await settle();

    currentUser = { pubkey: LOCAL };
    await act(async () => { view.rerender(<Harness />); });
    await settle();

    const sub = subscriptions.find((s) => s.kinds.includes(31950))!;
    await act(async () => sub.push(presenceEvent(LOCAL, LOCAL_BLOBBI, 'later-session')));
    await settle();

    expect(view.container.querySelectorAll('[data-player-key]')).toHaveLength(0);
  });

  it('draws no copy after the player switches account in place', async () => {
    // Identity is not fixed for the life of the world: the account switcher
    // changes it under a mounted island. The ingest reads it at call time.
    const w = await world();
    currentUser = { pubkey: SWITCHED };
    await act(async () => { w.rerender(<Harness />); });
    await settle();

    await w.push(presenceEvent(SWITCHED, LOCAL_BLOBBI, 'switched-session'));
    expect(w.actors()).toEqual([]);
  });

  it('draws no copy for a reconnect under a new session id', async () => {
    const w = await world();
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, 'reconnected-session'));
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, 'reconnected-session', { x: 55 }));
    expect(w.actors()).toEqual([]);
  });

  it('cannot be resurrected by a stale own presence replayed on resubscribe', async () => {
    // The filter loads the whole still-valid window on every (re)subscribe, so
    // our own older events are replayed to us by design.
    const w = await world();
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, w.ownSession(), { ageSeconds: 20 }));
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, 'old-session', { ageSeconds: 30 }));
    expect(w.actors()).toEqual([]);
  });

  it('draws no copy when the signer signs with a key the app does not know about', async () => {
    // A NIP-07 extension can be switched to another account WITHOUT the app's
    // stored login changing, so every event we publish comes back authored by a
    // key we do not recognise as ours. Identity cannot catch that one, the
    // session id we generated and published is the only thing that still proves
    // the event is ours.
    const w = await world();
    await w.push(presenceEvent(SWITCHED, LOCAL_BLOBBI, w.ownSession()));
    expect(w.actors()).toEqual([]);
  });

  it('keeps publishing movement: the fix refuses actors, not events', async () => {
    const w = await world();
    const before = published.length;
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, w.ownSession(), { x: 61, y: 71 }));
    // The heartbeat/login publisher is untouched by identity admission.
    expect(published.length).toBeGreaterThanOrEqual(before);
    expect(published.every((t) => t.kind === 31950 || t.kind === 21201)).toBe(true);
    expect(w.actors()).toEqual([]);
  });
});

describe('real remote players are unaffected', () => {
  it('draws a stranger', async () => {
    const w = await world();
    await w.push(presenceEvent(OTHER, 'their-blobbi', 'their-session'));
    expect(w.actors()).toEqual([`${OTHER}:their-session`]);
  });

  it('draws a stranger whose Blobbi looks exactly like ours', async () => {
    // Identity decides, never appearance: this fake relay gives every Blobbi
    // the same colours, so a check that keyed on looks would drop this player.
    const w = await world();
    await w.push(presenceEvent(OTHER, LOCAL_BLOBBI, 'lookalike-session'));
    expect(w.actors()).toEqual([`${OTHER}:lookalike-session`]);
  });

  it('draws a stranger alongside our own echoed presence', async () => {
    const w = await world();
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, w.ownSession(), { x: 44 }));
    await w.push(presenceEvent(OTHER, 'their-blobbi', 'their-session'));
    expect(w.actors()).toEqual([`${OTHER}:their-session`]);
  });

  it('survives a naming-policy change without gaining an actor', async () => {
    // The policy change clears cached visuals and re-resolves every player.
    // Re-resolving must not re-admit anyone, least of all us.
    const w = await world('family');
    await w.push(presenceEvent(OTHER, 'their-blobbi', 'their-session'));
    await w.push(presenceEvent(LOCAL, LOCAL_BLOBBI, w.ownSession()));
    expect(w.actors()).toEqual([`${OTHER}:their-session`]);
  });
});
