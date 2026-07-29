/**
 * Air Hockey — the table, and every number the simulation is tuned by.
 *
 * ## Table units, not pixels
 *
 * The whole simulation runs in a fixed **100 × 160 table-unit box** and knows
 * nothing about the screen. A pixel-sized simulation would change its own
 * physics when the dialog is resized — a puck travelling "200 px per second"
 * crosses a phone in a third of the time it crosses a laptop — and it would make
 * every physics test depend on a layout. So the canvas maps table units to
 * pixels at draw time and pointer coordinates back to table units at input time,
 * and nothing between those two edges has an opinion about size.
 *
 * The box is described here as PORTRAIT — 100 across, 160 along — with the
 * player defending `y = 160` and the opponent `y = 0`. Every constant, every
 * physics function and every test in this directory speaks that language.
 *
 * **How it is DRAWN is a separate decision, and it is not this.** The arcade's
 * game window keeps the world's landscape shape at every viewport (measured at
 * 452 × 296 on a 390 px phone), so `hockey-draw.ts` applies a quarter turn and
 * lays the long axis out wide, with the player's end on the left. Fitting the
 * portrait box in directly would have wasted about 60% of the playfield.
 *
 * That separation is the point of using abstract table units at all: the
 * orientation the game is presented at changed after the physics was tuned, and
 * not one number in this file had to move.
 *
 * ## Why these numbers
 *
 * They are arcade numbers, not physical ones. Real air hockey pucks are almost
 * frictionless and rebound near-perfectly; a faithful simulation of that is
 * exhausting to play on a phone, because the puck never settles and never gives
 * you a beat to think in. {@link PUCK_DRAG_PER_SECOND} is therefore higher than
 * reality and {@link PUCK_MIN_SPEED} stops the consequence of that — a puck
 * drifting to a halt in a corner while both players wait.
 */

/** Table width, in table units. */
export const TABLE_WIDTH = 100;
/** Table height, in table units. Portrait — see the module note. */
export const TABLE_HEIGHT = 160;
export const TABLE_CENTER_X = TABLE_WIDTH / 2;
export const TABLE_CENTER_Y = TABLE_HEIGHT / 2;

export const PUCK_RADIUS = 4;
export const MALLET_RADIUS = 7;

/**
 * Half the goal mouth, in table units — so the mouth is 46 of 100 wide.
 *
 * Wider than a real table's, deliberately, and the number came out of
 * measurement rather than taste. A keeper standing 20 units off its line blocks
 * a band about 27 units wide projected onto the goal, so a 34-wide mouth left
 * roughly seven units of scoring chance and produced simulated matches that ran
 * past four hundred seconds without a single goal. At 46 the same keeper leaves
 * a real target, matches land between two and a half and four minutes, and
 * nobody can block a goal by standing still.
 */
export const GOAL_HALF_WIDTH = 23;

/** Speed limits, in table units per second. */
export const PUCK_MAX_SPEED = 170;
/**
 * The floor a live puck is held at.
 *
 * Not a physical effect — a rule. Without it a rally can end with the puck
 * creeping along a rail for twenty seconds while neither player can reach it,
 * which is the single most common way an air hockey game stops being a game.
 */
export const PUCK_MIN_SPEED = 28;
/** Exponential drag coefficient, per second: `v *= exp(-k · dt)`. */
export const PUCK_DRAG_PER_SECOND = 0.28;

export const WALL_RESTITUTION = 0.94;
export const MALLET_RESTITUTION = 0.9;
/**
 * How much of a mallet's SIDEWAYS motion is dragged into the puck.
 *
 * Small on purpose. It is what makes a sliced hit curve away instead of
 * rebounding straight back, and anything larger turns every glancing touch into
 * a wild deflection.
 */
export const MALLET_TANGENT_FRICTION = 0.14;
/**
 * The speed a puck is guaranteed to leave a mallet with, along the contact
 * normal.
 *
 * The anti-stick rule. Without it a puck resting against a slowly-advancing
 * mallet is re-resolved every step, never separates, and rides the mallet
 * around the table.
 */
export const MALLET_MIN_SEPARATION_SPEED = 26;

