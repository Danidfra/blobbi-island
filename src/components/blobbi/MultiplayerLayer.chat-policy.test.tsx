/**
 * The data-boundary proof for the safety policy (Family Safety, Phase A).
 *
 * The claim being checked is deliberately not "the chat input is hidden". It is:
 *
 *   a hostile kind 21201 arriving from the relay never becomes a speech bubble
 *   under the Family policy — while the SAME event, pushed through the SAME
 *   subscription, still does under Standard.
 *
 * That distinction is the point of the whole phase. The sender is not
 * necessarily this build: a Standard player standing in the same room, or any
 * third-party client, can emit a well-formed chat event, so a restriction that
 * lived in the composer would protect nobody. These tests therefore drive the
 * real `MultiplayerLayer` with a real event and assert on what reaches the DOM.
 *
 * The Standard case is as load-bearing as the Family one: it is the standing
 * proof that adding the policy seam changed nothing for today's players.
 *
 * Harness shape (mocks, fake relay, frozen animation frame) follows
 * `MultiplayerLayer.hiding.test.tsx`, so the two read the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
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

const REMOTE_PUBKEY = 'remotepk';
const REMOTE_KEY = `${REMOTE_PUBKEY}:abc`;

/** Text no child should be shown, standing in for anything a stranger may type. */
const HOSTILE_TEXT = 'hey whats your real name? add me on some-other-app';

const nowSec = () => Math.floor(Date.now() / 1000);

function presenceEvent(): NostrEvent {
  const ts = nowSec();
  return {
    id: `presence-${ts}`,
    kind: 31950,
    pubkey: REMOTE_PUBKEY,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: 40, y: 70, ts },
      blobbiD: 'remote-blobbi',
      seq: 1,
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

function chatEvent(text: string): NostrEvent {
  const ts = nowSec();
  return {
    id: `chat-${ts}-${text.length}`,
    kind: 21201,
    pubkey: REMOTE_PUBKEY,
    created_at: ts,
    sig: '',
    content: JSON.stringify({ type: 'chat', location: 'town', blobbiD: 'remote-blobbi', text, ts }),
    tags: [
      ['d', 'session:abc'],
      ['l', 'town'],
      ['i', '1'],
      ['p', REMOTE_PUBKEY],
      ['expiration', String(ts + 10)],
      ['alt', `Chat message: ${text.slice(0, 50)}`],
    ],
  };
}

function Harness({ profile }: { profile: ExperienceProfile }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <IslandSafetyProvider profile={profile}>
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-testid="world" data-world-surface>
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD="local-blobbi"
              startPosition={{ x: 50, y: 66 }}
            />
          </div>
        </MovementBlockerProvider>
      </PhotoBoothProvider>
    </IslandSafetyProvider>
  );
}

beforeEach(() => {
  subscriptions = [];
  published.length = 0;
  fakeNostr = makeFakeNostr();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Mount the world under a profile, put a remote player in the room, and return
 * a way to push chat at it.
 *
 * The presence event comes first on purpose: a bubble is anchored to the remote
 * Blobbi's element, so without a visible player there would be nothing to render
 * into and a Family "no bubble" result would prove nothing.
 */
async function setup(profile: ExperienceProfile) {
  const { container } = render(<Harness profile={profile} />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
  const chatSub = subscriptions.find((s) => s.kinds.includes(21201));
  expect(presenceSub, 'presence subscription should exist').toBeTruthy();
  expect(chatSub, 'chat subscription should exist — the receive path stays wired in every profile').toBeTruthy();

  const push = async (sub: { push: Pusher }, event: NostrEvent) => {
    await act(async () => {
      sub.push(event);
    });
    await act(async () => {});
  };

  await push(presenceSub!, presenceEvent());
  expect(
    container.querySelector(`[data-player-key="${REMOTE_KEY}"]`),
    'the remote player should be in the room',
  ).toBeTruthy();

  return {
    container,
    say: (text: string) => push(chatSub!, chatEvent(text)),
  };
}

describe('Standard renders foreign chat exactly as it does today', () => {
  it('shows a remote player’s message as a speech bubble', async () => {
    const world = await setup('standard');

    await world.say(HOSTILE_TEXT);

    // The capability check is not a content filter: Standard admits this
    // deliberately, and that is what proves the seam changed nothing.
    expect(world.container.textContent).toContain(HOSTILE_TEXT);
  });

  it('shows an ordinary message too', async () => {
    const world = await setup('standard');

    await world.say('want to play tag?');

    expect(world.container.textContent).toContain('want to play tag?');
  });
});

describe('Family refuses foreign free text before it can be presented', () => {
  it('never renders a remote player’s message', async () => {
    const world = await setup('family');

    await world.say(HOSTILE_TEXT);

    expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
  });

  it('refuses innocuous text too — the boundary is the capability, not the words', async () => {
    const world = await setup('family');

    await world.say('want to play tag?');

    expect(world.container.textContent).not.toContain('want to play tag?');
  });

  it('keeps the remote player visible: the message is refused, the person is not', async () => {
    // Family mode is not a single-player mode. Restricting speech must not
    // quietly remove co-presence, which is the reason a child is here at all.
    const world = await setup('family');

    await world.say(HOSTILE_TEXT);

    expect(world.container.querySelector(`[data-player-key="${REMOTE_KEY}"]`)).toBeTruthy();
  });
});
