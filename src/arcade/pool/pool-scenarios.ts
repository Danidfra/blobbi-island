/**
 * Pool — the manual physics review scenarios.
 *
 * Fifteen repeatable table layouts, each one a thing the physics has to get
 * right and a thing that is quicker to judge with your eyes than to assert. They
 * are the acceptance list from the Planck migration brief, written down so that
 * "the jaws feel right" can be re-checked in ten seconds rather than by playing
 * frames until the situation happens to come up.
 *
 * Pure data plus an `expected` sentence: no React, no Planck, no DOM. The DEV
 * harness (`/dev/arcade`) renders them through the real controller, and
 * `pool-scenarios.test.ts` checks every one of them still describes a legal
 * table so a scenario cannot rot into a layout that cannot be set up.
 *
 * They are deliberately NOT assertions. A scenario says what should happen in a
 * sentence a person can compare against the screen; the automated versions of
 * the ones that CAN be asserted live in `pool-physics-world.test.ts`.
 */

import { BALL_DIAMETER, BALL_RADIUS, HEAD_SPOT, TABLE_LENGTH, TABLE_WIDTH } from './table';
import { CUE_BALL, EIGHT_BALL, type PoolBall } from './physics';
import { POOL_POCKETS } from './pool-physics-geometry';
import { buildRack, poolSeedFrom } from './rack';

export interface PoolScenario {
  readonly id: string;
  readonly label: string;
  /** What a reviewer should see. One sentence, checkable by eye. */
  readonly expected: string;
  /** The table to set up. The cue ball must be in here. */
  readonly balls: readonly PoolBall[];
  /**
   * A suggested shot, so a scenario can be replayed identically.
   *
   * `null` means "aim it yourself" — used by the two scenarios that are about a
   * table at rest rather than about a shot.
   */
  readonly shot: { readonly angle: number; readonly power: number } | null;
}

function ball(number: number, x: number, y: number): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed: false };
}

/** Aim from one point at another. */
function aim(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

const CORNER = POOL_POCKETS[2]; // (200, 0)
const SIDE = POOL_POCKETS[1]; // (100, 0)

/** A point `away` units from `target`, on the line toward `through`. */
function offsetFrom(
  target: { x: number; y: number },
  through: { x: number; y: number },
  away: number,
) {
  const dx = through.x - target.x;
  const dy = through.y - target.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: target.x + (dx / length) * away, y: target.y + (dy / length) * away };
}

/**
 * A hair more than a diameter.
 *
 * Two balls placed at EXACTLY `BALL_DIAMETER` are legal in the abstract and
 * round to overlapping in binary, so a "touching" scenario would set itself up
 * as an illegal table. This is the same reason the rack has `RACK_GAP`.
 */
const TOUCHING = BALL_DIAMETER + 0.02;

const STRAIGHT_TARGET = { x: 140, y: 50 };
const STRAIGHT_CUE = { x: 60, y: 50 };

const CUT_TARGET = { x: 140, y: 50 };
const CUT_CUE = { x: 70, y: 50 + BALL_DIAMETER * 0.75 };

const CORNER_APPROACH = offsetFrom(CORNER.mouthMid, { x: 120, y: 45 }, 55);
const SIDE_APPROACH = offsetFrom(SIDE.mouthMid, { x: SIDE.mouthMid.x, y: 60 }, 45);

/**
 * A point on the cushion just short of a mouth.
 *
 * `mouthB` of the bottom-right corner is the nose of the bottom-right cushion,
 * so a few units back along the rail from it is solid cushion — the jaw. The
 * approach angle matters as much as the point: a ball ROLLING ALONG the rail
 * would carry on past and drop in the corner, so these are struck steeply so a
 * graze is a graze.
 */
const CORNER_JAW = { x: CORNER.mouthB.x - 5, y: BALL_RADIUS };
const CORNER_JAW_FROM = { x: 150, y: 42 };

const SIDE_JAW = { x: SIDE.mouthA.x - 4, y: BALL_RADIUS };
const SIDE_JAW_FROM = { x: 60, y: 40 };

