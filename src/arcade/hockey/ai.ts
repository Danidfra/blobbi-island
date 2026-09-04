/**
 * Air Hockey: the opponent.
 *
 * A **target-based controller with four modes**, not a puck mirror and not a
 * per-frame dice roll. It is pure: `stepHockeyAi` takes the world and its own
 * memory and returns a new memory plus a point to move toward. The match step
 * then moves the mallet through the same rate-limited
 * {@link moveMalletToward} the player's mallet uses, so the opponent is
 * physically incapable of anything the player is not.
 *
 * ## Why it is beatable, deliberately
 *
 * Three separate mechanisms hold it back, and each one exists because removing
 * it produced a specific kind of bad opponent:
 *
 *  - **Perception lags.** The AI does not steer toward the puck; it steers
 *    toward a `perceived` puck that chases the real one with a time constant of
 *    {@link HockeyAiProfile.reactionMs}. Without it the opponent reacts inside
 *    one 8 ms step and no shot can ever beat it; it is not hard, it is
 *    unbeatable, which is a different and much less interesting thing.
 *  - **Decisions are held.** The MODE is re-chosen only every
 *    `decisionIntervalMs`; between decisions the target is recomputed
 *    continuously from the same mode. Re-choosing the mode every step made it
 *    flicker between defend and strike at the edge of a threshold, which reads
 *    as jitter and is unpleasant to watch. Recomputing the TARGET every step is
 *    what keeps it tracking smoothly inside a held decision.
 *  - **It commits.** A strike aims at a point chosen once, when the mode is
 *    entered, from the match's seeded RNG. It cannot re-aim mid-swing, so a
 *    player who moves after the opponent has committed gets the goal.
 *
 * ## Randomness
 *
 * Every random number comes from the caller's seeded generator, drawn only when
 * a decision is made; never per frame and never during a React render. Two runs
 * with the same seed and the same inputs produce the same opponent, which is
 * what makes the AI testable at all.
 */

import {
  MALLET_RADIUS,
  OPPONENT_HOME,
  OPPONENT_ZONE,
  PLAYER_GOAL,
  PUCK_RADIUS,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_WIDTH,
} from './table';
import {
  clamp,
  clampToZone,
  predictCrossingX,
  type MalletState,
  type PuckState,
  type Vec2,
} from './physics';
import type { ArcadeDifficulty } from '../types';

/**
 * What the opponent is trying to do right now.
 *
 * - `defend`: hold the line between the puck and its own goal. The default.
 * - `intercept`: the puck is coming; go to where it WILL be, not where it is.
 * - `strike`: the puck is loose in its half; get behind it and drive it back.
 * - `recover`: the puck is past it, or it has wandered; go home first.
 */
export type HockeyAiMode = 'defend' | 'intercept' | 'strike' | 'recover';

export interface HockeyAiState {
  readonly mode: HockeyAiMode;
  /** The puck as the opponent currently believes it to be. Lags the real one. */
  readonly perceived: PuckState;
  /** Milliseconds until the mode may change again. */
  readonly decisionTimerMs: number;
  /**
   * Where a strike is aimed, chosen once when `strike` is entered.
   *
   * Held rather than recomputed so the opponent cannot re-aim as the player
   * moves: which is exactly the "perfect instantaneous reaction" the brief
   * rules out, wearing a different hat.
   */
  readonly aimX: number;
  /**
   * Lateral error, in table units, applied to wherever the opponent decides to
   * stand. Redrawn once per decision.
   *
   * Reaction lag alone does not make a keeper beatable, and measuring showed
   * exactly why: the prediction error of `predictCrossingX` is PROPORTIONAL to
   * how far the puck travels sideways, so a shot straight down the middle is
   * predicted perfectly however low `predictionSkill` is set. A straight shot
   * could therefore never beat the opponent, six hundred hits and not one goal
   * across four hundred simulated seconds. An absolute error is the missing
   * piece: it is small, it is held for the length of a decision so it never
   * looks like jitter, and it is the difference between a keeper and a wall.
   */
  readonly readError: number;
}

