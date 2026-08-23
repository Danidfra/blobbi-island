/**
 * The end-to-end proof for Communication V2's safety boundary.
 *
 * Real component, real subscription, real events. The claims being checked are
 * deliberately not "the composer is hidden":
 *
 *   - a hostile kind 21201 never becomes a bubble under Family, while the SAME
 *     event still does under Standard;
 *   - a spoofed structured message — a valid phrase id with abusive text bolted
 *     on — renders the catalog phrase and never the text, in EITHER profile;
 *   - a template renders the sentence this build reconstructs, not anything the
 *     sender wrote;
 *   - refusing a message never removes the person who sent it.
 *
 * The sender is not necessarily this build, which is why every one of these is
 * pushed in from the relay side rather than sent through the UI.
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
import type { IslandMessage } from '@/communication';
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

let chatSeq = 0;

/** A kind 21201 event carrying an arbitrary content payload. */
function chatEvent(payload: Record<string, unknown>): NostrEvent {
  const ts = nowSec();
  chatSeq += 1;
  return {
    id: `chat-${ts}-${chatSeq}`,
    kind: 21201,
    pubkey: REMOTE_PUBKEY,
    created_at: ts,
    sig: '',
    content: JSON.stringify({ location: 'town', blobbiD: 'remote-blobbi', ts, ...payload }),
    tags: [
      ['d', 'session:abc'],
      ['l', 'town'],
      ['i', '1'],
      ['p', REMOTE_PUBKEY],
      ['expiration', String(ts + 10)],
    ],
  };
}

/** The deployed pre-Communication-V2 free-text shape. */
const legacyText = (text: string) => chatEvent({ type: 'chat', text });

