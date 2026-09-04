/**
 * The rule book; every branch of `resolveShot`, and the rack it starts from.
 *
 * `resolveShot` is the only thing in the game that decides who shoots next, who
 * owns which group and who has won. It is pure, so every rule in the ten-point
 * list at the top of `rules.ts` is checkable by handing it a shot and reading
 * the answer.
 */
import { describe, it, expect } from 'vitest';

import { CUE_BALL, EIGHT_BALL, type PoolBall } from './physics';
import {
  SOLID_NUMBERS,
  STRIPE_NUMBERS,
  buildRack,
  poolSeedFrom,
  rackPositions,
  seededShuffle,
} from './rack';
import {
  OPEN_TABLE,
  groupCleared,
  groupLabel,
  groupNumbers,
  groupOf,
  isLegalFirstContact,
  legalTargets,
  otherGroup,
  otherPlayer,
  remainingInGroup,
  resolveShot,
  type PoolAssignment,
  type ShotRecord,
} from './rules';
import { BALL_DIAMETER, FOOT_SPOT, HEAD_SPOT, TABLE_LENGTH, TABLE_WIDTH } from './table';

// ── Fixtures ────────────────────────────────────────────────────────────────

function ball(number: number, x = 100, y = 50, pocketed = false): PoolBall {
  return { number, x, y, vx: 0, vy: 0, pocketed };
}

/** A table with the listed object balls still up, plus the cue ball. */
function tableWith(...numbers: number[]): PoolBall[] {
  const all = [0, ...SOLID_NUMBERS, EIGHT_BALL, ...STRIPE_NUMBERS];
  return all.map((n, i) =>
    ball(n, 20 + i * 9, 30 + (i % 3) * 20, n !== CUE_BALL && !numbers.includes(n)),
  );
}

const SOLIDS_TO_PLAYER: PoolAssignment = { player: 'solids', opponent: 'stripes' };

function shot(overrides: Partial<ShotRecord> = {}): ShotRecord {
  return {
    shooter: 'player',
    firstContact: 1,
    pocketed: [],
    cuePocketed: false,
    cueLost: false,
    wasBreak: false,
    ...overrides,
  };
}

// ── Groups ──────────────────────────────────────────────────────────────────

describe('groups', () => {
  it('splits 1–7 from 9–15 and gives the cue ball and the 8 neither', () => {
    for (const n of SOLID_NUMBERS) expect(groupOf(n), String(n)).toBe('solids');
    for (const n of STRIPE_NUMBERS) expect(groupOf(n), String(n)).toBe('stripes');
    expect(groupOf(EIGHT_BALL)).toBeNull();
    expect(groupOf(CUE_BALL)).toBeNull();
    expect(groupNumbers('solids')).toEqual(SOLID_NUMBERS);
    expect(groupNumbers('stripes')).toEqual(STRIPE_NUMBERS);
  });

  it('has readable labels and a working opposite', () => {
    expect(groupLabel('solids')).toBe('Solids');
    expect(groupLabel('stripes')).toBe('Stripes');
    expect(groupLabel(null)).toBe('Open table');
    expect(otherGroup('solids')).toBe('stripes');
    expect(otherGroup('stripes')).toBe('solids');
    expect(otherPlayer('player')).toBe('opponent');
    expect(otherPlayer('opponent')).toBe('player');
  });

  it('counts what is left, and knows when a group is gone', () => {
    const table = tableWith(1, 2, EIGHT_BALL, 9);
    expect([...remainingInGroup(table, 'solids')].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(remainingInGroup(table, 'stripes')).toEqual([9]);
    expect(groupCleared(table, 'solids')).toBe(false);
    expect(groupCleared(tableWith(EIGHT_BALL, 9), 'solids')).toBe(true);
    // An open table is never "cleared": there is nothing to clear yet.
    expect(groupCleared(table, null)).toBe(false);
  });
});

describe('what may be struck first', () => {
  it('lets an open table hit anything except the 8', () => {
    const targets = legalTargets(tableWith(1, 2, EIGHT_BALL, 9), null);
    expect([...targets].sort((a, b) => a - b)).toEqual([1, 2, 9]);
    expect(targets).not.toContain(EIGHT_BALL);
    expect(targets).not.toContain(CUE_BALL);
  });

  it('restricts an assigned player to their own group', () => {
    const table = tableWith(1, 2, EIGHT_BALL, 9, 10);
    expect([...legalTargets(table, 'solids')].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...legalTargets(table, 'stripes')].sort((a, b) => a - b)).toEqual([9, 10]);
    expect(isLegalFirstContact(1, table, 'solids')).toBe(true);
    expect(isLegalFirstContact(9, table, 'solids')).toBe(false);
    expect(isLegalFirstContact(EIGHT_BALL, table, 'solids')).toBe(false);
  });

  it('leaves only the 8 once a group is clear', () => {
    const table = tableWith(EIGHT_BALL, 9, 10);
    expect(legalTargets(table, 'solids')).toEqual([EIGHT_BALL]);
    expect(isLegalFirstContact(EIGHT_BALL, table, 'solids')).toBe(true);
    expect(isLegalFirstContact(9, table, 'solids')).toBe(false);
  });
});