export const POOL_SCENARIOS: readonly PoolScenario[] = Object.freeze([
  {
    id: 'straight',
    label: '1 · Straight head-on',
    expected:
      'The object ball goes dead straight down the table and the cue ball stops almost on the spot.',
    balls: [ball(CUE_BALL, STRAIGHT_CUE.x, STRAIGHT_CUE.y), ball(1, STRAIGHT_TARGET.x, STRAIGHT_TARGET.y)],
    shot: { angle: aim(STRAIGHT_CUE, STRAIGHT_TARGET), power: 0.45 },
  },
  {
    id: 'thin-cut',
    label: '2 · Thin cut',
    expected:
      'The object ball leaves along the line of centres and the cue ball carries on at about a right angle to it.',
    balls: [ball(CUE_BALL, CUT_CUE.x, CUT_CUE.y), ball(1, CUT_TARGET.x, CUT_TARGET.y)],
    shot: {
      angle: aim(CUT_CUE, { x: CUT_TARGET.x, y: CUT_TARGET.y + BALL_DIAMETER * 0.75 }),
      power: 0.6,
    },
  },
  {
    id: 'three-line',
    label: '3 · Three-ball line',
    expected:
      'The far ball takes nearly all the pace; the middle ball barely moves and does not squirt sideways.',
    balls: [
      ball(CUE_BALL, 40, 50),
      ball(1, 110, 50),
      ball(2, 110 + TOUCHING + 0.3, 50),
    ],
    shot: { angle: 0, power: 0.6 },
  },
  {
    id: 'cluster',
    label: '4 · Four-ball cluster',
    expected: 'The cluster opens up cleanly. Nothing jumps, overlaps, or is flung off the table.',
    balls: [
      ball(CUE_BALL, 40, 50),
      ball(1, 120, 50),
      ball(2, 120 + TOUCHING, 50),
      ball(3, 120 + BALL_RADIUS, 50 + TOUCHING * 0.88),
      ball(4, 120 + BALL_RADIUS, 50 - TOUCHING * 0.88),
    ],
    shot: { angle: 0, power: 0.85 },
  },
  {
    id: 'break',
    label: '5 · Full rack and break',
    expected: 'The rack scatters widely, settles within a few seconds, and usually drops a ball or two.',
    balls: buildRack(poolSeedFrom('scenario-break')).balls,
    shot: { angle: 0, power: 1 },
  },
  {
    id: 'corner-slow',
    label: '6 · Slow corner approach',
    expected: 'The ball trickles into the corner and drops. It must not stop on the lip.',
    balls: [ball(CUE_BALL, CORNER_APPROACH.x, CORNER_APPROACH.y)],
    shot: { angle: aim(CORNER_APPROACH, CORNER.mouthMid), power: 0.12 },
  },
  {
    id: 'corner-fast',
    label: '7 · Fast corner approach',
    expected: 'The ball drops at full pace. It must not skip across the mouth or rattle back out.',
    balls: [ball(CUE_BALL, CORNER_APPROACH.x, CORNER_APPROACH.y)],
    shot: { angle: aim(CORNER_APPROACH, CORNER.mouthMid), power: 1 },
  },
  {
    id: 'side-slow',
    label: '8 · Slow side-pocket approach',
    expected: 'The ball rolls gently into the side pocket and drops.',
    balls: [ball(CUE_BALL, SIDE_APPROACH.x, SIDE_APPROACH.y)],
    shot: { angle: aim(SIDE_APPROACH, SIDE.mouthMid), power: 0.14 },
  },
  {
    id: 'corner-jaw',
    label: '9 · Corner jaw graze',
    expected:
      'The ball catches the cushion just outside the mouth and comes back onto the table. It must not vanish and must not stop dead.',
    balls: [ball(CUE_BALL, CORNER_JAW_FROM.x, CORNER_JAW_FROM.y)],
    shot: { angle: aim(CORNER_JAW_FROM, CORNER_JAW), power: 0.5 },
  },
  {
    id: 'side-jaw',
    label: '10 · Side-pocket jaw graze',
    expected: 'The ball clips the near jaw of the side pocket and deflects along the rail.',
    balls: [ball(CUE_BALL, SIDE_JAW_FROM.x, SIDE_JAW_FROM.y)],
    shot: { angle: aim(SIDE_JAW_FROM, SIDE_JAW), power: 0.5 },
  },
  {
    id: 'rail-past-side',
    label: '11 · Rail run past a side pocket',
    expected:
      'The ball runs along the cushion, passes the side pocket WITHOUT dropping, and carries on to the far corner (where it may well drop — that part is correct).',
    balls: [ball(CUE_BALL, 30, BALL_RADIUS)],
    shot: { angle: 0, power: 0.55 },
  },
  {
    id: 'scratch',
    label: '12 · Cue-ball scratch',
    expected:
      'The cue ball goes straight down the corner. The banner says "Scratch" and the rival is given ball-in-hand.',
    balls: [ball(CUE_BALL, 60, 60), ball(1, 150, 20), ball(EIGHT_BALL, 160, 70)],
    shot: { angle: aim({ x: 60, y: 60 }, POOL_POCKETS[3].mouthMid), power: 0.5 },
  },
  {
    id: 'frozen-rail',
    label: '13 · Ball frozen on a cushion',
    expected:
      'The rail ball is struck square and runs along the cushion without jumping or sticking.',
    balls: [ball(CUE_BALL, 70, 30), ball(1, 120, BALL_RADIUS)],
    shot: { angle: aim({ x: 70, y: 30 }, { x: 120, y: BALL_RADIUS }), power: 0.55 },
  },
  {
    id: 'touching',
    label: '14 · Two balls touching at rest',
    expected:
      'The pair sits perfectly still until it is hit; then the far ball takes the pace and the near one stays.',
    balls: [
      ball(CUE_BALL, 40, 50),
      ball(1, 130, 50),
      ball(2, 130 + TOUCHING, 50),
    ],
    shot: null,
  },
  {
    id: 'max-power',
    label: '15 · Maximum-power shot',
    expected:
      'The cue ball crosses the table several times, rebounds cleanly every time, never tunnels, and settles.',
    balls: [ball(CUE_BALL, HEAD_SPOT.x, HEAD_SPOT.y)],
    shot: { angle: 0.37, power: 1 },
  },
]);

export function poolScenario(id: string): PoolScenario | null {
  return POOL_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

/** The playfield bounds a scenario ball must sit inside. Used by its own test. */
export const SCENARIO_BOUNDS = Object.freeze({
  minX: BALL_RADIUS,
  maxX: TABLE_LENGTH - BALL_RADIUS,
  minY: BALL_RADIUS,
  maxY: TABLE_WIDTH - BALL_RADIUS,
});
