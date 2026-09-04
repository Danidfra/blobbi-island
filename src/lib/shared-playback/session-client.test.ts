/**
 * The state machine's job is to be boring under abuse: duplicates, replays,
 * reordering, a stranger's events, and a host that ends the session mid-film.
 */

import { describe, it, expect } from 'vitest';
import {
  createSessionClient,
  evaluateDrift,
  expectedNow,
  ingestCanonical,
  ingestCommand,
  NO_REVISION,
} from './session-client';
import {
  applyCommandToContent,
  createSessionContent,
  keepaliveContent,
  transition,
} from './session-state';
import type {
  SharedPlaybackSession,
  SharedPlaybackSessionContent,
} from './types';

const HOST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ADDRESS = `31951:${HOST}:session-1`;
const T = 1_785_175_200_000;
const MEDIA = { provider: 'youtube', id: 'aVmB8bZ1kQs' } as const;
const MEDIA_2 = { provider: 'youtube', id: 'Nk9pQ2rT7wY' } as const;

function record(
  content: SharedPlaybackSessionContent,
  overrides: Partial<SharedPlaybackSession> = {},
): SharedPlaybackSession {
  return {
    address: ADDRESS,
    hostPubkey: HOST,
    sessionId: 'session-1',
    room: 'blobbi-island:theater:main',
    code: 'B7X4QP',
    status: 'active',
    expiration: Math.floor(T / 1000) + 14400,
    createdAt: Math.floor(content.playback.updatedAt / 1000),
    eventId: `${content.rev}`.padStart(64, '0'),
    content,
    ...overrides,
  };
}

const guest = () => createSessionClient({ address: ADDRESS, hostPubkey: HOST, role: 'guest' });

describe('session-state transitions', () => {
  it('creates a session paused at zero on rev 0', () => {
    const content = createSessionContent(MEDIA, T);
    expect(content).toMatchObject({
      version: 1,
      rev: 0,
      playback: { state: 'paused', position: 0, rate: 1 },
      permissions: { mode: 'host-only' },
    });
  });

  it('bumps the revision exactly once per action', () => {
    const created = createSessionContent(MEDIA, T);
    const played = transition(created, { type: 'play', position: 0 }, T + 1000);
    expect(played.content.rev).toBe(1);
    const paused = transition(played.content, { type: 'pause', position: 42.5 }, T + 2000);
    expect(paused.content.rev).toBe(2);
  });

  it('gives the command and the canonical state the SAME rev, position and updatedAt', () => {
    const created = createSessionContent(MEDIA, T);
    const { content, command } = transition(created, { type: 'seek', position: 600 }, T + 5000);
    expect(command.rev).toBe(content.rev);
    expect(command.position).toBe(content.playback.position);
    expect(command.updatedAt).toBe(content.playback.updatedAt);
  });

  it('emits absolute positions, never deltas', () => {
    const created = createSessionContent(MEDIA, T);
    const { command } = transition(
      { ...created, playback: { ...created.playback, position: 180 } },
      { type: 'seek', position: 190, reason: 'skip-forward' },
      T,
    );
    expect(command).toMatchObject({ command: 'seek', position: 190, reason: 'skip-forward' });
    expect(command).not.toHaveProperty('amount');
  });

  it('keeps play/pause across a seek', () => {
    const playing = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T).content;
    const seeked = transition(playing, { type: 'seek', position: 600 }, T + 1000).content;
    expect(seeked.playback.state).toBe('playing');
  });

  it('preserves play state and resets position on a media change', () => {
    const playing = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T).content;
    const { content, command } = transition(playing, { type: 'set-media', media: MEDIA_2 }, T + 1000);
    expect(content.media).toEqual(MEDIA_2);
    expect(content.playback).toMatchObject({ state: 'playing', position: 0 });
    expect(command).toMatchObject({ command: 'set-media', state: 'playing', position: 0 });
  });

  it('ends paused at the final position', () => {
    const playing = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T).content;
    const ended = transition(playing, { type: 'end', position: 116.25 }, T + 1000);
    expect(ended.status).toBe('ended');
    expect(ended.content.playback).toMatchObject({ state: 'paused', position: 116.25 });
    expect(ended.command.command).toBe('end-session');
  });

  it('clamps hostile positions and rates before they reach the wire', () => {
    const created = createSessionContent(MEDIA, T);
    expect(transition(created, { type: 'seek', position: -50 }, T).content.playback.position).toBe(0);
    expect(transition(created, { type: 'seek', position: 1e12 }, T).content.playback.position).toBe(86400);
    expect(transition(created, { type: 'set-rate', rate: 99, position: 0 }, T).content.playback.rate).toBe(4);
  });

  it('folds a command into canonical state exactly as the host would have', () => {
    const created = createSessionContent(MEDIA, T);
    const { content, command } = transition(created, { type: 'play', position: 12 }, T + 1000);
    expect(applyCommandToContent(created, command)).toEqual(content);
  });

  describe('keepalive', () => {
    it('refreshes the timestamp of a paused session and nothing else', () => {
      const paused = createSessionContent(MEDIA, T);
      const alive = keepaliveContent(paused, T + 60_000);
      expect(alive.rev).toBe(paused.rev);
      expect(alive.playback.position).toBe(paused.playback.position);
      expect(alive.playback.state).toBe('paused');
      expect(alive.playback.updatedAt).toBe(T + 60_000);
    });

    it('re-anchors a playing session to where the previous anchor already says it is', () => {
      const playing = transition(createSessionContent(MEDIA, T), { type: 'play', position: 100 }, T).content;
      const alive = keepaliveContent(playing, T + 20_000);
      expect(alive.rev).toBe(playing.rev);
      expect(alive.playback.position).toBe(120);
      expect(alive.playback.updatedAt).toBe(T + 20_000);
      // The described timeline is unchanged: extrapolating either anchor to the
      // same instant gives the same playhead.
      expect(expectedPositionOf(alive, T + 45_000)).toBeCloseTo(expectedPositionOf(playing, T + 45_000), 6);
    });
  });
});

