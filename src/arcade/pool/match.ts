/**
 * Pool: the match: phases, turns, and the one place a shot is judged.
 *
 * ```
 *   ready ──1.5s──► aiming ──shot──► rolling ──settle──► banner ──┬─► aiming
 *                      ▲                                          ├─► ball-in-hand
 *                      │                                          ├─► thinking ──► rolling
 *   ball-in-hand ──place┘                                         └─► over
 * ```
 *
 * Two entry points, and the split matters:
 *
 *  - **{@link stepPoolMatch}** advances time. It is the only thing the frame
 *    loop calls, and it is a no-op in every phase that is waiting for a person.
 *  - **{@link applyPlayerShot}, {@link placePlayerCueBall},
 *    {@link dragPlayerCueBall}** are the player's discrete actions. Each refuses
 *    outright unless the match is in the phase that allows it, which is where
 *    "no input while balls are moving" is actually guaranteed, the UI also
 *    disables the controls, but a disabled control is a courtesy and this is the
 *    rule.
 *
 * ## The world is a parameter, not a field
 *
 * Every one of those takes a {@link PoolPhysicsWorld}. The match does not own
 * the simulation and does not contain it: `PoolMatchState` is a plain JSON value,
 * phases, timers, group ownership, statistics and a SNAPSHOT of the balls,
 * and the Planck bodies live in the world the caller passes in.
 *
 * That split is what survived the engine change. `rules.ts` never learned that
 * the solver was replaced, because it is handed a `ShotRecord` of observations
 * either way; `ai.ts` never learned, because it reads snapshots. The only thing
 * this file gained was calls to `world.step`, `world.drain` and
 * `world.snapshot` where it used to run a solver inline.
 *
 * The state stays serialisable, so a whole match is still `toEqual`-comparable
 * in a test and could still be persisted. It is no longer reproducible from
 * `(seed, actions)` ALONE, it needs the same sequence of world steps too, but
 * Planck is deterministic given identical inputs, so two runs of the same
 * actions against two fresh worlds still agree.
 *
 * ## The invariants this file exists to enforce
 *
 * 1. **A shot is resolved exactly once.** Resolution happens on the single
 *    transition out of `rolling`, calls {@link resolveShot} once, and lands in
 *    `banner`: a phase that cannot resolve anything. There is no incremental
 *    scoring and no flag to forget to clear.
 * 2. **A turn never changes while a ball is moving.** `rolling` is the only
 *    phase that steps the world, and it is the only phase that cannot change
 *    `turn`.
 * 3. **The opponent commits once per turn.** The plan is made on entry to
 *    `thinking`, stored, and played unchanged when the timer expires. It cannot
 *    re-aim, and it shoots through the same strike path the player does.
 * 4. **A ball is pocketed exactly once.** The world reports a capture on the one
 *    step the ball's centre crosses a mouth plane and takes the body out of the
 *    simulation in the same breath.
 * 5. **The cue ball can always be found.** A scratch restores it to a legal
 *    default immediately, so there is never a moment with no cue ball to draw or
 *    to drag.
 * 6. **A shot always ends.** The world's settling rule guarantees it;
 *    {@link MAX_SHOT_MS} guarantees it even if something pathological happens.
 * 7. **`over` is terminal.** Stepping it returns the same object.
 */

import {
  CUE_BALL,
  EIGHT_BALL,
  clampBall,
  findBall,
  isLegalBallPosition,
  nearestLegalPosition,
  type PoolBall,
  type Vec2,
} from './physics';
import type { PoolPhysicsFrame, PoolPhysicsWorld } from './pool-physics-world';
import { buildRack, nextRandom } from './rack';
import {
  groupCleared,
  otherPlayer,
  remainingInGroup,
  resolveShot,
  OPEN_TABLE,
  type PoolAssignment,
  type PoolEnding,
  type PoolFoul,
  type PoolPlayer,
  type ShotOutcome,
  type ShotRecord,
} from './rules';
import {
  DEFAULT_POOL_DIFFICULTY,
  planPoolShot,
  poolAiProfile,
  type PoolDifficulty,
  type PoolShotPlan,
} from './ai';
import {
  CONTINUE_BANNER_MS,
  FOOT_SPOT,
  HEAD_SPOT,
  MATCH_END_HOLD_MS,
  MAX_SHOT_MS,
  READY_MS,
  TURN_BANNER_MS,
  shotSpeedFor,
} from './table';