// ── The break ───────────────────────────────────────────────────────────────

describe('the break', () => {
  const full = tableWith(...SOLID_NUMBERS, EIGHT_BALL, ...STRIPE_NUMBERS);

  it('assigns nothing, even when it pots', () => {
    // Rule 3. Balls potted on the break count for whoever later owns them.
    const outcome = resolveShot({
      shot: shot({ wasBreak: true, pocketed: [3, 11] }),
      ballsBefore: full,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual(OPEN_TABLE);
    expect(outcome.foul).toBeNull();
    expect(outcome.continues).toBe(true);
    expect(outcome.nextTurn).toBe('player');
    expect(outcome.message).toMatch(/open/i);
  });

  it('passes the turn when it pots nothing', () => {
    const outcome = resolveShot({
      shot: shot({ wasBreak: true }),
      ballsBefore: full,
      assignment: OPEN_TABLE,
    });
    expect(outcome.continues).toBe(false);
    expect(outcome.nextTurn).toBe('opponent');
    expect(outcome.ballInHand).toBe(false);
  });

  it('re-spots the 8-ball rather than ending the match', () => {
    // The one exception in the rule set, and the reason it exists: losing to a
    // shot whose whole point is that you cannot control it is the least fair
    // thing an 8-ball game can do to a new player.
    const outcome = resolveShot({
      shot: shot({ wasBreak: true, pocketed: [EIGHT_BALL, 4] }),
      ballsBefore: full,
      assignment: OPEN_TABLE,
    });
    expect(outcome.winner).toBeNull();
    expect(outcome.ending).toBeNull();
    expect(outcome.respotEight).toBe(true);
    expect(outcome.continues).toBe(true);
  });

  it('still punishes a scratch on the break, and still re-spots the 8', () => {
    const outcome = resolveShot({
      shot: shot({ wasBreak: true, pocketed: [EIGHT_BALL, CUE_BALL], cuePocketed: true }),
      ballsBefore: full,
      assignment: OPEN_TABLE,
    });
    expect(outcome.winner).toBeNull();
    expect(outcome.respotEight).toBe(true);
    expect(outcome.foul).toBe('scratch');
    expect(outcome.nextTurn).toBe('opponent');
    expect(outcome.ballInHand).toBe(true);
  });
});

// ── Assignment ──────────────────────────────────────────────────────────────

describe('taking a group', () => {
  const open = tableWith(...SOLID_NUMBERS, EIGHT_BALL, ...STRIPE_NUMBERS);

  it('gives the shooter the group of the first ball they drop', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 3, pocketed: [3] }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual({ player: 'solids', opponent: 'stripes' });
    expect(outcome.continues).toBe(true);
    expect(outcome.message).toMatch(/solids/i);
  });

  it('uses the FIRST ball down when a shot drops one of each', () => {
    // Never ambiguous, and never a question the player has to answer.
    const outcome = resolveShot({
      shot: shot({ firstContact: 11, pocketed: [11, 2] }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual({ player: 'stripes', opponent: 'solids' });
  });

  it('assigns from the opponent’s side of the table too', () => {
    const outcome = resolveShot({
      shot: shot({ shooter: 'opponent', firstContact: 12, pocketed: [12] }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual({ player: 'solids', opponent: 'stripes' });
    expect(outcome.nextTurn).toBe('opponent');
  });

  it('assigns nothing on a miss, and passes the turn', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 3 }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual(OPEN_TABLE);
    expect(outcome.continues).toBe(false);
    expect(outcome.nextTurn).toBe('opponent');
  });

  it('assigns nothing when the pot came with a foul', () => {
    // A scratch is not a "valid pot", so the table stays open.
    const outcome = resolveShot({
      shot: shot({ firstContact: 3, pocketed: [3, CUE_BALL], cuePocketed: true }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.assignment).toEqual(OPEN_TABLE);
    expect(outcome.foul).toBe('scratch');
    expect(outcome.ballInHand).toBe(true);
  });

  it('treats the 8-ball as illegal to hit first even on an open table', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: EIGHT_BALL }),
      ballsBefore: open,
      assignment: OPEN_TABLE,
    });
    expect(outcome.foul).toBe('wrong-ball-first');
  });
});

// ── Continuing and ending a turn ────────────────────────────────────────────

describe('keeping the table', () => {
  const table = tableWith(1, 2, EIGHT_BALL, 9, 10);

  it('lets you shoot again after potting one of your own', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [1] }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.continues).toBe(true);
    expect(outcome.nextTurn).toBe('player');
    expect(outcome.ballInHand).toBe(false);
    expect(outcome.foul).toBeNull();
  });

  it('says so when two of yours go down at once', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [1, 2] }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.continues).toBe(true);
    expect(outcome.message).toMatch(/two/i);
  });

  it('ends the turn on a clean miss', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1 }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.continues).toBe(false);
    expect(outcome.nextTurn).toBe('opponent');
    expect(outcome.ballInHand).toBe(false);
    expect(outcome.foul).toBeNull();
  });

  it('ends the turn when only the opponent’s ball goes down', () => {
    // Rule 5, and NOT a foul: the cue ball hit a legal ball first, so the
    // opponent gets the table but not the cue ball.
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [9] }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBeNull();
    expect(outcome.continues).toBe(false);
    expect(outcome.nextTurn).toBe('opponent');
    expect(outcome.ballInHand).toBe(false);
    expect(outcome.message).toMatch(/wrong colour/i);
  });

  it('lets a legal pot that also drops the opponent’s ball continue', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [1, 9] }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.continues).toBe(true);
  });
});

