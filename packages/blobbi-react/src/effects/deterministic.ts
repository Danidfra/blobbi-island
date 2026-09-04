/**
 * DETERMINISTIC pseudo-randomness for effect particles.
 *
 * Particles need to look scattered. They must not BE scattered: `Math.random()`
 * during render would teleport every mote on any re-render, produce different
 * markup on a server than in the browser it hydrates into, and make "the output
 * for this input is X" untestable. So every varying number an effect uses comes
 * from this file: a pure hash of `(seed, index, field)`.
 *
 * Properties this guarantees, all of them asserted by `deterministic.test.ts`:
 *
 *  - **pure**: same arguments, same number, forever, in any runtime;
 *  - **well spread**: successive indices do not produce successive values, so
 *    a row of particles does not come out as a visible gradient;
 *  - **decorrelated per field**: a particle's `x` and its `delay` are drawn
 *    from different streams, so nothing lines up diagonally by accident;
 *  - **bounded**: `unitFor` is always in `[0, 1)`, so every `lerp` below stays
 *    inside the range the caller declared.
 *
 * The hash is FNV-1a over the composed key. It is not cryptographic and does
 * not need to be; it needs to be stable across engines, which a 32-bit integer
 * mixing function with explicit `>>> 0` truncation is.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a. Stable across engines because every step re-truncates. */
export function hashString(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // `Math.imul` keeps the multiply in 32-bit space; a plain `*` would lose
    // low bits to float rounding once the value exceeds 2^53.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A stable number in `[0, 1)` for one (seed, index, field) triple.
 *
 * `field` is what decorrelates the streams: `unitFor(s, 3, 'x')` and
 * `unitFor(s, 3, 'delay')` are unrelated, which is why a particle's position
 * and its timing do not correlate.
 */
export function unitFor(seed: string, index: number, field: string): number {
  // The separator matters: without it, ('a', 12, 'x') and ('a', 1, '2x') would
  // hash the same key and silently share a value.
  const hashed = hashString(`${seed}|${index}|${field}`);
  // A second mix stage. FNV alone leaves visible structure in the low bits for
  // keys that differ only in their last character, which is exactly our case,
  // since `index` usually differs by one.
  const mixed = (hashed ^ (hashed >>> 15)) >>> 0;
  return (Math.imul(mixed, 0x2545f491) >>> 8) / 0x01000000;
}

/** Linear interpolation. Exported because the presets read better with it. */
export function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/** A deterministic value in `[min, max)` for one (seed, index, field) triple. */
export function rangeFor(
  seed: string,
  index: number,
  field: string,
  min: number,
  max: number,
): number {
  return lerp(min, max, unitFor(seed, index, field));
}

/**
 * A deterministic value in `[min, max)`, rounded to `decimals`.
 *
 * Rounding is not cosmetic: it is what makes rendered markup comparable. An
 * unrounded value serializes as `13.827160492539406%`, and a snapshot of that
 * is unreadable and brittle against a change in the mixing constants that does
 * not change how anything looks.
 */
export function roundedRangeFor(
  seed: string,
  index: number,
  field: string,
  min: number,
  max: number,
  decimals = 2,
): number {
  const factor = 10 ** decimals;
  return Math.round(rangeFor(seed, index, field, min, max) * factor) / factor;
}

/**
 * A deterministic pick from a list.
 *
 * Used for per-particle colours. `list` must be non-empty; an empty list is a
 * preset bug, and returning `undefined` would push the failure into a CSS
 * string where it would render as the word "undefined".
 */
export function pickFor<T>(
  seed: string,
  index: number,
  field: string,
  list: readonly T[],
): T {
  if (list.length === 0) {
    throw new Error('pickFor: cannot pick from an empty list');
  }
  const position = Math.floor(unitFor(seed, index, field) * list.length);
  // `unitFor` is < 1 so this cannot overflow, but a clamp costs nothing and
  // turns a future off-by-one in the mixer into a wrong colour rather than an
  // `undefined` leaking into a style string.
  return list[Math.min(position, list.length - 1)];
}