export type PoolPhase =
  /** The break-setup beat. Nothing may be touched. */
  | 'ready'
  /** Waiting for the player to take a shot. */
  | 'aiming'
  /** Waiting for the player to place the cue ball. */
  | 'ball-in-hand'
  /** Balls are moving. Nobody may do anything. */
  | 'rolling'
  /** The result of the last shot is on screen. */
  | 'banner'
  /** The opponent has committed to a shot and is about to play it. */
  | 'thinking'
  /** Terminal. */
  | 'over';

/**
 * Something the presentation layer may want to react to.
 *
 * Returned from the step rather than stored on the state, because an event is a
 * thing that HAPPENED during one step, not a property of the world afterwards.
 * Keeping them out of the state also keeps the state comparable: two identical
 * tables are `toEqual` even if one of them got there noisily.
 */
export type PoolEvent =
  | { readonly type: 'ready-complete' }
  | { readonly type: 'strike'; readonly by: PoolPlayer; readonly power: number; readonly at: Vec2 }
  | {
      readonly type: 'collide';
      readonly a: number;
      readonly b: number;
      readonly at: Vec2;
      /** Closing speed, for scaling a sound or a spark. */
      readonly impact: number;
    }
  | {
      readonly type: 'cushion';
      /** Which cushion polygon, e.g. `bottom-left`. See `pool-physics-geometry.ts`. */
      readonly cushion: string;
      readonly at: Vec2;
      readonly impact: number;
    }
  | {
      readonly type: 'pocket';
      readonly ball: number;
      readonly pocket: number;
      readonly at: Vec2;
    }
  | { readonly type: 'scratch' }
  | { readonly type: 'shot-resolved'; readonly outcome: ShotOutcome }
  | { readonly type: 'turn'; readonly to: PoolPlayer; readonly ballInHand: boolean }
  | { readonly type: 'ai-planned'; readonly plan: PoolShotPlan }
  | {
      readonly type: 'match-over';
      readonly winner: PoolPlayer;
      readonly ending: PoolEnding;
    }
  /** An invalid physics state was caught and recovered from. */
  | { readonly type: 'recovered' };

/** Counters the result carries. Only numbers, so they map straight into `stats`. */
export interface PoolMatchStats {
  readonly playerShots: number;
  readonly opponentShots: number;
  /** Shots on which the shooter potted one of their own and kept the table. */
  readonly playerSuccessfulShots: number;
  readonly opponentSuccessfulShots: number;
  readonly playerFouls: number;
  readonly opponentFouls: number;
  readonly playerScratches: number;
  readonly opponentScratches: number;
  /** Every object ball that has dropped, whoever it belonged to. */
  readonly ballsPocketed: number;
  readonly cushionHits: number;
  readonly ballContacts: number;
  /** The most consecutive shots the player kept the table for. */
  readonly longestPlayerRun: number;
}

const EMPTY_STATS: PoolMatchStats = Object.freeze({
  playerShots: 0,
  opponentShots: 0,
  playerSuccessfulShots: 0,
  opponentSuccessfulShots: 0,
  playerFouls: 0,
  opponentFouls: 0,
  playerScratches: 0,
  opponentScratches: 0,
  ballsPocketed: 0,
  cushionHits: 0,
  ballContacts: 0,
  longestPlayerRun: 0,
});

/**
 * What the simulation has observed since the cue was struck.
 *
 * Lives only during `rolling`, and is handed to {@link resolveShot} once, when
 * the table settles. It records observations, never judgements.
 */
export interface ShotProgress {
  readonly shooter: PoolPlayer;
  readonly firstContact: number | null;
  readonly pocketed: readonly number[];
  readonly cuePocketed: boolean;
  readonly cueLost: boolean;
  readonly wasBreak: boolean;
  /** The table as it stood before the strike. Decides what was legal to hit. */
  readonly ballsBefore: readonly PoolBall[];
  /** How long this shot has been rolling, in ms. Bounded by {@link MAX_SHOT_MS}. */
  readonly rollingMs: number;
}

