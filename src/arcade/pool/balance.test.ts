/**
 * Pool: is it a game worth playing?
 *
 * Correctness is covered by `match.test.ts` and `rules.test.ts`. This file asks
 * the questions those cannot: **does a frame end?**, **does it end in a
 * reasonable time?**, and **is the rival beatable but not a pushover?**
 *
 * It answers them by playing whole frames. The player's seat is driven by the
 * SAME planner the rival uses, at a chosen difficulty, which makes "a Normal
 * player against an Easy rival" a measurable thing rather than a hope. Every
 * frame is seeded, so a regression here is reproducible rather than flaky.
 *
 * ## Why this exists at all
 *
 * The first version of the planner played every frame to a five-hundred-shot
 * stalemate: it could not break, and its fallback shot was a tap that dislodged
 * nothing. Every unit test passed. Only playing whole frames found it, and this
 * file is what would find it again.
 *
 * The thresholds are deliberately loose. They are there to catch a game that
 * has stopped working, not to pin the exact numbers a tuning pass produces.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  applyPlayerShot,
  createPoolMatch,
  placePlayerCueBall,
  stepPoolMatch,
  type PoolMatchState,
} from './match';
import { FIXED_STEP_MS, TYPICAL_POOL_MATCH_MS } from './table';
import { planPoolShot, poolAiProfile, type PoolDifficulty } from './ai';
import { nextRandom } from './rack';
import { summarisePoolMatch } from './pool-result';
import { createPoolPhysicsWorld } from './pool-physics-world';

const DT = FIXED_STEP_MS / 1000;

/** Enough seeds to separate a real difference from noise, and no more. */
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7717 + 11);

interface FrameOutcome {
  readonly state: PoolMatchState;
  readonly finished: boolean;
}

/** Play one whole frame, with `seat` driving the player and `rival` the opponent. */
function playFrame(seed: number, rival: PoolDifficulty, seat: PoolDifficulty): FrameOutcome {
  let state = createPoolMatch({ difficulty: rival, seed });

  // One world per frame, disposed at the end: a frame must not be able to
  // inherit a body from the one before it.
  const world = createPoolPhysicsWorld();
  world.reset(state.balls);

  // The player's own generator, separate from the match's, so the two sides
  // never draw from the same stream and accidentally correlate.
  let rng = seed ^ 0x9e3779b9;
  const random = () => {
    const draw = nextRandom(rng);
    rng = draw.state;
    return draw.value;
  };

  let steps = 0;
  const MAX_STEPS = 400_000; // ~55 simulated minutes; a real frame needs ~3

  while (state.phase !== 'over' && steps < MAX_STEPS) {
    if (state.turn === 'player' && (state.phase === 'aiming' || state.phase === 'ball-in-hand')) {
      if (state.phase === 'ball-in-hand') state = placePlayerCueBall(state, world);
      const plan = planPoolShot({
        balls: state.balls,
        group: state.assignment.player,
        ballInHand: false,
        profile: poolAiProfile(seat),
        random,
        isBreak: !state.broken,
      });
      state = applyPlayerShot(state, plan.angle, plan.power, world).state;
      continue;
    }
    state = stepPoolMatch(state, DT, world).state;
    steps += 1;
  }

  world.dispose();
  return { state, finished: state.phase === 'over' };
}

interface Tally {
  readonly wins: number;
  readonly frames: number;
  readonly unfinished: number;
  readonly averageMs: number;
  readonly longestMs: number;
  readonly seatPotRate: number;
  readonly rivalPotRate: number;
}

/**
 * Every matchup, played once in `beforeAll` rather than lazily inside the first
 * test that needs it.
 *
 * Seventy-two whole frames is a few seconds of simulation, and attributing it to
 * whichever assertion happened to run first made that test time out under the
 * full suite's parallel load while passing on its own. It is fixture work, so it
 * belongs in a hook with a fixture-sized budget; the assertions are then
 * instant.
 */
const TALLIES = new Map<string, Tally>();
const MATCHUPS: readonly (readonly [PoolDifficulty, PoolDifficulty])[] = [
  ['easy', 'normal'],
  ['normal', 'normal'],
  ['easy', 'easy'],
];

beforeAll(() => {
  for (const [rival, seat] of MATCHUPS) TALLIES.set(`${rival}/${seat}`, measure(rival, seat));
}, 120_000);

