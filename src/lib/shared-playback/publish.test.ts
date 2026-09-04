/**
 * The publication sequence, against a scripted publisher.
 *
 * What matters here is not that events are sent but that the RULES hold when
 * they are not: a failed publish must not consume a revision, a retry must not
 * change what it publishes, and a slider drag must not become fifty events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionPublisher } from './publish';
import { KIND_SHARED_PLAYBACK_COMMAND, KIND_SHARED_PLAYBACK_SESSION } from './constants';
import type { UnsignedSharedEvent } from './types';

const HOST = 'a'.repeat(64);
const MEDIA = { provider: 'youtube', id: 'aVmB8bZ1kQs' } as const;
const T = 1_785_175_200_000;

function harness(overrides: Partial<ConstructorParameters<typeof SessionPublisher>[0]> = {}) {
  const published: UnsignedSharedEvent[] = [];
  const failures: string[] = [];
  let now = T;
  let outcome: 'ok' | 'throw' = 'ok';

  const publisher = new SessionPublisher({
    hostPubkey: HOST,
    sessionId: 'session-1',
    room: 'blobbi-island:theater:main',
    code: 'B7X4QP',
    now: () => now,
    retryDelayMs: 10,
    delay: () => Promise.resolve(),
    publish: async (event) => {
      if (outcome === 'throw') throw new Error('relay said no');
      published.push(event);
    },
    onError: (error) => failures.push(error.code),
    ...overrides,
  });

  return {
    publisher,
    published,
    failures,
    advance(ms: number) {
      now += ms;
    },
    fail() {
      outcome = 'throw';
    },
    recover() {
      outcome = 'ok';
    },
    canonical: () => published.filter((e) => e.kind === KIND_SHARED_PLAYBACK_SESSION),
    commands: () => published.filter((e) => e.kind === KIND_SHARED_PLAYBACK_COMMAND),
    content: (event: UnsignedSharedEvent) => JSON.parse(event.content),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('create', () => {
  it('publishes exactly one canonical event, paused at zero, rev 0', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);

    expect(h.canonical()).toHaveLength(1);
    expect(h.commands()).toHaveLength(0);
    expect(h.content(h.canonical()[0])).toMatchObject({
      rev: 0,
      playback: { state: 'paused', position: 0, rate: 1 },
    });
    expect(h.publisher.content?.rev).toBe(0);
  });

  it('reports a failure instead of pretending a session exists', async () => {
    const h = harness();
    h.fail();
    const created = await h.publisher.create(MEDIA);
    expect(created).toBeNull();
    expect(h.publisher.content).toBeNull();
  });
});

describe('control publication', () => {
  it('sends the ephemeral command BEFORE the canonical state', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    h.publisher.commit({ type: 'play', position: 0 });
    await h.publisher.flush();

    const kinds = h.published.map((e) => e.kind);
    expect(kinds).toEqual([
      KIND_SHARED_PLAYBACK_SESSION,
      KIND_SHARED_PLAYBACK_COMMAND,
      KIND_SHARED_PLAYBACK_SESSION,
    ]);
  });

  it('gives both events of one action the same rev, position and updatedAt', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    h.publisher.commit({ type: 'seek', position: 600, reason: 'direct' });
    await h.publisher.flush();

    const command = h.content(h.commands()[0]);
    const canonical = h.content(h.canonical()[1]);
    expect(command.rev).toBe(canonical.rev);
    expect(command.position).toBe(canonical.playback.position);
    expect(command.updatedAt).toBe(canonical.playback.updatedAt);
  });

  it('lets the player veto an action before anything is published', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    const staged = h.publisher.commit({ type: 'play', position: 0 }, () => false);
    await h.publisher.flush();

    expect(staged).toBeNull();
    expect(h.published).toHaveLength(1); // the create, and nothing else
    expect(h.publisher.content?.rev).toBe(0);
  });

  it('coalesces a burst into one publish carrying the newest state', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    // A slider drag that leaked through, or an impatient host.
    h.publisher.commit({ type: 'seek', position: 100 });
    h.publisher.commit({ type: 'seek', position: 200 });
    h.publisher.commit({ type: 'seek', position: 300 });
    await h.publisher.flush();

    expect(h.commands()).toHaveLength(1);
    expect(h.canonical()).toHaveLength(2);
    expect(h.content(h.commands()[0]).position).toBe(300);
    expect(h.publisher.content?.rev).toBe(1);
  });

  it('keeps revisions gapless across a coalesced burst', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);
    h.publisher.commit({ type: 'play', position: 0 });
    h.publisher.commit({ type: 'seek', position: 50 });
    await h.publisher.flush();
    h.advance(5000);
    h.publisher.commit({ type: 'pause', position: 60 });
    await h.publisher.flush();

    expect(h.canonical().map((e) => h.content(e).rev)).toEqual([0, 1, 2]);
  });

  it('carries the play/pause intent through a coalesced burst', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);
    h.publisher.commit({ type: 'play', position: 0 });
    h.publisher.commit({ type: 'seek', position: 50 });
    await h.publisher.flush();

    // The seek must not silently discard the pause→play transition that shared
    // the rate window with it.
    expect(h.content(h.canonical()[1]).playback).toMatchObject({ state: 'playing', position: 50 });
  });

  it('holds a second action until the rate window opens', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    h.publisher.commit({ type: 'play', position: 0 });
    await h.publisher.flush();
    expect(h.canonical()).toHaveLength(2);

    h.publisher.commit({ type: 'pause', position: 10 });
    // Same instant: the scheduler must wait, not publish.
    await vi.advanceTimersByTimeAsync(500);
    expect(h.canonical()).toHaveLength(2);

    h.advance(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.canonical()).toHaveLength(3);
  });
});

describe('failure handling', () => {
  it('retries the canonical publish with byte-identical content', async () => {
    const attempts: UnsignedSharedEvent[] = [];
    let calls = 0;
    const h = harness({
      publish: async (event) => {
        calls += 1;
        attempts.push(event);
        if (calls < 3) throw new Error('flaky relay');
      },
    });

    const created = await h.publisher.create(MEDIA);
    expect(created).not.toBeNull();
    expect(attempts).toHaveLength(3);
    expect(attempts[0].content).toBe(attempts[1].content);
    expect(attempts[1].content).toBe(attempts[2].content);
  });

  it('does not consume a revision when the publish fails permanently', async () => {
    const rolledBack: unknown[] = [];
    const h = harness({ onRollback: (content) => rolledBack.push(content) });
    await h.publisher.create(MEDIA);
    h.advance(5000);

    h.fail();
    h.publisher.commit({ type: 'play', position: 0 });
    await h.publisher.flush();

    expect(h.failures).toContain('publish-failed');
    expect(rolledBack).toHaveLength(1);
    expect(h.publisher.content?.rev).toBe(0);

    // The next action reuses rev 1 rather than publishing rev 2 at a relay that
    // still holds rev 0.
    h.recover();
    h.advance(5000);
    h.publisher.commit({ type: 'pause', position: 12 });
    await h.publisher.flush();
    expect(h.publisher.content?.rev).toBe(1);
  });

  it('treats a dropped ephemeral command as nothing to fix', async () => {
    let failCommands = false;
    const h = harness({
      publish: async (event) => {
        if (failCommands && event.kind === KIND_SHARED_PLAYBACK_COMMAND) throw new Error('no ephemeral here');
      },
    });
    await h.publisher.create(MEDIA);
    h.advance(5000);
    failCommands = true;

    h.publisher.commit({ type: 'play', position: 0 });
    await h.publisher.flush();

    // The canonical publish still succeeded, so the revision is committed and no
    // error is surfaced: guests get the change through their 31951 subscription.
    expect(h.publisher.content?.rev).toBe(1);
    expect(h.failures).toHaveLength(0);
  });
});

describe('keepalive', () => {
  it('republishes the same revision with a refreshed anchor', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);
    h.publisher.commit({ type: 'play', position: 100 });
    await h.publisher.flush();

    h.advance(20_000);
    await h.publisher.keepalive();

    const events = h.canonical();
    const last = h.content(events[events.length - 1]);
    expect(last.rev).toBe(1);
    expect(last.playback.state).toBe('playing');
    expect(last.playback.position).toBe(120);
    expect(last.playback.updatedAt).toBe(T + 25_000);
  });

  it('publishes no command: a keepalive is not an action', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(20_000);
    await h.publisher.keepalive();
    expect(h.commands()).toHaveLength(0);
  });

  it('stands aside while a control publish is pending', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);
    h.publisher.commit({ type: 'play', position: 0 });
    await h.publisher.keepalive();
    expect(h.canonical()).toHaveLength(1);
  });

  it('stops once the session has ended', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);
    await h.publisher.end(90);
    const before = h.published.length;
    await h.publisher.keepalive();
    expect(h.published).toHaveLength(before);
  });
});

describe('end', () => {
  it('publishes the command and an ended canonical state with a short expiration', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    h.advance(5000);

    const ended = await h.publisher.end(116.25);
    expect(ended).toBe(true);

    const final = h.canonical()[1];
    expect(final.tags).toContainEqual(['status', 'ended']);
    const expiration = Number(final.tags.find(([n]) => n === 'expiration')?.[1]);
    expect(expiration - final.created_at).toBe(600);
    expect(h.content(final).playback).toMatchObject({ state: 'paused', position: 116.25 });
    expect(JSON.parse(h.commands()[0].content).command).toBe('end-session');
  });

  it('refuses every later action', async () => {
    const h = harness();
    await h.publisher.create(MEDIA);
    await h.publisher.end(10);
    const before = h.published.length;
    expect(h.publisher.commit({ type: 'play', position: 0 })).toBeNull();
    await h.publisher.flush();
    expect(h.published).toHaveLength(before);
  });
});