export interface PoolMatchState {
  readonly phase: PoolPhase;
  /** Milliseconds left in `ready`, `banner` or `thinking`. Unused elsewhere. */
  readonly timerMs: number;
  readonly balls: readonly PoolBall[];
  readonly turn: PoolPlayer;
  readonly assignment: PoolAssignment;
  /** True when the player whose turn it is may place the cue ball first. */
  readonly ballInHand: boolean;
  /** True once the break has been played. */
  readonly broken: boolean;
  readonly difficulty: PoolDifficulty;
  readonly shot: ShotProgress | null;
  readonly lastOutcome: ShotOutcome | null;
  /**
   * Who played the last resolved shot.
   *
   * Not derivable from `turn`, which has already moved on by the time anybody
   * asks: and the difference decides whether an early 8-ball was the player's
   * own mistake or the opponent's gift.
   */
  readonly lastShooter: PoolPlayer | null;
  /** One short sentence about what just happened. Drives the banner. */
  readonly banner: string | null;
  /** The opponent's committed decision. Cleared when it is played. */
  readonly plan: PoolShotPlan | null;
  readonly winner: PoolPlayer | null;
  readonly ending: PoolEnding | null;
  readonly stats: PoolMatchStats;
  /** How many shots in a row the player has kept the table for. */
  readonly playerRun: number;
  /** Total match time in ms, including every pause and banner. */
  readonly elapsedMs: number;
  /** Seeded generator state. A plain uint32, so the whole match stays JSON. */
  readonly rngState: number;
}

export interface PoolStepResult {
  readonly state: PoolMatchState;
  readonly events: readonly PoolEvent[];
}

// ── Construction ────────────────────────────────────────────────────────────

export interface CreatePoolMatchOptions {
  readonly difficulty?: PoolDifficulty;
  /** Any 32-bit number. Derive one from the run id with `poolSeedFrom`. */
  readonly seed?: number;
}

/**
 * A fresh match: a legal rack, the cue ball on the head spot, and the player to
 * break.
 *
 * The player always breaks; see the rule list in `rules.ts`. There is no lag
 * and no coin toss, because one machine plus one match plus the most interesting
 * shot in the game equals "give it to the person standing there".
 *
 * Deliberately does NOT take a world: it returns a state whose `balls` are the
 * rack, and the caller loads them with `world.reset(state.balls)`. Keeping
 * creation pure means a test can build a table to reason about without standing
 * up a physics engine.
 */
export function createPoolMatch({
  difficulty = DEFAULT_POOL_DIFFICULTY,
  seed = 1,
}: CreatePoolMatchOptions = {}): PoolMatchState {
  const rack = buildRack(seed >>> 0);
  return {
    phase: 'ready',
    timerMs: READY_MS,
    balls: rack.balls,
    turn: 'player',
    assignment: OPEN_TABLE,
    ballInHand: false,
    broken: false,
    difficulty,
    shot: null,
    lastOutcome: null,
    lastShooter: null,
    banner: 'Your break.',
    plan: null,
    winner: null,
    ending: null,
    stats: EMPTY_STATS,
    playerRun: 0,
    elapsedMs: 0,
    rngState: rack.rngState,
  };
}

// ── The player's discrete actions ───────────────────────────────────────────

/**
 * Move the cue ball while the player is placing it.
 *
 * Deliberately permissive: it accepts an illegal position and simply clamps the
 * ball onto the cloth. The renderer tints an illegal placement red and
 * {@link placePlayerCueBall} snaps it, so the drag can follow a finger exactly
 * rather than fighting it, a ball that refuses to go where you are pointing
 * feels broken long before the player works out why.
 */
export function dragPlayerCueBall(
  state: PoolMatchState,
  at: Vec2,
  world: PoolPhysicsWorld,
): PoolMatchState {
  if (state.phase !== 'ball-in-hand' || state.turn !== 'player') return state;
  const cue = findBall(state.balls, CUE_BALL);
  if (!cue) return state;

  const clamped = clampBall({ ...cue, x: at.x, y: at.y, vx: 0, vy: 0, pocketed: false });
  world.setBall(CUE_BALL, { x: clamped.x, y: clamped.y });
  return { ...state, balls: world.snapshot() };
}

