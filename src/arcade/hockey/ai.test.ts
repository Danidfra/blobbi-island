/**
 * Air Hockey opponent, the behaviour, and the limits it can never exceed.
 *
 * Two kinds of test, and the distinction is deliberate.
 *
 *  - **Limits** are absolute and asserted exactly: it cannot leave its half, it
 *    cannot outrun its profile, it cannot act on a frame's randomness. These are
 *    guarantees.
 *  - **Behaviour** is asserted as tendency: it defends its goal, it comes out
 *    for a loose puck, it does not simply mirror the puck. These are the
 *    properties that make it feel like an opponent, and pinning them to exact
 *    coordinates would mean any tuning change breaks a test that was never
 *    really about correctness.
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_HOCKEY_DIFFICULTY,
  HOCKEY_AI_PROFILES,
  HOCKEY_DIFFICULTIES,
  createHockeyAiState,
  hockeyAiProfile,
  isHockeyDifficulty,
  stepHockeyAi,
  type HockeyAiState,
} from './ai';
import type { MalletState, PuckState } from './physics';
import {
  FIXED_STEP_MS,
  MALLET_RADIUS,
  OPPONENT_HOME,
  PLAYER_MALLET_MAX_STRIKE_SPEED,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './table';

const DT = FIXED_STEP_MS / 1000;
const PROFILE = hockeyAiProfile('normal');

const puck = (over: Partial<PuckState> = {}): PuckState => ({
  x: TABLE_CENTER_X,
  y: TABLE_CENTER_Y,
  vx: 0,
  vy: 0,
  ...over,
});

const mallet = (over: Partial<MalletState> = {}): MalletState => ({
  x: OPPONENT_HOME.x,
  y: OPPONENT_HOME.y,
  vx: 0,
  vy: 0,
  ...over,
});

/** A deterministic stand-in for the match's seeded generator. */
function fixedRandom(value = 0.5) {
  return () => value;
}

/**
 * Run the controller until its perception has caught up, so a test asserts what
 * the opponent DOES rather than how long it takes to notice.
 */
function settle(
  world: { puck: PuckState; mallet: MalletState },
  steps = 240,
  profile = PROFILE,
): { state: HockeyAiState; target: { x: number; y: number }; arriveRadius: number } {
  let state = createHockeyAiState(world.puck);
  let out = stepHockeyAi({
    state,
    puck: world.puck,
    mallet: world.mallet,
    profile,
    dt: DT,
    random: fixedRandom(),
  });
  for (let i = 0; i < steps; i += 1) {
    state = out.state;
    out = stepHockeyAi({
      state,
      puck: world.puck,
      mallet: world.mallet,
      profile,
      dt: DT,
      random: fixedRandom(),
    });
  }
  return out;
}

describe('difficulty profiles', () => {
  it('ships Easy and Normal, and defaults to Normal', () => {
    expect([...HOCKEY_DIFFICULTIES]).toEqual(['easy', 'normal']);
    expect(DEFAULT_HOCKEY_DIFFICULTY).toBe('normal');
  });

  it('recognises its own difficulties and nothing else', () => {
    expect(isHockeyDifficulty('easy')).toBe(true);
    expect(isHockeyDifficulty('normal')).toBe(true);
    // `hard` is a valid arcade difficulty with no hockey profile behind it yet;
    // accepting it would mean a profile lookup returning undefined at runtime.
    expect(isHockeyDifficulty('hard')).toBe(false);
    expect(isHockeyDifficulty(undefined)).toBe(false);
  });

  it('makes Easy strictly gentler than Normal on every axis it varies', () => {
    const easy = HOCKEY_AI_PROFILES.easy;
    const normal = HOCKEY_AI_PROFILES.normal;
    expect(easy.maxSpeed).toBeLessThan(normal.maxSpeed);
    expect(easy.reactionMs).toBeGreaterThan(normal.reactionMs);
    expect(easy.predictionSkill).toBeLessThan(normal.predictionSkill);
    expect(easy.readError).toBeGreaterThan(normal.readError);
  });

  it('never lets the opponent hit as hard as the player can', () => {
    // The player's mallet is not speed-limited at all any more; it is wherever
    // the pointer is, so the comparison is against the strike clamp, which is
    // the only bound either side actually shares. The opponent must stay under
    // it: it steers by arithmetic and the player by hand, and that advantage is
    // what keeps a human opponent's imprecision fair.
    for (const id of HOCKEY_DIFFICULTIES) {
      expect(hockeyAiProfile(id).maxSpeed).toBeLessThan(PLAYER_MALLET_MAX_STRIKE_SPEED);
    }
  });
});