function tally(rival: PoolDifficulty, seat: PoolDifficulty): Tally {
  const cached = TALLIES.get(`${rival}/${seat}`);
  if (!cached) throw new Error(`no tally for ${rival}/${seat}, add it to MATCHUPS`);
  return cached;
}

function measure(rival: PoolDifficulty, seat: PoolDifficulty): Tally {
  let wins = 0;
  let unfinished = 0;
  let totalMs = 0;
  let longestMs = 0;
  let seatShots = 0;
  let seatPots = 0;
  let rivalShots = 0;
  let rivalPots = 0;

  for (const seed of SEEDS) {
    const { state, finished } = playFrame(seed, rival, seat);
    if (!finished) unfinished += 1;
    if (summarisePoolMatch(state).outcome === 'win') wins += 1;
    totalMs += state.elapsedMs;
    longestMs = Math.max(longestMs, state.elapsedMs);
    seatShots += state.stats.playerShots;
    seatPots += state.stats.playerSuccessfulShots;
    rivalShots += state.stats.opponentShots;
    rivalPots += state.stats.opponentSuccessfulShots;
  }

  const result: Tally = {
    wins,
    frames: SEEDS.length,
    unfinished,
    averageMs: totalMs / SEEDS.length,
    longestMs,
    seatPotRate: seatShots === 0 ? 0 : seatPots / seatShots,
    rivalPotRate: rivalShots === 0 ? 0 : rivalPots / rivalShots,
  };
  return result;
}

describe('a frame always ends', () => {
  it.each(['easy', 'normal'] as const)('against a %s rival', (rival) => {
    // The regression this file was written for. A frame that cannot end is not
    // a hard game, it is a broken one.
    expect(tally(rival, 'normal').unfinished).toBe(0);
  });

  it('ends even when both sides are weak', () => {
    // Two Easy planners refuse thin cuts, so they fall through to the fallback
    // knock far more often, which is exactly the situation that used to
    // deadlock.
    expect(tally('easy', 'easy').unfinished).toBe(0);
  });
});

describe('a frame takes about as long as the machine promises', () => {
  it('averages within sight of the estimate on the machine’s card', () => {
    const result = tally('normal', 'normal');
    // The simulated clock excludes a human's thinking time, so it should sit
    // BELOW the advertised figure rather than on it.
    expect(result.averageMs).toBeLessThan(TYPICAL_POOL_MATCH_MS);
    expect(result.averageMs).toBeGreaterThan(60_000);
  });

  it('has no runaway frames', () => {
    expect(tally('normal', 'normal').longestMs).toBeLessThan(TYPICAL_POOL_MATCH_MS * 4);
  });
});

describe('the rival is beatable, and worth beating', () => {
  it('pots less often on Easy than on Normal', () => {
    // The difficulty knobs must show up in play, not just in the profile table.
    expect(tally('easy', 'normal').rivalPotRate).toBeLessThan(
      tally('normal', 'normal').rivalPotRate,
    );
  });

  /*
    There is deliberately no assertion here on "the player WINS more often
    against Easy".

    It is true: measured over 40 seeds it is about 68% against Easy and 58%
    against Normal: but it is not a signal a test can stand on. A frame's
    outcome is dominated by who happens to get the first run of three or four
    pots, so the win count carries roughly ±10 points of noise at any seed count
    this suite can afford, and the difference it is trying to detect is about
    the same size. Asserting it would produce a test that fails a few times a
    year for no reason, which is worse than not asserting it.

    The pot rate above measures the same thing directly and does not move.
  */

  it('is beatable without being a pushover', () => {
    // A Normal player against a Normal rival should be winning more than half,
    // they get the break, but nowhere near all of them.
    const result = tally('normal', 'normal');
    expect(result.wins / result.frames).toBeGreaterThan(0.4);
    expect(result.wins / result.frames).toBeLessThan(0.85);
  });

  it('actually pots balls rather than nudging them around', () => {
    // The stalemate had a pot rate of zero. Anything above a tenth of shots is
    // a game being played.
    const result = tally('normal', 'normal');
    expect(result.rivalPotRate).toBeGreaterThan(0.1);
    expect(result.seatPotRate).toBeGreaterThan(0.1);
  });
});