/**
 * Commit the cue ball's position and go back to aiming.
 *
 * `at` is a REQUEST. An illegal one, inside another ball, over a pocket, off
 * the cloth: is snapped to the nearest legal spot rather than refused, so the
 * confirm button always works. That is the "safe default placement if the player
 * does not understand the interaction" the brief asks for, and it is also what
 * makes the whole interaction skippable: press the button without dragging and
 * the ball is simply somewhere legal.
 */
export function placePlayerCueBall(
  state: PoolMatchState,
  world: PoolPhysicsWorld,
  at?: Vec2,
): PoolMatchState {
  if (state.phase !== 'ball-in-hand' || state.turn !== 'player') return state;

  const cue = findBall(state.balls, CUE_BALL);
  const requested: Vec2 = at ?? (cue ? { x: cue.x, y: cue.y } : HEAD_SPOT);
  const spot = nearestLegalPosition(requested, state.balls);

  world.setBall(CUE_BALL, spot);
  return {
    ...state,
    balls: world.snapshot(),
    ballInHand: false,
    phase: 'aiming',
    banner: null,
  };
}

/**
 * Strike the cue ball.
 *
 * The single strike path. The player's drag ends here and so does the
 * opponent's plan, which is the structural reason the opponent cannot shoot
 * harder, cannot shoot from somewhere illegal, and cannot bypass a rule the
 * player is subject to.
 */
export function applyPlayerShot(
  state: PoolMatchState,
  angle: number,
  power: number,
  world: PoolPhysicsWorld,
): PoolStepResult {
  if (state.phase !== 'aiming' || state.turn !== 'player') return { state, events: [] };
  return strike(state, angle, power, 'player', world);
}

function strike(
  state: PoolMatchState,
  angle: number,
  power: number,
  by: PoolPlayer,
  world: PoolPhysicsWorld,
): PoolStepResult {
  const cue = findBall(state.balls, CUE_BALL);
  if (!cue || cue.pocketed) return { state, events: [] };
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return { state, events: [] };

  const clamped = power < 0 ? 0 : power > 1 ? 1 : power;
  world.strike(angle, shotSpeedFor(clamped));
  world.resetSettling();
  const balls = world.snapshot();

  const shot: ShotProgress = {
    shooter: by,
    firstContact: null,
    pocketed: [],
    cuePocketed: false,
    cueLost: false,
    wasBreak: !state.broken,
    ballsBefore: state.balls,
    rollingMs: 0,
  };

  const stats: PoolMatchStats = {
    ...state.stats,
    playerShots: state.stats.playerShots + (by === 'player' ? 1 : 0),
    opponentShots: state.stats.opponentShots + (by === 'opponent' ? 1 : 0),
  };

  return {
    state: {
      ...state,
      phase: 'rolling',
      timerMs: 0,
      balls,
      shot,
      plan: null,
      banner: null,
      stats,
    },
    events: [{ type: 'strike', by, power: clamped, at: { x: cue.x, y: cue.y } }],
  };
}

// ── The step ────────────────────────────────────────────────────────────────

/**
 * Advance one fixed step.
 *
 * `dt` is in SECONDS and is expected to be the fixed step the loop is driven at.
 * It is an argument rather than a constant so a test can settle a shot in a
 * handful of calls, but nothing in here adapts to it: the tuning assumes a
 * small, regular step, and `useFixedStepLoop` is what guarantees one.
 */
export function stepPoolMatch(
  state: PoolMatchState,
  dt: number,
  world: PoolPhysicsWorld,
): PoolStepResult {
  if (state.phase === 'over' || dt <= 0) return { state, events: [] };

  const elapsedMs = state.elapsedMs + dt * 1000;

  switch (state.phase) {
    case 'ready':
      return stepReady({ ...state, elapsedMs }, dt);
    case 'banner':
      return stepBanner({ ...state, elapsedMs }, dt, world);
    case 'thinking':
      return stepThinking({ ...state, elapsedMs }, dt, world);
    case 'rolling':
      return stepRolling({ ...state, elapsedMs }, dt, world);
    // `aiming` and `ball-in-hand` are waiting for a person. Time passes and
    // nothing else does, which is exactly what makes pausing safe.
    default:
      return { state: { ...state, elapsedMs }, events: [] };
  }
}

