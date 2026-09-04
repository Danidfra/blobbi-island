/**
 * Pool: the rule book, as one pure function over one shot.
 *
 * `resolveShot` is asked exactly once per shot, by the match state machine, at
 * the moment every ball has stopped. It answers every question a turn has,
 * was that a foul, who owns which group now, does the shooter go again, has
 * anybody won: and it answers them together, because they are not independent:
 * whether a pot lets you continue depends on whether the shot was a foul, and
 * whether the shot was a foul depends on which group you own, and which group
 * you own may have been decided by that very pot.
 *
 * Being one pure function is also how "scoring and turn resolution happen
 * exactly once per shot" is guaranteed rather than hoped for. There is no
 * incremental scoring, no per-step foul flag and no second place a turn can
 * change.
 *
 * ---
 *
 * ## The rule set, in full
 *
 * Ten rules, and this list is the whole game. It is deliberately shorter than
 * real 8-ball, and every omission below is a choice rather than a gap.
 *
 *  1. The table starts with a legal rack: the 8-ball in the middle of the third
 *     row, one solid and one stripe in the back corners, the rest shuffled.
 *  2. **The player always breaks.** There is no lag and no alternating break,
 *     one machine, one match, and the interesting shot belongs to the person who
 *     walked up to the table.
 *  3. Solids and stripes stay **unassigned until the first legal pot after the
 *     break**. Balls potted on the break count for whoever later owns them, and
 *     assign nothing.
 *  4. Pot one of your own and you **shoot again**.
 *  5. Miss, pot only your opponent's, or foul, and your **turn ends**.
 *  6. Every foul gives the incoming player **ball-in-hand**: they may place the
 *     cue ball anywhere legal on the table.
 *  7. The three fouls are: **potting the cue ball** (a scratch), **hitting
 *     nothing at all**, and **hitting the wrong ball first**: an opponent's
 *     ball, or the 8 before your group is gone.
 *  8. The 8-ball may only be potted once **every ball in your group is already
 *     down** and you strike the 8 first. Potting it before that **loses the
 *     match**.
 *  9. Potting the 8-ball legally **wins the match**.
 * 10. Potting the 8-ball **and** scratching on the same shot **loses**, however
 *     clear your group was.
 *
 * ### The one exception, and why it exists
 *
 * **The 8-ball on the break is not a loss.** It is returned to the foot spot and
 * play continues. Losing a match to the break, a shot whose whole point is that
 * you cannot control it, is the least fair thing an 8-ball game can do to a new
 * player, and re-spotting is what real rule sets do about it. A scratch on the
 * same break is still a scratch.
 *
 * ### What is deliberately not here
 *
 * No called pockets, no called safeties, no rail-after-contact requirement, no
 * tournament break requirement, no push-out, no three-foul rule, no kitchen
 * restriction after a scratch, and no penalty for a ball leaving the table
 * (which the cushions make impossible anyway). Every one of them is a real rule
 * and every one of them needs a paragraph of explanation before a player can
 * avoid breaking it by accident. The brief asks for clarity and fun; this is
 * where that is spent.
 */

import { EIGHT_BALL, type PoolBall } from './physics';
import { SOLID_NUMBERS, STRIPE_NUMBERS } from './rack';

export type PoolGroup = 'solids' | 'stripes';
export type PoolPlayer = 'player' | 'opponent';

/** Why a shot was a foul. `null` everywhere else means "no foul". */
export type PoolFoul =
  /** The cue ball went down a pocket. */
  | 'scratch'
  /** The cue ball touched nothing at all. */
  | 'no-contact'
  /** The first ball struck was not one the shooter was allowed to hit. */
  | 'wrong-ball-first'
  /**
   * The cue ball ended up somewhere impossible and was recovered.
   *
   * Cannot be produced by a legal shot, the cushions and the clamp see to that,
   * so it exists for one purpose: giving the physics recovery path a rule to
   * apply instead of a crash. Treated exactly like a scratch.
   */
  | 'off-table';

/** How the match ended. `null` while it has not. */
export type PoolEnding =
  /** The 8-ball was potted properly. The shooter wins. */
  | 'legal-eight'
  /** The 8-ball went down before the shooter's group was clear. The shooter loses. */
  | 'early-eight'
  /** The 8-ball went down on a shot that also fouled. The shooter loses. */
  | 'eight-with-scratch';

/** Who owns which group. Both `null` means the table is still open. */
export interface PoolAssignment {
  readonly player: PoolGroup | null;
  readonly opponent: PoolGroup | null;
}

export const OPEN_TABLE: PoolAssignment = Object.freeze({ player: null, opponent: null });

export function otherPlayer(who: PoolPlayer): PoolPlayer {
  return who === 'player' ? 'opponent' : 'player';
}

export function otherGroup(group: PoolGroup): PoolGroup {
  return group === 'solids' ? 'stripes' : 'solids';
}

/** Which group a ball belongs to. The cue ball and the 8-ball belong to neither. */
export function groupOf(ballNumber: number): PoolGroup | null {
  if (SOLID_NUMBERS.includes(ballNumber)) return 'solids';
  if (STRIPE_NUMBERS.includes(ballNumber)) return 'stripes';
  return null;
}

