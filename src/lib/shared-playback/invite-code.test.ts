import { describe, it, expect } from 'vitest';
import {
  INVITE_ALPHABET,
  INVITE_LENGTH,
  INVITE_REJECT_BYTE_AT,
} from './constants';
import { generateInviteCode, normalizeInviteCode, resolveInviteCode } from './invite-code';
import type { SharedPlaybackSession, SharedPlaybackSessionContent } from './types';

const CONTENT: SharedPlaybackSessionContent = {
  version: 1,
  rev: 0,
  media: { provider: 'youtube', id: 'aVmB8bZ1kQs' },
  playback: { state: 'paused', position: 0, updatedAt: 0, rate: 1 },
  permissions: { mode: 'host-only' },
};

function session(overrides: Partial<SharedPlaybackSession> = {}): SharedPlaybackSession {
  const hostPubkey = overrides.hostPubkey ?? 'a'.repeat(64);
  const sessionId = overrides.sessionId ?? 'session-1';
  return {
    address: `31951:${hostPubkey}:${sessionId}`,
    hostPubkey,
    sessionId,
    room: 'blobbi-island:theater:main',
    code: 'B7X4QP',
    status: 'active',
    expiration: 2000,
    createdAt: 1000,
    eventId: 'e'.repeat(64),
    content: CONTENT,
    ...overrides,
  };
}

describe('generateInviteCode', () => {
  it('produces six characters from the alphabet', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_LENGTH);
    for (const char of code) expect(INVITE_ALPHABET).toContain(char);
  });

  it('never emits a visually ambiguous glyph', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateInviteCode()).not.toMatch(/[01OIL]/);
    }
  });

  it('discards biased bytes instead of folding them in', () => {
    // Bytes >= 248 would map onto the first 8 glyphs a second time, making them
    // measurably more likely. Feeding only rejected bytes then one good byte
    // proves they are dropped rather than used.
    const scripted = [255, 254, 253, 252, 251, 250, 249, 248, 0, 1, 2, 3, 4, 5];
    let cursor = 0;
    const code = generateInviteCode((length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        out[i] = scripted[Math.min(cursor, scripted.length - 1)];
        cursor += 1;
      }
      return out;
    });
    expect(code).toBe('ABCDEF');
    expect(INVITE_REJECT_BYTE_AT).toBe(248);
  });

  it('is close to uniform over the alphabet', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      for (const char of generateInviteCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const expected = (4000 * INVITE_LENGTH) / INVITE_ALPHABET.length;
    expect(counts.size).toBe(INVITE_ALPHABET.length);
    for (const count of counts.values()) {
      // A generous band: this is a bias tripwire, not a randomness test suite.
      expect(count).toBeGreaterThan(expected * 0.6);
      expect(count).toBeLessThan(expected * 1.4);
    }
  });
});

describe('normalizeInviteCode', () => {
  it.each([
    ['B7X4QP', 'B7X4QP'],
    ['b7x4qp', 'B7X4QP'],
    ['  b7x4qp  ', 'B7X4QP'],
    ['B7X-4QP', 'B7X4QP'],
    ['B7X 4QP', 'B7X4QP'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['B7X4Q', 'too short'],
    ['B7X4QPP', 'too long'],
    ['B7X4Q0', 'contains an excluded glyph'],
    ['B7X4QI', 'contains an excluded glyph'],
    ['B7X4Q!', 'contains punctuation'],
  ])('refuses %s (%s) before any relay is queried', (input) => {
    expect(normalizeInviteCode(input)).toBeNull();
  });

  it('refuses a non-string', () => {
    expect(normalizeInviteCode(undefined)).toBeNull();
    expect(normalizeInviteCode(123456)).toBeNull();
  });
});

describe('resolveInviteCode', () => {
  const NOW_MS = 1500 * 1000;

  it('joins the single live session carrying the code', () => {
    const result = resolveInviteCode([session()], 'b7x4qp', NOW_MS);
    expect(result.type).toBe('ok');
    if (result.type === 'ok') expect(result.session.code).toBe('B7X4QP');
  });

  it('refuses a code no session carries', () => {
    expect(resolveInviteCode([session()], 'QQQQQQ', NOW_MS).type).toBe('none');
  });

  it('never trusts the relay filter alone', () => {
    // A relay that over-matches `#c` must not be able to join you to a session
    // whose code is not the one you typed.
    const result = resolveInviteCode([session({ code: 'ZZZZZZ' })], 'B7X4QP', NOW_MS);
    expect(result.type).toBe('none');
  });

  it('refuses an ended session', () => {
    expect(resolveInviteCode([session({ status: 'ended' })], 'B7X4QP', NOW_MS).type).toBe('none');
  });

  it('refuses an expired session even if the relay still serves it', () => {
    expect(resolveInviteCode([session({ expiration: 1400 })], 'B7X4QP', NOW_MS).type).toBe('none');
  });

  it('refuses an unparseable code without looking at candidates', () => {
    expect(resolveInviteCode([session()], 'nope', NOW_MS).type).toBe('none');
  });

  it('refuses to guess between two hosts holding the same code', () => {
    const result = resolveInviteCode(
      [
        session({ hostPubkey: 'a'.repeat(64), sessionId: 's1', createdAt: 900 }),
        session({ hostPubkey: 'b'.repeat(64), sessionId: 's2', createdAt: 1000 }),
      ],
      'B7X4QP',
      NOW_MS,
    );
    expect(result.type).toBe('ambiguous');
    if (result.type === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });

  it('refuses to guess between two near-simultaneous sessions', () => {
    const host = 'a'.repeat(64);
    const result = resolveInviteCode(
      [
        session({ hostPubkey: host, sessionId: 's1', createdAt: 1000 }),
        session({ hostPubkey: host, sessionId: 's2', createdAt: 1030 }),
      ],
      'B7X4QP',
      NOW_MS,
    );
    expect(result.type).toBe('ambiguous');
  });

  it('prefers the clearly newer session from the same host', () => {
    const host = 'a'.repeat(64);
    const result = resolveInviteCode(
      [
        session({ hostPubkey: host, sessionId: 'old', createdAt: 800 }),
        session({ hostPubkey: host, sessionId: 'new', createdAt: 1400 }),
      ],
      'B7X4QP',
      NOW_MS,
    );
    expect(result.type).toBe('ok');
    if (result.type === 'ok') expect(result.session.sessionId).toBe('new');
  });

  it('resolves identically whatever order the relay delivered candidates in', () => {
    const host = 'a'.repeat(64);
    const older = session({ hostPubkey: host, sessionId: 'old', createdAt: 800 });
    const newer = session({ hostPubkey: host, sessionId: 'new', createdAt: 1400 });
    const forwards = resolveInviteCode([older, newer], 'B7X4QP', NOW_MS);
    const backwards = resolveInviteCode([newer, older], 'B7X4QP', NOW_MS);
    expect(forwards).toEqual(backwards);
  });
});
