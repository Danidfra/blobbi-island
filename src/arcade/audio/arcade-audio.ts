/**
 * Arcade audio boundary.
 *
 * **No track, no scheduler, no notes.** This module exists to settle one
 * architectural question before Phase 3 writes a single beat map, and to own the
 * two pieces of state (mute, latency offset) that must be global and persisted
 * whatever the rhythm engine ends up looking like.
 *
 * ## The decision
 *
 * There are two kinds of arcade sound and they need different machinery:
 *
 * | | UI one-shots | Timing-critical music |
 * | --- | --- | --- |
 * | examples | button blips, coin drop, results sting | the track a rhythm game is judged against |
 * | mechanism | `useSfx` (`HTMLAudioElement`) | `AudioContext` |
 * | clock | none needed | `AudioContext.currentTime` — **never** `setTimeout`/rAF |
 * | tolerance | tens of ms | single-digit ms |
 *
 * `useSfx` stays exactly as it is for the first column: it is autoplay-safe,
 * cooldown-limited, dependency-free, and already used across the island. It is
 * NOT sufficient for the second: `HTMLAudioElement.currentTime` is coarse and
 * drifts, and scheduling notes off a timer accumulates error immediately.
 *
 * So: **one `AudioContext` per document, created lazily on a user gesture, and
 * every musical timing question answered against `AudioContext.currentTime`.**
 *
 * ## Why creation is gesture-gated
 *
 * Browsers create an `AudioContext` in the `suspended` state unless it is
 * constructed (or resumed) inside a user-gesture handler. Constructing one at
 * module load therefore yields a context that silently produces nothing until
 * something resumes it — a bug that only appears on real devices. So the context
 * is created by {@link ensureArcadeAudio}, which the shell calls from the click
 * that starts a run, and never at import time.
 *
 * ## Latency offset
 *
 * Output latency differs by tens of milliseconds between a laptop's speakers,
 * Bluetooth headphones and a phone. A rhythm game is unplayable if the judgement
 * window is wrong by more than a frame, so the offset is a first-class,
 * persisted, per-device setting. Phase 3 owns the calibration UI; the storage
 * and the accessor are here so no game invents its own.
 */

/** Persisted keys. `localStorage`, so the setting survives the session. */
const MUTE_KEY = 'blobbi:arcade:audio-muted';
const LATENCY_KEY = 'blobbi:arcade:audio-latency-ms';

/** Sane bounds for a hand-calibrated offset, in milliseconds. */
export const ARCADE_LATENCY_RANGE_MS = { min: -200, max: 500 } as const;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let context: AudioContext | null = null;

/**
 * Get the shared context, creating it if necessary.
 *
 * **Call this from a user-gesture handler.** Returns `null` where Web Audio does
 * not exist (jsdom, very old browsers), which every caller must handle: no
 * audio is a degraded experience, not a crash.
 */
export function ensureArcadeAudio(): AudioContext | null {
  if (context) return context;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** The context if one has already been created, without creating one. */
export function peekArcadeAudio(): AudioContext | null {
  return context;
}

/**
 * The authoritative clock for musical timing, in seconds.
 *
 * Returns `null` when no context exists — callers must NOT fall back to
 * `performance.now()`, because a schedule half-built on one clock and half on
 * another is worse than no schedule at all.
 */
export function arcadeAudioNow(): number | null {
  return context ? context.currentTime : null;
}

/**
 * Suspend the context, releasing the audio hardware while a game is paused.
 * `AudioContext.currentTime` stops advancing while suspended, which is exactly
 * what a paused rhythm game needs: the schedule freezes with the game.
 */
export async function suspendArcadeAudio(): Promise<void> {
  if (context && context.state === 'running') {
    try {
      await context.suspend();
    } catch {
      /* a context that refuses to suspend is not worth failing a pause over */
    }
  }
}

/** Resume after a pause. Safe to call when nothing is suspended. */
export async function resumeArcadeAudio(): Promise<void> {
  if (context && context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      /* autoplay policy may still refuse; the caller shows muted state */
    }
  }
}

/**
 * Drop the shared context.
 *
 * Only for tests and the DEV harness — production keeps one context for the
 * document's lifetime, because repeatedly constructing them leaks hardware
 * handles on some platforms.
 */
export async function resetArcadeAudio(): Promise<void> {
  const current = context;
  context = null;
  if (current) {
    try {
      await current.close();
    } catch {
      /* already closed */
    }
  }
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — the setting simply does not persist */
  }
}

/** Global, persisted mute. Applies to arcade music AND arcade UI sound. */
export function isArcadeMuted(): boolean {
  return readStorage(MUTE_KEY) === 'true';
}

export function setArcadeMuted(muted: boolean): void {
  writeStorage(MUTE_KEY, muted ? 'true' : null);
}

/**
 * Per-device output-latency compensation, in milliseconds.
 *
 * Positive means "this device plays sound late, so judge inputs late to match".
 * Out-of-range or unparseable values degrade to 0 rather than throwing: a
 * corrupted setting must not make the arcade unopenable.
 */
export function getArcadeLatencyOffsetMs(): number {
  const raw = readStorage(LATENCY_KEY);
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return clampLatency(value);
}

export function setArcadeLatencyOffsetMs(ms: number): void {
  if (!Number.isFinite(ms)) return;
  writeStorage(LATENCY_KEY, String(clampLatency(ms)));
}

function clampLatency(ms: number): number {
  return Math.min(ARCADE_LATENCY_RANGE_MS.max, Math.max(ARCADE_LATENCY_RANGE_MS.min, Math.round(ms)));
}
