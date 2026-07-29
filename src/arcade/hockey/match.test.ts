/**
 * Air Hockey match — the state machine, and the invariants a fair game needs.
 *
 * The whole match is one pure function over plain numbers, so a point can be
 * played, a goal counted and a match decided by calling `stepHockeyMatch` in a
 * loop. No canvas, no frames, no clock. The awkward questions — "can the same
 * goal score twice?", "can a pointer flung off screen break anything?", "does a
 * match ever fail to end?" — are all answerable here, which is exactly why the
 * simulation is not inside the component.
 */

import { describe, it, expect } from 'vitest';

import {
  countdownSeconds,
  createHockeyMatch,
  hockeySeedFrom,
  isMatchOver,
  matchWinner,
  stepHockeyMatch,
  type HockeyEvent,
  type HockeyMatchState,
} from './match';
import {
  COUNTDOWN_MS,
  FIXED_STEP_MS,
  GOAL_PAUSE_MS,
  MALLET_RADIUS,
  MATCH_GOAL_TARGET,
  PUCK_RADIUS,
  PLAYER_HOME,
  PUCK_MAX_SPEED,
  SERVE_DELAY_MS,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from './table';
import { speedOf, type Vec2 } from './physics';
import { hockeyAiProfile } from './ai';

const DT = FIXED_STEP_MS / 1000;
const HOLD: Vec2 = PLAYER_HOME;

/** Step `n` times, collecting every event, with a fixed player input. */
function run(
  state: HockeyMatchState,
  n: number,
  target: (s: HockeyMatchState, i: number) => Vec2 = () => HOLD,
): { state: HockeyMatchState; events: HockeyEvent[] } {
  const events: HockeyEvent[] = [];
  let current = state;
  for (let i = 0; i < n; i += 1) {
    const outcome = stepHockeyMatch(current, DT, { playerTarget: target(current, i) });
    current = outcome.state;
    events.push(...outcome.events);
  }
  return { state: current, events };
}

const stepsFor = (ms: number) => Math.ceil(ms / FIXED_STEP_MS) + 2;

/** A puck placed on the opponent's goal line, one step from being a goal. */
function aboutToScore(state: HockeyMatchState, scorer: 'player' | 'opponent'): HockeyMatchState {
  return {
    ...state,
    phase: 'live',
    puck: {
      x: TABLE_CENTER_X,
      y: scorer === 'player' ? 8 : TABLE_HEIGHT - 8,
      vx: 0,
      vy: scorer === 'player' ? -120 : 120,
    },
  };
}

describe('a new match', () => {
  it('starts in the countdown with nothing scored', () => {
    const match = createHockeyMatch();
    expect(match.phase).toBe('countdown');
    expect(match.playerScore).toBe(0);
    expect(match.opponentScore).toBe(0);
    expect(match.targetGoals).toBe(MATCH_GOAL_TARGET);
    expect(match.lastScorer).toBeNull();
    expect(countdownSeconds(match)).toBe(Math.ceil(COUNTDOWN_MS / 1000));
  });

  it('is plain JSON, so a whole match survives a round trip', () => {
    // The same rule `ArcadeGameResult` follows: nothing in the state may be a
    // live object, or a match could not be serialised, replayed or compared.
    const match = run(createHockeyMatch({ seed: 3 }), 600).state;
    expect(JSON.parse(JSON.stringify(match))).toEqual(match);
  });

  it('is fully determined by its seed', () => {
    const a = run(createHockeyMatch({ seed: 42 }), 1200).state;
    const b = run(createHockeyMatch({ seed: 42 }), 1200).state;
    expect(a).toEqual(b);
  });

  it('produces a different match from a different seed', () => {
    const a = run(createHockeyMatch({ seed: 1 }), 1200).state;
    const b = run(createHockeyMatch({ seed: 999 }), 1200).state;
    expect(a.puck).not.toEqual(b.puck);
  });

  it('derives a stable seed from a run id', () => {
    expect(hockeySeedFrom('hockey-abc')).toBe(hockeySeedFrom('hockey-abc'));
    expect(hockeySeedFrom('hockey-abc')).not.toBe(hockeySeedFrom('hockey-abd'));
  });

  it('does not always serve to the same side', () => {
    const sides = new Set(
      Array.from({ length: 20 }, (_, i) => createHockeyMatch({ seed: i * 7919 }).serveTo),
    );
    expect(sides.size).toBe(2);
  });
});

describe('the countdown', () => {
  it('freezes the puck until it ends', () => {
    const half = run(createHockeyMatch(), stepsFor(COUNTDOWN_MS / 2)).state;
    expect(half.phase).toBe('countdown');
    expect(speedOf(half.puck)).toBe(0);
  });

  it('lets both mallets reposition while it runs', () => {
    const ready = run(createHockeyMatch(), 60, () => ({ x: 20, y: TABLE_HEIGHT - 20 })).state;
    expect(ready.playerMallet.x).toBeLessThan(PLAYER_HOME.x);
  });

  it('announces each whole second, then serves exactly once', () => {
    const { state, events } = run(createHockeyMatch(), stepsFor(COUNTDOWN_MS));
    const ticks = events.filter((e) => e.type === 'countdown');
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.type === 'countdown-complete')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'serve')).toHaveLength(1);
    expect(state.phase).toBe('live');
    expect(speedOf(state.puck)).toBeGreaterThan(0);
  });

  it('has no countdown reading once play begins', () => {
    const live = run(createHockeyMatch(), stepsFor(COUNTDOWN_MS)).state;
    expect(countdownSeconds(live)).toBeNull();
  });
});

