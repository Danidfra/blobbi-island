/**
 * Validation is the security boundary.
 *
 * Kind numbers are unregistered, so anything at all can arrive under `31951` /
 * `21951` — including events crafted to steer someone else's session. There is
 * one test per numbered rule in the protocol's §4.4 and §5.4 lists, because a
 * rule that is not tested is a rule that quietly stops applying.
 */

import { describe, it, expect } from 'vitest';
import { parseCommandEvent, parseSessionEvent } from './parse';
import { buildCommandEvent, buildSessionEvent } from './builders';
import {
  ADDRESS,
  CANONICAL_EXAMPLES,
  CODE,
  COMMAND_EXAMPLES,
  HOST_PUBKEY,
  OTHER_PUBKEY,
  RELAY_HINT,
  ROOM,
  SESSION_D,
  T0_SEC,
  makeCommandEvent,
  makeSessionEvent,
  sessionTags,
} from './fixtures';
import type { SharedPlaybackSessionContent } from './types';

const NOW = T0_SEC + 60;

const VALID_CONTENT: SharedPlaybackSessionContent = {
  version: 1,
  rev: 4,
  media: { provider: 'youtube', id: 'aVmB8bZ1kQs' },
  playback: { state: 'playing', position: 42.5, updatedAt: NOW * 1000, rate: 1 },
  permissions: { mode: 'host-only' },
};

function sessionEvent(content: unknown, overrides: Parameters<typeof makeSessionEvent>[0] | object = {}) {
  return makeSessionEvent({
    createdAt: NOW,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    ...(overrides as object),
  } as Parameters<typeof makeSessionEvent>[0]);
}

function commandEvent(content: unknown, overrides: object = {}) {
  return makeCommandEvent({
    createdAt: NOW,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    ...(overrides as object),
  } as Parameters<typeof makeCommandEvent>[0]);
}

describe('parseSessionEvent — the §16 examples', () => {
  for (const { label, event } of CANONICAL_EXAMPLES) {
    it(`accepts ${label}`, () => {
      const result = parseSessionEvent(event, { nowSec: T0_SEC });
      expect(result.ok, `rejected: ${result.ok ? '' : result.reason}`).toBe(true);
      if (!result.ok) return;
      expect(result.value.address).toBe(ADDRESS);
      expect(result.value.hostPubkey).toBe(HOST_PUBKEY);
      expect(result.value.room).toBe(ROOM);
      expect(result.value.sessionId).toBe(SESSION_D);
      expect(result.value.content.version).toBe(1);
    });
  }

  it('round-trips build → parse without changing a single field', () => {
    const built = buildSessionEvent({
      sessionId: SESSION_D,
      room: ROOM,
      code: CODE,
      status: 'active',
      content: VALID_CONTENT,
      nowMs: NOW * 1000,
    });
    const parsed = parseSessionEvent(
      { ...built, id: 'a'.repeat(64), pubkey: HOST_PUBKEY, sig: '0'.repeat(128) },
      { nowSec: NOW },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.content).toEqual(VALID_CONTENT);
    expect(parsed.value.code).toBe(CODE);
    expect(parsed.value.status).toBe('active');
    // The mirrors must agree with the content they mirror.
    expect(built.tags).toContainEqual(['media', VALID_CONTENT.media.id]);
    expect(built.tags).toContainEqual(['provider', 'youtube']);
    expect(built.tags).toContainEqual(['t', 'shared-playback']);
  });

  it('rolls the expiration four hours forward on every publish', () => {
    const built = buildSessionEvent({
      sessionId: SESSION_D,
      room: ROOM,
      code: CODE,
      status: 'active',
      content: VALID_CONTENT,
      nowMs: NOW * 1000,
    });
    const expiration = Number(built.tags.find(([name]) => name === 'expiration')?.[1]);
    expect(expiration - built.created_at).toBe(4 * 60 * 60);
  });
});