/** The tuning knobs. One object per difficulty; nothing else varies. */
export interface HockeyAiProfile {
  readonly id: ArcadeDifficulty;
  readonly label: string;
  /** One-line description for the difficulty picker. */
  readonly blurb: string;
  /** Top mallet speed, in table units per second. The player's is 300. */
  readonly maxSpeed: number;
  /** Perception time constant, in ms. Bigger is slower to notice. */
  readonly reactionMs: number;
  /** How often the mode may change, in ms. */
  readonly decisionIntervalMs: number;
  /**
   * How far into its own half the opponent will chase a loose puck, as a
   * fraction of its half. Low values keep it home and make it easy to draw out.
   */
  readonly commitDepth: number;
  /** Aim scatter across the player's goal mouth, in table units. */
  readonly aimJitter: number;
  /**
   * How much of a wall-folded interception prediction the opponent actually
   * trusts, 0..1.
   *
   * The single most important beatability knob. `predictCrossingX` is EXACT,
   * it unfolds every rail bounce, and an opponent that acts on it is not a
   * good player, it is a solved one: it meets every shot, including banked
   * ones no person could read, and a match ends 0–0 after four hundred
   * simulated seconds. Blending the prediction back toward where the puck is
   * NOW is what turns "solved" into "reads the play well", and it degrades
   * exactly the way a person does, a straight shot stays easy to meet, a long
   * banked one gets progressively less well covered.
   */
  readonly predictionSkill: number;
  /** Half-width of the per-decision lateral error, in table units. */
  readonly readError: number;
  /**
   * Puck speed below which a loose puck in its own half is always worth
   * attacking, whatever {@link commitDepth} says.
   *
   * Without it two cautious opponents both sat on their lines while the puck
   * drifted around the centre spot at its minimum speed for four hundred
   * seconds. A slow puck in your own half is a free shot; nobody ignores one.
   */
  readonly looseSpeed: number;
  /** Where it sits when defending, in table units from its own goal line. */
  readonly defendY: number;
}

export const HOCKEY_AI_PROFILES: Readonly<Record<'easy' | 'normal', HockeyAiProfile>> =
  Object.freeze({
    easy: Object.freeze({
      id: 'easy',
      label: 'Easy',
      blurb: 'A slower opponent that stays near its goal.',
      maxSpeed: 132,
      reactionMs: 230,
      decisionIntervalMs: 190,
      commitDepth: 0.55,
      aimJitter: 26,
      predictionSkill: 0.45,
      readError: 24,
      looseSpeed: 70,
      defendY: 24,
    }),
    normal: Object.freeze({
      id: 'normal',
      label: 'Normal',
      blurb: 'Reads the puck, comes out to meet it, and shoots back hard.',
      maxSpeed: 168,
      reactionMs: 150,
      decisionIntervalMs: 140,
      commitDepth: 0.9,
      aimJitter: 13,
      predictionSkill: 0.6,
      readError: 16,
      looseSpeed: 70,
      defendY: 20,
    }),
  });

/** The two difficulties Air Hockey ships with. `hard` is left for later tuning. */
export type HockeyDifficulty = keyof typeof HOCKEY_AI_PROFILES;

export const HOCKEY_DIFFICULTIES: readonly HockeyDifficulty[] = Object.freeze([
  'easy',
  'normal',
]);

export const DEFAULT_HOCKEY_DIFFICULTY: HockeyDifficulty = 'normal';

export function isHockeyDifficulty(value: unknown): value is HockeyDifficulty {
  return typeof value === 'string' && (HOCKEY_DIFFICULTIES as readonly string[]).includes(value);
}

export function hockeyAiProfile(difficulty: HockeyDifficulty): HockeyAiProfile {
  return HOCKEY_AI_PROFILES[difficulty];
}

export function createHockeyAiState(puck: PuckState): HockeyAiState {
  return {
    mode: 'defend',
    perceived: puck,
    decisionTimerMs: 0,
    aimX: TABLE_CENTER_X,
    readError: 0,
  };
}

/** The y line the opponent tries to meet an incoming puck on. */
const INTERCEPT_Y = 30;
/** How far the opponent eases in before its target, so it settles rather than buzzes. */
export const AI_ARRIVE_RADIUS = 9;