describe('goals', () => {
  it('are counted exactly once, however long the goal pause runs', () => {
    // The invariant the phase change exists for: detection only happens in
    // `live`, and scoring leaves `live` in the same step, so the puck sitting
    // in the goal cannot be re-detected on any later step.
    const start = aboutToScore(createHockeyMatch(), 'player');
    const { state, events } = run(start, stepsFor(GOAL_PAUSE_MS) + 200);

    expect(events.filter((e) => e.type === 'goal')).toHaveLength(1);
    expect(state.playerScore).toBe(1);
    expect(state.opponentScore).toBe(0);
  });

  it('freeze the puck and record who scored', () => {
    const { state } = run(aboutToScore(createHockeyMatch(), 'opponent'), 12);
    expect(state.phase).toBe('goal');
    expect(state.opponentScore).toBe(1);
    expect(state.lastScorer).toBe('opponent');
    expect(speedOf(state.puck)).toBe(0);
  });

  it('reset the puck to the centre spot and serve again', () => {
    const scored = run(aboutToScore(createHockeyMatch(), 'player'), 12).state;
    const paused = run(scored, stepsFor(GOAL_PAUSE_MS)).state;
    expect(paused.phase).toBe('serve');
    expect(paused.puck.x).toBe(TABLE_CENTER_X);
    expect(paused.puck.y).toBe(TABLE_CENTER_Y);
    expect(speedOf(paused.puck)).toBe(0);

    const served = run(paused, stepsFor(SERVE_DELAY_MS));
    expect(served.state.phase).toBe('live');
    expect(served.events.filter((e) => e.type === 'serve')).toHaveLength(1);
    expect(speedOf(served.state.puck)).toBeGreaterThan(0);
  });

  it('hand the next serve to the side that conceded', () => {
    // Self-correcting, and the reason the serve can never be a repeated
    // advantage: whoever is being beaten keeps getting the puck.
    const playerScored = run(aboutToScore(createHockeyMatch(), 'player'), 12).state;
    expect(playerScored.serveTo).toBe('opponent');

    const opponentScored = run(aboutToScore(createHockeyMatch(), 'opponent'), 12).state;
    expect(opponentScored.serveTo).toBe('player');
  });

  it('send the puck toward the side being served', () => {
    const conceded = run(aboutToScore(createHockeyMatch(), 'opponent'), 12).state;
    const live = run(conceded, stepsFor(GOAL_PAUSE_MS + SERVE_DELAY_MS)).state;
    expect(live.phase).toBe('live');
    // `serveTo` is the player, and the player's end is the bottom (+y).
    expect(live.puck.vy).toBeGreaterThan(0);
  });
});

describe('the end of a match', () => {
  it('is reached when a side hits the target, and is terminal', () => {
    const matchPoint: HockeyMatchState = {
      ...createHockeyMatch({ targetGoals: 3 }),
      playerScore: 2,
    };
    const { state, events } = run(aboutToScore(matchPoint, 'player'), stepsFor(GOAL_PAUSE_MS) + 20);

    expect(state.phase).toBe('over');
    expect(state.playerScore).toBe(3);
    expect(isMatchOver(state)).toBe(true);
    expect(matchWinner(state)).toBe('player');
    expect(events.filter((e) => e.type === 'match-over')).toHaveLength(1);
  });

  it('changes nothing once it is over, however long the loop keeps running', () => {
    const decided: HockeyMatchState = {
      ...createHockeyMatch({ targetGoals: 1 }),
      phase: 'over',
      playerScore: 1,
    };
    const after = run(decided, 500);
    expect(after.state).toBe(decided);
    expect(after.events).toHaveLength(0);
  });

  it('has no winner before it is decided', () => {
    expect(matchWinner(createHockeyMatch())).toBeNull();
  });

  it('names the opponent as the winner when the opponent reaches the target', () => {
    const matchPoint: HockeyMatchState = {
      ...createHockeyMatch({ targetGoals: 2 }),
      opponentScore: 1,
    };
    const decided = run(aboutToScore(matchPoint, 'opponent'), stepsFor(GOAL_PAUSE_MS) + 20).state;
    expect(matchWinner(decided)).toBe('opponent');
  });
});

