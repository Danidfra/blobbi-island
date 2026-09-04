/**
 * The review scenarios, checked for being SETUPPABLE, not for their outcome.
 *
 * A scenario's job is to put a legal table in front of a person and tell them
 * what to look for. It rots in two ways: the layout drifts into something the
 * game cannot set up (a ball inside a cushion, two balls overlapping, no cue
 * ball), or the geometry moves underneath it and the shot stops pointing at the
 * thing it was written for. Both are caught here.
 *
 * What is deliberately NOT here is whether each shot does what its `expected`
 * sentence says. Several of them are about how something LOOKS, and the ones
 * that can be asserted are asserted in `pool-physics-world.test.ts`: a second,
 * weaker copy would just be a place for the two to disagree.
 */
import { describe, it, expect } from 'vitest';

import { POOL_SCENARIOS, SCENARIO_BOUNDS, poolScenario } from './pool-scenarios';
import { BALL_DIAMETER, FIXED_STEP_MS } from './table';
import { CUE_BALL, isLegalBallPosition } from './physics';
import { createPoolPhysicsWorld } from './pool-physics-world';

const DT = FIXED_STEP_MS / 1000;

describe('the review scenarios', () => {
  it('covers every case the migration brief asks a reviewer to look at', () => {
    expect(POOL_SCENARIOS).toHaveLength(15);
    expect(new Set(POOL_SCENARIOS.map((s) => s.id)).size).toBe(15);
  });

  it('can be looked up by id', () => {
    expect(poolScenario('break')?.label).toMatch(/rack/i);
    expect(poolScenario('nope')).toBeNull();
  });

  it.each(POOL_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s is a table the game could actually set up',
    (_id, scenario) => {
      const cue = scenario.balls.find((b) => b.number === CUE_BALL);
      expect(cue, 'every scenario needs a cue ball').toBeDefined();

      for (const ball of scenario.balls) {
        expect(ball.pocketed, `${ball.number} starts on the table`).toBe(false);
        expect(ball.vx === 0 && ball.vy === 0, `${ball.number} starts at rest`).toBe(true);
        expect(ball.x, `${ball.number} x`).toBeGreaterThanOrEqual(SCENARIO_BOUNDS.minX - 1e-9);
        expect(ball.x, `${ball.number} x`).toBeLessThanOrEqual(SCENARIO_BOUNDS.maxX + 1e-9);
        expect(ball.y, `${ball.number} y`).toBeGreaterThanOrEqual(SCENARIO_BOUNDS.minY - 1e-9);
        expect(ball.y, `${ball.number} y`).toBeLessThanOrEqual(SCENARIO_BOUNDS.maxY + 1e-9);
      }

      // No two balls inside each other, and none in a pocket mouth.
      for (let i = 0; i < scenario.balls.length; i += 1) {
        const a = scenario.balls[i];
        expect(
          isLegalBallPosition(a, scenario.balls, a.number),
          `${scenario.id}: ball ${a.number} is not on legal cloth`,
        ).toBe(true);
        for (let k = i + 1; k < scenario.balls.length; k += 1) {
          const b = scenario.balls[k];
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `${scenario.id}: ${a.number}/${b.number}`,
          ).toBeGreaterThanOrEqual(BALL_DIAMETER - 1e-6);
        }
      }
    },
  );

  it.each(POOL_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s describes what to look for',
    (_id, scenario) => {
      expect(scenario.label.length).toBeGreaterThan(4);
      expect(scenario.expected.length).toBeGreaterThan(30);
      expect(scenario.expected).toMatch(/\.$/);
    },
  );

  it.each(POOL_SCENARIOS.filter((s) => s.shot !== null).map((s) => [s.id, s] as const))(
    '%s has a shot that is playable and settles',
    (_id, scenario) => {
      const shot = scenario.shot!;
      expect(Number.isFinite(shot.angle)).toBe(true);
      expect(shot.power).toBeGreaterThan(0);
      expect(shot.power).toBeLessThanOrEqual(1);

      // And it actually resolves. A scenario that hangs is worse than none.
      const world = createPoolPhysicsWorld();
      world.reset(scenario.balls);
      world.strike(shot.angle, 40 + shot.power * 145);
      let steps = 0;
      while (!world.isSettled() && steps < 8000) {
        world.step(DT);
        world.drain();
        steps += 1;
      }
      expect(world.isSettled(), `${scenario.id} settles`).toBe(true);
      for (const ball of world.snapshot()) {
        expect(Number.isFinite(ball.x) && Number.isFinite(ball.y), String(ball.number)).toBe(true);
      }
      world.dispose();
    },
  );
});

describe('the scenarios that CAN be judged automatically, are', () => {
  /** Play a scenario and report every ball that went down, and where. */
  function play(id: string): { ball: number; pocket: number }[] {
    const scenario = poolScenario(id)!;
    const world = createPoolPhysicsWorld();
    world.reset(scenario.balls);
    if (scenario.shot) world.strike(scenario.shot.angle, 40 + scenario.shot.power * 145);
    const potted: { ball: number; pocket: number }[] = [];
    let steps = 0;
    while (!world.isSettled() && steps < 8000) {
      world.step(DT);
      potted.push(...world.drain().pocketed.map((p) => ({ ball: p.ball, pocket: p.pocket })));
      steps += 1;
    }
    world.dispose();
    return potted;
  }

  const potted = (id: string) => play(id).map((p) => p.ball);

  it('drops the slow corner approach', () => {
    expect(potted('corner-slow')).toContain(CUE_BALL);
  });

  it('drops the fast corner approach', () => {
    expect(potted('corner-fast')).toContain(CUE_BALL);
  });

  it('drops the slow side approach', () => {
    expect(potted('side-slow')).toContain(CUE_BALL);
  });

  it('rejects the corner jaw graze', () => {
    expect(potted('corner-jaw')).not.toContain(CUE_BALL);
  });

  it('runs past the SIDE pocket without dropping into it', () => {
    // Reaching the far corner and dropping there is correct and expected, the
    // contract is only that the side pocket (index 1) did not take it.
    expect(play('rail-past-side').map((p) => p.pocket)).not.toContain(1);
  });

  it('scratches when it is supposed to', () => {
    expect(potted('scratch')).toContain(CUE_BALL);
  });
});
