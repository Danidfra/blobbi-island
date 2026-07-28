/**
 * Coverage for the SHARED-ACTIVITY reference carried by presence (kind 31950).
 *
 * Presence answers exactly one question about a watch session — *which shared
 * activity is this visible player in?* — and carries only the session ADDRESS
 * (`docs/protocol/shared-playback-session.md` §14.2, §14.3). It is not, and must
 * never become, a second copy of the playback state.
 *
 * The properties that matter, one line each:
 *  - joining publishes the address, and only the address;
 *  - leaving publishes presence with no `activity` field at all;
 *  - heartbeats preserve it, so a two-hour film does not drop you from the count;
 *  - MOVEMENT preserves it, because participation is not a claim about standing
 *    still — unlike `seatId`, which movement is defined to clear;
 *  - the parser treats anything that is not the documented shape as "no activity";
 *  - a client that knows nothing about the field still validates.
 */
import { describe, it, expect } from 'vitest';
import {
  createWalkableApi,
  parseActivity,
  publishActivity,
  publishHeartbeat,
  publishMove,
  publishSit,
  validatePresenceEvent,
  type PresenceContent,
} from './multiplayer';
import type { NostrEvent } from '@nostrify/nostrify';

const PARAMS = {
  sessionId: 'session-1',
  islandId: '1',
  location: 'stage' as const,
  blobbiAddr: '31124:pk:blobbi-1',
};

const POS = { x: 30, y: 88 };
const SEAT = 'theater-seat-a4';
const ADDRESS = `31951:${'a'.repeat(64)}:3f1c9a52-7b4e-4d61-9c0f-2a8e5b7d1c34`;
const ACTIVITY = { type: 'shared-playback', session: ADDRESS } as const;

interface Published {
  kind: number;
  content: string;
  tags: string[][];
}

function collector() {
  const events: Published[] = [];
  return {
    publish: async (event: Record<string, unknown>) => {
      events.push(event as unknown as Published);
    },
    events,
    lastContent: () => JSON.parse(events[events.length - 1].content) as PresenceContent,
  };
}

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

describe('publishActivity', () => {
  it('publishes the session address and nothing else about the session', async () => {
    const c = collector();
    await publishActivity(c.publish, PARAMS, POS, ACTIVITY);

    const content = c.lastContent();
    expect(content.activity).toEqual({ type: 'shared-playback', session: ADDRESS });
    // No playback state may ride along: presence is not the session store.
    const asRecord = content.activity as unknown as Record<string, unknown>;
    expect(Object.keys(asRecord).sort()).toEqual(['session', 'type']);
    expect(JSON.stringify(content)).not.toMatch(/"rev"|"position"|"playing"|"paused"|"media"/);
  });

  it('describes motion as idle — joining a session is not a movement', async () => {
    const c = collector();
    await publishActivity(c.publish, PARAMS, POS, ACTIVITY);
    expect(c.lastContent().state).toBe('idle');
  });

  it('preserves the seat, so joining a session does not stand you up', async () => {
    const c = collector();
    await publishActivity(c.publish, PARAMS, POS, ACTIVITY, SEAT);
    expect(c.lastContent().seatId).toBe(SEAT);
  });

  it('omits the field entirely when leaving', async () => {
    const c = collector();
    await publishActivity(c.publish, PARAMS, POS, null, SEAT);

    const content = c.lastContent();
    expect(content.activity).toBeUndefined();
    expect('activity' in content).toBe(false);
    // ...and leaving a session does not stand you up either.
    expect(content.seatId).toBe(SEAT);
  });

  it('stays a valid presence event either way', async () => {
    const c = collector();
    await publishActivity(c.publish, PARAMS, POS, ACTIVITY, SEAT);
    await publishActivity(c.publish, PARAMS, POS, null, SEAT);
    for (const event of c.events) expect(validatePresenceEvent(asEvent(event))).toBe(true);
  });
});

describe('activity across the presence lifecycle', () => {
  it('is preserved by heartbeats — a long film must not drop you from the count', async () => {
    const c = collector();
    await publishHeartbeat(c.publish, PARAMS, POS, undefined, SEAT, ACTIVITY);

    const content = c.lastContent();
    expect(content.activity?.session).toBe(ADDRESS);
    expect(content.seatId).toBe(SEAT);
  });

  it('is absent from a heartbeat once the player has left the session', async () => {
    const c = collector();
    await publishHeartbeat(c.publish, PARAMS, POS, undefined, SEAT, undefined);
    expect(c.lastContent().activity).toBeUndefined();
  });

  it('SURVIVES movement, unlike the seat', async () => {
    const c = collector();
    await publishMove(
      c.publish,
      PARAMS,
      POS,
      { x: 60, y: 90 },
      120,
      createWalkableApi('stage'),
      ACTIVITY,
    );

    const content = c.lastContent();
    expect(content.state).toBe('moving');
    // Walking across the room is not leaving the session...
    expect(content.activity?.session).toBe(ADDRESS);
    // ...but it IS standing up, and that is still true.
    expect(content.seatId).toBeUndefined();
  });

  it('is carried by a sit, so sitting down mid-session keeps you in it', async () => {
    const c = collector();
    await publishSit(c.publish, PARAMS, POS, SEAT, ACTIVITY);

    const content = c.lastContent();
    expect(content.seatId).toBe(SEAT);
    expect(content.activity?.session).toBe(ADDRESS);
  });

  it('is absent from a sit made outside any session', async () => {
    const c = collector();
    await publishSit(c.publish, PARAMS, POS, SEAT);
    expect(c.lastContent().activity).toBeUndefined();
  });
});

describe('parseActivity', () => {
  it('accepts the documented shape', () => {
    expect(parseActivity({ type: 'shared-playback', session: ADDRESS })).toEqual({
      type: 'shared-playback',
      session: ADDRESS,
    });
  });

  it('drops extra fields rather than passing them through', () => {
    // Presence content is attacker-controlled JSON from an open relay. Anything
    // beyond the two documented fields is not carried into the app.
    const parsed = parseActivity({
      type: 'shared-playback',
      session: ADDRESS,
      position: 999,
      rev: 42,
    });
    expect(parsed).toEqual({ type: 'shared-playback', session: ADDRESS });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string', ADDRESS],
    ['an unknown activity type', { type: 'karaoke', session: ADDRESS }],
    ['no session', { type: 'shared-playback' }],
    ['a non-string session', { type: 'shared-playback', session: 42 }],
    ['a blank session', { type: 'shared-playback', session: '   ' }],
    ['an array', [{ type: 'shared-playback', session: ADDRESS }]],
  ])('answers undefined for %s', (_label, value) => {
    expect(parseActivity(value)).toBeUndefined();
  });

  it('does NOT validate the address — that is the protocol layer\'s job', () => {
    // Presence must not grow a dependency on any one activity's addressing
    // rules; a syntactically wrong address is refused where it is used.
    expect(parseActivity({ type: 'shared-playback', session: 'not-an-address' })).toEqual({
      type: 'shared-playback',
      session: 'not-an-address',
    });
  });
});
