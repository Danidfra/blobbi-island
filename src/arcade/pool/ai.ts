/**
 * Pool — the opponent, as a shot planner.
 *
 * **One decision per turn, made once.** The planner is called exactly once when
 * the opponent's turn begins; it returns a {@link PoolShotPlan} — an angle, a
 * power, and optionally where to put the cue ball — which the match state
 * machine then plays through the *same* shot path a human's drag produces. The
 * opponent cannot move a ball, cannot exceed the player's power, cannot re-aim
 * once it has committed, and is judged by the same {@link resolveShot} the
 * player is.
 *
 * That structure is the whole safety argument. There is no "AI mode" in the
 * physics and no branch in the rules that asks who is shooting.
 *
 * ## How it thinks
 *
 * A geometric search, not a simulation and not a dice roll:
 *
 *  1. **Legal targets.** Whatever the rules say it may strike first — its own
 *     group, anything but the 8 on an open table, or the 8 alone once its group
 *     is gone.
 *  2. **Every target against every pocket.** Ninety pairs at most.
 *  3. **The ghost ball.** For each pair, the point the cue ball's centre must
 *     reach for the object ball to set off toward that pocket. That single
 *     construction is all of pool aiming.
 *  4. **Rejections.** A cut too thin to make, a ghost ball off the cloth, a
 *     blocked path to the ghost, a blocked path to the pocket.
 *  5. **A score**, favouring straight shots over thin cuts and short pots over
 *     long ones, and penalising a shot that would put the cue ball down a pocket
 *     afterwards.
 *  6. **Error.** The chosen shot's angle and power are then knocked off target
 *     by an amount the difficulty decides.
 *  7. **A safety** if nothing survived: touch the nearest legal ball gently,
 *     which is not clever but is legal, and a legal miss is enormously better
 *     than the foul that hands the player ball-in-hand.
 *
 * ## Why it is beatable, deliberately
 *
 * Because {@link PoolAiProfile.aimErrorRad} is applied AFTER the search, the
 * opponent aims at the right place and then misses by a human amount. That is a
 * different and much better failure mode than picking a worse shot: it misses
 * the pots a person misses (long ones, thin ones) and makes the ones a person
 * makes, so a run of three or four pots feels earned rather than scripted, and
 * the miss that ends it looks like a miss rather than a decision.
 *
 * ## Randomness
 *
 * Every random number comes from the caller's seeded generator, drawn only while
 * planning — never per frame and never during a React render. The same seed and
 * the same table produce the same plan, which is what makes `ai.test.ts` able to
 * assert anything at all.
 */

import type { ArcadeDifficulty } from '../types';
import {
  BALL_BOUNDS,
  BALL_DIAMETER,
  MAX_SHOT_SPEED,
  MIN_SHOT_SPEED,
  POCKETS,
  ROLLING_DECEL,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
} from './table';
import {
  CUE_BALL,
  clamp,
  findBall,
  isLegalBallPosition,
  nearestLegalPosition,
  nearestMouthCrossing,
  normalise,
  pathIsClear,
  type PoolBall,
  type Vec2,
} from './physics';
import { legalTargets, type PoolGroup } from './rules';

export interface PoolAiProfile {
  readonly id: ArcadeDifficulty;
  readonly label: string;
  /** One line for the difficulty picker. */
  readonly blurb: string;
  /**
   * Half-width of the aim error applied to the chosen shot, in radians.
   *
   * The single most important knob. At 0.05 rad the opponent is about 2.9° out,
   * which over a 60-unit pot is roughly half a ball — a miss on anything long
   * and a pot on anything close, which is exactly how a casual player plays.
   */
  readonly aimErrorRad: number;
  /** Half-width of the power error, as a fraction of the computed power. */
  readonly powerError: number;
  /**
   * The thinnest cut it will attempt, as the cosine of the cut angle.
   *
   * 0.2 is a 78° cut — near the limit of what is possible at all. 0.45 is 63°,
   * which is the sort of cut a beginner does not see.
   */
  readonly minCutCos: number;
  /** Noise added to each candidate's score, so it does not always take the same shot. */
  readonly rankingNoise: number;
  /** How much a likely scratch costs a candidate's score. */
  readonly scratchAversion: number;
  /** How long it appears to think before shooting, in ms. */
  readonly thinkMs: number;
  /** How many cue-ball placements it tries when it has ball-in-hand. */
  readonly placementCandidates: number;
}

