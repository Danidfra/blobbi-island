import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ context: null as unknown, created: 0 }));

vi.mock('@/arcade/audio/arcade-audio', () => ({
  ensureArcadeAudio: () => {
    if (!audio.context) return null;
    audio.created += 1;
    return audio.context;
  },
  peekArcadeAudio: () => audio.context,
}));

import { RUSTLE_DURATION_S, playBushRustle, primeBushRustle, synthesizeRustle } from './bush-rustle';

const RATE = 48_000;

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

describe('synthesizeRustle', () => {
  const samples = synthesizeRustle(RATE, 1);

  it('is a short effect between 0.5 and 1.3 seconds', () => {
    expect(RUSTLE_DURATION_S).toBeGreaterThanOrEqual(0.5);
    expect(RUSTLE_DURATION_S).toBeLessThanOrEqual(1.3);
    expect(samples.length).toBe(Math.round(RATE * RUSTLE_DURATION_S));
  });

  it('is finite, never clips and is not silent', () => {
    let peak = 0;
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      peak = Math.max(peak, Math.abs(s));
    }
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(peak).toBeGreaterThan(0.8);
  });

  it('starts and ends at silence, so it never clicks', () => {
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
    expect(Math.abs(samples[1])).toBeLessThan(0.05);
    expect(Math.abs(samples[samples.length - 2])).toBeLessThan(0.05);
  });

  it('swells early and fades out: a natural envelope', () => {
    const n = samples.length;
    const early = rms(samples, Math.floor(n * 0.05), Math.floor(n * 0.35));
    const late = rms(samples, Math.floor(n * 0.7), n);
    expect(early).toBeGreaterThan(late * 2);
  });

  it('is noise with no DC offset or rumble, not a tone', () => {
    let mean = 0;
    for (const s of samples) mean += s;
    mean /= samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    // Zero crossings per second in the loud part: far above a hum, below raw white noise.
    const from = Math.floor(RATE * 0.05);
    const to = Math.floor(RATE * 0.4);
    let crossings = 0;
    for (let i = from + 1; i < to; i += 1) if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings += 1;
    const perSecond = crossings / ((to - from) / RATE);
    expect(perSecond).toBeGreaterThan(1500);
    expect(perSecond).toBeLessThan(15000);
  });

  it('is the same for the same seed and different for another', () => {
    expect(synthesizeRustle(RATE, 1)).toEqual(samples);
    expect(synthesizeRustle(RATE, 2)).not.toEqual(samples);
  });

  it('works at the usual output rates', () => {
    for (const rate of [22_050, 44_100, 48_000]) {
      const s = synthesizeRustle(rate, 3);
      expect(s.length).toBe(Math.round(rate * RUSTLE_DURATION_S));
      expect(s.every(Number.isFinite)).toBe(true);
    }
  });
});

/** A minimal stand-in for an `AudioContext`, recording what the rustle asks of it. */
class FakeContext {
  sampleRate = 48_000;
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  buffers = 0;
  sources: FakeSource[] = [];
  resumes = 0;
  createBuffer(_channels: number, length: number) {
    this.buffers += 1;
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createGain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  connect = vi.fn();
  disconnect = () => {
    this.disconnected += 1;
  };
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
}

describe('playBushRustle', () => {
  let context: FakeContext;

  beforeEach(() => {
    context = new FakeContext();
    audio.context = context;
    audio.created = 0;
  });

  afterEach(() => {
    audio.context = null;
  });

  it('does nothing, and does not throw, without Web Audio', () => {
    audio.context = null;
    expect(() => primeBushRustle()).not.toThrow();
    expect(playBushRustle(0.8)).toBe(false);
  });

  it('is skipped while the context is suspended, and the click resumes it', () => {
    context.state = 'suspended';
    expect(playBushRustle(0.8)).toBe(false);
    expect(context.sources).toHaveLength(0);
    primeBushRustle();
    expect(context.resumes).toBe(1);
    expect(playBushRustle(0.8)).toBe(true);
  });

  it('renders its variants once per context, never per play', () => {
    for (let i = 0; i < 5; i += 1) playBushRustle(0.8);
    expect(context.sources).toHaveLength(5);
    expect(context.buffers).toBe(3);
  });

  it('varies the pitch a little within a narrow range', () => {
    const rates = [0, 0.5, 0.999].map((r) => {
      playBushRustle(0.8, () => r);
      return context.sources[context.sources.length - 1].playbackRate.value;
    });
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.94);
      expect(rate).toBeLessThanOrEqual(1.06);
    }
  });

  it('replaces a rustle still playing instead of layering on it, and lets go of finished ones', () => {
    playBushRustle(0.8);
    playBushRustle(0.8);
    const [first, second] = context.sources;
    expect(first.stopped).toBe(1);
    expect(second.started).toBe(1);
    first.onended?.();
    second.onended?.();
    expect(first.disconnected).toBe(1);
    expect(second.disconnected).toBe(1);
  });
});