function expectedPositionOf(content: SharedPlaybackSessionContent, nowMs: number): number {
  const elapsed = (nowMs - content.playback.updatedAt) / 1000;
  return content.playback.position + elapsed * content.playback.rate;
}

describe('ingestCanonical', () => {
  it('applies the first canonical state it sees', () => {
    const result = ingestCanonical(guest(), record(createSessionContent(MEDIA, T)), T);
    expect(result.changed).toBe(true);
    expect(result.state.lastAppliedRev).toBe(0);
    expect(result.state.content?.media).toEqual(MEDIA);
  });

  it('refuses a state for a different session', () => {
    const foreign = record(createSessionContent(MEDIA, T), {
      address: `31951:${HOST}:another`,
    });
    expect(ingestCanonical(guest(), foreign, T).ignored).toBe('wrong-session');
  });

  it('refuses a state signed by a different host', () => {
    const foreign = record(createSessionContent(MEDIA, T), { hostPubkey: OTHER });
    expect(ingestCanonical(guest(), foreign, T).ignored).toBe('wrong-host');
  });

  it('refuses an older revision, a stale event cannot rewind the player', () => {
    const created = createSessionContent(MEDIA, T);
    const seeked = transition(created, { type: 'seek', position: 600 }, T + 1000).content;
    const synced = ingestCanonical(guest(), record(seeked), T + 1000).state;
    const stale = ingestCanonical(synced, record(created), T + 2000);
    expect(stale.ignored).toBe('stale');
    expect(stale.state.content?.playback.position).toBe(600);
  });

  it('adopts a keepalive as the record but asks for no player action', () => {
    const created = createSessionContent(MEDIA, T);
    const synced = ingestCanonical(guest(), record(created), T).state;
    const alive = keepaliveContent(created, T + 20_000);
    const result = ingestCanonical(synced, record(alive, { eventId: 'f'.repeat(64) }), T + 20_000);
    expect(result.ignored).toBeUndefined();
    expect(result.changed).toBe(false);
    expect(result.state.content?.playback.updatedAt).toBe(T + 20_000);
    expect(result.state.lastCanonicalAtMs).toBe(T + 20_000);
  });

  it('collects a clock sample from every accepted event, keepalives included', () => {
    const created = createSessionContent(MEDIA, T);
    // This client's clock is 400 ms ahead of the host's.
    const first = ingestCanonical(guest(), record(created), T + 400).state;
    expect(first.clockSamples).toEqual([400]);
    const alive = keepaliveContent(created, T + 20_000);
    const second = ingestCanonical(first, record(alive, { eventId: 'f'.repeat(64) }), T + 20_400).state;
    expect(second.clockSamples).toEqual([400, 400]);
    expect(second.clockOffsetMs).toBe(400);
  });

  it('reports a media change so the player knows to load a different video', () => {
    const created = createSessionContent(MEDIA, T);
    const synced = ingestCanonical(guest(), record(created), T).state;
    const swapped = transition(created, { type: 'set-media', media: MEDIA_2 }, T + 1000).content;
    const result = ingestCanonical(synced, record(swapped), T + 1000);
    expect(result.mediaChanged).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('goes terminal on an ended session', () => {
    const created = createSessionContent(MEDIA, T);
    const ended = transition(created, { type: 'end', position: 90 }, T + 1000);
    const result = ingestCanonical(guest(), record(ended.content, { status: 'ended' }), T + 1000);
    expect(result.ended).toBe(true);
    expect(result.state.ended).toBe(true);
  });
});

describe('ingestCommand', () => {
  const synced = () => ingestCanonical(guest(), record(createSessionContent(MEDIA, T)), T).state;

  it('applies a newer command immediately', () => {
    const { command } = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T + 1000);
    const result = ingestCommand(synced(), command, T + 1000);
    expect(result.changed).toBe(true);
    expect(result.state.content?.playback.state).toBe('playing');
    expect(result.state.lastAppliedRev).toBe(1);
  });

  it('ignores the matching canonical event that follows, same rev, already applied', () => {
    const created = createSessionContent(MEDIA, T);
    const { content, command } = transition(created, { type: 'play', position: 0 }, T + 1000);
    const afterCommand = ingestCommand(synced(), command, T + 1000).state;
    const afterCanonical = ingestCanonical(afterCommand, record(content), T + 1200);
    expect(afterCanonical.changed).toBe(false);
    expect(afterCanonical.state.content?.playback.state).toBe('playing');
  });

  it('ignores a duplicate delivery of the same command', () => {
    const { command } = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T + 1000);
    const once = ingestCommand(synced(), command, T + 1000).state;
    const twice = ingestCommand(once, command, T + 1100);
    expect(twice.ignored).toBe('stale');
    expect(twice.state).toBe(once);
  });

  it('ignores a command that arrives after a newer one (relay reordering)', () => {
    const created = createSessionContent(MEDIA, T);
    const play = transition(created, { type: 'play', position: 0 }, T + 1000);
    const seek = transition(play.content, { type: 'seek', position: 600 }, T + 2000);
    const afterSeek = ingestCommand(synced(), seek.command, T + 2100).state;
    const late = ingestCommand(afterSeek, play.command, T + 2200);
    expect(late.ignored).toBe('stale');
    expect(late.state.content?.playback.position).toBe(600);
  });

  it('survives a revision jump, a missed command needs no replay', () => {
    const created = createSessionContent(MEDIA, T);
    let content = created;
    for (const position of [0, 100, 200]) {
      content = transition(content, { type: 'seek', position }, T + 1000).content;
    }
    const result = ingestCommand(synced(), transition(content, { type: 'seek', position: 900 }, T + 5000).command, T + 5000);
    expect(result.changed).toBe(true);
    expect(result.state.content?.playback.position).toBe(900);
    expect(result.state.lastAppliedRev).toBe(4);
  });

  it('refuses every command once the session has ended', () => {
    const created = createSessionContent(MEDIA, T);
    const ended = transition(created, { type: 'end', position: 90 }, T + 1000);
    const terminal = ingestCanonical(synced(), record(ended.content, { status: 'ended' }), T + 1000).state;
    const after = transition(ended.content, { type: 'play', position: 90 }, T + 2000);
    expect(ingestCommand(terminal, after.command, T + 2000).ignored).toBe('ended');
  });

  it('holds a command that arrives before any canonical state', () => {
    const { command } = transition(createSessionContent(MEDIA, T), { type: 'play', position: 0 }, T);
    expect(ingestCommand(guest(), command, T).ignored).toBe('not-ready');
  });
});

