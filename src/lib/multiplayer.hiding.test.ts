/**
 * Coverage for the hiding-spot state carried by presence (kind 31950).
 *
 * Hiding is represented as an OPTIONAL, semantic field in the existing presence
 * content (`hiddenIn: "<hiding-spot-id>"`) — no new event kind, no coordinate
 * guessing. These tests pin when it is published, when it is absent, and that
 * clients which know nothing about it stay valid.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  publishHide,
  publishMove,
  publishHeartbeat,
  publishPresenceLogin,
  validatePresenceEvent,
  createWalkableApi,
  isSupersededPresence,
  presenceOrderOf,
  type PresenceContent,
} from './multiplayer';
import type { NostrEvent } from '@nostrify/nostrify';

const PARAMS = {
  sessionId: 'session-1',
  islandId: '1',
  location: 'town' as const,
  blobbiAddr: '31124:pk:blobbi-1',
};

interface Published {
  kind: number;
  content: string;
  tags: string[][];
}

function collector() {
  const events: Published[] = [];
  const publish = async (event: Record<string, unknown>) => {
    events.push(event as unknown as Published);
  };
  return {
    publish,
    events,
    lastContent: () => JSON.parse(events[events.length - 1].content) as PresenceContent,
  };
}

/** Turn a published payload into a signed-looking event for the validator. */
function asEvent(published: Published): NostrEvent {
  return {
    id: 'evt',
    pubkey: 'pk',
    created_at: Math.floor(Date.now() / 1000),
    sig: '',
    kind: published.kind,
    content: published.content,
    tags: published.tags,
  };
}

