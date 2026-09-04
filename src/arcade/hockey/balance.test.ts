/**
 * Air Hockey balance, does a match actually work as a match?
 *
 * The three questions a physics test cannot answer, answered by playing whole
 * matches in a loop: does the opponent score, can it be beaten, and does a match
 * end in the time the machine's card promises?
 *
 * ## The reference opponent
 *
 * The "player" here is the SAME controller, mirrored across the centre line and
 * driving the player's mallet. That is the only fair yardstick available, a
 * hand-written stand-in would measure the stand-in, and it makes the test
 * symmetric by construction: any bias it finds is a bias in the game, not in the
 * harness. The mirrored side is genuinely stronger, because the player's mallet
 * is faster than any opponent profile, which is exactly the advantage a person
 * steering by hand is meant to have.
 *
 * ## Why the thresholds are loose
 *
 * These are tuning guards, not specifications. They exist to catch the two
 * failures that actually happened during development, a 0–0 stalemate that ran
 * past four hundred simulated seconds, and a puck creeping along a rail for
 * forty seconds while nobody could reach it, without breaking every time a
 * constant is nudged. A tighter assertion here would be a test about the
 * harness's arithmetic rather than about whether the game is playable.
 */

import { describe, it, expect } from 'vitest';

import {
  createHockeyAiState,
  hockeyAiProfile,
  stepHockeyAi,
  type HockeyAiState,
  type HockeyDifficulty,
} from './ai';
import { createHockeyMatch, stepHockeyMatch, type HockeyMatchState } from './match';
import {
  moveMalletToward,
  speedOf,
  type MalletState,
  type PuckState,
  type Vec2,
} from './physics';
import { FIXED_STEP_MS, TABLE_HEIGHT } from './table';

const DT = FIXED_STEP_MS / 1000;
/** Well past any plausible match; reaching it is itself a failure. */
const STEP_CAP = 120 * 420;

const mirrorPuck = (p: PuckState): PuckState => ({
  x: p.x,
  y: TABLE_HEIGHT - p.y,
  vx: p.vx,
  vy: -p.vy,
});
const mirrorMallet = (m: MalletState): MalletState => ({
  x: m.x,
  y: TABLE_HEIGHT - m.y,
  vx: m.vx,
  vy: -m.vy,
});
const mirrorPoint = (v: Vec2): Vec2 => ({ x: v.x, y: TABLE_HEIGHT - v.y });

/**
 * How fast the reference player's HAND may move, in table units per second.
 *
 * The real player's mallet has no speed limit at all; it is wherever the
 * pointer is. A reference opponent driving it would therefore teleport, which
 * measures a player nobody can be and makes every balance number meaningless.
 * So the harness rate-limits its own AIM POINT instead, modelling the one thing
 * a pointer genuinely has that the simulation does not: a hand attached to it.
 *
 * 300 is the limit the player's mallet itself used to carry, so the balance
 * figures below stay comparable with the ones the score target was chosen from.
 */
const REFERENCE_HAND_SPEED = 300;

/** The opponent controller, playing the bottom half, through a modelled hand. */
function mirroredPlayer(difficulty: HockeyDifficulty, seed: number) {
  let ai: HockeyAiState = createHockeyAiState({ x: 50, y: 80, vx: 0, vy: 0 });
  let hand: MalletState = { x: 50, y: TABLE_HEIGHT - 26, vx: 0, vy: 0 };
  let rng = seed >>> 0;
  const random = () => {
    rng = (Math.imul(rng ^ (rng >>> 15), rng | 1) >>> 0) % 100_000;
    return rng / 100_000;
  };
  return (state: HockeyMatchState): Vec2 => {
    const out = stepHockeyAi({
      state: ai,
      puck: mirrorPuck(state.puck),
      mallet: mirrorMallet(state.playerMallet),
      profile: hockeyAiProfile(difficulty),
      dt: DT,
      random,
    });
    ai = out.state;
    hand = moveMalletToward(hand, mirrorPoint(out.target), DT, {
      maxSpeed: REFERENCE_HAND_SPEED,
    });
    return { x: hand.x, y: hand.y };
  };
}

interface MatchReport {
  readonly finished: boolean;
  readonly seconds: number;
  readonly playerScore: number;
  readonly opponentScore: number;
  /** Longest run, in seconds, with the puck live and barely moving. */
  readonly longestCrawl: number;
}

function playMatch(
  opponent: HockeyDifficulty,
  player: HockeyDifficulty,
  seed: number,
): MatchReport {
  let state = createHockeyMatch({ difficulty: opponent, seed });
  const control = mirroredPlayer(player, seed + 1);
  let steps = 0;
  let crawl = 0;
  let longestCrawl = 0;

  while (state.phase !== 'over' && steps < STEP_CAP) {
    state = stepHockeyMatch(state, DT, { playerTarget: control(state) }).state;
    steps += 1;
    if (state.phase === 'live') {
      crawl = speedOf(state.puck) < 12 ? crawl + 1 : 0;
      longestCrawl = Math.max(longestCrawl, crawl);
    }
  }

  return {
    finished: state.phase === 'over',
    seconds: state.elapsedMs / 1000,
    playerScore: state.playerScore,
    opponentScore: state.opponentScore,
    longestCrawl: longestCrawl * DT,
  };
}

const SEEDS = [7919, 15838, 23757, 31676];

describe('a match always reaches a conclusion', () => {
  it.each(['easy', 'normal'] as const)(
    'ends against a %s opponent, within an arcade session',
    (difficulty) => {
      const reports = SEEDS.map((seed) => playMatch(difficulty, difficulty, seed));

      for (const report of reports) {
        // The stalemate guard. A 0–0 that runs to the cap is the failure this
        // whole file exists to catch.
        expect(report.finished, `seed report: ${JSON.stringify(report)}`).toBe(true);
        expect(report.seconds).toBeLessThan(360);
        // The crawl guard: the minimum-speed rule must keep the puck usable.
        expect(report.longestCrawl).toBeLessThan(1);
      }

      const average = reports.reduce((a, r) => a + r.seconds, 0) / reports.length;
      // The score target's whole justification, checked rather than asserted in
      // a comment: first to seven produces an arcade-length match.
      expect(average).toBeGreaterThan(60);
      expect(average).toBeLessThan(300);
    },
  );
});

describe('the opponent is a real opponent', () => {
  it('scores against a weaker player', () => {
    // A Normal opponent facing an Easy brain must actually threaten it.
    const reports = SEEDS.map((seed) => playMatch('normal', 'easy', seed));
    const goals = reports.reduce((a, r) => a + r.opponentScore, 0);
    expect(goals).toBeGreaterThan(reports.length);
  });

  it('is beatable by a stronger player', () => {
    // The other half. An opponent nobody can score against is not difficult,
    // it is broken, and that is exactly what the first tuning pass shipped.
    const reports = SEEDS.map((seed) => playMatch('normal', 'normal', seed));
    const goals = reports.reduce((a, r) => a + r.playerScore, 0);
    expect(goals).toBeGreaterThan(reports.length);
  });

  it('is easier on Easy than on Normal', () => {
    const versusEasy = SEEDS.map((seed) => playMatch('easy', 'normal', seed));
    const versusNormal = SEEDS.map((seed) => playMatch('normal', 'normal', seed));
    const conceded = (rs: MatchReport[]) => rs.reduce((a, r) => a + r.playerScore, 0);
    expect(conceded(versusEasy)).toBeGreaterThanOrEqual(conceded(versusNormal));
  });
});