export const POOL_AI_PROFILES: Readonly<Record<'easy' | 'normal', PoolAiProfile>> = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    label: 'Easy',
    blurb: 'Takes the obvious pot and misses the hard ones.',
    aimErrorRad: 0.055,
    powerError: 0.26,
    minCutCos: 0.45,
    rankingNoise: 26,
    scratchAversion: 10,
    thinkMs: 950,
    placementCandidates: 5,
  }),
  normal: Object.freeze({
    id: 'normal',
    label: 'Normal',
    blurb: 'Hunts for the best angle and punishes a foul.',
    aimErrorRad: 0.019,
    powerError: 0.11,
    minCutCos: 0.22,
    rankingNoise: 8,
    scratchAversion: 45,
    thinkMs: 720,
    placementCandidates: 12,
  }),
});

/** The two difficulties Pool ships with. `hard` is left for later tuning. */
export type PoolDifficulty = keyof typeof POOL_AI_PROFILES;

export const POOL_DIFFICULTIES: readonly PoolDifficulty[] = Object.freeze(['easy', 'normal']);

export const DEFAULT_POOL_DIFFICULTY: PoolDifficulty = 'normal';

export function isPoolDifficulty(value: unknown): value is PoolDifficulty {
  return typeof value === 'string' && (POOL_DIFFICULTIES as readonly string[]).includes(value);
}

export function poolAiProfile(difficulty: PoolDifficulty): PoolAiProfile {
  return POOL_AI_PROFILES[difficulty];
}

/**
 * One committed decision.
 *
 * `angle` and `power` are exactly what a player's drag produces, and they are
 * fed into exactly the same function. `cuePlacement` is only ever set when the
 * opponent was given ball-in-hand, and the match applies it before the shot.
 */
export interface PoolShotPlan {
  /** Radians, in table space. */
  readonly angle: number;
  /** 0..1, the same scale the player's cue pull produces. */
  readonly power: number;
  /** Where to put the cue ball first, or `null` to shoot from where it is. */
  readonly cuePlacement: Vec2 | null;
  /** What it was going for. Reported for tests and for the HUD's "thinking" line. */
  readonly targetBall: number | null;
  readonly targetPocket: number | null;
  /**
   * What sort of shot this is.
   *
   * - `pot` — a pocket was found and this shot is aimed at it.
   * - `break` — the opening shot. Not a search; see {@link PlanPoolShotInput.isBreak}.
   * - `safety` — nothing was potable, so hit a legal ball firmly and move on.
   */
  readonly kind: 'pot' | 'break' | 'safety';
}

export interface PlanPoolShotInput {
  readonly balls: readonly PoolBall[];
  /** The planner's own group. `null` on an open table. */
  readonly group: PoolGroup | null;
  /** True when the opponent may place the cue ball before shooting. */
  readonly ballInHand: boolean;
  readonly profile: PoolAiProfile;
  /** A number in [0, 1) from the match's seeded generator. */
  readonly random: () => number;
  /**
   * True when this is the opening break.
   *
   * A break is not a shot the pot search can find and must not be planned like
   * one: every ball behind the apex is blocked by the ball in front of it, so
   * the search correctly rejects all ninety pairs and falls through to a gentle
   * legal knock — which taps the intact rack, moves nothing, and hands the table
   * back. Two opponents doing that to each other never open the table at all.
   *
   * So the break is a separate, explicit shot: full power at the front of the
   * rack. Found by playing the planner against itself, where it produced a
   * five-hundred-shot stalemate on a rack that was never actually broken.
   */
  readonly isBreak?: boolean;
}

/** A shot considered but not yet committed to. */
interface Candidate {
  readonly angle: number;
  readonly power: number;
  readonly score: number;
  readonly targetBall: number;
  readonly targetPocket: number;
  readonly cuePlacement: Vec2 | null;
}

/** Speed needed to roll `distance` units and just arrive: `v = √(2·a·d)`. */
function speedToTravel(distanceUnits: number): number {
  return Math.sqrt(2 * ROLLING_DECEL * Math.max(0, distanceUnits));
}

/** Inverse of `shotSpeedFor`, clamped into the playable band. */
function powerForSpeed(speed: number): number {
  return clamp((speed - MIN_SHOT_SPEED) / (MAX_SHOT_SPEED - MIN_SHOT_SPEED), 0, 1);
}

/**
 * How far a ray travels before it goes down a pocket, or `Infinity`.
 *
 * Uses the real pocket MOUTHS — the same segments the cushions leave, the
 * physics captures against and the renderer draws. It used to test a circle
 * around each pocket centre, which was a fourth, private idea of where a pocket
 * was; the planner could therefore avoid a scratch that could not happen and
 * walk into one that could.
 */