export interface HockeyAiInput {
  readonly state: HockeyAiState;
  readonly puck: PuckState;
  readonly mallet: MalletState;
  readonly profile: HockeyAiProfile;
  /** Seconds. The same fixed step the physics uses. */
  readonly dt: number;
  /** A number in [0, 1) from the match's seeded generator. Drawn per decision. */
  readonly random: () => number;
}

export interface HockeyAiStep {
  readonly state: HockeyAiState;
  /** Already clamped into the opponent's half, the caller need not re-check. */
  readonly target: Vec2;
  /**
   * How gently to arrive, in table units. Zero means "at full speed".
   *
   * Per-mode, and that is not a detail: easing in is what stops the opponent
   * vibrating on a defensive spot it can never sit exactly on, and it is
   * precisely wrong for a SHOT, a mallet that decelerates as it reaches the
   * puck taps it instead of hitting it, which is how an opponent ends up unable
   * to score at all.
   */
  readonly arriveRadius: number;
}

/**
 * Advance the opponent by one fixed step.
 *
 * Returns a TARGET, never a position. Moving is the match step's job, through
 * the same rate limiter the player is subject to, which is the structural reason
 * the opponent cannot teleport, cannot cross the centre line, and cannot exceed
 * its own speed limit however wrong this function's judgement is.
 */
export function stepHockeyAi(input: HockeyAiInput): HockeyAiStep {
  const { puck, mallet, profile, dt, random, state } = input;

  // ── Perception ────────────────────────────────────────────────────────────
  // An exponential chase rather than a ring buffer of past positions: it costs
  // one object per step instead of twenty, it is framerate-independent by
  // construction, and it produces a smooth belief rather than a stale snapshot
  // that jumps every time the buffer rolls over.
  const alpha = 1 - Math.exp(-dt / Math.max(0.001, profile.reactionMs / 1000));
  // A puck that is not a number is not something anyone can see. Keeping the
  // previous belief means one bad frame cannot poison the opponent's perception
  // for the rest of the match, the match step recovers the puck itself on the
  // very next step, and by then this is looking at a real one again.
  const visible =
    Number.isFinite(puck.x) &&
    Number.isFinite(puck.y) &&
    Number.isFinite(puck.vx) &&
    Number.isFinite(puck.vy);
  const perceived: PuckState = visible
    ? {
        x: state.perceived.x + (puck.x - state.perceived.x) * alpha,
        y: state.perceived.y + (puck.y - state.perceived.y) * alpha,
        vx: state.perceived.vx + (puck.vx - state.perceived.vx) * alpha,
        vy: state.perceived.vy + (puck.vy - state.perceived.vy) * alpha,
      }
    : state.perceived;

  // ── Decision ──────────────────────────────────────────────────────────────
  let decisionTimerMs = state.decisionTimerMs - dt * 1000;
  let mode = state.mode;
  let aimX = state.aimX;
  let readError = state.readError;

  if (decisionTimerMs <= 0) {
    const next = chooseMode(perceived, mallet, profile);
    if (next === 'strike' && mode !== 'strike') {
      // Committed here and nowhere else. One draw, held for the whole swing.
      aimX = clamp(
        PLAYER_GOAL.x + (random() * 2 - 1) * profile.aimJitter,
        PUCK_RADIUS,
        TABLE_WIDTH - PUCK_RADIUS,
      );
    }
    readError = (random() * 2 - 1) * profile.readError;
    mode = next;
    decisionTimerMs = profile.decisionIntervalMs;
  }

  const raw = targetFor(mode, perceived, mallet, profile, aimX);
  // The error moves where it STANDS, never how hard it hits: applied to the
  // defensive modes only, so a committed shot still goes where it was aimed.
  const skewed =
    mode === 'defend' || mode === 'intercept' ? { x: raw.x + readError, y: raw.y } : raw;
  const target = clampToZone(skewed, OPPONENT_ZONE);

  return {
    state: { mode, perceived, decisionTimerMs, aimX, readError },
    target,
    arriveRadius: mode === 'strike' ? 0 : AI_ARRIVE_RADIUS,
  };
}

