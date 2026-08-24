/**
 * Mute and Block, proven against the real ingest paths.
 *
 * Every case here pushes a real event through the real subscription and asserts
 * on the DOM, because the claims are about what reaches a player — not about
 * what a component chooses to draw. The distinction matters most for Block: a
 * blocked player must never enter the presence model at all, so "no actor" has
 * to be true of the state, not just of the render.
 *
 * Harness shape follows `MultiplayerLayer.chat-policy.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { MovementBlockerProvider } from '@/contexts/MovementBlockerContext';
import { PhotoBoothProvider } from '@/contexts/PhotoBoothContext';
import { IslandSafetyProvider, type ExperienceProfile } from '@/safety';
import {
  clearAllRelationships,
  clearRecentMessages,
  recentMessageFrom,
  setPlayerBlocked,
  setPlayerMuted,
} from '@/player-safety';
import { MultiplayerLayer } from './MultiplayerLayer';
import type { NostrEvent } from '@nostrify/nostrify';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'localpk' } }),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: async () => {}, mutate: () => {} }),
}));
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: 'town' }) }));
vi.mock('@/hooks/useBlobbis', () => ({ useBlobbis: () => ({ data: [] }) }));
vi.mock('@/hooks/useBlobbonautProfile', () => ({ useBlobbonautProfile: () => ({ data: {} }) }));
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
          while (queue.length > 0) yield ['EVENT', 'sub', queue.shift()];
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
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: fakeNostr }) }));

/** A real-shaped hex pubkey, because the store validates the format. */
const RUDE = 'a'.repeat(64);
const FRIEND = 'f'.repeat(64);
const RUDE_KEY = `${RUDE}:abc`;
const FRIEND_KEY = `${FRIEND}:def`;

const HOSTILE_TEXT = 'whats your real name, add me on some-other-app';

const nowSec = () => Math.floor(Date.now() / 1000);
let seq = 0;

function presenceEvent(pubkey: string, session: string): NostrEvent {
  const ts = nowSec();
  seq += 1;
  return {
    id: `presence-${pubkey.slice(0, 4)}-${seq}`,
    kind: 31950,
    pubkey,
    created_at: ts,
    sig: '',
    content: JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: 40, y: 70, ts },
      blobbiD: 'remote-blobbi',
      seq,
    }),
    tags: [
      ['d', `session:${session}`],
      ['a', `31124:${pubkey}:remote-blobbi`],
      ['t', 'blobbi:presence'],
      ['t', 'island:1'],
      ['t', 'loc:town'],
      ['expiration', String(ts + 35)],
    ],
  };
}

function chatEvent(pubkey: string, session: string, payload: Record<string, unknown>): NostrEvent {
  const ts = nowSec();
  seq += 1;
  return {
    id: `chat-${seq}`,
    kind: 21201,
    pubkey,
    created_at: ts,
    sig: '',
    content: JSON.stringify({ location: 'town', blobbiD: 'remote-blobbi', ts, ...payload }),
    tags: [
      ['d', `session:${session}`],
      ['l', 'town'],
      ['i', '1'],
      ['p', pubkey],
      ['expiration', String(ts + 10)],
    ],
  };
}

const legacyText = (pubkey: string, session: string, text: string) =>
  chatEvent(pubkey, session, { type: 'chat', text });

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
  seq = 0;
  fakeNostr = makeFakeNostr();
  localStorage.clear();
  clearAllRelationships();
  clearRecentMessages();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function setup(profile: ExperienceProfile = 'standard') {
  const { container } = render(<Harness profile={profile} />);
  await act(async () => {});
  await act(async () => {});

  const presenceSub = subscriptions.find((s) => s.kinds.includes(31950))!;
  const chatSub = subscriptions.find((s) => s.kinds.includes(21201))!;
  expect(presenceSub).toBeTruthy();
  expect(chatSub).toBeTruthy();

  const push = async (sub: { push: Pusher }, event: NostrEvent) => {
    await act(async () => sub.push(event));
    await act(async () => {});
  };

  /** Run a safety action and let the resulting eviction settle. */
  const apply = async (action: () => void) => {
    await act(async () => {
      action();
    });
    await act(async () => {});
  };

  return {
    container,
    arrive: (pubkey: string, session: string) =>
      push(presenceSub, presenceEvent(pubkey, session)),
    say: (pubkey: string, session: string, payload: Record<string, unknown>) =>
      push(chatSub, chatEvent(pubkey, session, payload)),
    sayText: (pubkey: string, session: string, text: string) =>
      push(chatSub, legacyText(pubkey, session, text)),
    apply,
    actor: (key: string) => container.querySelector(`[data-player-key="${key}"]`),
  };
}

