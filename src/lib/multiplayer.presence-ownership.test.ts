/**
 * Presence (kind 31950) ownership and size invariants, with real signatures.
 *
 * The `a` tag names the Blobbi a presence walks around as, and the renderer
 * fetches that Blobbi's look and name from the pubkey inside it. A presence
 * whose `a` belongs to someone else is an impersonation and must never reach
 * the presence map. Content is size-capped before `JSON.parse`, and an
 * `expiration` far past the event's own `created_at` is refused.
 *
 * Keys are generated per run; nothing here talks to a relay.
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildPresence31950,
  explainPresenceEvent,
  EXP_SECONDS,
  makeBlobbiAddr,
  nowSec,
  PRESENCE_CONTENT_MAX_BYTES,
  validatePresenceEvent,
  type PresenceContent,
} from './multiplayer';
import { STANDARD_POLICY } from '@/safety';

const alice = generateSecretKey();
const mallory = generateSecretKey();
const ALICE = getPublicKey(alice);
const MALLORY = getPublicKey(mallory);

function content(): PresenceContent {
  const ts = nowSec();
  return { state: 'idle', location: 'town', anchor: { x: 40, y: 70, ts } };
}

function template(blobbiAddr: string) {
  return buildPresence31950({
    sessionId: 'session-1',
    islandId: '1',
    location: 'town',
    blobbiAddr,
    content: content(),
    policy: STANDARD_POLICY,
  });
}

function sign(
  secret: Uint8Array,
  t: { kind: number; content: string; tags: string[][] },
  createdAt = nowSec(),
): NostrEvent {
  const event = finalizeEvent({ ...t, created_at: createdAt }, secret) as NostrEvent;
  expect(verifyEvent(event)).toBe(true);
  return event;
}

function withTag(tags: string[][], name: string, value: string): string[][] {
  return tags.map((tag) => (tag[0] === name ? [name, value] : tag));
}

describe('presence ownership', () => {
  it('accepts a presence whose a tag names the signer\'s own Blobbi', () => {
    const event = sign(alice, template(makeBlobbiAddr(ALICE, 'blobbi-1')));
    expect(explainPresenceEvent(event)).toEqual({ ok: true });
  });

  it('refuses a presence that claims another player\'s Blobbi', () => {
    // Mallory signs, but the a tag points at Alice's Blobbi.
    const event = sign(mallory, template(makeBlobbiAddr(ALICE, 'blobbi-1')));
    expect(event.pubkey).toBe(MALLORY);
    expect(explainPresenceEvent(event)).toEqual({ ok: false, reason: 'a tag pubkey != event pubkey' });
    expect(validatePresenceEvent(event)).toBe(false);
  });

  it('refuses a malformed a tag', () => {
    for (const a of ['31124', `31124:${ALICE}`, `1:${ALICE}:blobbi-1`, `31124::blobbi-1`]) {
      const t = template(makeBlobbiAddr(ALICE, 'blobbi-1'));
      const event = sign(alice, { ...t, tags: withTag(t.tags, 'a', a) });
      expect(explainPresenceEvent(event)).toEqual({ ok: false, reason: 'invalid a tag' });
    }
  });
});

describe('presence expiration bound', () => {
  it('accepts the writer\'s own expiration (created_at + EXP_SECONDS)', () => {
    const event = sign(alice, template(makeBlobbiAddr(ALICE, 'blobbi-1')));
    const expiration = Number(event.tags.find(([n]) => n === 'expiration')![1]);
    expect(expiration - event.created_at).toBeLessThanOrEqual(EXP_SECONDS);
    expect(validatePresenceEvent(event)).toBe(true);
  });

  it('refuses an expiration far past the event\'s created_at', () => {
    const t = template(makeBlobbiAddr(ALICE, 'blobbi-1'));
    const farFuture = String(nowSec() + 24 * 60 * 60);
    const event = sign(alice, { ...t, tags: withTag(t.tags, 'expiration', farFuture) });
    expect(explainPresenceEvent(event)).toEqual({ ok: false, reason: 'expiration too far past created_at' });
  });

  it('still accepts a remote player whose clock runs ahead (both stamps come from the signer)', () => {
    const ahead = nowSec() + 120;
    const t = template(makeBlobbiAddr(ALICE, 'blobbi-1'));
    const event = sign(alice, { ...t, tags: withTag(t.tags, 'expiration', String(ahead + EXP_SECONDS)) }, ahead);
    expect(validatePresenceEvent(event)).toBe(true);
  });
});

describe('presence content size cap', () => {
  it('refuses content over the cap before parsing it', () => {
    const t = template(makeBlobbiAddr(ALICE, 'blobbi-1'));
    const big = JSON.stringify({ ...content(), pad: 'x'.repeat(PRESENCE_CONTENT_MAX_BYTES) });
    const event = sign(alice, { ...t, content: big });
    expect(explainPresenceEvent(event)).toEqual({ ok: false, reason: 'content too large' });
  });

  it('counts UTF-8 bytes, not characters', () => {
    const t = template(makeBlobbiAddr(ALICE, 'blobbi-1'));
    const base = JSON.stringify({ ...content(), pad: '' });
    // Each U+00E9 is 2 UTF-8 bytes: under the cap in characters, over it in bytes.
    const pad = 'é'.repeat(Math.ceil((PRESENCE_CONTENT_MAX_BYTES - base.length) / 2) + 1);
    const text = JSON.stringify({ ...content(), pad });
    expect(text.length).toBeLessThanOrEqual(PRESENCE_CONTENT_MAX_BYTES);
    const event = sign(alice, { ...t, content: text });
    expect(explainPresenceEvent(event)).toEqual({ ok: false, reason: 'content too large' });
  });

  it('a full real presence (goal, hiding, seat, activity) is far under the cap', () => {
    const ts = nowSec();
    const full = buildPresence31950({
      sessionId: crypto.randomUUID(),
      islandId: '1',
      location: 'stage',
      blobbiAddr: makeBlobbiAddr(ALICE, 'blobbi-with-a-fairly-long-d-tag-value-0123456789'),
      content: {
        state: 'moving',
        location: 'stage',
        anchor: { x: 12.3456, y: 78.9012, ts },
        goal: { from: { x: 12.3456, y: 78.9012 }, to: { x: 87.6543, y: 21.0987 }, ts, v: 12.5 },
        blobbiD: 'blobbi-with-a-fairly-long-d-tag-value-0123456789',
        hiddenIn: 'town-bush-1',
        seatId: 'theater-seat-a4',
        activity: { type: 'shared-playback', session: `31951:${ALICE}:${crypto.randomUUID()}` },
        seq: 123456,
      } as PresenceContent,
      policy: STANDARD_POLICY,
    });
    expect(new TextEncoder().encode(full.content).length).toBeLessThan(PRESENCE_CONTENT_MAX_BYTES / 4);
  });
});
