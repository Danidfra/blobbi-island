/**
 * The opponent — what it may aim at, and what it may not do.
 *
 * Two kinds of claim are being checked here, and the second matters more than
 * the first:
 *
 *  - **it plays well enough**: it finds a pot when one exists, prefers the
 *    easier of two, and misses by a human amount;
 *  - **it cannot cheat**: it returns a PLAN, never a ball. It cannot move a
 *    ball, cannot exceed the player's power, cannot place the cue ball
 *    illegally and cannot aim at something the rules forbid.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_POOL_DIFFICULTY,
  POOL_AI_PROFILES,
  POOL_DIFFICULTIES,
  ballsWithCueAt,
  isPoolDifficulty,
  planPoolShot,
  poolAiProfile,
  type PoolShotPlan,
} from './ai';
import { CUE_BALL, EIGHT_BALL, isLegalBallPosition, type PoolBall } from './physics';
import { buildRack, nextRandom, poolSeedFrom } from './rack';
import { legalTargets, type PoolGroup } from './rules';
import { POCKETS, TABLE_LENGTH } from './table';

function ball(number: number, x: number, y: number, pocketed = false): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed };
}

/** A deterministic generator, so every assertion below is reproducible. */
function seededRandom(seed = 12345) {
  let state = seed;
  return () => {
    const draw = nextRandom(state);
    state = draw.state;
    return draw.value;
  };
}

function plan(
  balls: PoolBall[],
  group: PoolGroup | null = 'solids',
  overrides: Partial<Parameters<typeof planPoolShot>[0]> = {},
): PoolShotPlan {
  return planPoolShot({
    balls,
    group,
    ballInHand: false,
    profile: POOL_AI_PROFILES.normal,
    random: seededRandom(),
    ...overrides,
  });
}

describe('difficulties', () => {
  it('ships exactly Easy and Normal, with Normal as the default', () => {
    expect(POOL_DIFFICULTIES).toEqual(['easy', 'normal']);
    expect(DEFAULT_POOL_DIFFICULTY).toBe('normal');
    expect(isPoolDifficulty('easy')).toBe(true);
    expect(isPoolDifficulty('hard')).toBe(false);
    expect(isPoolDifficulty(3)).toBe(false);
  });

  it('makes Easy strictly worse on every knob that matters', () => {
    const easy = poolAiProfile('easy');
    const normal = poolAiProfile('normal');
    expect(easy.aimErrorRad).toBeGreaterThan(normal.aimErrorRad);
    expect(easy.powerError).toBeGreaterThan(normal.powerError);
    // A higher cosine floor means it refuses thinner cuts — fewer shots seen.
    expect(easy.minCutCos).toBeGreaterThan(normal.minCutCos);
    expect(easy.rankingNoise).toBeGreaterThan(normal.rankingNoise);
    expect(easy.scratchAversion).toBeLessThan(normal.scratchAversion);
    expect(easy.placementCandidates).toBeLessThan(normal.placementCandidates);
  });

  it('thinks for long enough to be read, and not so long it annoys', () => {
    for (const id of POOL_DIFFICULTIES) {
      const profile = poolAiProfile(id);
      expect(profile.thinkMs, id).toBeGreaterThanOrEqual(400);
      expect(profile.thinkMs, id).toBeLessThanOrEqual(1200);
      expect(profile.label.length, id).toBeGreaterThan(0);
      expect(profile.blurb.length, id).toBeGreaterThan(10);
    }
  });
});