// ── Communication: cases 1-6 ────────────────────────────────────────────────

describe('a blocked sender is not heard, whatever they send', () => {
  it.each([
    ['legacy free text', { type: 'chat', text: HOSTILE_TEXT }, HOSTILE_TEXT],
    ['a quick phrase', { type: 'quick', v: 1, phrase: 'hi' }, 'Hi!'],
    [
      'a template',
      { type: 'template', v: 1, template: 'going-to', params: { location: 'beach' } },
      "I'm going to the Beach.",
    ],
  ])('drops %s', async (_label, payload, rendered) => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.say(RUDE, 'abc', payload);

    expect(world.container.textContent).not.toContain(rendered);
    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });

  it('drops an emote', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.say(RUDE, 'abc', { type: 'emote', v: 1, emote: 'wave' });

    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });
});

describe('a muted sender is not heard but stays visible', () => {
  it.each([
    ['legacy free text', { type: 'chat', text: HOSTILE_TEXT }, HOSTILE_TEXT],
    ['a quick phrase', { type: 'quick', v: 1, phrase: 'hi' }, 'Hi!'],
    ['an emote', { type: 'emote', v: 1, emote: 'wave' }, 'Wave'],
  ])('drops %s', async (_label, payload, rendered) => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerMuted(RUDE, true));

    await world.say(RUDE, 'abc', payload);

    expect(world.container.textContent).not.toContain(rendered);
  });

  it('keeps the muted player on the island', async () => {
    // The whole distinction between Mute and Block. Muting is "I do not want to
    // read this", not "I do not want you here".
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerMuted(RUDE, true));

    expect(world.actor(RUDE_KEY)).toBeTruthy();
  });

  it('leaves everyone else audible', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.arrive(FRIEND, 'def');
    await world.apply(() => setPlayerMuted(RUDE, true));

    await world.sayText(FRIEND, 'def', 'want to play tag?');

    expect(world.container.textContent).toContain('want to play tag?');
  });
});

// ── Presence: cases 7-9 ─────────────────────────────────────────────────────

describe('block at the presence ingest', () => {
  it('never lets a blocked player arrive', async () => {
    const world = await setup();
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.arrive(RUDE, 'abc');

    expect(world.actor(RUDE_KEY)).toBeNull();
  });

  it('removes a player who is already on screen, immediately', async () => {
    // Not "eventually": presence lives for 35 s plus a grace sweep, and waiting
    // out a timeout next to someone you just blocked is not a safety control.
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    expect(world.actor(RUDE_KEY)).toBeTruthy();

    await world.apply(() => setPlayerBlocked(RUDE, true));

    expect(world.actor(RUDE_KEY)).toBeNull();
  });

  it('keeps them gone when they keep publishing', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.arrive(RUDE, 'abc');
    await world.arrive(RUDE, 'abc');

    expect(world.actor(RUDE_KEY)).toBeNull();
  });

  it('brings them back when unblocked', async () => {
    const world = await setup();
    await world.apply(() => setPlayerBlocked(RUDE, true));
    await world.arrive(RUDE, 'abc');
    expect(world.actor(RUDE_KEY)).toBeNull();

    await world.apply(() => setPlayerBlocked(RUDE, false));
    await world.arrive(RUDE, 'abc');

    expect(world.actor(RUDE_KEY)).toBeTruthy();
  });

  it("leaves a muted player's presence completely alone", async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerMuted(RUDE, true));
    await world.arrive(RUDE, 'abc');

    expect(world.actor(RUDE_KEY)).toBeTruthy();
  });

  it('does not touch anybody else', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.arrive(FRIEND, 'def');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    expect(world.actor(RUDE_KEY)).toBeNull();
    expect(world.actor(FRIEND_KEY)).toBeTruthy();
  });
});

// ── Existing UI state: cases 10-11 ──────────────────────────────────────────