function stepReady(state: PoolMatchState, dt: number): PoolStepResult {
  const timerMs = state.timerMs - dt * 1000;
  if (timerMs > 0) return { state: { ...state, timerMs }, events: [] };
  return {
    state: { ...state, phase: 'aiming', timerMs: 0, banner: null },
    events: [{ type: 'ready-complete' }],
  };
}

function stepBanner(
  state: PoolMatchState,
  dt: number,
  world: PoolPhysicsWorld,
): PoolStepResult {
  const timerMs = state.timerMs - dt * 1000;
  if (timerMs > 0) return { state: { ...state, timerMs }, events: [] };

  if (state.winner !== null && state.ending !== null) {
    return {
      state: { ...state, phase: 'over', timerMs: 0 },
      events: [{ type: 'match-over', winner: state.winner, ending: state.ending }],
    };
  }

  if (state.turn === 'player') {
    return {
      state: {
        ...state,
        phase: state.ballInHand ? 'ball-in-hand' : 'aiming',
        timerMs: 0,
        banner: null,
      },
      events: [],
    };
  }

  return beginOpponentTurn({ ...state, banner: null }, world);
}

/**
 * The opponent's one decision, made here and nowhere else.
 *
 * Planning happens on ENTRY to `thinking` rather than on exit, for two reasons.
 * It is what makes "one committed decision per turn" true; there is no second
 * moment at which the plan could be recomputed against a table that has since
 * changed. And when the plan includes a cue-ball placement, applying it now
 * means the player watches the opponent put the ball down and then take aim,
 * instead of the ball teleporting at the instant of the strike.
 */
function beginOpponentTurn(
  state: PoolMatchState,
  world: PoolPhysicsWorld,
): PoolStepResult {
  const profile = poolAiProfile(state.difficulty);

  let rngState = state.rngState;
  const random = () => {
    const draw = nextRandom(rngState);
    rngState = draw.state;
    return draw.value;
  };

  const plan = planPoolShot({
    balls: state.balls,
    group: state.assignment.opponent,
    ballInHand: state.ballInHand,
    profile,
    random,
    isBreak: !state.broken,
  });

  let balls = state.balls;
  if (state.ballInHand && plan.cuePlacement) {
    world.setBall(CUE_BALL, nearestLegalPosition(plan.cuePlacement, balls));
    balls = world.snapshot();
  }

  return {
    state: {
      ...state,
      phase: 'thinking',
      timerMs: profile.thinkMs,
      balls,
      ballInHand: false,
      plan,
      rngState,
    },
    events: [{ type: 'ai-planned', plan }],
  };
}

function stepThinking(
  state: PoolMatchState,
  dt: number,
  world: PoolPhysicsWorld,
): PoolStepResult {
  const timerMs = state.timerMs - dt * 1000;
  if (timerMs > 0) return { state: { ...state, timerMs }, events: [] };

  const plan = state.plan;
  if (!plan) {
    // Nothing to play. Cannot happen, `beginOpponentTurn` always produces a
    // plan: but a match must never be able to stall, so hand the table back.
    return {
      state: { ...state, phase: 'aiming', timerMs: 0, turn: 'player' },
      events: [{ type: 'turn', to: 'player', ballInHand: false }],
    };
  }

  return strike({ ...state, timerMs: 0 }, plan.angle, plan.power, 'opponent', world);
}

// ── `rolling`: the world does the work now ──────────────────────────────────

/**
 * Fold one step's physics events into the shot's record.
 *
 * The match observes; it does not judge. `firstContact`, the pocket list and the
 * scratch flag are FACTS about what happened, and `resolveShot` is the only
 * thing that turns them into consequences.
 */
