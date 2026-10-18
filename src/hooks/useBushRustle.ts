import { useCallback, useRef } from 'react';

import { playBushRustle, primeBushRustle } from '@/lib/audio/bush-rustle';

export interface UseBushRustleOptions {
  /** Playback volume 0..1. Defaults to 1. */
  volume?: number;
  /** Minimum time (ms) between two rustles; a play inside it is ignored. Defaults to 500 ms. */
  cooldownMs?: number;
}

export interface BushRustleApi {
  /** Call from the click that leads to a rustle: readies audio inside the user gesture. */
  prime: () => void;
  /** Play the rustle (respects the cooldown; never throws). */
  play: () => void;
}

/**
 * The bush rustle, generated in code (`@/lib/audio/bush-rustle`), with the same
 * cooldown semantics `useSfx` gives a one-shot file.
 */
export function useBushRustle(options: UseBushRustleOptions = {}): BushRustleApi {
  const { volume = 1, cooldownMs = 500 } = options;
  const lastPlayedRef = useRef(0);

  const prime = useCallback(() => {
    primeBushRustle();
  }, []);

  const play = useCallback(() => {
    const now = Date.now();
    if (now - lastPlayedRef.current < cooldownMs) return;
    lastPlayedRef.current = now;
    playBushRustle(volume);
  }, [volume, cooldownMs]);

  return { prime, play };
}