function Harness({
  profile,
  sendRef,
}: {
  profile: ExperienceProfile;
  sendRef?: React.MutableRefObject<((message: IslandMessage) => Promise<boolean>) | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<((message: IslandMessage) => Promise<boolean>) | null>(null);
  return (
    <IslandSafetyProvider profile={profile}>
      <PhotoBoothProvider>
        <MovementBlockerProvider>
          <div ref={containerRef} data-testid="world" data-world-surface>
            <MultiplayerLayer
              containerRef={containerRef}
              currentBlobbiD="local-blobbi"
              startPosition={{ x: 50, y: 66 }}
              sendMessageRef={sendRef ?? fallbackRef}
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
  chatSeq = 0;
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
 * ways to push messages at it and to send from it.
 *
 * The presence event comes first on purpose: a bubble anchors to the remote
 * Blobbi's element, so without a visible player there would be nothing to render
 * into and a "no bubble" result would prove nothing.
 */
async function setup(profile: ExperienceProfile) {
  const sendRef: React.MutableRefObject<((message: IslandMessage) => Promise<boolean>) | null> = {
    current: null,
  };
  const { container } = render(<Harness profile={profile} sendRef={sendRef} />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950));
  const chatSub = subscriptions.find((s) => s.kinds.includes(21201));
  expect(presenceSub, 'presence subscription should exist').toBeTruthy();
  expect(
    chatSub,
    'chat subscription should exist - the receive path stays wired in every profile',
  ).toBeTruthy();

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
    /** Deliver one kind 21201 event from the remote player. */
    receive: (payload: Record<string, unknown>) => push(chatSub!, chatEvent(payload)),
    receiveEvent: (event: NostrEvent) => push(chatSub!, event),
    /** Publish one message as the local player. */
    send: async (message: IslandMessage) => {
      let sent = false;
      await act(async () => {
        sent = (await sendRef.current?.(message)) ?? false;
      });
      await act(async () => {});
      return sent;
    },
    remotePlayer: () => container.querySelector(`[data-player-key="${REMOTE_KEY}"]`),
    chatEvents: () => published.filter((event) => event.kind === 21201),
  };
}

// ── Receiving ───────────────────────────────────────────────────────────────

describe('Standard renders foreign communication exactly as it does today', () => {
  it('shows legacy free text as a speech bubble', async () => {
    const world = await setup('standard');

    await world.receiveEvent(legacyText(HOSTILE_TEXT));

    // The capability check is not a content filter: Standard admits this
    // deliberately, and that is what proves the pipeline changed nothing.
    expect(world.container.textContent).toContain(HOSTILE_TEXT);
  });

  it('shows a quick phrase using the local catalog text', async () => {
    const world = await setup('standard');

    await world.receive({ type: 'quick', v: 1, phrase: 'want-to-play' });

    expect(world.container.textContent).toContain('Want to play?');
  });

  it('shows an emote', async () => {
    const world = await setup('standard');

    await world.receive({ type: 'emote', v: 1, emote: 'wave' });

    const bubble = world.container.querySelector('[role="status"]');
    expect(bubble?.getAttribute('aria-label')).toBe('Wave');
  });
});

describe('Family refuses free text before it can be presented', () => {
  it('never renders legacy free text', async () => {
    const world = await setup('family');

    await world.receiveEvent(legacyText(HOSTILE_TEXT));

    expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
  });

  it('refuses innocuous text too - the boundary is the capability, not the words', async () => {
    const world = await setup('family');

    await world.receiveEvent(legacyText('want to play tag?'));

    expect(world.container.textContent).not.toContain('want to play tag?');
  });

  it('keeps the remote player visible: the message is refused, the person is not', async () => {
    // Family mode is not a single-player mode. Restricting speech must not
    // quietly remove co-presence, which is the reason a child is here at all.
    const world = await setup('family');

    await world.receiveEvent(legacyText(HOSTILE_TEXT));

    expect(world.remotePlayer()).toBeTruthy();
  });
});

describe('Family still hears the safe classes', () => {
  it('renders a valid quick phrase', async () => {
    const world = await setup('family');

    await world.receive({ type: 'quick', v: 1, phrase: 'good-game' });

    expect(world.container.textContent).toContain('Good game!');
  });

  it('renders a template as the sentence THIS build reconstructs', async () => {
    const world = await setup('family');

    await world.receive({
      type: 'template',
      v: 1,
      template: 'meet-at-in',
      params: { location: 'beach', time: '15m' },
    });

    expect(world.container.textContent).toContain('Meet me at the Beach in 15 minutes.');
  });

  it('renders an emote with its accessible label', async () => {
    const world = await setup('family');

    await world.receive({ type: 'emote', v: 1, emote: 'heart' });

    const bubble = world.container.querySelector('[role="status"]');
    expect(bubble?.getAttribute('aria-label')).toBe('Heart');
  });
});

describe('a structured message cannot smuggle text into either profile', () => {
  it.each([['standard'], ['family']] as const)(
    'renders the catalog phrase and not the attached text (%s)',
    async (profile) => {
      const world = await setup(profile);

      await world.receive({
        type: 'quick',
        v: 1,
        phrase: 'hi',
        text: HOSTILE_TEXT,
        fallback: HOSTILE_TEXT,
      });

      expect(world.container.textContent).toContain('Hi!');
      expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
    },
  );

  it('shows nothing at all when the phrase id is not real', async () => {
    // The attack the brief names: type says "quick", payload is arbitrary text.
    const world = await setup('family');

    await world.receive({ type: 'quick', v: 1, phrase: 'made-up', text: HOSTILE_TEXT });

    expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });

  it('refuses a template whose parameter is not in the catalog', async () => {
    const world = await setup('family');

    await world.receive({
      type: 'template',
      v: 1,
      template: 'going-to',
      params: { location: 'MY HOUSE, come alone' },
    });

    expect(world.container.textContent).not.toContain('MY HOUSE');
    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });

  it('refuses a structured message carrying an unknown version', async () => {
    const world = await setup('standard');

    await world.receive({ type: 'quick', v: 99, phrase: 'hi' });

    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });
});

// ── Sending ─────────────────────────────────────────────────────────────────

describe('Standard can publish every class', () => {
  it.each([
    ['text', { type: 'text', text: 'hello there' }],
    ['quick', { type: 'quick', phrase: 'hi' }],
    ['emote', { type: 'emote', emote: 'wave' }],
    ['template', { type: 'template', template: 'back-in', params: { time: '5m' } }],
  ] as const)('publishes a %s message', async (_label, message) => {
    const world = await setup('standard');

    expect(await world.send(message)).toBe(true);
    expect(world.chatEvents()).toHaveLength(1);
  });

  it('publishes free text in the shape an older client still understands', async () => {
    const world = await setup('standard');

    await world.send({ type: 'text', text: 'hello there' });

    const payload = JSON.parse(world.chatEvents()[0].content);
    expect(payload.type).toBe('chat');
    expect(payload.text).toBe('hello there');
  });

  it('publishes structured messages as stable ids with no free-text field', async () => {
    const world = await setup('standard');

    await world.send({ type: 'template', template: 'going-to', params: { location: 'arcade' } });

    const raw = world.chatEvents()[0].content;
    const payload = JSON.parse(raw);
    expect(payload).toMatchObject({
      type: 'template',
      v: 1,
      template: 'going-to',
      params: { location: 'arcade' },
    });
    expect(payload.text).toBeUndefined();
    expect(raw).not.toContain('the Arcade');
  });
});

describe('Family refuses to publish free text', () => {
  it('publishes nothing for a text message', async () => {
    // The outbound half of the same capability. A Family client cannot be made
    // to emit free text even by a caller holding the send ref directly.
    const world = await setup('family');

    expect(await world.send({ type: 'text', text: HOSTILE_TEXT })).toBe(false);
    expect(world.chatEvents()).toHaveLength(0);
  });

  it.each([
    ['quick', { type: 'quick', phrase: 'hi' }],
    ['emote', { type: 'emote', emote: 'clap' }],
    ['template', { type: 'template', template: 'want-to-play', params: { activity: 'pool' } }],
  ] as const)('still publishes a %s message', async (_label, message) => {
    const world = await setup('family');

    expect(await world.send(message)).toBe(true);
    expect(world.chatEvents()).toHaveLength(1);
    expect(world.chatEvents()[0].content).not.toContain('"text"');
  });
});