describe('every plan is playable', () => {
  const layouts: Record<string, PoolBall[]> = {
    'a clear pot': [ball(CUE_BALL, 40, 50), ball(1, 120, 50), ball(EIGHT_BALL, 90, 20)],
    'nothing but the 8': [ball(CUE_BALL, 40, 50), ball(EIGHT_BALL, 150, 50)],
    'everything snookered': [
      ball(CUE_BALL, 40, 50),
      ball(9, 46, 50),
      ball(10, 52, 50),
      ball(1, 120, 50),
      ball(EIGHT_BALL, 150, 50),
    ],
    'balls on the cushions': [
      ball(CUE_BALL, 100, 50),
      ball(1, 3, 60),
      ball(2, 197, 40),
      ball(EIGHT_BALL, 100, 97),
    ],
    'a full rack': buildRack(poolSeedFrom('plan')).balls as PoolBall[],
  };

  it.each(Object.entries(layouts))('%s produces a finite, legal shot', (_label, balls) => {
    for (const group of ['solids', 'stripes', null] as const) {
      for (const id of POOL_DIFFICULTIES) {
        const shot = planPoolShot({
          balls,
          group,
          ballInHand: false,
          profile: poolAiProfile(id),
          random: seededRandom(),
        });
        expect(Number.isFinite(shot.angle), `${id}/${group}`).toBe(true);
        expect(Number.isFinite(shot.power), `${id}/${group}`).toBe(true);
        expect(shot.power).toBeGreaterThanOrEqual(0);
        expect(shot.power).toBeLessThanOrEqual(1);
        expect(['pot', 'break', 'safety']).toContain(shot.kind);
      }
    }
  });

  it('never plans a shot the rules would call a foul first contact', () => {
    const balls = [
      ball(CUE_BALL, 40, 50),
      ball(1, 100, 40),
      ball(2, 130, 70),
      ball(9, 80, 20),
      ball(10, 150, 80),
      ball(EIGHT_BALL, 60, 80),
    ];
    for (const group of ['solids', 'stripes'] as const) {
      const legal = legalTargets(balls, group);
      for (const id of POOL_DIFFICULTIES) {
        const shot = planPoolShot({
          balls,
          group,
          ballInHand: false,
          profile: poolAiProfile(id),
          random: seededRandom(),
        });
        if (shot.targetBall !== null) {
          expect(legal, `${id}/${group}`).toContain(shot.targetBall);
        }
      }
    }
  });

  it('takes the 8-ball on once its group is gone, and nothing else', () => {
    const balls = [ball(CUE_BALL, 40, 50), ball(EIGHT_BALL, 120, 50), ball(9, 150, 80)];
    const shot = plan(balls, 'solids');
    expect(shot.targetBall).toBe(EIGHT_BALL);
  });

  it('leaves the 8-ball alone while the table is open', () => {
    const balls = [ball(CUE_BALL, 40, 50), ball(EIGHT_BALL, 120, 50), ball(9, 150, 80)];
    const shot = plan(balls, null);
    expect(shot.targetBall).not.toBe(EIGHT_BALL);
  });
});

/**
 * A dead-straight pot into a corner: cue ball, object ball and pocket all on
 * one line, with room behind the object for the cue ball to be.
 *
 * Built rather than written out, because hand-picked coordinates put balls on
 * `y = 0` in an earlier pass — which is the rail, not the cloth, and produced a
 * layout with no legal shot in it at all.
 */
const CORNER = POCKETS[2]; // (200, 0)
const STRAIGHT_TARGET = { x: 170, y: 20 };
const STRAIGHT_AIM = Math.atan2(CORNER.y - STRAIGHT_TARGET.y, CORNER.x - STRAIGHT_TARGET.x);
const STRAIGHT_CUE = {
  x: STRAIGHT_TARGET.x - Math.cos(STRAIGHT_AIM) * 45,
  y: STRAIGHT_TARGET.y - Math.sin(STRAIGHT_AIM) * 45,
};

function straightPotLayout(...extra: PoolBall[]): PoolBall[] {
  return [
    ball(CUE_BALL, STRAIGHT_CUE.x, STRAIGHT_CUE.y),
    ball(1, STRAIGHT_TARGET.x, STRAIGHT_TARGET.y),
    ball(EIGHT_BALL, 60, 80),
    ...extra,
  ];
}