describe('what is already on screen goes too', () => {
  it('takes down a visible bubble when the sender is muted', async () => {
    // A hostile message must not sit there for the rest of its four-second life
    // after the player pressed the button to make it stop.
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.sayText(RUDE, 'abc', HOSTILE_TEXT);
    expect(world.container.textContent).toContain(HOSTILE_TEXT);

    await world.apply(() => setPlayerMuted(RUDE, true));

    expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
  });

  it('takes down a visible bubble when the sender is blocked', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.sayText(RUDE, 'abc', HOSTILE_TEXT);
    expect(world.container.textContent).toContain(HOSTILE_TEXT);

    await world.apply(() => setPlayerBlocked(RUDE, true));

    expect(world.container.textContent).not.toContain(HOSTILE_TEXT);
    expect(world.actor(RUDE_KEY)).toBeNull();
  });

  it("leaves another player's bubble up", async () => {
    const world = await setup();
    await world.arrive(FRIEND, 'def');
    await world.sayText(FRIEND, 'def', 'hello there');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    expect(world.container.textContent).toContain('hello there');
  });
});

// ── Report evidence ─────────────────────────────────────────────────────────

describe('evidence for a report', () => {
  it('remembers what a player said, so a report can point at it', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.sayText(RUDE, 'abc', HOSTILE_TEXT);

    const remembered = recentMessageFrom(RUDE);
    expect(remembered?.renderedText).toBe(HOSTILE_TEXT);
    expect(remembered?.event.kind).toBe(21201);
    expect(remembered?.event.pubkey).toBe(RUDE);
  });

  it('remembers the local meaning of a structured message, not its ids', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.say(RUDE, 'abc', { type: 'quick', v: 1, phrase: 'want-to-play' });

    expect(recentMessageFrom(RUDE)?.renderedText).toBe('Want to play?');
    expect(recentMessageFrom(RUDE)?.messageClass).toBe('quick');
  });

  it('forgets a player once they are blocked', async () => {
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.sayText(RUDE, 'abc', HOSTILE_TEXT);

    await world.apply(() => setPlayerBlocked(RUDE, true));

    expect(recentMessageFrom(RUDE)).toBeNull();
  });
});

// ── Family: cases 16-18 ─────────────────────────────────────────────────────

describe('the same rules apply in both experiences', () => {
  it('blocks identically under Family', async () => {
    const world = await setup('family');
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));
    await world.say(RUDE, 'abc', { type: 'quick', v: 1, phrase: 'hi' });

    expect(world.actor(RUDE_KEY)).toBeNull();
    expect(world.container.textContent).not.toContain('Hi!');
  });

  it('leaves Family free-text restrictions working for everyone else', async () => {
    // Blocking one player must not disturb the capability layer: a non-blocked
    // Standard player's free text is still refused under Family.
    const world = await setup('family');
    await world.arrive(FRIEND, 'def');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.sayText(FRIEND, 'def', 'hello there');

    expect(world.container.textContent).not.toContain('hello there');
  });

  it('still delivers safe classes from non-blocked players under Family', async () => {
    const world = await setup('family');
    await world.arrive(FRIEND, 'def');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.say(FRIEND, 'def', { type: 'quick', v: 1, phrase: 'good-game' });

    expect(world.container.textContent).toContain('Good game!');
  });
});

// ── Case 19: a modified client cannot route around it ───────────────────────

describe('a blocked client cannot get through by changing its payload', () => {
  it.each([
    ['free text', { type: 'chat', text: HOSTILE_TEXT }],
    ['a quick phrase', { type: 'quick', v: 1, phrase: 'hi' }],
    ['an emote', { type: 'emote', v: 1, emote: 'wave' }],
    ['a template', { type: 'template', v: 1, template: 'back-in', params: { time: '5m' } }],
    ['an unknown class', { type: 'sticker', v: 1, sticker: 'x' }],
    ['a malformed payload', { type: 'quick', v: 1 }],
  ])('drops %s', async (_label, payload) => {
    // The gate is on the SENDER and runs before the payload is even parsed, so
    // reshaping the message cannot change the outcome.
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    await world.say(RUDE, 'abc', payload);

    expect(world.container.querySelector('[role="status"]')).toBeNull();
  });

  it('does not stop the same PERSON returning under a new key', async () => {
    // Documented, not fixed. Keys are free: blocking is an identity-level
    // control, never a person-level ban. This is why Family's communication
    // restrictions still matter after Block exists.
    const world = await setup();
    await world.arrive(RUDE, 'abc');
    await world.apply(() => setPlayerBlocked(RUDE, true));

    const newIdentity = 'd'.repeat(64);
    await world.arrive(newIdentity, 'ghi');

    expect(world.actor(`${newIdentity}:ghi`)).toBeTruthy();
  });
});