/** "Solids" / "Stripes", for a HUD that must never say `solids` in code voice. */
export function groupLabel(group: PoolGroup | null): string {
  if (group === 'solids') return 'Solids';
  if (group === 'stripes') return 'Stripes';
  return 'Open table';
}

/** The numbers in a group. */
export function groupNumbers(group: PoolGroup): readonly number[] {
  return group === 'solids' ? SOLID_NUMBERS : STRIPE_NUMBERS;
}

/** Which of a group's balls are still on the table. */
export function remainingInGroup(
  balls: readonly PoolBall[],
  group: PoolGroup,
): readonly number[] {
  const wanted = groupNumbers(group);
  return balls.filter((b) => !b.pocketed && wanted.includes(b.number)).map((b) => b.number);
}

/** True when every ball in a group is off the table. */
export function groupCleared(balls: readonly PoolBall[], group: PoolGroup | null): boolean {
  if (group === null) return false;
  return remainingInGroup(balls, group).length === 0;
}

/**
 * Which balls the shooter is allowed to strike FIRST.
 *
 * Three cases, and every one of them is a sentence a player would say:
 *
 *  - **Open table**: anything except the 8.
 *  - **Group assigned, balls left**: your own group only.
 *  - **Group cleared**: the 8, and nothing else.
 */
export function legalTargets(
  balls: readonly PoolBall[],
  group: PoolGroup | null,
): readonly number[] {
  const onTable = balls.filter((b) => !b.pocketed).map((b) => b.number);
  if (group === null) return onTable.filter((n) => n !== EIGHT_BALL && n !== 0);
  if (groupCleared(balls, group)) return onTable.filter((n) => n === EIGHT_BALL);
  return onTable.filter((n) => groupOf(n) === group);
}

/** Whether striking this ball first was legal, given the table before the shot. */
export function isLegalFirstContact(
  ballNumber: number,
  balls: readonly PoolBall[],
  group: PoolGroup | null,
): boolean {
  return legalTargets(balls, group).includes(ballNumber);
}

// ── One shot, recorded ──────────────────────────────────────────────────────

/**
 * Everything the simulation observed during one shot.
 *
 * Accumulated by the match step while the balls roll, and read exactly once when
 * they stop. It carries observations only, no judgement, no score, because the
 * judgement is {@link resolveShot}'s and having two places form an opinion is
 * how a foul ends up being counted twice.
 */
export interface ShotRecord {
  readonly shooter: PoolPlayer;
  /** The first object ball the cue ball touched, or `null` if it touched none. */
  readonly firstContact: number | null;
  /** Every ball potted, in the order they dropped. May include the cue ball. */
  readonly pocketed: readonly number[];
  readonly cuePocketed: boolean;
  /** The cue ball reached an impossible state and had to be recovered. */
  readonly cueLost: boolean;
  /** True only for the very first shot of the match. */
  readonly wasBreak: boolean;
}

export interface ShotOutcome {
  readonly foul: PoolFoul | null;
  /** Group ownership AFTER the shot. Unchanged unless this shot assigned it. */
  readonly assignment: PoolAssignment;
  /** True when the shooter keeps the table. */
  readonly continues: boolean;
  /** Whose shot it is next. Equals the shooter when `continues`. */
  readonly nextTurn: PoolPlayer;
  /** True when the next shooter may place the cue ball anywhere legal. */
  readonly ballInHand: boolean;
  readonly winner: PoolPlayer | null;
  readonly ending: PoolEnding | null;
  /** The 8-ball went down on the break and must be returned to the foot spot. */
  readonly respotEight: boolean;
  /** One short, player-facing sentence. The only copy the banner shows. */
  readonly message: string;
}

const FOUL_MESSAGE: Record<PoolFoul, string> = {
  scratch: 'Scratch: the cue ball went down.',
  'no-contact': 'Foul: the cue ball hit nothing.',
  'wrong-ball-first': 'Foul: wrong ball hit first.',
  'off-table': 'Foul: the cue ball left the table.',
};

export interface ResolveShotInput {
  readonly shot: ShotRecord;
  /**
   * The table as it stood BEFORE the shot.
   *
   * Before, and deliberately only before. Every question this function asks,
   * was that ball legal to hit first, was the group already clear when the
   * 8-ball went down, is a question about the table the shooter was looking at
   * when they took the shot. What the table looks like AFTERWARDS is fully
   * described by {@link ShotRecord.pocketed}, and passing it as well would be a
   * second, redundant source of truth about the same shot.
   */
  readonly ballsBefore: readonly PoolBall[];
  /** Group ownership BEFORE the shot. */
  readonly assignment: PoolAssignment;
}

/**
 * Judge one finished shot.
 *
 * The order below is the rule set's own precedence and it is not
 * interchangeable:
 *
 *  1. **The 8-ball first**, because potting it ends the match whatever else
 *     happened, and a foul on the same shot changes who won rather than whether
 *     the match is over.
 *  2. **Then fouls**, because a foul suppresses assignment and always passes the
 *     turn: a shot that pots one of your own AND scratches is still a scratch.
 *  3. **Then assignment**, because whether you continue depends on which group
 *     you have just been given.
 *  4. **Then continuation.**
 */
