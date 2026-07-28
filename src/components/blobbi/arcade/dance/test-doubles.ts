/**
 * Test doubles for the dance game — a fake signer, a fake reward writer and a
 * scriptable audio engine.
 *
 * Kept apart from the provider component so neither file mixes components with
 * helpers (which breaks fast refresh, and which the lint config flags).
 *
 * ## Nothing here can publish
 *
 * The fake writer is explicit and injected. There is no path from any test in
 * this directory to a relay: the real writer is never constructed, the real
 * signer is never called, and a test that tried would have to build every
 * dependency by hand.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import type { ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import type { DanceAudioEngine, DanceAudioFactory } from '@/arcade/dance/dance-audio';

/** A signer that produces a plausible signed event without any cryptography. */
export function fakeUser(pubkey = 'f'.repeat(64)) {
  return {
    pubkey,
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (template: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
        ...template,
        id: 'fake-event-id',
        pubkey,
        sig: 'fake-sig',
      }),
    },
  };
}

export interface FakeWriterOptions {
  /** Quantities returned by successive `readTicketQuantity()` calls. */
  readonly quantities?: readonly (number | null)[];
  /** Throw this from `publishTicketGrant`. */
  readonly publishError?: unknown;
  /** Called with every published claim, in order. */
  readonly onPublish?: (tickets: number) => void;
  /** Resolve the publish only when this promise settles. */
  readonly gate?: Promise<void>;
}

/**
 * A writer whose every branch is chosen by the test.
 *
 * The default is the happy path: publishes accumulate into `granted`, and reads
 * return it — additive, like the real kind:31633 grant.
 *
 * ## `quantities` is SCRIPTED, and that makes it weaker than a relay
 *
 * When `quantities` is supplied, reads return the script regardless of what was
 * published. That is exactly what a state-machine branch test wants (drive
 * `verify-mismatch` on demand) and exactly what a **non-duplication** test must
 * NOT rely on: a scripted read cannot show a second `+N` landing, so it would
 * make a retry look safe when the production writer would have doubled the
 * balance.
 *
 * Anything asserting "one publish, delta exactly N" therefore uses a purpose-
 * built additive writer instead — see `laggyRelayWriter` in
 * `useArcadeReward.test.tsx`, which models a real relay: the publish lands, and
 * only the read lags.
 */
export function createFakeWriter(options: FakeWriterOptions = {}): ArcadeRewardWriter & {
  publishCount: () => number;
  readCount: () => number;
} {
  let publishes = 0;
  let reads = 0;
  let granted = 0;
  const quantities = options.quantities;

  return {
    publishCount: () => publishes,
    readCount: () => reads,
    async publishTicketGrant(claim) {
      if (options.gate) await options.gate;
      publishes += 1;
      if (options.publishError) throw options.publishError;
      granted += claim.tickets;
      options.onPublish?.(claim.tickets);
    },
    async readTicketQuantity() {
      const index = reads;
      reads += 1;
      if (quantities) return quantities[Math.min(index, quantities.length - 1)] ?? null;
      return granted;
    },
  };
}

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
