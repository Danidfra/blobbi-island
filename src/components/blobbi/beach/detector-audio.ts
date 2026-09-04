/**
 * Treasure Hunt: the detector's voice. A feedback engine in the
 * `hockey-audio.ts` mold: it is handed the current signal and makes short
 * noises about it; it keeps no time and the game plays identically in
 * silence.
 *
 * ## How the beep works
 *
 * There is deliberately NO standing oscillator. `update(intensity)` is called
 * from the game's tick; when enough time has passed since the last beep for
 * the current intensity, one self-terminating blip is scheduled and the
 * timestamp advances. Repeat interval shortens and pitch rises as the signal
 * strengthens: the classic detector feel, and the interval floor doubles as
 * the throttle, so a fast sweep can never machine-gun (the same guard as
 * pool's `COLLIDE_MIN_GAP_S`). Pause simply stops calling `update`; there is
 * no timer here to cancel.
 *
 * Shares the one arcade `AudioContext` and the one persisted mute setting
 * (`arcade-audio.ts`), so "turn the arcade down" covers the beach too. Build
 * it inside the Start click; Web Audio missing → a working silent engine, and
 * the run is never refused.
 */

import { arcadeAudioNow, ensureArcadeAudio, isArcadeMuted } from '@/arcade/audio/arcade-audio';

export interface DetectorAudioEngine {
  /** Feed the current detector intensity (0..1). May emit at most one beep. */
  update(intensity: number): void;
  /** A dig resolved. Distinct figures for a find and for plain sand. */
  dig(hit: boolean): void;
  /** The round ended. A short close-out figure. */
  finish(found: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Release every node. Silent afterwards, never broken. */
  dispose(): void;
}

/** A no-op engine, used when Web Audio is missing (jsdom, old browsers). */
function silentEngine(muted: boolean): DetectorAudioEngine {
  return {
    update: () => {},
    dig: () => {},
    finish: () => {},
    setMuted: () => {},
    muted,
    dispose: () => {},
  };
}

/** Factory shape, so tests and the dev harness can substitute an engine. */
export type DetectorAudioFactory = () => DetectorAudioEngine;

/** Beep cadence: silence → slow ticking → rapid chirping. Seconds. */
const BEEP_GAP_WEAK_S = 0.55;
const BEEP_GAP_STRONG_S = 0.12;
/** Beep pitch range, Hz. Rises with intensity. */
const BEEP_FREQ_WEAK = 320;
const BEEP_FREQ_STRONG = 960;

/** **Call from a user-gesture handler** (the Start click): see arcade-audio. */
export function createDetectorAudio(): DetectorAudioEngine {
  let muted = isArcadeMuted();
  const context = ensureArcadeAudio();
  if (!context) return silentEngine(muted);

  const master = context.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(context.destination);

  let disposed = false;
  let lastBeepAt = -Infinity;

  const blip = (
    frequency: number,
    endFrequency: number,
    durationS: number,
    level: number,
    type: OscillatorType = 'sine',
  ) => {
    if (disposed || muted) return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + durationS);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationS);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + durationS + 0.02);
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* already torn down */
      }
    };
  };

  const clampUnit = (value: number) => (value > 1 ? 1 : value < 0 ? 0 : value);

  return {
    update(intensity) {
      if (disposed) return;
      const s = clampUnit(intensity);
      if (s <= 0) return;
      const gap = BEEP_GAP_WEAK_S + (BEEP_GAP_STRONG_S - BEEP_GAP_WEAK_S) * s;
      const now = arcadeAudioNow();
      if (now === null) return;
      if (now - lastBeepAt < gap) return;
      lastBeepAt = now;
      const freq = BEEP_FREQ_WEAK + (BEEP_FREQ_STRONG - BEEP_FREQ_WEAK) * s;
      blip(freq, freq * 1.06, 0.07, 0.1 + s * 0.14, 'sine');
    },
    dig(hit) {
      if (hit) {
        blip(520, 880, 0.18, 0.22, 'triangle');
        blip(780, 1180, 0.24, 0.12, 'sine');
      } else {
        blip(220, 130, 0.16, 0.14, 'triangle');
      }
    },
    finish(found) {
      if (found > 0) {
        blip(523, 784, 0.4, 0.2, 'triangle');
        blip(784, 1046, 0.5, 0.12, 'sine');
      } else {
        blip(392, 240, 0.4, 0.14, 'triangle');
      }
    },
    setMuted(next) {
      muted = next;
      if (!disposed) master.gain.value = next ? 0 : 0.5;
    },
    get muted() {
      return muted;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        master.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
