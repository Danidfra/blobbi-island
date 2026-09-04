import { useCallback, useEffect, useRef } from 'react';

/**
 * Options for {@link useSfx}.
 */
export interface UseSfxOptions {
  /** Playback volume 0..1. Defaults to 1. */
  volume?: number;
  /**
   * Minimum time (ms) between two successful plays. A `play()` call that lands
   * inside the cooldown window is ignored. Defaults to 500ms, enough to stop
   * the same effect from machine-gunning if the trigger fires repeatedly.
   */
  cooldownMs?: number;
}

export interface SfxApi {
  /**
   * Play the sound effect. Safe to call from any event handler:
   *  - respects the cooldown window (ignored if called too soon);
   *  - prevents overlapping playback by restarting the single shared element
   *    rather than layering copies on top of each other;
   *  - swallows autoplay/permission rejections so a blocked sound never throws.
   */
  play: () => void;
}

/**
 * useSfx: a tiny, reusable one-shot sound-effect helper built on a single
 * `HTMLAudioElement`. Deliberately dependency-free (no audio libraries) and
 * resilient to the browser autoplay policy.
 *
 * Design:
 *  - One `Audio` element per hook instance is created lazily on the first
 *    `play()` (constructing it eagerly can trip some autoplay heuristics and
 *    wastes a request if the sound never fires).
 *  - Overlap prevention: instead of spawning a new element per play we reset
 *    `currentTime = 0` and re-`play()` the shared element, so rapid triggers
 *    cannot stack into a distorted wall of sound.
 *  - Cooldown: consecutive plays inside `cooldownMs` are dropped.
 *  - Safe fallback: `HTMLMediaElement.play()` returns a promise that rejects
 *    when playback is blocked (autoplay policy) or the file can't be decoded;
 *    we catch and ignore it so callers never need a try/catch.
 */
export function useSfx(src: string, options: UseSfxOptions = {}): SfxApi {
  const { volume = 1, cooldownMs = 500 } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedRef = useRef(0);

  // Keep volume in sync if it changes between renders.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Release the element on unmount so we don't leak a decoded buffer.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const play = useCallback(() => {
    // Guard against SSR / non-DOM environments.
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    const now = Date.now();
    if (now - lastPlayedRef.current < cooldownMs) return;
    lastPlayedRef.current = now;

    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = volume;
      audioRef.current = audio;
    }

    try {
      // Overlap prevention: restart the single shared element.
      audio.currentTime = 0;
      const result = audio.play();
      // Older browsers return undefined; modern ones return a promise that can
      // reject under the autoplay policy. Swallow either way.
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          /* autoplay blocked or decode failed, ignore, no sound is fine */
        });
      }
    } catch {
      /* extremely defensive: some engines throw synchronously, ignore */
    }
  }, [src, volume, cooldownMs]);

  return { play };
}
