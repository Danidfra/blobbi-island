/**
 * Coverage for the THEATER SEATING state carried by presence (kind 31950).
 *
 * Seating is represented as an OPTIONAL, semantic field in the existing presence
 * content (`seatId: "theater-seat-a4"`) — no new event kind, no coordinate
 * guessing — exactly like `hiddenIn` before it. These tests pin when it is
 * published, when it is absent, what the parser accepts, and that clients which
 * know nothing about it stay valid.
 *
 * The properties that matter, in one line each:
 *  - sitting publishes the canonical seat id;
 *  - MOVING never carries it, which is how standing up works;
 *  - heartbeats preserve it, so a long film does not eject you from your chair;
 *  - the parser treats anything that is not a non-empty string as "not seated".
 */
import { groundToWireCenter } from '@/lib/presence-ground';
import { describe, it, expect } from 'vitest';
import {
  publishSit,
  publishMove,
  publishHeartbeat,
  publishPresenceLogin,
  publishHide,
  parseSeatId,
  validatePresenceEvent,
  explainPresenceEvent,
  createWalkableApi,
  nowSec,
  EXP_SECONDS,
  type PresenceContent,
} from './multiplayer';
import { getTheaterSeat } from './theater-seats-config';
import type { NostrEvent } from '@nostrify/nostrify';

const PARAMS = {
  sessionId: 'session-1',
  islandId: '1',
  location: 'stage' as const,
  blobbiAddr: '31124:pk:blobbi-1',
};

const SEAT = 'theater-seat-a4';
/** The seat used above must really exist and really be sittable. */
const seatConfig = getTheaterSeat(SEAT);

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

describe('presence seating state', () => {
  it('names a real, occupiable seat', () => {
    expect(seatConfig).toBeDefined();
    expect(seatConfig!.occupiable).toBe(true);
  });

  it('publishes seatId with the canonical seat id on arrival', async () => {
    const c = collector();

    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);

    const content = c.lastContent();
    expect(content.seatId).toBe(SEAT);
    // Sitting is not motion: `state` still describes movement and stays idle.
    expect(content.state).toBe('idle');
    expect(content.goal).toBeUndefined();
    // Position stays truthful — the remote render ignores it, but presence must
    // not start lying about where the player is.
    // Phase 2: the WIRE keeps legacy CENTER semantics — the published anchor
    // is the internal ground point converted at the build boundary.
    const wire = groundToWireCenter({ x: 52.4, y: 87.6 }, PARAMS.location);
    expect(content.anchor.x).toBe(wire.x);
    expect(content.anchor.y).toBe(wire.y);
    // Reuses the existing presence kind; no new kind was introduced.
    expect(c.events[0].kind).toBe(31950);
    expect(c.events[0].tags).toEqual(
      expect.arrayContaining([['t', 'blobbi:presence'], ['t', 'loc:stage']]),
    );
  });

  it('never carries seatId on a movement publish — moving away clears it', async () => {
    const c = collector();
    const nav = createWalkableApi('stage');

    await publishMove(c.publish, PARAMS, { x: 52.4, y: 87.6 }, { x: 20, y: 90 }, 120, nav);

    const content = c.lastContent();
    expect(content.state).toBe('moving');
    expect(content.goal).toBeDefined();
    // THE property standing up depends on: no separate "I stood up" event can be
    // lost or reordered, because the movement itself is the clear.
    expect('seatId' in content).toBe(false);
  });

  it('preserves seatId across heartbeats, and omits it when not seated', async () => {
    const c = collector();

    await publishHeartbeat(c.publish, PARAMS, { x: 52.4, y: 87.6 }, undefined, SEAT);
    expect(c.lastContent().seatId).toBe(SEAT);

    await publishHeartbeat(c.publish, PARAMS, { x: 52.4, y: 87.6 }, undefined, undefined);
    expect('seatId' in c.lastContent()).toBe(false);
  });

  it('keeps hiding and seating independent on a heartbeat', async () => {
    const c = collector();

    await publishHeartbeat(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3', undefined);
    expect(c.lastContent().hiddenIn).toBe('town-bush-3');
    expect('seatId' in c.lastContent()).toBe(false);

    await publishHeartbeat(c.publish, PARAMS, { x: 52.4, y: 87.6 }, undefined, SEAT);
    expect(c.lastContent().seatId).toBe(SEAT);
    expect('hiddenIn' in c.lastContent()).toBe(false);
  });

  it('omits seatId on login presence and on a hide', async () => {
    const c = collector();

    await publishPresenceLogin(c.publish, { ...PARAMS, startPos: { x: 50, y: 88 } });
    expect('seatId' in c.lastContent()).toBe(false);

    await publishHide(c.publish, PARAMS, { x: 8, y: 91 }, 'town-bush-3');
    expect('seatId' in c.lastContent()).toBe(false);
  });

  it('stamps the publish sequence on a sit, so it orders against moves', async () => {
    const c = collector();
    const nav = createWalkableApi('stage');

    // The exact race this protects: arrive + sit, then immediately click the
    // floor. Both land in the same wall-clock second; only `seq` can order them.
    await publishSit(c.publish, { ...PARAMS, seq: 11 }, { x: 52.4, y: 87.6 }, SEAT);
    await publishMove(
      c.publish, { ...PARAMS, seq: 12 }, { x: 52.4, y: 87.6 }, { x: 20, y: 90 }, 120, nav,
    );

    expect(c.events.map((e) => JSON.parse(e.content).seq)).toEqual([11, 12]);
  });

  it('omits seq entirely when the publisher does not supply one', async () => {
    const c = collector();
    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);
    expect('seq' in c.lastContent()).toBe(false);
  });

  it('keeps presence valid with and without the optional field', async () => {
    const c = collector();
    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);
    await publishHeartbeat(c.publish, PARAMS, { x: 52.4, y: 87.6 });

    // A client that publishes `seatId` and one that has never heard of it both
    // produce valid presence — the field is additive.
    expect(validatePresenceEvent(asEvent(c.events[0]))).toBe(true);
    expect(validatePresenceEvent(asEvent(c.events[1]))).toBe(true);
  });

  it('survives a re-sit in the same seat without changing the state', async () => {
    const c = collector();

    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);
    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);

    // Idempotent: presence is addressable, so a repeated arrival replaces rather
    // than accumulates, and observers can never see a half-applied sit.
    expect(JSON.parse(c.events[0].content).seatId).toBe(SEAT);
    expect(JSON.parse(c.events[1].content).seatId).toBe(SEAT);
  });
});

