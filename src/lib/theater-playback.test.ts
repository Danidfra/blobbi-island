/**
 * Coverage for the theater playback controller.
 *
 * The controller is where every playback DECISION lives, which is why it is
 * testable against a fake adapter with no browser, no network and no YouTube.
 * The rules it enforces are the ones shared playback will later depend on:
 * absolute positions only, no-op actions publish nothing, and one immutable
 * command per action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  END_GUARD_SECONDS,
  LocalTheaterPlaybackController,
  SKIP_STEP_SECONDS,
  applyCommand,
  clampPosition,
  normalizeRate,
  resolvePlaybackCommand,
  resolveSkipTarget,
  type PlaybackCommand,
  type PlaybackState,
} from './theater-playback';
import type { MediaPlayerAdapter } from './youtube-player';

// ── Fake provider ──────────────────────────────────────────────────────────

interface FakeAdapter extends MediaPlayerAdapter {
  calls: string[];
  position: number;
  duration: number;
  destroyed: boolean;
  title: string | null;
}

function makeAdapter(overrides: Partial<{ duration: number; rates: number[]; title: string | null }> = {}): FakeAdapter {
  const state = {
    position: 0,
    duration: overrides.duration ?? 300,
    playing: false,
    rate: 1,
    volume: 100,
    muted: false,
    destroyed: false,
    title: overrides.title ?? null,
  };
  const calls: string[] = [];
  const rates = overrides.rates ?? [0.25, 0.5, 1, 1.5, 2];

  return {
    calls,
    get position() { return state.position; },
    set position(v: number) { state.position = v; },
    get duration() { return state.duration; },
    set duration(v: number) { state.duration = v; },
    get destroyed() { return state.destroyed; },
    get title() { return state.title; },
    set title(v: string | null) { state.title = v; },
    load: (id, opts) => { calls.push(`load:${id}:${opts.autoplay ? 'play' : 'cue'}`); state.position = opts.startSeconds ?? 0; },
    play: () => { calls.push('play'); state.playing = true; },
    pause: () => { calls.push('pause'); state.playing = false; },
    seek: (s) => { calls.push(`seek:${s}`); state.position = s; },
    getPosition: () => state.position,
    getDuration: () => state.duration,
    isPlaying: () => state.playing,
    setRate: (r) => { calls.push(`rate:${r}`); state.rate = r; },
    getRate: () => state.rate,
    getAvailableRates: () => rates,
    setVolume: (v) => { calls.push(`volume:${v}`); state.volume = v; },
    getVolume: () => state.volume,
    setMuted: (m) => { calls.push(`muted:${m}`); state.muted = m; },
    isMuted: () => state.muted,
    setCaptionsEnabled: (e) => calls.push(`captions:${e}`),
    getTitle: () => state.title,
    getElement: () => null,
    destroy: () => { calls.push('destroy'); state.destroyed = true; },
  };
}

const YT = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;

let now = 1_000_000;
beforeEach(() => { now = 1_000_000; });

function makeController(adapter: FakeAdapter, onCommand?: (c: PlaybackCommand, s: PlaybackState) => void) {
  return new LocalTheaterPlaybackController({ adapter, now: () => now, onCommand });
}

// ── Pure helpers ───────────────────────────────────────────────────────────

describe('clampPosition', () => {
  it.each([
    [-5, 300, 0],
    [0, 300, 0],
    [150, 300, 150],
    [400, 300, 300 - END_GUARD_SECONDS],
    // Unknown duration is unbounded, never clamped against zero.
    [500, 0, 500],
    [NaN, 300, 0],
  ])('clamp(%s, %s) → %s', (position, duration, expected) => {
    expect(clampPosition(position, duration)).toBe(expected);
  });
});

describe('resolveSkipTarget', () => {
  it('resolves a relative skip to an absolute position', () => {
    expect(resolveSkipTarget(100, 10, 300)).toBe(110);
    expect(resolveSkipTarget(100, -10, 300)).toBe(90);
  });

  it('clamps at the start and the end', () => {
    expect(resolveSkipTarget(4, -10, 300)).toBe(0);
    expect(resolveSkipTarget(298, 10, 300)).toBe(300 - END_GUARD_SECONDS);
  });

  it('returns null for a no-op, a no-op must not publish anything', () => {
    expect(resolveSkipTarget(0, -10, 300)).toBeNull();
    expect(resolveSkipTarget(300 - END_GUARD_SECONDS, 10, 300)).toBeNull();
  });

  it('works with an unknown duration', () => {
    expect(resolveSkipTarget(10, 10, 0)).toBe(20);
  });
});

describe('normalizeRate', () => {
  it('snaps to the nearest available rate', () => {
    expect(normalizeRate(1.3, [0.5, 1, 1.5, 2])).toBe(1.5);
    expect(normalizeRate(1.1, [0.5, 1, 1.5, 2])).toBe(1);
  });

  it('bounds rates to the protocol range', () => {
    expect(normalizeRate(9, [])).toBe(4);
    expect(normalizeRate(0.01, [])).toBe(0.25);
    expect(normalizeRate(NaN, [])).toBe(1);
  });
});

describe('resolvePlaybackCommand', () => {
  const state: PlaybackState = { media: YT, status: 'paused', position: 0, rate: 1, updatedAt: 0 };
  const snapshot = { currentTime: 100, duration: 300, availableRates: [0.5, 1, 2] };

  it('emits absolute positions for relative skips', () => {
    const forward = resolvePlaybackCommand(state, snapshot, { kind: 'skip', deltaSeconds: 10 }, now);
    expect(forward).toEqual({ type: 'seek', position: 110, rate: 1, reason: 'skip-forward', updatedAt: now });

    const back = resolvePlaybackCommand(state, snapshot, { kind: 'skip', deltaSeconds: -10 }, now);
    expect(back).toMatchObject({ position: 90, reason: 'skip-backward' });
  });

  it('labels restart as a seek to zero', () => {
    expect(resolvePlaybackCommand(state, snapshot, { kind: 'restart' }, now)).toEqual({
      type: 'seek', position: 0, rate: 1, reason: 'restart', updatedAt: now,
    });
  });

  it('stamps every command with the same clock reading it was given', () => {
    const command = resolvePlaybackCommand(state, snapshot, { kind: 'play' }, 12345);
    expect(command?.updatedAt).toBe(12345);
  });

  it('returns null when a rate change would be a no-op', () => {
    expect(resolvePlaybackCommand(state, snapshot, { kind: 'set-rate', rate: 1 }, now)).toBeNull();
  });

  it('resets position on a media change', () => {
    const command = resolvePlaybackCommand(state, snapshot, { kind: 'set-media', media: YT }, now);
    expect(command).toMatchObject({ type: 'set-media', position: 0, media: YT });
  });
});

describe('applyCommand', () => {
  const base: PlaybackState = { media: YT, status: 'paused', position: 0, rate: 1, updatedAt: 0 };

  it('preserves the play state across a media change', () => {
    const playing: PlaybackState = { ...base, status: 'playing' };
    const next = applyCommand(playing, { type: 'set-media', media: YT, position: 0, rate: 1, updatedAt: now });
    expect(next.status).toBe('playing');
    expect(next.position).toBe(0);
  });

  it('leaves the play state alone on a seek', () => {
    const playing: PlaybackState = { ...base, status: 'playing' };
    expect(applyCommand(playing, { type: 'seek', position: 42, rate: 1, reason: 'direct', updatedAt: now }).status)
      .toBe('playing');
  });
});

// ── Controller ─────────────────────────────────────────────────────────────

describe('LocalTheaterPlaybackController', () => {
  it('cues a new video without playing when paused, and loads it when playing', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);

    c.setMedia(YT);
    expect(adapter.calls).toContain(`load:${YT.id}:cue`);

    c.play();
    adapter.calls.length = 0;
    c.setMedia({ provider: 'youtube', id: 'aaaaaaaaaaa' });
    expect(adapter.calls).toContain('load:aaaaaaaaaaa:play');
  });

  it('ignores every global control until media is loaded', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);

    c.play();
    c.pause();
    c.seek(30);
    c.skip(10);
    c.restart();

    expect(adapter.calls).toEqual([]);
  });

  it('tracks play/pause as shared state, not as a player readout', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);

    c.play();
    expect(c.getSnapshot().status).toBe('playing');
    c.togglePlay();
    expect(c.getSnapshot().status).toBe('paused');
    expect(adapter.calls).toEqual([`load:${YT.id}:cue`, 'play', 'pause']);
  });

  it('seeks to absolute positions for ±10 and restart', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    adapter.position = 100;
    c.tick();

    c.skip(SKIP_STEP_SECONDS);
    expect(adapter.calls.at(-1)).toBe('seek:110');

    c.skip(-SKIP_STEP_SECONDS);
    expect(adapter.calls.at(-1)).toBe('seek:100');

    c.restart();
    expect(adapter.calls.at(-1)).toBe('seek:0');
  });

  it('does nothing when a skip would be a no-op', () => {
    const adapter = makeAdapter();
    const commands: PlaybackCommand[] = [];
    const c = makeController(adapter, (cmd) => commands.push(cmd));
    c.setMedia(YT);
    commands.length = 0;
    adapter.calls.length = 0;

    c.skip(-SKIP_STEP_SECONDS); // already at 0

    expect(commands).toEqual([]);
    expect(adapter.calls).toEqual([]);
  });

  it('reports one immutable command per action to the publish hook', () => {
    const adapter = makeAdapter();
    const seen: Array<{ command: PlaybackCommand; state: PlaybackState }> = [];
    const c = makeController(adapter, (command, state) => seen.push({ command, state }));

    c.setMedia(YT);
    c.play();
    now += 5000;
    c.seek(42);

    expect(seen.map((s) => s.command.type)).toEqual(['set-media', 'play', 'seek']);
    // The command and the resulting state agree, by construction.
    expect(seen[2].command.position).toBe(42);
    expect(seen[2].state.position).toBe(42);
    expect(seen[2].command.updatedAt).toBe(now);
    // ...and the play/pause intent survived the seek.
    expect(seen[2].state.status).toBe('playing');
  });

  it('clamps a seek past the end of the video', () => {
    const adapter = makeAdapter({ duration: 300 });
    const c = makeController(adapter);
    c.setMedia(YT);
    c.tick();

    c.seek(9999);
    expect(adapter.calls.at(-1)).toBe(`seek:${300 - END_GUARD_SECONDS}`);
  });

  it('keeps volume, mute and captions strictly local; never a command', () => {
    const adapter = makeAdapter();
    const commands: PlaybackCommand[] = [];
    const c = makeController(adapter, (cmd) => commands.push(cmd));
    c.setMedia(YT);
    commands.length = 0;

    c.setVolume(40);
    c.setMuted(true);
    c.setCaptionsEnabled(true);

    expect(commands).toEqual([]);
    expect(c.getSnapshot().volume).toBe(40);
    expect(c.getSnapshot().captionsEnabled).toBe(true);
  });

  it('unmutes when the volume is raised from a muted state', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMuted(true);
    c.setVolume(60);
    expect(c.getSnapshot().muted).toBe(false);
  });

  it('normalizes an unsupported rate to the nearest the device offers', () => {
    const adapter = makeAdapter({ rates: [0.5, 1, 2] });
    const c = makeController(adapter);
    c.setMedia(YT);

    c.setRate(1.75);
    expect(adapter.calls.at(-1)).toBe('rate:2');
    expect(c.getSnapshot().rate).toBe(2);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    const listener = vi.fn();
    const unsubscribe = c.subscribe(listener);

    c.setMedia(YT);
    c.play();
    expect(listener).toHaveBeenCalled();

    const count = listener.mock.calls.length;
    unsubscribe();
    c.pause();
    expect(listener.mock.calls.length).toBe(count);
  });

  it('destroys the underlying player exactly once', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.destroy();
    c.destroy();
    expect(adapter.calls.filter((call) => call === 'destroy')).toHaveLength(1);
    expect(adapter.destroyed).toBe(true);
  });

  it('surfaces a player error without changing the shared state', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    c.play();

    c.handleError({ code: 'embedding-disabled', message: 'nope', retryable: false });

    expect(c.getSnapshot().error?.code).toBe('embedding-disabled');
    expect(c.getSnapshot().status).toBe('playing');
  });

  it('clears a stale error when a new video is loaded', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    c.handleError({ code: 'unavailable', message: 'gone', retryable: false });

    c.setMedia({ provider: 'youtube', id: 'bbbbbbbbbbb' });
    expect(c.getSnapshot().error).toBeNull();
  });

  it('treats "playing but the player never started" as autoplay blocked', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    c.handlePhase('ready');
    c.play();

    c.handlePlayingChange(false);
    expect(c.getSnapshot().autoplayBlocked).toBe(true);

    c.handlePlayingChange(true);
    expect(c.getSnapshot().autoplayBlocked).toBe(false);
  });

  it('does not call a paused player autoplay-blocked', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    c.handlePhase('ready');
    c.pause();
    c.handlePlayingChange(false);
    expect(c.getSnapshot().autoplayBlocked).toBe(false);
  });

  it('marks the session paused when the video ends', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.setMedia(YT);
    c.play();

    c.handlePhase('ended');
    expect(c.getSnapshot().status).toBe('paused');
    expect(c.getSnapshot().phase).toBe('ended');
  });

  it('clears the stalled flag when buffering ends', () => {
    const adapter = makeAdapter();
    const c = makeController(adapter);
    c.handlePhase('buffering');
    c.handleStalled(true);
    expect(c.getSnapshot().stalled).toBe(true);

    c.handlePhase('ready');
    expect(c.getSnapshot().stalled).toBe(false);
  });

  it('polls position without producing any command', () => {
    const adapter = makeAdapter();
    const commands: PlaybackCommand[] = [];
    const c = makeController(adapter, (cmd) => commands.push(cmd));
    c.setMedia(YT);
    commands.length = 0;

    adapter.position = 12.5;
    c.tick();

    expect(c.getSnapshot().currentTime).toBe(12.5);
    expect(commands).toEqual([]);
  });
});
