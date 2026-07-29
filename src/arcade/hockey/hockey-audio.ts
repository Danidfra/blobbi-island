/**
 * Air Hockey — four short sounds, and nothing that keeps time.
 *
 * The contrast with `dance-audio.ts` is the whole design. Blobbi Dance JUDGES
 * against `AudioContext.currentTime`, so its engine is a scheduler with a
 * lookahead and a clock other code reads. Air Hockey judges against nothing: the
 * simulation is a fixed-step loop that would play identically in silence. So
 * this is a **feedback** engine, not a timing one — it is handed events that
 * have already happened and makes a noise about them.
 *
 * That difference is why it is fifty lines instead of four hundred, and why
 * losing audio entirely is a degraded experience rather than a refused run:
 * {@link createHockeyAudio} returns a working, silent engine when Web Audio is
 * unavailable, and the game never asks whether sound exists.
 *
 * It shares the ONE arcade `AudioContext` (`arcade-audio.ts`) and the one
 * persisted mute setting, so muting the dance machine mutes this too — which is
 * what a player means by "turn the arcade down".
 */

import { ensureArcadeAudio, isArcadeMuted } from '../audio/arcade-audio';

export interface HockeyAudioEngine {
  /** A mallet struck the puck. `strength` in 0..1 scales pitch and level. */
  hit(strength: number): void;
  /** The puck kissed a rail. Softer and duller than a hit. */
  wall(strength: number): void;
  /** A goal went in. `forPlayer` picks a rising or a falling figure. */
  goal(forPlayer: boolean): void;
  /** The match is decided. */
  fanfare(won: boolean): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Release every node. The engine is silent afterwards, never broken. */
  dispose(): void;
}

/** A no-op engine, used when Web Audio is missing (jsdom, old browsers). */
function silentEngine(muted: boolean): HockeyAudioEngine {
  return {
    hit: () => {},
    wall: () => {},
    goal: () => {},
    fanfare: () => {},
    setMuted: () => {},
    muted,
    dispose: () => {},
  };
}

/** The factory shape, so a test or the DEV harness can substitute an engine. */
export type HockeyAudioFactory = () => HockeyAudioEngine;

/**
 * Build the engine.
 *
 * **Call this from a user-gesture handler** (the Start click). An
 * `AudioContext` constructed outside one starts suspended and silently produces
 * nothing — the same rule `arcade-audio.ts` documents, obeyed here rather than
 * rediscovered.
 */
export function createHockeyAudio(): HockeyAudioEngine {
  let muted = isArcadeMuted();
  const context = ensureArcadeAudio();
  if (!context) return silentEngine(muted);

  const master = context.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(context.destination);

  let disposed = false;

  /** One oscillator + one envelope. Every sound in the game is made of these. */
  const blip = (
    frequency: number,
    endFrequency: number,
    durationS: number,
    level: number,
    type: OscillatorType = 'triangle',
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
    // Nodes disconnect themselves when they stop, so nothing accumulates over a
    // four-minute match — which is the failure mode a per-hit sound invites.
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
    hit(strength) {
      const s = clampUnit(strength);
      blip(280 + s * 340, 150, 0.09, 0.16 + s * 0.16, 'square');
    },
    wall(strength) {
      const s = clampUnit(strength);
      blip(180 + s * 120, 110, 0.07, 0.05 + s * 0.07, 'triangle');
    },
    goal(forPlayer) {
      if (forPlayer) {
        blip(440, 880, 0.22, 0.24, 'triangle');
        blip(660, 990, 0.3, 0.14, 'sine');
      } else {
        blip(340, 150, 0.3, 0.2, 'sawtooth');
      }
    },
    fanfare(won) {
      if (won) {
        blip(523, 784, 0.5, 0.24, 'triangle');
        blip(784, 1046, 0.6, 0.16, 'sine');
      } else {
        blip(392, 196, 0.6, 0.2, 'triangle');
      }
    },
    setMuted(next) {
      muted = next;
      if (!disposed) master.gain.value = next ? 0 : 0.5;
    },
    // A getter, so `engine.muted` reports the live value rather than whatever it
    // was when the object literal was evaluated.
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
