/**
 * The bush rustle: an original sound, generated in the browser from code.
 *
 * There is no audio file. The samples are synthesised by {@link synthesizeRustle}
 * (pure, deterministic per seed, testable without Web Audio) and played through
 * the document's one shared `AudioContext` (`ensureArcadeAudio`), so the town
 * never opens a second context.
 *
 * ## How it sounds like leaves
 *
 *  - **Swish:** noise under a smooth envelope (a soft ~70 ms rise, a long fall)
 *    with a slow wobble, so the bush breathes rather than hisses.
 *  - **Leaf ticks:** a scatter of very short decaying bursts, denser at the
 *    start, which is what makes it read as leaves rather than wind.
 *  - **Softening:** a high-pass removes rumble and a low-pass (two poles at
 *    ~4.5 kHz) removes the harsh top. Each play varies the pitch and a second
 *    low-pass a little, and picks one of a few pre-rendered variants, so
 *    repeated rustles are never identical.
 *
 * ## Autoplay
 *
 * A context created outside a user gesture starts suspended. The bush click is
 * the gesture, so {@link primeBushRustle} runs there (creating or resuming the
 * context) and the rustle itself plays later, on arrival. If the context is not
 * running when the Blobbi arrives, the rustle is skipped: no sound is fine.
 */

import { ensureArcadeAudio, peekArcadeAudio } from '@/arcade/audio/arcade-audio';

/** Length of one rustle, in seconds. */
export const RUSTLE_DURATION_S = 0.9;

/** Seeds of the pre-rendered variants (rendered once per context, on first use). */
const VARIANT_SEEDS = [0x51a7e, 0x2b0c4, 0x7e113] as const;

/** A small, fast, seedable PRNG (mulberry32): the same seed, the same rustle. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole filter coefficient for a cutoff, as `exp(-2π fc / fs)`. */
function poleFor(cutoffHz: number, sampleRate: number): number {
  return Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
}

/**
 * The rustle's samples, mono, peak-normalised to 0.9. Starts and ends at zero,
 * so it never clicks. Pure: no Web Audio, no `Math.random`.
 */
export function synthesizeRustle(sampleRate: number, seed: number, durationS: number = RUSTLE_DURATION_S): Float32Array {
  const length = Math.max(1, Math.round(sampleRate * durationS));
  const out = new Float32Array(length);
  const random = seededRandom(seed);

  // Swish: noise under an envelope that rises softly and falls slowly.
  const attackS = 0.06 + random() * 0.03;
  const decayS = 0.22 + random() * 0.1;
  const wobbleHz = 5 + random() * 3;
  const wobblePhase = random() * Math.PI * 2;
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const env = t < attackS ? Math.pow(t / attackS, 1.5) : Math.exp(-(t - attackS) / decayS);
    const wobble = 1 + 0.3 * Math.sin(2 * Math.PI * wobbleHz * t + wobblePhase);
    out[i] = (random() * 2 - 1) * env * wobble * 0.5;
  }

  // Leaf ticks: short decaying bursts, more of them early on.
  const ticks = 18 + Math.floor(random() * 10);
  for (let k = 0; k < ticks; k += 1) {
    const start = Math.floor(Math.pow(random(), 1.7) * durationS * 0.8 * sampleRate);
    const tickLength = Math.floor((0.003 + random() * 0.007) * sampleRate);
    const fade = Math.exp(-(start / sampleRate) / 0.35);
    const amplitude = (0.35 + random() * 0.65) * fade;
    for (let j = 0; j < tickLength && start + j < length; j += 1) {
      out[start + j] += (random() * 2 - 1) * amplitude * Math.exp((-6 * j) / tickLength);
    }
  }

  // Softening: high-pass at ~350 Hz (no rumble), then two low-pass poles at
  // ~4.5 kHz (no hiss), which leaves the soft mid-range of leaves.
  const hp = poleFor(350, sampleRate);
  const lp = poleFor(4500, sampleRate);
  let prevIn = 0;
  let prevHp = 0;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < length; i += 1) {
    const x = out[i];
    const high = hp * (prevHp + x - prevIn);
    prevIn = x;
    prevHp = high;
    lp1 = (1 - lp) * high + lp * lp1;
    lp2 = (1 - lp) * lp1 + lp * lp2;
    out[i] = lp2;
  }

  // 5 ms fades at both ends, then normalise.
  const edge = Math.min(Math.floor(sampleRate * 0.005), Math.floor(length / 2));
  for (let i = 0; i < edge; i += 1) {
    const g = i / edge;
    out[i] *= g;
    out[length - 1 - i] *= g;
  }
  out[0] = 0;
  out[length - 1] = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const scale = 0.9 / peak;
    for (let i = 0; i < length; i += 1) out[i] *= scale;
  }
  return out;
}

/** The variants rendered for each context, so no buffer is ever rebuilt per play. */
const variantsByContext = new WeakMap<BaseAudioContext, AudioBuffer[]>();

function variantsFor(context: BaseAudioContext): AudioBuffer[] {
  const cached = variantsByContext.get(context);
  if (cached) return cached;
  const buffers = VARIANT_SEEDS.map((seed) => {
    const samples = synthesizeRustle(context.sampleRate, seed);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  });
  variantsByContext.set(context, buffers);
  return buffers;
}

/**
 * Call from the user gesture that will lead to a rustle (the bush click): makes
 * sure the shared context exists and is running. Never throws.
 */
export function primeBushRustle(): void {
  const context = ensureArcadeAudio();
  if (!context || context.state !== 'suspended') return;
  context.resume().catch(() => {
    /* the autoplay policy may still refuse; the rustle is then skipped */
  });
}

/** A rustle that is playing, so the next one can replace it instead of layering on it. */
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

let current: Voice | null = null;
let nextVariant = 0;

function release(voice: Voice): void {
  if (current === voice) current = null;
  try {
    voice.source.disconnect();
    voice.gain.disconnect();
  } catch {
    /* already disconnected */
  }
}

/**
 * Play one rustle at `volume` (0..1). Skipped, silently, where Web Audio does
 * not exist or the context is not running. Returns whether a rustle started.
 */
export function playBushRustle(volume: number, random: () => number = Math.random): boolean {
  const context = peekArcadeAudio();
  if (!context || context.state !== 'running') return false;
  try {
    const variants = variantsFor(context);
    const buffer = variants[nextVariant % variants.length];
    nextVariant += 1;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + random() * 0.12;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3800 + random() * 1800;
    filter.Q.value = 0.5;

    const gain = context.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume));

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    // One rustle at a time: fade the previous one out quickly rather than stacking.
    const previous = current;
    if (previous) {
      const now = context.currentTime;
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      try {
        previous.source.stop(now + 0.035);
      } catch {
        release(previous);
      }
    }

    const voice: Voice = { source, gain };
    current = voice;
    source.onended = () => {
      release(voice);
      try {
        filter.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    source.start();
    return true;
  } catch {
    return false;
  }
}