describe('choosing a shot', () => {
  it('finds a straight pot when one is sitting there', () => {
    const shot = plan(straightPotLayout(), 'solids');
    expect(shot.kind).toBe('pot');
    expect(shot.targetBall).toBe(1);
    expect(shot.targetPocket).toBe(2);
    // Aimed along the line it was built on, give or take the difficulty's error.
    expect(Math.abs(shot.angle - STRAIGHT_AIM)).toBeLessThan(0.1);
  });

  it('prefers the easy pot over the desperate cut', () => {
    // The 1 is dead straight; the 2 sits against the far cushion where every
    // pocket is a 70°-plus cut.
    const balls = straightPotLayout(ball(2, 150, 96));
    expect(plan(balls, 'solids').targetBall).toBe(1);
  });

  it('rejects a pot it cannot reach, and plays a legal knock instead', () => {
    // The 1 is potable in principle but the 9 sits directly in the cue ball's
    // way, and the 1 is screened from every pocket.
    const balls = [
      ball(CUE_BALL, 30, 50),
      ball(9, 60, 50),
      ball(1, 66, 50),
      ball(2, 72, 50),
      ball(EIGHT_BALL, 78, 50),
    ];
    const shot = plan(balls, 'solids');
    expect(shot.kind).toBe('safety');
    // A knock still has to move something: a tap that dislodges nothing is how
    // two planners deadlock a frame.
    expect(shot.power).toBeGreaterThan(0.3);
  });

  it('always makes contact on a knock, so it does not foul for nothing', () => {
    const balls = [ball(CUE_BALL, 30, 50), ball(9, 40, 50), ball(1, 46, 50), ball(EIGHT_BALL, 52, 50)];
    const shot = plan(balls, 'solids');
    expect(shot.targetBall).not.toBeNull();
    expect(legalTargets(balls, 'solids')).toContain(shot.targetBall!);
  });

  it('smashes the rack on the break rather than tapping it', () => {
    // The pot search correctly rejects every shot at an intact rack, so without
    // this branch the break is a knock and the frame never opens.
    const balls = buildRack(poolSeedFrom('break')).balls as PoolBall[];
    const shot = planPoolShot({
      balls,
      group: null,
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(),
      isBreak: true,
    });
    expect(shot.kind).toBe('break');
    expect(shot.power).toBeGreaterThan(0.85);
    // Straight up the table at the apex.
    expect(Math.abs(shot.angle)).toBeLessThan(0.05);
  });
});