describe('presence hiding state', () => {
  it('publishes hiddenIn with the hiding-spot id on arrival', async () => {
    const c = collector();

    await publishHide(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3');

    const content = c.lastContent();
    expect(content.hiddenIn).toBe('town-bush-3');
    expect(content.state).toBe('idle');
    // Position stays truthful — hiding does not move the player out of the world.
    expect(content.anchor.x).toBe(8);
    expect(content.anchor.y).toBe(91);
    expect(content.goal).toBeUndefined();
    // Reuses the existing presence kind; no new kind was introduced.
    expect(c.events[0].kind).toBe(31950);
  });

  it('never carries hiddenIn on a movement publish — moving away clears it', async () => {
    const c = collector();
    const nav = createWalkableApi('town');

    await publishMove(c.publish, PARAMS, { x: 8, y: 91 }, { x: 50, y: 68 }, 120, nav);

    const content = c.lastContent();
    expect(content.state).toBe('moving');
    expect(content.goal).toBeDefined();
    expect('hiddenIn' in content).toBe(false);
  });

  it('preserves hiddenIn across heartbeats, and omits it when not hidden', async () => {
    const c = collector();

    await publishHeartbeat(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3');
    expect(c.lastContent().hiddenIn).toBe('town-bush-3');

    await publishHeartbeat(c.publish, PARAMS, { x: 8, y: 91 }, undefined);
    expect('hiddenIn' in c.lastContent()).toBe(false);
  });

  it('omits hiddenIn on login presence', async () => {
    const c = collector();

    await publishPresenceLogin(c.publish, { ...PARAMS, startPos: { x: 50, y: 68 } });

    expect('hiddenIn' in c.lastContent()).toBe(false);
  });

  it('keeps presence valid with and without the optional field', async () => {
    const c = collector();
    await publishHide(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3');
    await publishHeartbeat(c.publish, PARAMS, { x: 8, y: 91 });

    // A client that publishes `hiddenIn` and one that has never heard of it both
    // produce valid presence — the field is additive, so old clients simply
    // ignore it and keep rendering the Blobbi.
    expect(validatePresenceEvent(asEvent(c.events[0]))).toBe(true);
    expect(validatePresenceEvent(asEvent(c.events[1]))).toBe(true);
  });

  it('reads an unknown hiding state as "not hidden" for legacy payloads', () => {
    // Exactly what an older client sends: no hiddenIn key at all.
    const legacy = JSON.stringify({
      state: 'idle',
      location: 'town',
      anchor: { x: 50, y: 68, ts: 1 },
    });
    const content = JSON.parse(legacy) as PresenceContent;
    expect(content.hiddenIn).toBeUndefined();
  });

  it('stamps the publish sequence on hide, move and heartbeat presence', async () => {
    const c = collector();
    const nav = createWalkableApi('town');

    await publishHide(c.publish, { ...PARAMS, seq: 4 }, { x: 8, y: 91 }, 'town-bush-3');
    await publishMove(
      c.publish, { ...PARAMS, seq: 5 }, { x: 8, y: 91 }, { x: 50, y: 68 }, 120, nav,
    );
    await publishHeartbeat(c.publish, { ...PARAMS, seq: 6 }, { x: 50, y: 68 });
    await publishPresenceLogin(c.publish, { ...PARAMS, seq: 7, startPos: { x: 50, y: 68 } });

    expect(c.events.map((e) => JSON.parse(e.content).seq)).toEqual([4, 5, 6, 7]);
  });

  it('omits seq entirely when the publisher does not supply one', async () => {
    const c = collector();

    await publishHide(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3');

    expect('seq' in c.lastContent()).toBe(false);
    expect(validatePresenceEvent(asEvent(c.events[0]))).toBe(true);
  });

  it('survives a re-hide in the same spot without changing the state', async () => {
    const c = collector();
    const spy = vi.fn(c.publish);

    await publishHide(spy, PARAMS, { x: 8, y: 91 }, 'town-bush-3');
    await publishHide(spy, PARAMS, { x: 8, y: 91 }, 'town-bush-3');

    // Idempotent: the same addressable event content, so repeated arrivals can
    // never leave a player half-hidden for observers.
    expect(JSON.parse(c.events[0].content).hiddenIn).toBe('town-bush-3');
    expect(JSON.parse(c.events[1].content).hiddenIn).toBe('town-bush-3');
  });
});

describe('presence update ordering', () => {
  const order = (createdAt: number, seq?: number) => ({ createdAt, seq });

  it('accepts the first update for a session', () => {
    expect(isSupersededPresence(undefined, order(100, 1))).toBe(false);
  });

  it('orders same-second updates by seq', () => {
    // THE case this exists for: hide (seq 7) and the move that leaves it (seq 8)
    // share a created_at second. Whatever order the relay delivers them in, the
    // move wins and the hide is dropped.
    const known = order(100, 8); // move applied first
    expect(isSupersededPresence(known, order(100, 7))).toBe(true);

    const knownHide = order(100, 7); // hide applied first
    expect(isSupersededPresence(knownHide, order(100, 8))).toBe(false);
  });

  it('drops duplicate re-deliveries of an already applied update', () => {
    expect(isSupersededPresence(order(100, 8), order(100, 8))).toBe(true);
    expect(isSupersededPresence(order(100, 8), order(105, 8))).toBe(true);
  });

  it('trusts seq over created_at, since seq is monotonic per session', () => {
    // A newer publish always carries a higher seq, even if the wall clock did not
    // advance (or went backwards).
    expect(isSupersededPresence(order(100, 8), order(99, 9))).toBe(false);
    expect(isSupersededPresence(order(100, 8), order(101, 7))).toBe(true);
  });

  it('falls back to created_at when either side has no seq', () => {
    // Legacy publisher: exactly the previous behavior — strictly older dropped,
    // same second applied.
    expect(isSupersededPresence(order(100), order(99))).toBe(true);
    expect(isSupersededPresence(order(100), order(100))).toBe(false);
    expect(isSupersededPresence(order(100), order(101))).toBe(false);

    // Mixed (should not happen within one session, but must not throw or lock up).
    expect(isSupersededPresence(order(100, 3), order(99))).toBe(true);
    expect(isSupersededPresence(order(100), order(101, 3))).toBe(false);
  });

  it('reads seq safely from legacy and malformed content', () => {
    const base = { state: 'idle', location: 'town', anchor: { x: 1, y: 2, ts: 3 } } as PresenceContent;

    expect(presenceOrderOf(base, 100)).toEqual({ createdAt: 100, seq: undefined });
    expect(presenceOrderOf({ ...base, seq: 9 }, 100)).toEqual({ createdAt: 100, seq: 9 });
    // Non-numeric / non-finite values are ignored rather than poisoning ordering.
    expect(presenceOrderOf({ ...base, seq: '9' as unknown as number }, 100).seq).toBeUndefined();
    expect(presenceOrderOf({ ...base, seq: NaN }, 100).seq).toBeUndefined();
    expect(presenceOrderOf({ ...base, seq: Infinity }, 100).seq).toBeUndefined();
  });
});
