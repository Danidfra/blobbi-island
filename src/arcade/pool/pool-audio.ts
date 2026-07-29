/**
 * Pool — seven short sounds, and nothing that keeps time.
 *
 * A **feedback** engine, exactly like `hockey-audio.ts`: it is handed events
 * that have already happened and makes a noise about them. The simulation would
 * play identically in silence, which is why {@link createPoolAudio} returns a
 * working, silent engine when Web Audio is unavailable rather than refusing the
 * run.
 *
 * It shares the ONE arcade `AudioContext` (`arcade-audio.ts`) and the one
 * persisted mute setting, so muting the dance machine mutes this too — which is
 * what a player means by "turn the arcade down".
 *
 * ## The one thing this engine has to do that air hockey's did not
 *
 * **A break is forty collisions in a fifth of a second.** Playing a click for
 * each of them is not loud, it is a burst of white noise that clips the master
 * bus and sounds like a fault. Air hockey never had to solve this: a puck hits
 * one thing at a time.
 *
 * Two defences, at two levels, because either alone is not enough:
 *
 *  - **The caller aggregates.** The table component keeps only the hardest
 *    contact of each frame and calls {@link PoolAudioEngine.collide} once, so
 *    sixty simultaneous clicks become one click at the volume of the loudest.
 *  - **The engine throttles.** {@link COLLIDE_MIN_GAP_S} refuses a second click
 *    within 32 ms whatever the caller does, which covers the frames either side
 *    of the break as the rack keeps re-colliding.
 *
 * The result is that a break sounds like a break — one loud crack and a scatter
 * of smaller ones — rather than like a fault.
 */

import { ensureArcadeAudio, isArcadeMuted } from '../audio/arcade-audio';

export interface PoolAudioEngine {
  /** The cue struck the ball. `power` in 0..1 scales pitch and level. */
  strike(power: number): void;
  /** Two balls touched. `strength` in 0..1. Throttled — see the module note. */
  collide(strength: number): void;
  /** A ball kissed a cushion. Softer and duller than a collision. */
  cushion(strength: number): void;
  /** A ball dropped. */
  pocket(): void;
  /** The cue ball dropped. */
  scratch(): void;
  /** The turn changed. `toPlayer` picks a rising or a falling figure. */
  turn(toPlayer: boolean): void;
  /** The match is decided. */
  fanfare(won: boolean): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Release every node. The engine is silent afterwards, never broken. */
  dispose(): void;
}

/** The shortest gap between two collision clicks, in seconds. */
const COLLIDE_MIN_GAP_S = 0.032;

/** A no-op engine, used when Web Audio is missing (jsdom, old browsers). */
function silentEngine(muted: boolean): PoolAudioEngine {
  return {
    strike: () => {},
    collide: () => {},
    cushion: () => {},
    pocket: () => {},
    scratch: () => {},
    turn: () => {},
    fanfare: () => {},
    setMuted: () => {},
    muted,
    dispose: () => {},
  };
}

/** The factory shape, so a test or the DEV harness can substitute an engine. */
export type PoolAudioFactory = () => PoolAudioEngine;

/**
 * Build the engine.
 *
 * **Call this from a user-gesture handler** (the Start click). An
 * `AudioContext` constructed outside one starts suspended and silently produces
 * nothing — the rule `arcade-audio.ts` documents, obeyed here rather than
 * rediscovered.
 */
export function createPoolAudio(): PoolAudioEngine {
  let muted = isArcadeMuted();
  const context = ensureArcadeAudio();
  if (!context) return silentEngine(muted);

  const master = context.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(context.destination);

  let disposed = false;
  let lastCollideAt = -Infinity;

  /** One oscillator + one envelope. Every tone in the game is made of these. */
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
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationS);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + durationS + 0.02);
    // Nodes disconnect themselves when they stop, so nothing accumulates over a
    // four-minute match — which is the failure mode a per-contact sound invites.
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
    strike(power) {
      const p = clampUnit(power);
      // A cue tip is a soft, low knock. The pitch barely moves with power;
      // the LEVEL is what tells the player how hard they hit it.
      blip(150 + p * 60, 90, 0.07, 0.1 + p * 0.2, 'triangle');
    },
    collide(strength) {
      const now = context.currentTime;
      if (now - lastCollideAt < COLLIDE_MIN_GAP_S) return;
      lastCollideAt = now;
      const s = clampUnit(strength);
      // Resin on resin: bright, short, and higher the harder it lands.
      blip(620 + s * 620, 300, 0.045, 0.06 + s * 0.2, 'square');
    },
    cushion(strength) {
      const s = clampUnit(strength);
      blip(190 + s * 90, 120, 0.06, 0.03 + s * 0.06, 'sine');
    },
    pocket() {
      // Down and away: the ball falling out of play.
      blip(420, 150, 0.16, 0.2, 'sine');
      blip(210, 90, 0.22, 0.12, 'triangle');
    },
    scratch() {
      blip(300, 110, 0.3, 0.2, 'sawtooth');
    },
    turn(toPlayer) {
      if (toPlayer) blip(520, 700, 0.14, 0.11, 'triangle');
      else blip(420, 330, 0.14, 0.09, 'triangle');
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