describe('error, and where it is applied', () => {
  it('misses by more on Easy than on Normal, from the same table', () => {
    // One dominant shot, so the spread being measured is the AIM ERROR and not
    // the two difficulties disagreeing about which ball to take on.
    const balls = straightPotLayout();

    const spread = (id: 'easy' | 'normal') => {
      const angles: number[] = [];
      for (let seed = 1; seed <= 60; seed += 1) {
        angles.push(
          planPoolShot({
            balls,
            group: 'solids',
            ballInHand: false,
            profile: poolAiProfile(id),
            random: seededRandom(seed * 7919),
          }).angle,
        );
      }
      const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
      return Math.sqrt(angles.reduce((a, b) => a + (b - mean) ** 2, 0) / angles.length);
    };

    expect(spread('easy')).toBeGreaterThan(spread('normal') * 1.5);
  });

  it('aims at the RIGHT place and then misses, rather than picking a worse shot', () => {
    // The distinction that makes the opponent look human: over many draws the
    // average aim is the correct one.
    const balls = straightPotLayout();
    let sum = 0;
    const runs = 80;
    for (let seed = 1; seed <= runs; seed += 1) {
      sum += planPoolShot({
        balls,
        group: 'solids',
        ballInHand: false,
        profile: POOL_AI_PROFILES.easy,
        random: seededRandom(seed * 104729),
      }).angle;
    }
    expect(Math.abs(sum / runs - STRAIGHT_AIM)).toBeLessThan(POOL_AI_PROFILES.easy.aimErrorRad);
  });

  it('never plans a shot outside the power band a player has', () => {
    const balls = buildRack(poolSeedFrom('power')).balls as PoolBall[];
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const id of POOL_DIFFICULTIES) {
        const shot = planPoolShot({
          balls,
          group: null,
          ballInHand: false,
          profile: poolAiProfile(id),
          random: seededRandom(seed),
        });
        expect(shot.power).toBeGreaterThanOrEqual(0);
        expect(shot.power).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('determinism', () => {
  it('gives the same plan for the same table and the same seed', () => {
    const balls = buildRack(poolSeedFrom('determinism')).balls as PoolBall[];
    const once = planPoolShot({
      balls,
      group: null,
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(555),
    });
    const twice = planPoolShot({
      balls,
      group: null,
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(555),
    });
    expect(once).toEqual(twice);
  });

  it('gives a different plan for a different seed', () => {
    const balls = buildRack(poolSeedFrom('determinism')).balls as PoolBall[];
    const a = planPoolShot({
      balls,
      group: null,
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(1),
    });
    const b = planPoolShot({
      balls,
      group: null,
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(2),
    });
    expect(a).not.toEqual(b);
  });

  it('calls no clock and no global randomness', () => {
    // Enforced structurally: the only entropy is the injected generator, so a
    // planner given a generator that always returns the same value is constant.
    const balls = [ball(CUE_BALL, 40, 50), ball(1, 120, 50), ball(EIGHT_BALL, 90, 20)];
    const fixed = () => 0.5;
    const a = planPoolShot({
      balls,
      group: 'solids',
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: fixed,
    });
    const b = planPoolShot({
      balls,
      group: 'solids',
      ballInHand: false,
      profile: POOL_AI_PROFILES.normal,
      random: fixed,
    });
    expect(a).toEqual(b);
  });
});

describe('it cannot touch the table', () => {
  it('leaves every ball object exactly as it found it', () => {
    const balls = buildRack(poolSeedFrom('immutable')).balls as PoolBall[];
    const snapshot = JSON.parse(JSON.stringify(balls));
    const identities = balls.slice();

    planPoolShot({
      balls,
      group: null,
      ballInHand: true,
      profile: POOL_AI_PROFILES.normal,
      random: seededRandom(),
    });

    expect(balls).toEqual(snapshot);
    balls.forEach((b, i) => expect(b).toBe(identities[i]));
  });

  it('copies the table when it tries a cue-ball position', () => {
    const balls = [ball(CUE_BALL, 40, 50), ball(1, 120, 50)];
    const moved = ballsWithCueAt(balls, { x: 90, y: 30 });
    expect(moved).not.toBe(balls);
    expect(moved[0]).not.toBe(balls[0]);
    expect(balls[0].x).toBe(40);
    expect(moved[0].x).toBe(90);
    expect(moved[0].vx).toBe(0);
    expect(moved[0].pocketed).toBe(false);
    // Everything else is carried across untouched.
    expect(moved[1]).toBe(balls[1]);
  });
});

describe('ball-in-hand', () => {
  const balls = [
    ball(CUE_BALL, 40, 50, true), // scratched — it is off the table
    ball(1, 120, 40),
    ball(2, 80, 70),
    ball(EIGHT_BALL, 150, 50),
  ];

  it('always names a legal spot for the cue ball', () => {
    for (const id of POOL_DIFFICULTIES) {
      for (let seed = 1; seed <= 15; seed += 1) {
        const shot = planPoolShot({
          balls,
          group: 'solids',
          ballInHand: true,
          profile: poolAiProfile(id),
          random: seededRandom(seed),
        });
        expect(shot.cuePlacement, `${id}/${seed}`).not.toBeNull();
        expect(
          isLegalBallPosition(shot.cuePlacement!, balls, CUE_BALL),
          `${id}/${seed} → ${JSON.stringify(shot.cuePlacement)}`,
        ).toBe(true);
      }
    }
  });

  it('places the cue ball on the cloth, never in a pocket or a ball', () => {
    const shot = plan(balls, 'solids', { ballInHand: true });
    const at = shot.cuePlacement!;
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(TABLE_LENGTH);
    for (const pocket of POCKETS) {
      expect(Math.hypot(at.x - pocket.x, at.y - pocket.y)).toBeGreaterThan(4.2);
    }
  });

  it('lines a pot up rather than dropping the ball anywhere', () => {
    const shot = plan(balls, 'solids', { ballInHand: true });
    expect(shot.kind).toBe('pot');
    expect(shot.targetBall).not.toBeNull();
  });

  it('still finds a legal spot when nothing can be potted', () => {
    const stuck = [
      ball(CUE_BALL, 40, 50, true),
      ball(9, 100, 50),
      ball(1, 106, 50),
      ball(10, 112, 50),
      ball(EIGHT_BALL, 118, 50),
    ];
    const shot = plan(stuck, 'solids', { ballInHand: true });
    expect(shot.cuePlacement).not.toBeNull();
    expect(isLegalBallPosition(shot.cuePlacement!, stuck, CUE_BALL)).toBe(true);
  });

  it('does not move the cue ball when it was not offered one', () => {
    expect(plan([ball(CUE_BALL, 40, 50), ball(1, 120, 50)], 'solids').cuePlacement).toBeNull();
  });
});