// ── Fouls ───────────────────────────────────────────────────────────────────

describe('fouls', () => {
  const table = tableWith(1, 2, EIGHT_BALL, 9, 10);

  it('calls a scratch and hands over the cue ball', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [CUE_BALL], cuePocketed: true }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('scratch');
    expect(outcome.ballInHand).toBe(true);
    expect(outcome.nextTurn).toBe('opponent');
    expect(outcome.message).toMatch(/scratch/i);
  });

  it('overrides a good pot on the same shot', () => {
    // Rule 5 and rule 7 together: potting one of your own does not rescue a
    // scratch.
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [1, CUE_BALL], cuePocketed: true }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('scratch');
    expect(outcome.continues).toBe(false);
    expect(outcome.nextTurn).toBe('opponent');
  });

  it('calls hitting nothing at all', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: null }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('no-contact');
    expect(outcome.ballInHand).toBe(true);
  });

  it('calls hitting the opponent’s ball first', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 9, pocketed: [1] }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('wrong-ball-first');
    expect(outcome.ballInHand).toBe(true);
    expect(outcome.nextTurn).toBe('opponent');
  });

  it('calls hitting the 8 first before the group is clear', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: EIGHT_BALL }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('wrong-ball-first');
  });

  it('treats a lost cue ball exactly like a scratch', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, cueLost: true }),
      ballsBefore: table,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.foul).toBe('off-table');
    expect(outcome.ballInHand).toBe(true);
  });

  it('gives every foul a sentence a player can read', () => {
    for (const record of [
      shot({ cuePocketed: true }),
      shot({ firstContact: null }),
      shot({ firstContact: 9 }),
      shot({ cueLost: true }),
    ]) {
      const outcome = resolveShot({
        shot: record,
        ballsBefore: table,
        assignment: SOLIDS_TO_PLAYER,
      });
      expect(outcome.foul).not.toBeNull();
      expect(outcome.message.length).toBeGreaterThan(8);
      expect(outcome.message).not.toMatch(/undefined|null|\[object/);
    }
  });
});