describe('movement boundaries', () => {
  const EXTREMES: PuckState[] = [
    puck({ x: 0, y: 0 }),
    puck({ x: TABLE_WIDTH, y: TABLE_HEIGHT }),
    puck({ x: -500, y: -500, vx: -900, vy: -900 }),
    puck({ x: 9999, y: 9999, vx: 900, vy: 900 }),
    puck({ x: TABLE_CENTER_X, y: TABLE_HEIGHT - 5, vy: -400 }),
  ];

  it('never targets a point outside its own half, whatever the puck does', () => {
    for (const p of EXTREMES) {
      for (const id of HOCKEY_DIFFICULTIES) {
        const { target } = settle({ puck: p, mallet: mallet() }, 60, hockeyAiProfile(id));
        expect(target.x).toBeGreaterThanOrEqual(MALLET_RADIUS);
        expect(target.x).toBeLessThanOrEqual(TABLE_WIDTH - MALLET_RADIUS);
        expect(target.y).toBeGreaterThanOrEqual(MALLET_RADIUS);
        expect(target.y).toBeLessThanOrEqual(TABLE_CENTER_Y);
      }
    }
  });

  it('always produces a finite target', () => {
    const { target } = settle({ puck: puck({ x: Number.NaN }), mallet: mallet() }, 10);
    expect(Number.isFinite(target.x)).toBe(true);
    expect(Number.isFinite(target.y)).toBe(true);
  });
});

describe('perception lags, so a shot can beat it', () => {
  it('does not jump to a puck that has just moved', () => {
    const state = createHockeyAiState(puck({ x: 10, y: 40 }));
    const jumped = stepHockeyAi({
      state,
      puck: puck({ x: 90, y: 40 }),
      mallet: mallet(),
      profile: PROFILE,
      dt: DT,
      random: fixedRandom(),
    });
    // One 8 ms step moves its belief a fraction of the way, not all of it.
    expect(jumped.state.perceived.x).toBeLessThan(20);
    expect(jumped.state.perceived.x).toBeGreaterThan(10);
  });

  it('catches up eventually', () => {
    const settled = settle({ puck: puck({ x: 90, y: 40 }), mallet: mallet() });
    expect(settled.state.perceived.x).toBeCloseTo(90, 1);
  });

  it('lags further on Easy than on Normal', () => {
    const believed = (profile: typeof PROFILE) => {
      // Start the belief on the LEFT and move the real puck to the right, so
      // what is measured is how fast each profile notices.
      let state = createHockeyAiState(puck({ x: 10, y: 40 }));
      for (let i = 0; i < 12; i += 1) {
        state = stepHockeyAi({
          state,
          puck: puck({ x: 90, y: 40 }),
          mallet: mallet(),
          profile,
          dt: DT,
          random: fixedRandom(),
        }).state;
      }
      return state.perceived.x;
    };
    expect(believed(HOCKEY_AI_PROFILES.easy)).toBeLessThan(
      believed(HOCKEY_AI_PROFILES.normal),
    );
  });
});

describe('decisions are held, not re-rolled every frame', () => {
  it('keeps a mode for at least its decision interval', () => {
    let state = createHockeyAiState(puck({ y: 40 }));
    // Advance once so a mode is chosen and the timer is armed.
    state = stepHockeyAi({
      state,
      puck: puck({ y: 40 }),
      mallet: mallet(),
      profile: PROFILE,
      dt: DT,
      random: fixedRandom(),
    }).state;
    const chosen = state.mode;

    // Flip the world to something that would demand a different mode.
    const flipped = puck({ y: TABLE_HEIGHT - 10, vy: 200 });
    const next = stepHockeyAi({
      state,
      puck: flipped,
      mallet: mallet(),
      profile: PROFILE,
      dt: DT,
      random: fixedRandom(),
    });
    expect(next.state.mode).toBe(chosen);
    expect(next.state.decisionTimerMs).toBeLessThan(PROFILE.decisionIntervalMs);
  });

  it('is completely deterministic for the same inputs', () => {
    // No `Math.random`, ever: the only randomness is the caller's seeded draw,
    // which is what makes the whole match reproducible.
    const world = { puck: puck({ x: 30, y: 30, vx: 40, vy: -60 }), mallet: mallet() };
    expect(settle(world, 100)).toEqual(settle(world, 100));
  });
});

