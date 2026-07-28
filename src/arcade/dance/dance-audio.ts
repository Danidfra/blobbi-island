/**
 * Blobbi Dance — the audio engine and the authoritative song clock.
 *
 * ## The clock
 *
 * `AudioContext.currentTime` is the only clock this game trusts. It is the same
 * timebase the sound is scheduled on, it advances in real seconds regardless of
 * what the renderer is doing, and it FREEZES when the context is suspended —
 * which is exactly the behaviour a paused rhythm game needs.
 *
 * What is deliberately not used as a clock: `Date.now()` (wall time, and it can
 * step), `performance.now()` (monotonic but unrelated to the audio hardware, so
 * it drifts against the music), `requestAnimationFrame` deltas (throttled when
 * backgrounded, skipped under load), CSS animation events, and chained
 * `setTimeout`s (error accumulates on every link).
 *
 * `requestAnimationFrame` still drives RENDERING — it samples
 * {@link DanceAudioEngine.songTimeMs} and draws whatever that says. A dropped
 * frame therefore costs a frame of animation and nothing else: the next frame
 * reads the true song time and the notes are where they should be.
 *
 * ## The lookahead scheduler
 *
 * A `setInterval` tops the schedule up every 25 ms with everything due in the
 * next 200 ms. This is the standard Web Audio pattern and it is not a violation
 * of the rule above: the timer decides *when to think about scheduling*, and is
 * allowed to be late or early by tens of milliseconds. Every event it creates is
 * given an explicit `AudioContext` start time computed from the song's zero, so
 * the SOUND is sample-accurate whatever the timer did. Scheduling all ~1,100
 * events up front would also work and would be simpler, but it holds a thousand
 * live nodes for the length of the song and makes a mid-song pause much harder
 * to unwind.
 *
 * ## The track is synthesised
 *
 * There is no audio asset. `NEON_HOP_TRACK` is a kick, a hat, a clap and a bass
 * line computed from oscillators and gain envelopes, so it carries no licence,
 * no download, and no takedown risk — see `track.ts` for why that decision was
 * forced and what would replace it.
 */

import {
  ensureArcadeAudio,
  getArcadeLatencyOffsetMs,
  isArcadeMuted,
  resumeArcadeAudio,
} from '../audio/arcade-audio';
import type { DanceTrack } from './track';
import { msPerBeat } from './track';

/** How far ahead of `currentTime` the scheduler works, in seconds. */
const LOOKAHEAD_S = 0.2;
/** How often the scheduler wakes up, in milliseconds. */
const SCHEDULER_TICK_MS = 25;
/**
 * Gap between `start()` and song time zero, in seconds.
 *
 * Without it the first beat would be scheduled at (or slightly before) the
 * current time and would either be dropped or play late. 120 ms is comfortably
 * more than one scheduler tick and short enough that the countdown does not feel
 * like it stalls.
 */
const PRE_ROLL_S = 0.12;

export type DanceAudioState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface DanceAudioEngine {
  /** Begin at song time zero. Idempotent — a second call is ignored. */
  start(): void;
  /** Freeze the clock and silence the schedule. The song position is kept. */
  pause(): Promise<void>;
  /** Continue from exactly where {@link pause} stopped. */
  resume(): Promise<void>;
  /** End the run. The clock stops advancing and reports its final position. */
  stop(): void;
  /** Release every node and timer. The engine is unusable afterwards. */
  dispose(): void;
  /**
   * Song position in milliseconds, latency-compensated.
   *
   * `null` before {@link start}. Slightly NEGATIVE for the length of the pre-roll
   * (and by the latency offset), which is correct rather than a bug: zero is the
   * first musical instant, and the moments before it are moments before the song.
   * Renderers clamp; the judgement engine does not need to, because no note is
   * scheduled before the lead-in.
   */
  songTimeMs(): number | null;
  /**
   * Whether the underlying `AudioContext` is actually running.
   *
   * `currentTime` stops advancing in a suspended context, so a game that reads a
   * frozen clock would silently stall. The controller checks this to tell the
   * player something true instead.
   */
  isRunning(): boolean;
  /** A short click, for hit feedback. Never affects the schedule or the clock. */
  playHitBlip(strong: boolean): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  readonly state: DanceAudioState;
  /** The device latency compensation in force, in ms. */
  readonly latencyOffsetMs: number;
}

/** Why an engine could not be created. Rendered verbatim by the preview. */
export type DanceAudioFailure = 'no-web-audio' | 'context-failed';

export type CreateDanceAudioResult =
  | { readonly ok: true; readonly engine: DanceAudioEngine }
  | { readonly ok: false; readonly failure: DanceAudioFailure };

/** The factory shape, so tests and the DEV harness can substitute an engine. */
export type DanceAudioFactory = (track: DanceTrack) => CreateDanceAudioResult;

// ── Synthesis ───────────────────────────────────────────────────────────────

type Voice = 'kick' | 'hat' | 'clap' | 'bass' | 'count';

