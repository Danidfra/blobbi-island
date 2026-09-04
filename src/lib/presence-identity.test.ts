/**
 * The rule that decides whether an actor exists.
 *
 * The case that matters most is `unknown-local-identity`: the bug this module
 * was written for did not involve a wrong answer, it involved NO answer, the
 * local pubkey had not resolved yet, so "is this me?" quietly evaluated to
 * "no", and the player's own Blobbi walked onto the screen twice.
 */
import { describe, expect, it } from 'vitest';

import { admitRemotePresence } from './presence-identity';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const MY_SESSION = 'sess-local';

const admit = (over: Partial<Parameters<typeof admitRemotePresence>[0]> = {}) =>
  admitRemotePresence({
    localPubkey: ME,
    localSessionId: MY_SESSION,
    eventPubkey: THEM,
    eventSessionId: 'sess-remote',
    ...over,
  });

describe('remote presence admission', () => {
  it('admits another player', () => {
    expect(admit()).toEqual({ ok: true });
  });

  it('refuses our own key', () => {
    expect(admit({ eventPubkey: ME })).toEqual({ ok: false, reason: 'own-pubkey' });
  });

  it('refuses our own session even when the key says otherwise', () => {
    // The backstop. If identity is wrong or missing, the session id we
    // generated and published still proves the event is ours.
    expect(admit({ eventSessionId: MY_SESSION, localPubkey: '' })).toEqual({
      ok: false,
      reason: 'own-session',
    });
    expect(admit({ eventSessionId: MY_SESSION, localPubkey: THEM })).toEqual({
      ok: false,
      reason: 'own-session',
    });
  });

  it.each([[''], [undefined], [null]])('admits nobody while the local identity is %s', (value) => {
    // Not "admit and hope". If we cannot say who we are, we cannot say that
    // somebody else is not us, and presence self-heals within a heartbeat.
    expect(admit({ localPubkey: value })).toEqual({
      ok: false,
      reason: 'unknown-local-identity',
    });
  });

  it('still admits a stranger from a different session of the same second', () => {
    expect(admit({ eventSessionId: 'sess-other' })).toEqual({ ok: true });
  });

  it('does not treat a missing session id as ours', () => {
    // A `d` tag we could not read is not evidence of anything; identity decides.
    expect(admit({ eventSessionId: null })).toEqual({ ok: true });
    expect(admit({ eventSessionId: null, eventPubkey: ME })).toEqual({
      ok: false,
      reason: 'own-pubkey',
    });
  });

  it('never throws on malformed input', () => {
    expect(() =>
      admitRemotePresence({
        localPubkey: undefined,
        localSessionId: '',
        eventPubkey: '',
        eventSessionId: '',
      }),
    ).not.toThrow();
  });
});
