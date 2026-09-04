/**
 * Beach Treasure Hunt, seeded randomness.
 *
 * The same mulberry32 + FNV-1a pair that `src/arcade/hockey/match.ts` and
 * `src/arcade/pool/rack.ts` each carry, copied rather than imported: those
 * modules are arcade domain code, and the beach model must not depend on them
 * (the copies exist for the same reason, a game's determinism should not
 * depend on a package version, and nine lines do not justify a dependency).
 *
 * ## Seed representation
 *
 * The public seed is a **string** (easy to type into a dev harness, easy to
 * log, easy to correlate). `treasureSeedFrom` hashes it to the uint32 the
 * generator state actually is. The generator state is threaded functionally,
 * `nextRandom(state)` returns `{ value, state }`: so nothing here ever calls
 * `Math.random()` and the whole round stays reproducible from the seed.
 */

/** mulberry32: small, well-distributed, deterministic 32-bit PRNG. */
export function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  a = a | 0;
  return { value, state: a };
}

/** FNV-1a: turn any string into a uint32 seed. Same string, same round. */
export function treasureSeedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher-Yates against the seeded generator. Returns the new generator state too. */
export function seededShuffle<T>(
  items: readonly T[],
  seed: number
): { items: T[]; state: number } {
  const out = items.slice();
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const draw = nextRandom(state);
    state = draw.state;
    const k = Math.floor(draw.value * (i + 1));
    const swap = out[i];
    out[i] = out[k];
    out[k] = swap;
  }
  return { items: out, state };
}