describe('expectedNow / evaluateDrift', () => {
  const playing = () => {
    const created = createSessionContent(MEDIA, T);
    const { content } = transition(created, { type: 'play', position: 100 }, T);
    return ingestCanonical(guest(), record(content), T).state;
  };

  const READY = {
    playerReady: true,
    buffering: false,
    rateMatched: true,
    msSinceLastSeek: 10_000,
    settleMs: 2000,
  };

  it('answers null before any state is known', () => {
    expect(expectedNow(guest(), T)).toBeNull();
  });

  it('extrapolates from the canonical anchor', () => {
    expect(expectedNow(playing(), T + 30_000)).toBe(130);
  });

  it('ignores negligible drift', () => {
    const result = evaluateDrift(playing(), { ...READY, playerPosition: 130.4, nowMs: T + 30_000 });
    expect(result.action).toBe('ignore');
  });

  it('waits a tick on moderate drift instead of seeking', () => {
    const result = evaluateDrift(playing(), { ...READY, playerPosition: 131.5, nowMs: T + 30_000 });
    expect(result.action).toBe('wait');
  });

  it('seeks to the canonical position on large drift', () => {
    const result = evaluateDrift(playing(), { ...READY, playerPosition: 60, nowMs: T + 30_000 });
    expect(result.action).toBe('seek');
    expect(result.target).toBe(130);
  });

  it('suspends correction while buffering, a stalled player has no honest position', () => {
    const result = evaluateDrift(playing(), {
      ...READY,
      buffering: true,
      playerPosition: 10,
      nowMs: T + 30_000,
    });
    expect(result.action).toBe('ignore');
  });

  it('suspends correction while the player is not ready', () => {
    const result = evaluateDrift(playing(), {
      ...READY,
      playerReady: false,
      playerPosition: 10,
      nowMs: T + 30_000,
    });
    expect(result.action).toBe('ignore');
  });

  it('suspends correction when the device cannot match the session rate', () => {
    // Otherwise an unmatchable rate would trigger a hard seek every 5 s forever.
    const result = evaluateDrift(playing(), {
      ...READY,
      rateMatched: false,
      playerPosition: 10,
      nowMs: T + 30_000,
    });
    expect(result.action).toBe('ignore');
  });

  it('respects the settle window after a corrective seek', () => {
    const result = evaluateDrift(playing(), {
      ...READY,
      msSinceLastSeek: 500,
      playerPosition: 10,
      nowMs: T + 30_000,
    });
    expect(result.action).toBe('ignore');
  });

  it('stops correcting once the session has ended', () => {
    const created = createSessionContent(MEDIA, T);
    const ended = transition(created, { type: 'end', position: 90 }, T);
    const terminal = ingestCanonical(guest(), record(ended.content, { status: 'ended' }), T).state;
    expect(evaluateDrift(terminal, { ...READY, playerPosition: 0, nowMs: T + 30_000 }).action).toBe('ignore');
  });

  it('starts with no revision applied', () => {
    expect(guest().lastAppliedRev).toBe(NO_REVISION);
  });
});