describe('behaviour', () => {
  it('defends its own end when the player has the puck', () => {
    const { state, target } = settle({
      puck: puck({ x: TABLE_CENTER_X, y: TABLE_HEIGHT - 30, vy: 20 }),
      mallet: mallet(),
    });
    expect(state.mode).toBe('defend');
    // Near its own goal line, never wandering up the table.
    expect(target.y).toBeLessThan(TABLE_CENTER_Y / 2);
  });

  it('does not mirror the puck’s x; it covers the angle instead', () => {
    // A mirror is the behaviour that reads as robotic and leaves the far post
    // open on every cross. Covering the goal-to-puck line does not.
    const wide = 6;
    const { target } = settle({
      puck: puck({ x: wide, y: TABLE_HEIGHT - 30 }),
      mallet: mallet(),
    });
    expect(Math.abs(target.x - wide)).toBeGreaterThan(10);
    // Still shaded toward the puck's side, though; it is not ignoring it.
    expect(target.x).toBeLessThan(TABLE_CENTER_X);
  });

  it('comes out to meet a puck driven at its goal', () => {
    const { state, target } = settle({
      puck: puck({ x: TABLE_CENTER_X, y: 70, vy: -140 }),
      mallet: mallet(),
    });
    expect(state.mode).toBe('intercept');
    expect(target.y).toBeGreaterThan(hockeyAiProfile('normal').defendY);
  });

  it('attacks a slow loose puck in its own half wherever it is', () => {
    // Without this, two cautious opponents both sat on their lines while the
    // puck drifted around the centre spot for four hundred simulated seconds.
    const { state } = settle({
      puck: puck({ x: TABLE_CENTER_X, y: TABLE_CENTER_Y - 5, vx: 5, vy: 5 }),
      mallet: mallet(),
    });
    expect(state.mode).toBe('strike');
  });

  it('goes home when the puck has got behind it', () => {
    const { state, target } = settle({
      puck: puck({ x: TABLE_CENTER_X, y: 8 }),
      mallet: mallet({ y: 40 }),
    });
    expect(state.mode).toBe('recover');
    expect(target).toEqual({ x: OPPONENT_HOME.x, y: OPPONENT_HOME.y });
  });

  it('drives THROUGH the puck when it shoots, rather than stopping at it', () => {
    // The missing half of a shot. Targeting the point just behind the puck
    // produced an opponent that touched it constantly and never scored.
    const world = {
      puck: puck({ x: TABLE_CENTER_X, y: 45, vx: 2, vy: 2 }),
      mallet: mallet({ y: 20 }),
    };
    const { state, target, arriveRadius } = settle(world);
    expect(state.mode).toBe('strike');
    // Past the puck, toward the player's end.
    expect(target.y).toBeGreaterThan(world.puck.y);
    // And at full speed, easing in is what turns a shot into a tap.
    expect(arriveRadius).toBe(0);
  });

  it('sets up behind the puck first when it is on the wrong side of it', () => {
    // Level with the puck rather than well past it, past it is `recover`,
    // which is a different problem with a different answer.
    const world = {
      puck: puck({ x: TABLE_CENTER_X, y: 45, vx: 2, vy: 2 }),
      mallet: mallet({ y: 49 }),
    };
    const { state, target } = settle(world);
    expect(state.mode).toBe('strike');
    expect(target.y).toBeLessThan(world.puck.y);
  });

  it('eases in when it is positioning, so it settles instead of vibrating', () => {
    const { arriveRadius } = settle({
      puck: puck({ x: TABLE_CENTER_X, y: TABLE_HEIGHT - 30 }),
      mallet: mallet(),
    });
    expect(arriveRadius).toBeGreaterThan(0);
  });
});