function travelToPocket(from: Vec2, direction: Vec2): number {
  return nearestMouthCrossing(from, direction)?.travel ?? Infinity;
}

function withinBounds(point: Vec2): boolean {
  return (
    point.x >= BALL_BOUNDS.minX &&
    point.x <= BALL_BOUNDS.maxX &&
    point.y >= BALL_BOUNDS.minY &&
    point.y <= BALL_BOUNDS.maxY
  );
}

/** Extra roll asked of the object ball, so it reaches the pocket rather than dying on the lip. */
const POT_MARGIN = 20;

/**
 * Every pot this cue position could attempt, scored.
 *
 * Pure geometry with no randomness — the noise and the error are applied by the
 * caller, after the choice, so the search itself is reproducible and testable.
 */
function candidatesFrom(
  cue: Vec2,
  balls: readonly PoolBall[],
  targets: readonly number[],
  profile: PoolAiProfile,
  cuePlacement: Vec2 | null,
): Candidate[] {
  const found: Candidate[] = [];

  for (const targetNumber of targets) {
    const target = findBall(balls, targetNumber);
    if (!target || target.pocketed) continue;

    for (let pocketIndex = 0; pocketIndex < POCKETS.length; pocketIndex += 1) {
      const pocket = POCKETS[pocketIndex];

      const toPocket = normalise(pocket.x - target.x, pocket.y - target.y);
      if (!toPocket) continue;

      // The ghost ball: where the cue ball's centre has to be at the moment of
      // contact for the object ball to leave along the line to the pocket.
      const ghost: Vec2 = {
        x: target.x - toPocket.x * BALL_DIAMETER,
        y: target.y - toPocket.y * BALL_DIAMETER,
      };
      if (!withinBounds(ghost)) continue;

      const toGhost = normalise(ghost.x - cue.x, ghost.y - cue.y);
      if (!toGhost) continue;

      // The cut angle: 1 is a straight pot, 0 is a right-angle cut nobody makes.
      const cutCos = toGhost.x * toPocket.x + toGhost.y * toPocket.y;
      if (cutCos < profile.minCutCos) continue;

      const cueTravel = Math.hypot(ghost.x - cue.x, ghost.y - cue.y);
      const potTravel = Math.hypot(pocket.x - target.x, pocket.y - target.y);

      if (!pathIsClear(cue, ghost, balls, [CUE_BALL, targetNumber])) continue;
      if (!pathIsClear(target, pocket, balls, [CUE_BALL, targetNumber])) continue;

      // Power. The object ball gets roughly `cos(cut)` of the cue ball's speed
      // at contact, and the cue ball has to reach the contact first — so the
      // shot is built backwards from the roll the object ball needs.
      const objectSpeed = speedToTravel(potTravel + POT_MARGIN);
      const contactSpeed = objectSpeed / Math.max(0.25, cutCos);
      const launchSpeed = Math.sqrt(contactSpeed * contactSpeed + 2 * ROLLING_DECEL * cueTravel);
      const power = powerForSpeed(launchSpeed);

      // Where the cue ball goes afterwards: perpendicular to the line of
      // centres, on the side it approached from. Straight into a pocket is a
      // scratch, and a scratch is worse than a miss.
      let scratchRisk = 0;
      const tangent = normalise(
        toGhost.x - toPocket.x * cutCos,
        toGhost.y - toPocket.y * cutCos,
      );
      if (tangent) {
        const runOn = travelToPocket(ghost, tangent);
        if (runOn < 55) scratchRisk = 1 - runOn / 55;
      }

      const score =
        100 * Math.pow(cutCos, 1.6) -
        potTravel * 0.24 -
        cueTravel * 0.09 -
        scratchRisk * profile.scratchAversion;

      found.push({
        angle: Math.atan2(toGhost.y, toGhost.x),
        power,
        score,
        targetBall: targetNumber,
        targetPocket: pocketIndex,
        cuePlacement,
      });
    }
  }

  return found;
}

/**
 * Cue-ball positions worth trying when the opponent has ball-in-hand.
 *
 * One per promising (ball, pocket) pair: sit the cue ball straight behind the
 * ghost ball, on the far side from the pocket, at a comfortable distance. That
 * is what a person does with ball-in-hand — line the easiest pot up dead
 * straight — and it needs no search of its own.
 *
 * The list is capped by {@link PoolAiProfile.placementCandidates}, so the work
 * is bounded whatever the table looks like.
 */