describe('movement limits, under any input at all', () => {
  /** Deliberately hostile: teleporting, out-of-bounds, non-finite targets. */
  const hostileTarget = (_: HockeyMatchState, i: number): Vec2 => {
    if (i % 97 === 0) return { x: Number.NaN, y: Number.NaN };
    if (i % 31 === 0) return { x: -9_999, y: -9_999 };
    if (i % 17 === 0) return { x: 9_999, y: 9_999 };
    return { x: (i * 37) % 200 - 50, y: ((i * 53) % 400) - 100 };
  };

  it('never lets the player leave their own half or the table', () => {
    let state = createHockeyMatch({ seed: 7 });
    for (let i = 0; i < 6_000; i += 1) {
      state = stepHockeyMatch(state, DT, { playerTarget: hostileTarget(state, i) }).state;
      const { x, y } = state.playerMallet;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
      expect(x).toBeLessThanOrEqual(TABLE_WIDTH - MALLET_RADIUS + 1e-9);
      expect(y).toBeGreaterThanOrEqual(TABLE_CENTER_Y - 1e-9);
      expect(y).toBeLessThanOrEqual(TABLE_HEIGHT - MALLET_RADIUS + 1e-9);
    }
  });

  it('never lets the opponent cross into the player’s half', () => {
    let state = createHockeyMatch({ seed: 11 });
    for (let i = 0; i < 6_000; i += 1) {
      state = stepHockeyMatch(state, DT, { playerTarget: hostileTarget(state, i) }).state;
      const { x, y } = state.opponentMallet;
      expect(y).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
      expect(y).toBeLessThanOrEqual(TABLE_CENTER_Y + 1e-9);
      expect(x).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
      expect(x).toBeLessThanOrEqual(TABLE_WIDTH - MALLET_RADIUS + 1e-9);
    }
  });

  it('never lets a hostile pointer make the puck unstable or lose it', () => {
    let state = createHockeyMatch({ seed: 13 });
    let slowRun = 0;
    for (let i = 0; i < 20_000; i += 1) {
      state = stepHockeyMatch(state, DT, { playerTarget: hostileTarget(state, i) }).state;
      const { x, y } = state.puck;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(speedOf(state.puck)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
      // Never outside the table, allowing for the goal mouths' small overshoot.
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(TABLE_WIDTH);
      expect(y).toBeGreaterThanOrEqual(-15);
      expect(y).toBeLessThanOrEqual(TABLE_HEIGHT + 15);

      if (state.phase === 'live') {
        slowRun = speedOf(state.puck) < 10 ? slowRun + 1 : 0;
        // A live puck may never crawl for a whole second: that is the stall the
        // minimum-speed rule exists to prevent.
        expect(slowRun).toBeLessThan(120);
      }
    }
  });

  it('never leaves the puck trapped inside a mallet', () => {
    let state = createHockeyMatch({ seed: 17 });
    for (let i = 0; i < 8_000; i += 1) {
      // Drive the mallet straight at the puck every step: the worst case for a
      // separation rule, and the one that produced a carried puck before the
      // anti-stick floor existed.
      state = stepHockeyMatch(state, DT, {
        playerTarget: { x: state.puck.x, y: state.puck.y },
      }).state;
      if (state.phase !== 'live') continue;
      const gap = Math.hypot(
        state.puck.x - state.playerMallet.x,
        state.puck.y - state.playerMallet.y,
      );
      // The resolution places the puck exactly `PUCK_RADIUS + MALLET_RADIUS`
      // away; one step of mallet travel (2.5 units) is the most it can close
      // before the next step pushes it out again.
      expect(gap).toBeGreaterThan(PUCK_RADIUS + MALLET_RADIUS - 3);
    }
  });
});

describe('player input is immediate', () => {
  it('puts the mallet exactly where the pointer asked, in one step', () => {
    // The responsiveness contract, at match level. Before this, the mallet was
    // rate-limited and needed 19 steps to cross the player's half.
    const asked = { x: 90, y: TABLE_HEIGHT - 10 };
    const { state } = stepHockeyMatch(createHockeyMatch(), DT, { playerTarget: asked });
    expect(state.playerMallet.x).toBeCloseTo(asked.x, 6);
    expect(state.playerMallet.y).toBeCloseTo(asked.y, 6);
  });

  it('tracks a pointer that changes direction every step', () => {
    // Fast direction changes are where a smoothed or rate-limited mallet falls
    // furthest behind; here it must be on the spot every time.
    let state = createHockeyMatch({ seed: 3 });
    for (let i = 0; i < 40; i += 1) {
      const asked = { x: i % 2 === 0 ? 12 : 88, y: TABLE_HEIGHT - 20 };
      state = stepHockeyMatch(state, DT, { playerTarget: asked }).state;
      expect(state.playerMallet.x).toBeCloseTo(asked.x, 6);
    }
  });

  it('cannot jump THROUGH the puck, however far the pointer moves', () => {
    // The property the removed speed limit used to provide, now provided by the
    // swept resolver — and provided better, because it also covers a genuine
    // teleport rather than merely making one impossible.
    const parked: HockeyMatchState = {
      ...createHockeyMatch({ seed: 9 }),
      phase: 'live',
      puck: { x: 50, y: 120, vx: 0, vy: 0 },
      playerMallet: { x: 50, y: 152, vx: 0, vy: 0 },
    };
    // One step, pointer flung from below the puck to well above it.
    const { state, events } = stepHockeyMatch(parked, DT, {
      playerTarget: { x: 50, y: TABLE_CENTER_Y },
    });

    expect(events.some((e) => e.type === 'mallet' && e.side === 'player')).toBe(true);
    // Struck up the table, toward the opponent.
    expect(state.puck.vy).toBeLessThan(0);
    // And still inside the speed band, so a teleport cannot launch it.
    expect(speedOf(state.puck)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
  });

  it('never produces an out-of-band puck speed from a flicking pointer', () => {
    let state = createHockeyMatch({ seed: 5 });
    for (let i = 0; i < 4_000; i += 1) {
      // Corner to corner, every single step: far faster than any hand.
      const asked =
        i % 2 === 0
          ? { x: MALLET_RADIUS, y: TABLE_CENTER_Y }
          : { x: TABLE_WIDTH - MALLET_RADIUS, y: TABLE_HEIGHT - MALLET_RADIUS };
      state = stepHockeyMatch(state, DT, { playerTarget: asked }).state;
      expect(speedOf(state.puck)).toBeLessThanOrEqual(PUCK_MAX_SPEED + 1e-6);
      expect(Number.isFinite(state.puck.x) && Number.isFinite(state.puck.y)).toBe(true);
    }
  });
});

describe('recovery', () => {
  it('re-serves rather than continuing with an impossible puck', () => {
    const broken: HockeyMatchState = {
      ...createHockeyMatch(),
      phase: 'live',
      puck: { x: Number.NaN, y: 40, vx: 10, vy: 10 },
    };
    const { state, events } = stepHockeyMatch(broken, DT, { playerTarget: HOLD });

    expect(events.some((e) => e.type === 'recovered')).toBe(true);
    expect(state.phase).toBe('serve');
    expect(state.puck.x).toBe(TABLE_CENTER_X);
    expect(state.puck.y).toBe(TABLE_CENTER_Y);
    // Recovery costs a restart, never a point.
    expect(state.playerScore).toBe(0);
    expect(state.opponentScore).toBe(0);
  });
});

describe('a non-advancing step', () => {
  it('does nothing for a zero or negative dt', () => {
    const match = createHockeyMatch();
    expect(stepHockeyMatch(match, 0, { playerTarget: HOLD }).state).toBe(match);
    expect(stepHockeyMatch(match, -1, { playerTarget: HOLD }).state).toBe(match);
  });
});

describe('difficulty', () => {
  it('is carried on the match and picks the opponent’s profile', () => {
    expect(createHockeyMatch({ difficulty: 'easy' }).difficulty).toBe('easy');
    expect(hockeyAiProfile('easy').maxSpeed).toBeLessThan(hockeyAiProfile('normal').maxSpeed);
  });

  it('changes how the match plays', () => {
    const easy = run(createHockeyMatch({ difficulty: 'easy', seed: 5 }), 3_000).state;
    const normal = run(createHockeyMatch({ difficulty: 'normal', seed: 5 }), 3_000).state;
    expect(easy.opponentMallet).not.toEqual(normal.opponentMallet);
  });
});
