/**
 * Pool: building a legal rack, and the seeded shuffle behind it.
 *
 * Pure and deterministic: the same seed builds the same table, which is what
 * lets a match be reproduced from `(seed, shots)` and what lets `rules.test.ts`
 * assert a break by calling a function rather than by watching a canvas.
 *
 * ## What makes a rack "legal" here
 *
 * Three constraints, which are the ones the real game's rack rule actually
 * cares about and no more:
 *
 *  1. the **8-ball sits in the middle of the third row**;
 *  2. the **two back corners are one solid and one stripe**;
 *  3. the remaining twelve are **shuffled**, so no two breaks are identical.
 *
 * Tournament racking also alternates solids and stripes throughout and requires
 * the apex ball on the foot spot. The apex is on the foot spot here; full
 * alternation is left out on purpose. It constrains the shuffle so heavily that
 * consecutive racks start to look the same, and no player has ever noticed it in
 * an arcade game.
 */

import {
  BALL_DIAMETER,
  FOOT_SPOT,
  HEAD_SPOT,
  RACK_GAP,
} from './table';
import { CUE_BALL, EIGHT_BALL, separateOverlaps, type PoolBall } from './physics';

/** Ball numbers 1–7. */
export const SOLID_NUMBERS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
/** Ball numbers 9–15. */
export const STRIPE_NUMBERS: readonly number[] = Object.freeze([9, 10, 11, 12, 13, 14, 15]);

/**
 * mulberry32: the same small PRNG `hockey/match.ts` uses, for the same reasons:
 * nine lines, no cryptographic strength needed, and a match's determinism should
 * not depend on a package version.
 */
export function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  a = a | 0;
  return { value, state: a };
}

/** Turn any string into a seed. Same string, same rack. */
export function poolSeedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher-Yates against the seeded generator. Returns the new generator state too. */
export function seededShuffle<T>(items: readonly T[], seed: number): { items: T[]; state: number } {
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

/**
 * The fifteen positions of a triangular rack, apex first, in reading order:
 * row 0 has one ball, row 4 has five.
 *
 * The rows advance along `+x` (away from the break end) and are spaced by the
 * triangle's height, `√3 · r`, which is what makes the balls in adjacent rows
 * touch rather than merely line up.
 */
export function rackPositions(): { x: number; y: number }[] {
  const pitch = BALL_DIAMETER + RACK_GAP;
  const rowStep = (Math.sqrt(3) / 2) * pitch;
  const spots: { x: number; y: number }[] = [];

  for (let row = 0; row < 5; row += 1) {
    const x = FOOT_SPOT.x + row * rowStep;
    // Centre each row on the long axis: a row of `row + 1` balls spans
    // `row · pitch`, so it starts half that above the centre line.
    const top = FOOT_SPOT.y - (row * pitch) / 2;
    for (let i = 0; i <= row; i += 1) {
      spots.push({ x, y: top + i * pitch });
    }
  }
  return spots;
}

/** Index into {@link rackPositions} of the middle ball of the third row. */
const EIGHT_BALL_SLOT = 4;
/** Indices of the two back-row corners. */
const BACK_LEFT_SLOT = 10;
const BACK_RIGHT_SLOT = 14;

export interface RackResult {
  readonly balls: readonly PoolBall[];
  /** The generator state after the shuffle, so the caller can carry it forward. */
  readonly rngState: number;
}

/**
 * Build a full, legal, at-rest table: the cue ball on the head spot and fifteen
 * object balls racked on the foot spot.
 *
 * `separateOverlaps` runs at the end. It should never have anything to do,
 * {@link RACK_GAP} leaves air between every pair, and it runs anyway, because a
 * rack that starts a thousandth of a unit interpenetrating is a rack that
 * explodes gently on the first step, and the cost of being certain is six passes
 * over 120 pairs, once per match.
 */
export function buildRack(seed: number): RackResult {
  const spots = rackPositions();

  // One solid and one stripe in the two back corners, drawn from the seeded
  // generator so which ones they are still varies.
  const solids = seededShuffle(SOLID_NUMBERS, seed);
  const stripes = seededShuffle(STRIPE_NUMBERS, solids.state);

  const backLeft = solids.items[0];
  const backRight = stripes.items[0];

  const remaining = seededShuffle(
    [...solids.items.slice(1), ...stripes.items.slice(1)],
    stripes.state,
  );

  const numbers: number[] = new Array(spots.length);
  numbers[EIGHT_BALL_SLOT] = EIGHT_BALL;
  numbers[BACK_LEFT_SLOT] = backLeft;
  numbers[BACK_RIGHT_SLOT] = backRight;

  let cursor = 0;
  for (let slot = 0; slot < numbers.length; slot += 1) {
    if (numbers[slot] !== undefined) continue;
    numbers[slot] = remaining.items[cursor];
    cursor += 1;
  }

  const objects: PoolBall[] = spots.map((spot, slot) => ({
    number: numbers[slot],
    x: spot.x,
    y: spot.y,
    vx: 0,
    vy: 0,
    pocketed: false,
  }));

  const cue: PoolBall = {
    number: CUE_BALL,
    x: HEAD_SPOT.x,
    y: HEAD_SPOT.y,
    vx: 0,
    vy: 0,
    pocketed: false,
  };

  return {
    balls: separateOverlaps([cue, ...objects]),
    rngState: remaining.state,
  };
}