// ── The 8-ball ──────────────────────────────────────────────────────────────

describe('the 8-ball', () => {
  /** Group clear, only the 8 and the opponent's balls left. */
  const onTheEight = tableWith(EIGHT_BALL, 9, 10, 11);

  it('wins the match when the group is clear and it is struck first', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL] }),
      ballsBefore: onTheEight,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.winner).toBe('player');
    expect(outcome.ending).toBe('legal-eight');
    expect(outcome.foul).toBeNull();
    expect(outcome.ballInHand).toBe(false);
    expect(outcome.message).toMatch(/win/i);
  });

  it('loses the match when it goes down early', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [EIGHT_BALL] }),
      ballsBefore: tableWith(1, 2, EIGHT_BALL, 9),
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.winner).toBe('opponent');
    expect(outcome.ending).toBe('early-eight');
  });

  it('loses when the last group ball and the 8 drop together', () => {
    // The reading of rule 8 the rule list states: the group must ALREADY be
    // clear. A combination that clears up and pots the 8 in one shot is a loss.
    const outcome = resolveShot({
      shot: shot({ firstContact: 1, pocketed: [1, EIGHT_BALL] }),
      ballsBefore: tableWith(1, EIGHT_BALL, 9),
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.winner).toBe('opponent');
    expect(outcome.ending).toBe('early-eight');
  });

  it('loses when the 8 and the cue ball go down together', () => {
    // Rule 10, and it beats a clear group.
    const outcome = resolveShot({
      shot: shot({ firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL, CUE_BALL], cuePocketed: true }),
      ballsBefore: onTheEight,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.winner).toBe('opponent');
    expect(outcome.ending).toBe('eight-with-scratch');
  });

  it('hands the match to the player when the RIVAL fouls it away', () => {
    const outcome = resolveShot({
      shot: shot({ shooter: 'opponent', firstContact: 9, pocketed: [EIGHT_BALL] }),
      ballsBefore: tableWith(1, EIGHT_BALL, 9),
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.winner).toBe('player');
    expect(outcome.ending).toBe('early-eight');
  });

  it('never leaves a winner without an ending, or an ending without a winner', () => {
    const cases: ShotRecord[] = [
      shot({ firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL] }),
      shot({ firstContact: 1, pocketed: [EIGHT_BALL] }),
      shot({ firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL, CUE_BALL], cuePocketed: true }),
      shot({ firstContact: 1, pocketed: [1] }),
      shot({ wasBreak: true, pocketed: [EIGHT_BALL] }),
    ];
    for (const record of cases) {
      const outcome = resolveShot({
        shot: record,
        ballsBefore: onTheEight,
        assignment: SOLIDS_TO_PLAYER,
      });
      expect(outcome.winner === null, JSON.stringify(record)).toBe(outcome.ending === null);
    }
  });

  it('never lets a decided match also continue', () => {
    const outcome = resolveShot({
      shot: shot({ firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL] }),
      ballsBefore: onTheEight,
      assignment: SOLIDS_TO_PLAYER,
    });
    expect(outcome.continues).toBe(false);
    expect(outcome.respotEight).toBe(false);
  });
});