/**
 * The ceiling on the velocity a player's mallet may STRIKE with, in units per
 * second. It does not limit where the mallet may be.
 *
 * ## Why this is not a speed limit any more
 *
 * It was. The player's mallet used to chase the pointer at 300 units/s through
 * the same rate limiter the opponent uses, and that turned out to be the single
 * worst thing about the game: an ordinary mouse flick of a third of the table
 * took **117 ms** to catch up, and a corner-to-corner one **158 ms**. Direct
 * manipulation stops feeling direct somewhere around 50 ms. The mallet did not
 * feel like a thing in your hand; it felt like a second AI following you.
 *
 * So the mallet now goes exactly where the pointer is, every step, and this
 * constant does the job the rate limit was really needed for: bounding the
 * IMPULSE. Velocity is displacement ÷ dt, so a pointer that jumps the length of
 * the table in one 8 ms step would otherwise report 19,000 units/s and hit the
 * puck like a bullet.
 *
 * 400 is comfortably above anything a hand produces and far above what is needed
 * to saturate the puck: at restitution 0.9 a mallet moving 89 units/s already
 * drives a resting puck to {@link PUCK_MAX_SPEED}. Tunnelling is prevented
 * separately and exactly, by the swept collision test in `physics.ts`.
 */
export const PLAYER_MALLET_MAX_STRIKE_SPEED = 400;

/** The simulation step. Everything is tuned assuming a small, regular one. */
export const FIXED_STEP_MS = 1000 / 120;

/** Serve speed out of the centre spot, in units per second. */
export const SERVE_SPEED = 62;
/** Maximum deviation of a serve from straight down the table, in radians. */
export const SERVE_SPREAD_RADIANS = 0.55;

/** "3 — 2 — 1 — GO", before the opening serve. */
export const COUNTDOWN_MS = 3000;
/** How long the puck sits in the goal after it goes in. */
export const GOAL_PAUSE_MS = 1300;
/** How long both players get to reposition before the next serve. */
export const SERVE_DELAY_MS = 900;

/**
 * Goals needed to win, and the reason for the number.
 *
 * Measured rather than guessed. Playing the opponent controller against a
 * mirrored copy of itself over thirty-six simulated matches, **first to 7**
 * lands between about 160 seconds (Easy, a one-sided win) and about 260
 * (Normal, a long one) — two and a half to four and a half minutes, which is
 * the arcade-session length the brief asks for.
 *
 * First to 5 ended matches at around a hundred seconds, before a new player had
 * worked out how to aim; first to 10 pushed the Normal opponent past six
 * minutes, which is a chore rather than a match.
 */
export const MATCH_GOAL_TARGET = 7;

/**
 * What "a match" is worth telling a player before they start, in ms.
 *
 * Three minutes: the middle of the range {@link MATCH_GOAL_TARGET} produces.
 * The catalogue reads this rather than restating a number, so the estimate on
 * the machine's card cannot drift away from the rule that determines it.
 */
export const TYPICAL_AIR_HOCKEY_MATCH_MS = 180_000;

/** The rectangle a mallet's CENTRE may occupy. */
export interface HockeyZone {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The player owns the bottom half; the opponent owns the top.
 *
 * The centre line is a hard limit on the mallet's CENTRE, so half a mallet may
 * overhang it — which is how a real table plays, and is what makes a
 * centre-line interception feel possible rather than mysteriously blocked.
 */
export const PLAYER_ZONE: HockeyZone = Object.freeze({
  minX: MALLET_RADIUS,
  maxX: TABLE_WIDTH - MALLET_RADIUS,
  minY: TABLE_CENTER_Y,
  maxY: TABLE_HEIGHT - MALLET_RADIUS,
});

export const OPPONENT_ZONE: HockeyZone = Object.freeze({
  minX: MALLET_RADIUS,
  maxX: TABLE_WIDTH - MALLET_RADIUS,
  minY: MALLET_RADIUS,
  maxY: TABLE_CENTER_Y,
});

/** Where each mallet starts, and where the AI returns to when it has nothing to do. */
export const PLAYER_HOME = Object.freeze({ x: TABLE_CENTER_X, y: TABLE_HEIGHT - 26 });
export const OPPONENT_HOME = Object.freeze({ x: TABLE_CENTER_X, y: 26 });

/** The centre of each goal mouth, on the goal line. */
export const PLAYER_GOAL = Object.freeze({ x: TABLE_CENTER_X, y: TABLE_HEIGHT });
export const OPPONENT_GOAL = Object.freeze({ x: TABLE_CENTER_X, y: 0 });