interface ScheduledEvent {
  /** Seconds from song zero. */
  readonly at: number;
  readonly voice: Voice;
  /** Pitch in Hz, for the voices that have one. */
  readonly frequency?: number;
}

/**
 * Bass root note per bar, as a frequency in Hz.
 *
 * A four-bar loop (A minor – F – C – G, an octave down) repeated eight times.
 * Written as a committed table for the same reason the chart is: a progression
 * generated from a random source would be a different song every run, and a
 * rhythm game whose music changes is a rhythm game whose chart is wrong.
 */
const BASS_LOOP_HZ = [110, 87.31, 130.81, 98] as const;

/**
 * Build every event of the track, deterministically.
 *
 * Pure: same track in, same array out. Exported so a test can assert the shape
 * of the schedule without an `AudioContext`.
 */
export function buildDanceTrackSchedule(track: DanceTrack): readonly ScheduledEvent[] {
  const beatS = msPerBeat(track.bpm) / 1000;
  const leadInS = track.leadInMs / 1000;
  const bodyS = (track.durationMs - track.leadInMs - track.tailMs) / 1000;
  const totalBeats = Math.round(bodyS / beatS);

  const events: ScheduledEvent[] = [];

  // Count-in: four clicks over the lead-in, so "3, 2, 1, go" is audible and in
  // tempo rather than a visual countdown over silence.
  for (let i = 0; i < track.beatsPerBar; i += 1) {
    events.push({ at: leadInS - (track.beatsPerBar - i) * beatS, voice: 'count' });
  }

  for (let beat = 0; beat < totalBeats; beat += 1) {
    const at = leadInS + beat * beatS;
    const beatInBar = beat % track.beatsPerBar;
    const bar = Math.floor(beat / track.beatsPerBar);

    events.push({ at, voice: 'kick' });
    events.push({ at: at + beatS / 2, voice: 'hat' });
    if (beatInBar === 1 || beatInBar === 3) events.push({ at, voice: 'clap' });
    if (beatInBar === 0 || beatInBar === 2) {
      events.push({ at, voice: 'bass', frequency: BASS_LOOP_HZ[bar % BASS_LOOP_HZ.length] });
    }
  }

  // One last kick to land the tail, so the song ends rather than stopping.
  events.push({ at: leadInS + bodyS, voice: 'kick' });
  events.push({
    at: leadInS + bodyS,
    voice: 'bass',
    frequency: BASS_LOOP_HZ[0],
  });

  return events.filter((e) => e.at >= 0).sort((a, b) => a.at - b.at);
}

const VOICE_GAIN: Readonly<Record<Voice, number>> = {
  kick: 0.55,
  hat: 0.08,
  clap: 0.16,
  bass: 0.16,
  count: 0.25,
};

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * Create the real engine, or report why it could not be created.
 *
 * **Call from a user gesture.** `ensureArcadeAudio()` constructs the shared
 * context, and a context constructed outside a gesture starts suspended and
 * silently produces nothing — a bug that only appears on real devices.
 */