// ── The rack ────────────────────────────────────────────────────────────────

describe('the rack', () => {
  it('places sixteen balls, all of them distinct', () => {
    const { balls } = buildRack(poolSeedFrom('run-1'));
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((b) => b.number)).size).toBe(16);
    expect(balls.every((b) => !b.pocketed)).toBe(true);
    expect(balls.every((b) => b.vx === 0 && b.vy === 0)).toBe(true);
  });

  it('puts the cue ball on the head spot and the apex on the foot spot', () => {
    const { balls } = buildRack(poolSeedFrom('run-1'));
    const cue = balls.find((b) => b.number === CUE_BALL)!;
    expect(cue.x).toBeCloseTo(HEAD_SPOT.x, 6);
    expect(cue.y).toBeCloseTo(HEAD_SPOT.y, 6);

    const apex = balls
      .filter((b) => b.number !== CUE_BALL)
      .reduce((closest, b) => (b.x < closest.x ? b : closest));
    expect(apex.x).toBeCloseTo(FOOT_SPOT.x, 4);
    expect(apex.y).toBeCloseTo(FOOT_SPOT.y, 4);
  });

  it('puts the 8-ball in the middle of the third row', () => {
    const { balls } = buildRack(poolSeedFrom('anything'));
    const spots = rackPositions();
    const eight = balls.find((b) => b.number === EIGHT_BALL)!;
    expect(eight.x).toBeCloseTo(spots[4].x, 4);
    expect(eight.y).toBeCloseTo(spots[4].y, 4);
  });

  it('puts one solid and one stripe in the back corners', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { balls } = buildRack(poolSeedFrom(seed));
      const spots = rackPositions();
      const at = (i: number) =>
        balls.find((b) => Math.hypot(b.x - spots[i].x, b.y - spots[i].y) < 0.2)!.number;
      const corners = [groupOf(at(10)), groupOf(at(14))].sort();
      expect(corners, seed).toEqual(['solids', 'stripes']);
    }
  });

  it('starts with every ball on the cloth and none overlapping', () => {
    const { balls } = buildRack(poolSeedFrom('overlap'));
    for (const b of balls) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(TABLE_LENGTH);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(TABLE_WIDTH);
    }
    for (let i = 0; i < balls.length; i += 1) {
      for (let k = i + 1; k < balls.length; k += 1) {
        expect(
          Math.hypot(balls[i].x - balls[k].x, balls[i].y - balls[k].y),
          `${balls[i].number}/${balls[k].number}`,
        ).toBeGreaterThanOrEqual(BALL_DIAMETER - 1e-6);
      }
    }
  });

  it('is reproducible from its seed, and different between seeds', () => {
    const a = buildRack(poolSeedFrom('same')).balls.map((b) => b.number);
    const b = buildRack(poolSeedFrom('same')).balls.map((b) => b.number);
    const c = buildRack(poolSeedFrom('other')).balls.map((b) => b.number);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('shuffles without losing or duplicating anything', () => {
    const { items } = seededShuffle([1, 2, 3, 4, 5, 6, 7], 99);
    expect(items.slice().sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('hashes different run ids to different seeds', () => {
    expect(poolSeedFrom('run-a')).not.toBe(poolSeedFrom('run-b'));
    expect(poolSeedFrom('run-a')).toBe(poolSeedFrom('run-a'));
    expect(Number.isInteger(poolSeedFrom(''))).toBe(true);
  });
});