describe('seat presence expiry (what stale-seat release actually rests on)', () => {
  it('stamps a NIP-40 expiration tag on the sit event', async () => {
    const c = collector();
    const before = nowSec();

    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);

    // The documented stale-seat behaviour ("stop publishing and your seat frees
    // itself") is not implemented by any seating code — it rests entirely on
    // this tag plus the presence GC. If the tag ever went missing, seats would
    // be held by ghosts and nothing in the theater would notice.
    const expiration = c.events[0].tags.find(([n]) => n === 'expiration')?.[1];
    expect(expiration).toBeDefined();
    const expiresAt = Number(expiration);
    expect(Number.isNaN(expiresAt)).toBe(false);
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(nowSec() + EXP_SECONDS);
  });

  it('stops validating a seat claim once its expiration has passed', async () => {
    const c = collector();
    await publishSit(c.publish, PARAMS, { x: 52.4, y: 87.6 }, SEAT);

    const live = asEvent(c.events[0]);
    expect(validatePresenceEvent(live)).toBe(true);

    // Same event, expiration in the past: rejected before its seat claim can
    // reach any renderer.
    const expired: NostrEvent = {
      ...live,
      tags: live.tags.map(([n, v]) => (n === 'expiration' ? [n, String(nowSec() - 1)] : [n, v])),
    };
    expect(validatePresenceEvent(expired)).toBe(false);
    expect(explainPresenceEvent(expired)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('parseSeatId', () => {
  it('accepts a valid canonical seat id verbatim', () => {
    expect(parseSeatId(SEAT)).toBe(SEAT);
    expect(parseSeatId('theater-seat-c10')).toBe('theater-seat-c10');
  });

  it('reads a missing field as "not seated" (legacy payloads)', () => {
    // Exactly what an older client sends: no seatId key at all.
    const legacy = JSON.parse(
      JSON.stringify({ state: 'idle', location: 'stage', anchor: { x: 50, y: 88, ts: 1 } }),
    ) as PresenceContent;
    expect(parseSeatId(legacy.seatId)).toBeUndefined();
  });

  it('rejects every non-string and empty value without throwing', () => {
    // Presence content is attacker-controlled JSON off an open relay.
    for (const bad of [undefined, null, '', 0, 42, true, false, {}, [], ['theater-seat-a1'], NaN]) {
      expect(parseSeatId(bad)).toBeUndefined();
    }
  });

  it('reads a whitespace-only value as "not seated"', () => {
    // A blank string is a missing value wearing a costume. Left as-is it would
    // travel through the pipeline as a "claim" that can never match a seat.
    for (const blank of [' ', '   ', '\t', '\n', ' \t\n ']) {
      expect(parseSeatId(blank)).toBeUndefined();
    }
  });

  it('does NOT trim-normalize a padded id into a valid one', () => {
    // Returned unchanged so the exact-match registry rejects it downstream.
    // Trimming would accept a second wire spelling of one seat — and occupancy
    // is keyed by this exact string.
    expect(parseSeatId(' theater-seat-a4 ')).toBe(' theater-seat-a4 ');
    expect(getTheaterSeat(' theater-seat-a4 ')).toBeUndefined();
  });

  it('does not vet the id itself — that is the renderer\'s job', () => {
    // A transport parser must not import room furniture. Unknown and decorative
    // ids survive here and are rejected later by `resolveSeatedRender` /
    // `resolveRemoteSeatOccupancy`, which is where seat geometry lives.
    expect(parseSeatId('theater-seat-b1')).toBe('theater-seat-b1'); // decorative
    expect(parseSeatId('not-a-seat')).toBe('not-a-seat');
  });
});