export function resolveShot({ shot, ballsBefore, assignment }: ResolveShotInput): ShotOutcome {
  const shooter = shot.shooter;
  const opponent = otherPlayer(shooter);
  const shooterGroup = assignment[shooter];

  // ── 1. Was it a foul? ────────────────────────────────────────────────────
  let foul: PoolFoul | null = null;
  if (shot.cueLost) foul = 'off-table';
  else if (shot.cuePocketed) foul = 'scratch';
  else if (shot.firstContact === null) foul = 'no-contact';
  else if (!isLegalFirstContact(shot.firstContact, ballsBefore, shooterGroup)) {
    foul = 'wrong-ball-first';
  }

  const eightPotted = shot.pocketed.includes(EIGHT_BALL);

  // ── 2. The 8-ball ends the match, except on the break ────────────────────
  if (eightPotted && !shot.wasBreak) {
    // Legal only when the group was ALREADY clear before the shot and the 8 was
    // struck first. Potting your last group ball and the 8 together therefore
    // loses: which is standard, and is the reading of rule 8 the rule list
    // above states.
    const clearedBefore = groupCleared(ballsBefore, shooterGroup);
    const legal =
      foul === null && shooterGroup !== null && clearedBefore && shot.firstContact === EIGHT_BALL;

    if (legal) {
      return {
        foul: null,
        assignment,
        continues: false,
        nextTurn: shooter,
        ballInHand: false,
        winner: shooter,
        ending: 'legal-eight',
        respotEight: false,
        message: shooter === 'player' ? 'The 8-ball drops. You win.' : 'Your rival sinks the 8-ball.',
      };
    }

    const ending: PoolEnding =
      foul === 'scratch' || foul === 'off-table' ? 'eight-with-scratch' : 'early-eight';
    return {
      foul,
      assignment,
      continues: false,
      nextTurn: opponent,
      ballInHand: false,
      winner: opponent,
      ending,
      respotEight: false,
      message:
        ending === 'eight-with-scratch'
          ? 'The 8-ball and the cue ball both went down.'
          : 'The 8-ball went down too early.',
    };
  }

  // The break exception: the 8 comes back and nothing else about the shot
  // changes. A scratch on the same break is still handled below.
  const respotEight = eightPotted && shot.wasBreak;

  // ── 3. A foul ends the turn and hands over the cue ball ──────────────────
  if (foul !== null) {
    return {
      foul,
      assignment,
      continues: false,
      nextTurn: opponent,
      ballInHand: true,
      winner: null,
      ending: null,
      respotEight,
      message: FOUL_MESSAGE[foul],
    };
  }

  const pottedObjects = shot.pocketed.filter((n) => n !== 0 && n !== EIGHT_BALL);

  // ── 4. The break assigns nothing, but a pot still keeps the table ────────
  if (shot.wasBreak) {
    const continues = pottedObjects.length > 0;
    return {
      foul: null,
      assignment,
      continues,
      nextTurn: continues ? shooter : opponent,
      ballInHand: false,
      winner: null,
      ending: null,
      respotEight,
      message: continues
        ? 'Good break: the table is still open.'
        : 'Break played. The table is open.',
    };
  }

  // ── 5. An open table is decided by the first ball that drops ─────────────
  if (shooterGroup === null) {
    if (pottedObjects.length === 0) {
      return {
        foul: null,
        assignment,
        continues: false,
        nextTurn: opponent,
        ballInHand: false,
        winner: null,
        ending: null,
        respotEight,
        message: 'No pot. The table is still open.',
      };
    }

    // The FIRST ball down decides, so a shot that drops one of each is never
    // ambiguous and never needs the player to choose.
    const claimed = groupOf(pottedObjects[0])!;
    const next: PoolAssignment =
      shooter === 'player'
        ? { player: claimed, opponent: otherGroup(claimed) }
        : { player: otherGroup(claimed), opponent: claimed };

    return {
      foul: null,
      assignment: next,
      continues: true,
      nextTurn: shooter,
      ballInHand: false,
      winner: null,
      ending: null,
      respotEight,
      message:
        shooter === 'player'
          ? `You are on ${groupLabel(claimed).toLowerCase()}.`
          : `Your rival is on ${groupLabel(claimed).toLowerCase()}.`,
    };
  }

  // ── 6. Assigned: only your own group keeps the table ─────────────────────
  const own = pottedObjects.filter((n) => groupOf(n) === shooterGroup);
  const continues = own.length > 0;

  return {
    foul: null,
    assignment,
    continues,
    nextTurn: continues ? shooter : opponent,
    ballInHand: false,
    winner: null,
    ending: null,
    respotEight,
    message: continues
      ? own.length > 1
        ? `Two down. ${shooter === 'player' ? 'Your' : 'Their'} shot again.`
        : `Potted. ${shooter === 'player' ? 'Your' : 'Their'} shot again.`
      : pottedObjects.length > 0
        ? 'That was the wrong colour, turn over.'
        : 'No pot: turn over.',
  };
}