export function createDanceAudioEngine(track: DanceTrack): CreateDanceAudioResult {
  const context = ensureArcadeAudio();
  if (!context) return { ok: false, failure: 'no-web-audio' };

  let master: GainNode;
  try {
    master = context.createGain();
    master.connect(context.destination);
  } catch {
    return { ok: false, failure: 'context-failed' };
  }

  const schedule = buildDanceTrackSchedule(track);
  const latencyOffsetMs = getArcadeLatencyOffsetMs();

  let state: DanceAudioState = 'idle';
  let muted = isArcadeMuted();
  /** `AudioContext` time that corresponds to song time zero. */
  let originS = 0;
  /** Index of the next event in `schedule` that has not been scheduled. */
  let nextEvent = 0;
  /** Song position captured at pause, in seconds. */
  let pausedAtS = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  const live = new Set<AudioScheduledSourceNode>();

  master.gain.value = muted ? 0 : 1;

  const forget = (node: AudioScheduledSourceNode) => {
    live.delete(node);
    try {
      node.disconnect();
    } catch {
      /* already gone */
    }
  };

  /** One percussive voice: an oscillator (or noise) through a decay envelope. */
  const emit = (event: ScheduledEvent, atS: number) => {
    const gain = context.createGain();
    gain.connect(master);

    let source: AudioScheduledSourceNode;
    let stopAt = atS;

    if (event.voice === 'hat' || event.voice === 'clap') {
      // Noise, built once per hit. A 60 ms buffer is cheap and sounds better
      // than a high oscillator, which reads as a whistle rather than a hat.
      const length = Math.max(1, Math.floor(context.sampleRate * 0.06));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      // A fixed-seed LCG, not Math.random: the track must be identical every run.
      let seed = event.voice === 'hat' ? 0x2f6e2b1 : 0x5d3c9a7;
      for (let i = 0; i < length; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x3fffffff - 1) * (1 - i / length);
      }
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.connect(gain);
      source = noise;
      const decay = event.voice === 'hat' ? 0.04 : 0.09;
      gain.gain.setValueAtTime(VOICE_GAIN[event.voice], atS);
      gain.gain.exponentialRampToValueAtTime(0.0001, atS + decay);
      stopAt = atS + decay;
    } else {
      const osc = context.createOscillator();
      osc.connect(gain);
      source = osc;

      if (event.voice === 'kick') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, atS);
        osc.frequency.exponentialRampToValueAtTime(45, atS + 0.11);
        gain.gain.setValueAtTime(VOICE_GAIN.kick, atS);
        gain.gain.exponentialRampToValueAtTime(0.0001, atS + 0.18);
        stopAt = atS + 0.2;
      } else if (event.voice === 'bass') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(event.frequency ?? 110, atS);
        gain.gain.setValueAtTime(0.0001, atS);
        gain.gain.exponentialRampToValueAtTime(VOICE_GAIN.bass, atS + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, atS + 0.42);
        stopAt = atS + 0.45;
      } else {
        // count-in click, reused at a higher pitch for hit feedback
        osc.type = 'square';
        osc.frequency.setValueAtTime(event.frequency ?? 880, atS);
        gain.gain.setValueAtTime(VOICE_GAIN.count, atS);
        gain.gain.exponentialRampToValueAtTime(0.0001, atS + 0.06);
        stopAt = atS + 0.08;
      }
    }

    source.onended = () => forget(source);
    live.add(source);
    try {
      source.start(atS);
      source.stop(stopAt);
    } catch {
      forget(source);
    }
  };

  const pump = () => {
    if (disposed || state !== 'playing') return;
    const horizon = context.currentTime + LOOKAHEAD_S;
    while (nextEvent < schedule.length && originS + schedule[nextEvent].at <= horizon) {
      const event = schedule[nextEvent];
      // A tick that ran late must not schedule an event in the past, where it
      // would be dropped or fire immediately; clamp to the current time.
      emit(event, Math.max(context.currentTime, originS + event.at));
      nextEvent += 1;
    }
  };

  const startTicker = () => {
    if (ticker !== null) return;
    ticker = setInterval(pump, SCHEDULER_TICK_MS);
    pump();
  };

  const stopTicker = () => {
    if (ticker === null) return;
    clearInterval(ticker);
    ticker = null;
  };

  const killLiveNodes = () => {
    for (const node of [...live]) {
      try {
        node.stop();
      } catch {
        /* not started, or already stopped */
      }
      forget(node);
    }
    live.clear();
  };

  const engine: DanceAudioEngine = {
    get state() {
      return state;
    },
    get muted() {
      return muted;
    },
    latencyOffsetMs,

    start() {
      if (disposed || state !== 'idle') return;
      // Resuming is fire-and-forget: the schedule is anchored to `currentTime`,
      // which does not advance while suspended, so a slow resume delays the
      // music without desynchronising it from the clock the game reads.
      void resumeArcadeAudio();
      originS = context.currentTime + PRE_ROLL_S;
      nextEvent = 0;
      state = 'playing';
      startTicker();
    },

    async pause() {
      if (disposed || state !== 'playing') return;
      pausedAtS = context.currentTime - originS;
      state = 'paused';
      stopTicker();
      killLiveNodes();
      // Rewind the schedule to the pause point so resuming replays anything that
      // was scheduled into the (now cancelled) lookahead window.
      nextEvent = schedule.findIndex((e) => e.at >= pausedAtS);
      if (nextEvent === -1) nextEvent = schedule.length;
    },

    async resume() {
      if (disposed || state !== 'paused') return;
      await resumeArcadeAudio();
      // Re-anchor rather than relying on the context having been suspended for
      // exactly the paused duration. `suspend()` is asynchronous and its latency
      // is not observable, so anchoring to the CURRENT time is the only way to
      // guarantee the song resumes at the position it stopped at.
      originS = context.currentTime - pausedAtS + PRE_ROLL_S;
      state = 'playing';
      startTicker();
    },

    stop() {
      if (disposed || state === 'stopped') return;
      if (state === 'playing') pausedAtS = context.currentTime - originS;
      state = 'stopped';
      stopTicker();
      killLiveNodes();
    },

    dispose() {
      if (disposed) return;
      engine.stop();
      disposed = true;
      try {
        master.disconnect();
      } catch {
        /* already disconnected */
      }
    },

    songTimeMs() {
      if (state === 'idle') return null;
      const positionS = state === 'playing' ? context.currentTime - originS : pausedAtS;
      return positionS * 1000 - latencyOffsetMs;
    },

    isRunning() {
      return !disposed && context.state === 'running';
    },

    playHitBlip(strong: boolean) {
      if (disposed || muted || state !== 'playing') return;
      emit(
        { at: 0, voice: 'count', frequency: strong ? 1320 : 990 },
        context.currentTime + 0.001,
      );
    },

    setMuted(next: boolean) {
      muted = next;
      try {
        master.gain.value = next ? 0 : 1;
      } catch {
        /* a disposed context refuses; nothing to do */
      }
    },
  };

  return { ok: true, engine };
}