function absorb(
  shot: ShotProgress,
  frame: PoolPhysicsFrame,
  stats: PoolMatchStats,
  events: PoolEvent[],
): { shot: ShotProgress; stats: PoolMatchStats } {
  let firstContact = shot.firstContact;
  let cuePocketed = shot.cuePocketed;
  let cueLost = shot.cueLost;
  const pocketed = [...shot.pocketed];
  let next = stats;

  for (const contact of frame.contacts) {
    next = { ...next, ballContacts: next.ballContacts + 1 };
    // The world always reports the lower ball number as `a`, and the cue ball is
    // 0: so `a === CUE_BALL` is exactly "the cue ball was involved".
    if (contact.a === CUE_BALL && firstContact === null) firstContact = contact.b;
    events.push({
      type: 'collide',
      a: contact.a,
      b: contact.b,
      at: contact.at,
      impact: contact.impact,
    });
  }

  for (const hit of frame.cushions) {
    next = { ...next, cushionHits: next.cushionHits + 1 };
    events.push({ type: 'cushion', cushion: hit.cushion, at: hit.at, impact: hit.impact });
  }

  for (const drop of frame.pocketed) {
    pocketed.push(drop.ball);
    if (drop.ball === CUE_BALL) {
      cuePocketed = true;
      events.push({ type: 'scratch' });
    } else {
      next = { ...next, ballsPocketed: next.ballsPocketed + 1 };
    }
    events.push({ type: 'pocket', ball: drop.ball, pocket: drop.pocket, at: drop.at });
  }

  if (frame.recovered.length > 0) {
    events.push({ type: 'recovered' });
    // A cue ball the world could not keep is a foul, not a mystery. It is
    // reported as `off-table` and costs ball-in-hand, exactly as a scratch does.
    if (frame.recovered.includes(CUE_BALL)) cueLost = true;
  }

  return {
    shot: { ...shot, firstContact, pocketed, cuePocketed, cueLost },
    stats: next,
  };
}

/**
 * Advance the shot by one step, then ask whether it is over.
 *
 * All of the physics is behind `world.step`. What is left here is bookkeeping,
 * which is the whole point of the adapter boundary, and the reason this function
 * lost sixty lines when Planck arrived.
 */
function stepRolling(
  state: PoolMatchState,
  dt: number,
  world: PoolPhysicsWorld,
): PoolStepResult {
  const shot = state.shot;
  if (!shot) {
    // No shot in flight. Recover to a sane waiting phase rather than stepping a
    // table nobody struck.
    return { state: { ...state, phase: 'aiming' }, events: [] };
  }

  world.step(dt);

  const events: PoolEvent[] = [];
  const absorbed = absorb(shot, world.drain(), state.stats, events);

  const rollingMs = shot.rollingMs + dt * 1000;
  const progress: ShotProgress = { ...absorbed.shot, rollingMs };
  const balls = world.snapshot();

  // The world's settling rule; every ball stopped for several consecutive
  // steps: plus a backstop for a shot that somehow will not end.
  const settled = world.isSettled() || rollingMs >= MAX_SHOT_MS;
  if (!settled) {
    return {
      state: { ...state, balls, shot: progress, stats: absorbed.stats },
      events,
    };
  }

  // Invariant 1: the single transition out of `rolling`, and the only place a
  // shot is judged.
  return finishShot(
    { ...state, balls, shot: progress, stats: absorbed.stats },
    events,
    world,
  );
}

/**
 * Judge the finished shot and set up whatever comes next.
 *
 * Everything a turn changes happens here, once: assignment, whose shot it is,
 * ball-in-hand, the 8-ball re-spot, the statistics, the banner and the winner.
 * The state that comes out is always `banner`, which is a phase that resolves
 * nothing: so there is no path by which a second resolution could occur.
 */