describe('parseSessionEvent — §4.4 rejections', () => {
  it('(1) refuses another kind', () => {
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { kind: 31950 }), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'wrong-kind' });
  });

  it.each([
    ['d', ['d', SESSION_D]],
    ['r', ['r', ROOM]],
    ['status', ['status', 'active']],
    ['expiration', ['expiration', String(NOW + 100)]],
  ])('(2) refuses a session with no %s tag', (_name, tag) => {
    const tags = sessionTags({ mediaId: 'aVmB8bZ1kQs', status: 'active', expiration: NOW + 100 })
      .filter(([name]) => name !== tag[0]);
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { tags }), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'missing-tag' });
  });

  it('(2) refuses a session without the protocol discriminator', () => {
    const tags = sessionTags({ mediaId: 'aVmB8bZ1kQs', status: 'active', expiration: NOW + 100 })
      .filter(([name, value]) => !(name === 't' && value === 'shared-playback'));
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { tags }), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'missing-tag' });
  });

  it('(2) refuses an active session with no invitation code — it would be unreachable', () => {
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { code: null }), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'missing-tag' });
  });

  it('(3) refuses an expired session even though the relay served it', () => {
    const result = parseSessionEvent(
      sessionEvent(VALID_CONTENT, { expiration: NOW - 1 }),
      { nowSec: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('(4) refuses content that is not JSON', () => {
    const result = parseSessionEvent(sessionEvent('not json at all'), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'malformed-content' });
  });

  it('(5) ignores an unimplemented schema version rather than guessing', () => {
    const result = parseSessionEvent(
      sessionEvent({ ...VALID_CONTENT, version: 2 }),
      { nowSec: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('(6) refuses a permission mode v1 does not implement', () => {
    const result = parseSessionEvent(
      sessionEvent({ ...VALID_CONTENT, permissions: { mode: 'open' } }),
      { nowSec: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'unsupported-permissions' });
  });

  it.each([-1, 1.5, Number.NaN])('(7) refuses rev %s', (rev) => {
    const result = parseSessionEvent(sessionEvent({ ...VALID_CONTENT, rev }), { nowSec: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-revision');
  });

  it.each([-5, 86401, Number.POSITIVE_INFINITY])('(8) refuses position %s', (position) => {
    const result = parseSessionEvent(
      sessionEvent({ ...VALID_CONTENT, playback: { ...VALID_CONTENT.playback, position } }),
      { nowSec: NOW },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-position');
  });

  it.each([0, 0.2, 4.5])('(9) refuses rate %s', (rate) => {
    const result = parseSessionEvent(
      sessionEvent({ ...VALID_CONTENT, playback: { ...VALID_CONTENT.playback, rate } }),
      { nowSec: NOW },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-rate');
  });

  it('(10) refuses an updatedAt more than five minutes from created_at', () => {
    const result = parseSessionEvent(
      sessionEvent({
        ...VALID_CONTENT,
        playback: { ...VALID_CONTENT.playback, updatedAt: (NOW + 400) * 1000 },
      }),
      { nowSec: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'clock-inconsistent' });
  });

  it('(10) accepts a keepalive re-anchored to the moment it was published', () => {
    // The 20 s keepalive refreshes `updatedAt`, which is exactly what keeps a
    // long-paused session's canonical event valid to every receiver.
    const later = NOW + 3600;
    const result = parseSessionEvent(
      sessionEvent(
        { ...VALID_CONTENT, playback: { ...VALID_CONTENT.playback, updatedAt: later * 1000 } },
        { createdAt: later, expiration: later + 14400 },
      ),
      { nowSec: later },
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a provider we cannot play', { provider: 'vimeo', id: 'aVmB8bZ1kQs' }],
    ['an id of the wrong shape', { provider: 'youtube', id: 'too-short' }],
  ])('(11) refuses %s', (_label, media) => {
    const result = parseSessionEvent(sessionEvent({ ...VALID_CONTENT, media }), { nowSec: NOW });
    expect(result).toEqual({ ok: false, reason: 'unsupported-media' });
  });

  it('(12) refuses an event signed by anyone but the session host', () => {
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { pubkey: OTHER_PUBKEY }), {
      nowSec: NOW,
      knownHostPubkey: HOST_PUBKEY,
    });
    expect(result).toEqual({ ok: false, reason: 'unauthorized-signer' });
  });

  it('derives the address from the SIGNER, so a spoofed address cannot survive', () => {
    const result = parseSessionEvent(sessionEvent(VALID_CONTENT, { pubkey: OTHER_PUBKEY }), {
      nowSec: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.address).toBe(`31951:${OTHER_PUBKEY}:${SESSION_D}`);
  });
});

describe('parseCommandEvent — the §16 examples', () => {
  for (const { label, event } of COMMAND_EXAMPLES) {
    it(`accepts ${label}`, () => {
      const result = parseCommandEvent(event, { nowSec: T0_SEC, expectedAddress: ADDRESS });
      expect(result.ok, `rejected: ${result.ok ? '' : result.reason}`).toBe(true);
    });
  }

  it('round-trips build → parse', () => {
    const command = {
      version: 1,
      command: 'seek',
      rev: 12,
      position: 190,
      updatedAt: NOW * 1000,
      rate: 1,
      reason: 'skip-forward',
    } as const;
    const built = buildCommandEvent({
      address: ADDRESS,
      hostPubkey: HOST_PUBKEY,
      command,
      nowMs: NOW * 1000,
      relayHint: RELAY_HINT,
    });
    const parsed = parseCommandEvent(
      { ...built, id: 'b'.repeat(64), pubkey: HOST_PUBKEY, sig: '0'.repeat(128) },
      { nowSec: NOW, expectedAddress: ADDRESS },
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(command);
    expect(built.tags[0]).toEqual(['a', ADDRESS, RELAY_HINT]);
    expect(built.tags).toContainEqual(['p', HOST_PUBKEY]);
  });

  it('gives a command a 30 s life, so a replay is stale before it can be replayed', () => {
    const built = buildCommandEvent({
      address: ADDRESS,
      hostPubkey: HOST_PUBKEY,
      command: { version: 1, command: 'play', rev: 1, position: 0, updatedAt: NOW * 1000, rate: 1 },
      nowMs: NOW * 1000,
    });
    const expiration = Number(built.tags.find(([name]) => name === 'expiration')?.[1]);
    expect(expiration - built.created_at).toBe(30);
  });
});

describe('parseCommandEvent — §5.4 rejections', () => {
  const PLAY = { version: 1, command: 'play', rev: 3, position: 0, updatedAt: NOW * 1000, rate: 1 };

  it('(1) refuses another kind', () => {
    const result = parseCommandEvent(commandEvent(PLAY, { kind: 1 }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong-kind' });
  });

  it('(2) refuses an expired command', () => {
    const result = parseCommandEvent(commandEvent(PLAY, { expiration: NOW - 1 }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('(3) refuses a command for a different session', () => {
    const result = parseCommandEvent(
      commandEvent(PLAY, { address: `31951:${HOST_PUBKEY}:some-other-session` }),
      { nowSec: NOW, expectedAddress: ADDRESS },
    );
    expect(result).toEqual({ ok: false, reason: 'wrong-session' });
  });

  it('(3) refuses a command carrying two session addresses', () => {
    const result = parseCommandEvent(
      commandEvent(PLAY, {
        tags: [
          ['a', ADDRESS],
          ['a', `31951:${OTHER_PUBKEY}:${SESSION_D}`],
          ['expiration', String(NOW + 30)],
        ],
      }),
      { nowSec: NOW, expectedAddress: ADDRESS },
    );
    expect(result).toEqual({ ok: false, reason: 'missing-tag' });
  });

  it('(4) refuses a command signed by a guest — the whole authority guarantee', () => {
    const result = parseCommandEvent(commandEvent(PLAY, { pubkey: OTHER_PUBKEY }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(result).toEqual({ ok: false, reason: 'unauthorized-signer' });
  });

  it('(5) refuses an unknown command verb', () => {
    const result = parseCommandEvent(commandEvent({ ...PLAY, command: 'destroy' }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(result).toEqual({ ok: false, reason: 'unknown-command' });
  });

  it('(6) refuses an unimplemented version', () => {
    const result = parseCommandEvent(commandEvent({ ...PLAY, version: 9 }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  it('(8) refuses out-of-bounds numbers', () => {
    const position = parseCommandEvent(commandEvent({ ...PLAY, position: -3 }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(position.ok).toBe(false);
    if (!position.ok) expect(position.reason).toBe('bad-position');

    const rate = parseCommandEvent(commandEvent({ ...PLAY, rate: 12 }), {
      nowSec: NOW,
      expectedAddress: ADDRESS,
    });
    expect(rate.ok).toBe(false);
    if (!rate.ok) expect(rate.reason).toBe('bad-rate');
  });

  it('(8) refuses a set-media command carrying media it cannot play', () => {
    const result = parseCommandEvent(
      commandEvent({
        version: 1,
        command: 'set-media',
        rev: 4,
        media: { provider: 'youtube', id: 'nope' },
        state: 'playing',
        position: 0,
        updatedAt: NOW * 1000,
        rate: 1,
      }),
      { nowSec: NOW, expectedAddress: ADDRESS },
    );
    expect(result).toEqual({ ok: false, reason: 'unsupported-media' });
  });
});