function placementCandidates(
  balls: readonly PoolBall[],
  targets: readonly number[],
  profile: PoolAiProfile,
): Vec2[] {
  const STAND_OFF = 30;
  const rated: { at: Vec2; potTravel: number }[] = [];

  for (const targetNumber of targets) {
    const target = findBall(balls, targetNumber);
    if (!target || target.pocketed) continue;

    for (const pocket of POCKETS) {
      const toPocket = normalise(pocket.x - target.x, pocket.y - target.y);
      if (!toPocket) continue;
      if (!pathIsClear(target, pocket, balls, [CUE_BALL, targetNumber])) continue;

      const at: Vec2 = {
        x: target.x - toPocket.x * (BALL_DIAMETER + STAND_OFF),
        y: target.y - toPocket.y * (BALL_DIAMETER + STAND_OFF),
      };
      if (!isLegalBallPosition(at, balls)) continue;

      rated.push({ at, potTravel: Math.hypot(pocket.x - target.x, pocket.y - target.y) });
    }
  }

  rated.sort((a, b) => a.potTravel - b.potTravel);
  return rated.slice(0, profile.placementCandidates).map((entry) => entry.at);
}

/** The band a fallback knock is played at. See {@link safetyPlan}. */
const KNOCK_MIN_POWER = 0.34;
const KNOCK_MAX_POWER = 0.72;
/** Extra roll asked of the cue ball on a knock, so it goes THROUGH the target. */
const KNOCK_FOLLOW_THROUGH = 90;

/**
 * A legal shot that is not a pot: hit the nearest reachable legal ball, firmly.
 *
 * Not clever, and it does not pretend to be a positional safety. It has exactly
 * two jobs, and the second one was learned the hard way:
 *
 *  1. **Avoid the `no-contact` foul.** A foul hands the opponent ball-in-hand,
 *     and one ball-in-hand is worth more than any safety this planner could
 *     compute.
 *  2. **Move the table on.** The first version played this at whatever speed
 *     just reached the target, which is a tap. Two planners tapping at each
 *     other never dislodge anything, and a table with no pot available stays a
 *     table with no pot available — measured at five hundred consecutive
 *     scoreless shots. Hitting THROUGH the ball with real pace is what turns a
 *     dead layout into a live one.
 *
 * It prefers a target it can actually see, and falls back to the nearest legal
 * ball if every one of them is snookered.
 */
function safetyPlan(
  cue: Vec2,
  balls: readonly PoolBall[],
  targets: readonly number[],
  cuePlacement: Vec2 | null,
  random: () => number,
): PoolShotPlan {
  let best: { number: number; distance: number; clear: boolean } | null = null;

  for (const targetNumber of targets) {
    const target = findBall(balls, targetNumber);
    if (!target || target.pocketed) continue;
    const gap = Math.hypot(target.x - cue.x, target.y - cue.y);
    const clear = pathIsClear(cue, target, balls, [CUE_BALL, targetNumber]);
    if (
      best === null ||
      (clear && !best.clear) ||
      (clear === best.clear && gap < best.distance)
    ) {
      best = { number: targetNumber, distance: gap, clear };
    }
  }

  if (best === null) {
    // No legal ball at all. Cannot happen while the match is live — the 8 is
    // always there until somebody wins — but a plan must always exist.
    const toCentre = normalise(TABLE_CENTER_X - cue.x, TABLE_CENTER_Y - cue.y) ?? { x: 1, y: 0 };
    return {
      angle: Math.atan2(toCentre.y, toCentre.x),
      power: KNOCK_MIN_POWER,
      cuePlacement,
      targetBall: null,
      targetPocket: null,
      kind: 'safety',
    };
  }

  const target = findBall(balls, best.number)!;
  const toTarget = normalise(target.x - cue.x, target.y - cue.y) ?? { x: 1, y: 0 };

  // A little scatter on the angle, so two dead layouts in a row are not hit
  // identically twice. Drawn from the seeded generator, so a replay still is.
  const jitter = (random() * 2 - 1) * 0.05;

  return {
    angle: Math.atan2(toTarget.y, toTarget.x) + jitter,
    power: clamp(
      powerForSpeed(speedToTravel(best.distance + KNOCK_FOLLOW_THROUGH)),
      KNOCK_MIN_POWER,
      KNOCK_MAX_POWER,
    ),
    cuePlacement,
    targetBall: best.number,
    targetPocket: null,
    kind: 'safety',
  };
}