function finishShot(
  state: PoolMatchState,
  events: PoolEvent[],
  world: PoolPhysicsWorld,
): PoolStepResult {
  const shot = state.shot!;

  const record: ShotRecord = {
    shooter: shot.shooter,
    firstContact: shot.firstContact,
    pocketed: shot.pocketed,
    cuePocketed: shot.cuePocketed,
    cueLost: shot.cueLost,
    wasBreak: shot.wasBreak,
  };

  const outcome = resolveShot({
    shot: record,
    ballsBefore: shot.ballsBefore,
    assignment: state.assignment,
  });

  // Both of the corrections below put a ball back on the table, so both go
  // through the world, a snapshot edit would leave the body where it was and
  // the next step would undo it.
  let touched = false;

  // The break exception: the 8-ball comes back rather than ending the match.
  if (outcome.respotEight) {
    world.setBall(EIGHT_BALL, nearestLegalPosition(FOOT_SPOT, state.balls, EIGHT_BALL));
    touched = true;
  }

  // Invariant 5: after a scratch there is always a cue ball to draw and to drag.
  // It is restored to a legal default now; the incoming player may move it
  // anywhere legal, and may equally just shoot from here.
  if (shot.cuePocketed || shot.cueLost) {
    world.setBall(CUE_BALL, nearestLegalPosition(HEAD_SPOT, state.balls));
    touched = true;
  }

  const balls = touched ? world.snapshot() : state.balls;

  const scratched = shot.cuePocketed || shot.cueLost;
  const byPlayer = shot.shooter === 'player';
  const potted = outcome.continues;

  const playerRun = byPlayer ? (potted ? state.playerRun + 1 : 0) : state.playerRun;

  const stats: PoolMatchStats = {
    ...state.stats,
    playerSuccessfulShots:
      state.stats.playerSuccessfulShots + (byPlayer && potted ? 1 : 0),
    opponentSuccessfulShots:
      state.stats.opponentSuccessfulShots + (!byPlayer && potted ? 1 : 0),
    playerFouls: state.stats.playerFouls + (byPlayer && outcome.foul !== null ? 1 : 0),
    opponentFouls: state.stats.opponentFouls + (!byPlayer && outcome.foul !== null ? 1 : 0),
    playerScratches: state.stats.playerScratches + (byPlayer && scratched ? 1 : 0),
    opponentScratches: state.stats.opponentScratches + (!byPlayer && scratched ? 1 : 0),
    longestPlayerRun: Math.max(state.stats.longestPlayerRun, playerRun),
  };

  events.push({ type: 'shot-resolved', outcome });
  if (outcome.winner === null) {
    events.push({ type: 'turn', to: outcome.nextTurn, ballInHand: outcome.ballInHand });
  }

  return {
    state: {
      ...state,
      phase: 'banner',
      timerMs:
        outcome.winner !== null
          ? MATCH_END_HOLD_MS
          : outcome.continues
            ? CONTINUE_BANNER_MS
            : TURN_BANNER_MS,
      balls,
      broken: true,
      turn: outcome.nextTurn,
      assignment: outcome.assignment,
      ballInHand: outcome.ballInHand,
      shot: null,
      lastOutcome: outcome,
      lastShooter: shot.shooter,
      banner: outcome.message,
      winner: outcome.winner,
      ending: outcome.ending,
      stats,
      playerRun,
    },
    events,
  };
}

// ── Derived questions the UI asks ───────────────────────────────────────────

export function isPoolMatchOver(state: PoolMatchState): boolean {
  return state.phase === 'over';
}

/** True while the player may actually do something. */
export function isPlayerTurnInteractive(state: PoolMatchState): boolean {
  return state.turn === 'player' && (state.phase === 'aiming' || state.phase === 'ball-in-hand');
}

/** The player's remaining balls, or `null` while the table is open. */
export function playerRemaining(state: PoolMatchState): readonly number[] | null {
  const group = state.assignment.player;
  if (group === null) return null;
  return remainingInGroup(state.balls, group);
}

/** The opponent's remaining balls, or `null` while the table is open. */
export function opponentRemaining(state: PoolMatchState): readonly number[] | null {
  const group = state.assignment.opponent;
  if (group === null) return null;
  return remainingInGroup(state.balls, group);
}

/** True when this side has cleared its group and is on the 8-ball. */
export function isOnTheEight(state: PoolMatchState, who: PoolPlayer): boolean {
  return groupCleared(state.balls, state.assignment[who]);
}

/** The foul from the last shot, if it was one. Drives the foul banner. */
export function lastFoul(state: PoolMatchState): PoolFoul | null {
  return state.lastOutcome?.foul ?? null;
}

/** Whether the cue ball may legally sit here right now. Read by the placement UI. */
export function canPlaceCueBallAt(state: PoolMatchState, at: Vec2): boolean {
  return isLegalBallPosition(at, state.balls, CUE_BALL);
}

export { otherPlayer };
