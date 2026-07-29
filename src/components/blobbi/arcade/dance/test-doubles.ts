/**
 * Test doubles for the dance game — a scriptable audio engine, plus re-exports
 * of the arcade-wide fake signer and fake reward writer.
 *
 * The signer and writer moved to `../test-doubles` when Air Hockey and Pool
 * gained the same claim wiring; they are re-exported here so this directory's
 * tests keep their established import site. Kept apart from the provider
 * component so neither file mixes components with helpers (which breaks fast
 * refresh, and which the lint config flags).
 */

import type { DanceAudioEngine, DanceAudioFactory } from '@/arcade/dance/dance-audio';

export { createFakeWriter, fakeUser, type FakeWriterOptions } from '../test-doubles';

/**
 * A scriptable audio engine.
 *
 * `jsdom` has no `AudioContext`, so the real engine cannot be built there — and
 * more importantly, a test that had to wait for real seconds to pass would be a
 * test nobody runs. `setSongTime` moves the song clock explicitly, which is the
 * whole reason the judgement code takes the time as an argument.
 */
export function createFakeAudio(): {
  factory: DanceAudioFactory;
  setSongTime: (ms: number) => void;
  engine: DanceAudioEngine & { blips: number; disposed: boolean; started: boolean };
} {
  let songTime: number | null = null;

  const engine = {
    blips: 0,
    disposed: false,
    started: false,
    state: 'idle' as DanceAudioEngine['state'],
    muted: false,
    latencyOffsetMs: 0,
    start() {
      engine.started = true;
      engine.state = 'playing';
      songTime = 0;
    },
    async pause() {
      engine.state = 'paused';
    },
    async resume() {
      engine.state = 'playing';
    },
    stop() {
      engine.state = 'stopped';
    },
    dispose() {
      engine.disposed = true;
      engine.state = 'stopped';
    },
    songTimeMs: () => songTime,
    isRunning: () => engine.state === 'playing',
    playHitBlip() {
      engine.blips += 1;
    },
    setMuted(next: boolean) {
      engine.muted = next;
    },
  };

  return {
    engine,
    factory: () => ({ ok: true, engine }),
    setSongTime: (ms: number) => {
      songTime = ms;
    },
  };
}

/** A factory that always refuses, for the no-Web-Audio path. */
export const refusingAudioFactory: DanceAudioFactory = () => ({
  ok: false,
  failure: 'no-web-audio',
});