/**
 * The break: everything, at the front of the rack.
 *
 * Deliberately not a search. See {@link PlanPoolShotInput.isBreak} — the pot
 * search cannot find a break, because every ball in an intact rack is screened
 * by the one in front of it, and letting it fall through to a knock produces a
 * game that never starts.
 *
 * The target is the legal ball nearest the cue ball, which on a racked table is
 * always the apex. A degree or so of scatter keeps consecutive breaks from being
 * identical, and full power is simply what a break is.
 */
function breakPlan(
  cue: Vec2,
  balls: readonly PoolBall[],
  targets: readonly number[],
  cuePlacement: Vec2 | null,
  random: () => number,
): PoolShotPlan {
  let apex: PoolBall | null = null;
  let nearest = Infinity;
  for (const targetNumber of targets) {
    const ball = findBall(balls, targetNumber);
    if (!ball || ball.pocketed) continue;
    const gap = Math.hypot(ball.x - cue.x, ball.y - cue.y);
    if (gap < nearest) {
      nearest = gap;
      apex = ball;
    }
  }

  const toApex = apex
    ? (normalise(apex.x - cue.x, apex.y - cue.y) ?? { x: 1, y: 0 })
    : { x: 1, y: 0 };

  return {
    angle: Math.atan2(toApex.y, toApex.x) + (random() * 2 - 1) * 0.028,
    power: clamp(0.9 + random() * 0.1, 0, 1),
    cuePlacement,
    targetBall: apex?.number ?? null,
    targetPocket: null,
    kind: 'break',
  };
}

/**
 * Choose this turn's shot.
 *
 * Called once, when the opponent's turn begins. Returns a plan; never a ball, a
 * position or a mutation.
 */
export function planPoolShot({
  balls,
  group,
  ballInHand,
  profile,
  random,
  isBreak = false,
}: PlanPoolShotInput): PoolShotPlan {
  const targets = legalTargets(balls, group);
  const cueBall = findBall(balls, CUE_BALL);

  // Where the cue ball is now, or a legal default if it is off the table (which
  // is what ball-in-hand after a scratch looks like).
  const currentCue: Vec2 =
    cueBall && !cueBall.pocketed
      ? { x: cueBall.x, y: cueBall.y }
      : nearestLegalPosition({ x: TABLE_CENTER_X * 0.5, y: TABLE_CENTER_Y }, balls);

  if (isBreak) return breakPlan(currentCue, balls, targets, null, random);

  let candidates: Candidate[];
  let fallbackCue: Vec2;
  let fallbackPlacement: Vec2 | null;

  if (ballInHand) {
    const spots = placementCandidates(balls, targets, profile);
    candidates = spots.flatMap((spot) =>
      candidatesFrom(spot, ballsWithCueAt(balls, spot), targets, profile, spot),
    );
    // Nothing lined up: put it back on a sensible legal spot and play safe.
    fallbackPlacement = spots[0] ?? nearestLegalPosition(currentCue, balls);
    fallbackCue = fallbackPlacement;
  } else {
    candidates = candidatesFrom(currentCue, balls, targets, profile, null);
    fallbackPlacement = null;
    fallbackCue = currentCue;
  }

  if (candidates.length === 0) {
    const safetyBalls = fallbackPlacement
      ? ballsWithCueAt(balls, fallbackPlacement)
      : balls;
    return safetyPlan(fallbackCue, safetyBalls, targets, fallbackPlacement, random);
  }

  // Rank, with a little noise so the same table does not always produce the same
  // shot — drawn from the seeded generator, so a replay still does.
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = candidate.score + random() * profile.rankingNoise;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // The error goes on AFTER the choice: it aims at the right place and misses
  // like a person, rather than choosing a worse shot.
  const angle = best.angle + (random() * 2 - 1) * profile.aimErrorRad;
  const power = clamp(best.power * (1 + (random() * 2 - 1) * profile.powerError), 0.05, 1);

  return {
    angle,
    power,
    cuePlacement: best.cuePlacement,
    targetBall: best.targetBall,
    targetPocket: best.targetPocket,
    kind: 'pot',
  };
}

/**
 * A copy of the table with the cue ball moved.
 *
 * Returns a NEW array of NEW objects — the planner is handed the real match's
 * balls and must not be able to move one. `ai.test.ts` checks that by identity.
 */
export function ballsWithCueAt(balls: readonly PoolBall[], at: Vec2): PoolBall[] {
  return balls.map((ball) =>
    ball.number === CUE_BALL ? { ...ball, x: at.x, y: at.y, vx: 0, vy: 0, pocketed: false } : ball,
  );
}