function chooseMode(
  puck: PuckState,
  mallet: MalletState,
  profile: HockeyAiProfile,
): HockeyAiMode {
  const inOwnHalf = puck.y < TABLE_CENTER_Y;

  // The puck has got behind the mallet, in its own half. Nothing useful can be
  // done from here except get back between it and the goal.
  if (inOwnHalf && puck.y < mallet.y - MALLET_RADIUS) return 'recover';

  if (!inOwnHalf) {
    // The player has it. Hold a defensive line; there is nothing to chase.
    return 'defend';
  }

  // Coming at the goal with pace: meet it, do not follow it.
  if (puck.vy < -18) return 'intercept';

  // A slow puck in your own half is a free shot. Take it wherever it is.
  if (Math.hypot(puck.vx, puck.vy) < profile.looseSpeed) return 'strike';

  // Otherwise, only leave home for a puck shallow enough to be worth it.
  const reach = TABLE_CENTER_Y * profile.commitDepth;
  if (puck.y <= reach) return 'strike';

  return 'defend';
}

/** How far PAST the puck a shot aims, so the mallet drives through it. */
const FOLLOW_THROUGH = 30;
/** Gap left behind the puck when setting up a shot. */
const SETUP_GAP = MALLET_RADIUS + PUCK_RADIUS + 3;

function targetFor(
  mode: HockeyAiMode,
  puck: PuckState,
  mallet: MalletState,
  profile: HockeyAiProfile,
  aimX: number,
): Vec2 {
  switch (mode) {
    case 'recover':
      return OPPONENT_HOME;

    case 'intercept': {
      const crossing = predictCrossingX(puck, INTERCEPT_Y);
      // No prediction means the puck is not actually coming; fall back to the
      // defensive line rather than guessing.
      if (crossing === null) return defendPoint(puck, profile);
      // Believe the prediction only as far as this opponent is allowed to. See
      // `predictionSkill`.
      const read = puck.x + (crossing - puck.x) * profile.predictionSkill;
      return { x: read, y: INTERCEPT_Y };
    }

    case 'strike': {
      /*
        A shot in two stages, because one is not enough.

        A first pass targeted the point just BEHIND the puck. The mallet
        obediently travelled there, decelerated into it, and nudged the puck a
        few units: an opponent that touched the puck constantly and could not
        score in four hundred simulated seconds. The missing half is the
        FOLLOW-THROUGH: a shot is a move to a point on the far side of the
        puck, so contact happens at speed and in the direction of the goal.

        Setting up first is what keeps that from being a wild swipe. Until the
        mallet is behind the puck relative to the aim, it goes there; once it
        is, it drives all the way through.
      */
      const dx = aimX - puck.x;
      const dy = PLAYER_GOAL.y - puck.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;

      // Negative when the mallet is behind the puck, which is where a shot
      // starts from.
      const along = (mallet.x - puck.x) * ux + (mallet.y - puck.y) * uy;
      if (along > -SETUP_GAP * 0.6) {
        return { x: puck.x - ux * SETUP_GAP, y: puck.y - uy * SETUP_GAP };
      }
      return { x: puck.x + ux * FOLLOW_THROUGH, y: puck.y + uy * FOLLOW_THROUGH };
    }

    case 'defend':
    default:
      return defendPoint(puck, profile);
  }
}

/**
 * The defensive line: on the segment from its own goal toward the puck, a fixed
 * distance out.
 *
 * Following the puck's x directly is the mirror behaviour the brief rules out,
 * it looks robotic and it leaves the near post open on every cross. Sitting on
 * the goal-to-puck line covers the angle instead, which is both correct and
 * what a person does.
 */
function defendPoint(puck: PuckState, profile: HockeyAiProfile): Vec2 {
  const spread = clamp((puck.x - TABLE_CENTER_X) * 0.5, -TABLE_WIDTH / 2, TABLE_WIDTH / 2);
  return { x: TABLE_CENTER_X + spread, y: profile.defendY };
}
