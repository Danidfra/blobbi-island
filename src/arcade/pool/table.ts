/**
 * Pool — the table, and every number the simulation is tuned by.
 *
 * ## Table units, not pixels
 *
 * The same rule Air Hockey established, for the same reason: the whole
 * simulation runs in a fixed **200 × 100 table-unit box** and knows nothing
 * about the screen. A pixel-sized simulation changes its own physics when the
 * dialog is resized, and it makes every physics test depend on a layout.
 * `pool-draw.ts` maps table units to pixels at draw time and pointer
 * coordinates back at input time; nothing between those two edges has an
 * opinion about size.
 *
 * The box is described here as LANDSCAPE — 200 along, 100 across — with the
 * break end (the "kitchen") at `x = 0` and the rack end at `x = 200`. Every
 * constant, every physics function and every test in this directory speaks that
 * language. The portrait presentation a phone gets is a quarter turn applied at
 * draw time and nowhere else.
 *
 * 2:1 is a real pool table's proportion, and it is the one number here that is
 * not negotiable — it is what makes the picture read as pool at a glance.
 *
 * ## Why these numbers
 *
 * They are arcade numbers, not physical ones, and two of them are deliberately
 * generous:
 *
 *  - **The balls are big.** A real 9-foot table's ball is about 1.1% of the
 *    table's length; {@link BALL_RADIUS} makes ours 1.4%. On a 390 px phone that
 *    is the difference between a ball you can see the number on and a dot.
 *  - **The pockets are kind.** The mouths in `pool-physics-geometry.ts` are
 *    about 2.3 ball diameters against a real table's 2.0. A first-time player
 *    who aims roughly right should be rewarded; a game that punishes a 2° error
 *    is a game nobody finishes.
 *
 * Rolling friction is modelled as **constant deceleration** rather than
 * exponential decay, and that is the one place this file disagrees with
 * `hockey/table.ts` on purpose. An exponential decay never actually stops — it
 * asymptotes — which is fine for a puck that is always in play and wrong for
 * pool, where "all the balls have stopped" is the event the entire turn
 * structure hangs off. Constant deceleration stops a ball at a predictable
 * distance, which is also what a player's intuition about a real rolling ball
 * expects — and `d = v² / 2a` is the model the AI aims by.
 *
 * It survived the move to Planck for exactly that reason: `linearDamping` is
 * left at zero and the deceleration is applied by the adapter after each solver
 * step. See `pool-physics-world.ts`.
 *
 * ## What is NOT here
 *
 * The table's SHAPE. Cushion polygons, pocket mouths and jaw angles live in
 * `pool-physics-geometry.ts`, which the physics world, the renderer and the aim
 * guide all read — so the table a ball bounces off is the table on the screen.
 * This file is the numbers a ball is tuned by.
 */

import type { Vec2 } from './physics';

/** Table length, in table units. The long axis. */
export const TABLE_LENGTH = 200;
/** Table width, in table units. The short axis. */
export const TABLE_WIDTH = 100;
export const TABLE_CENTER_X = TABLE_LENGTH / 2;
export const TABLE_CENTER_Y = TABLE_WIDTH / 2;

export const BALL_RADIUS = 2.8;
export const BALL_DIAMETER = BALL_RADIUS * 2;

/*
  There is deliberately no POCKET_RADIUS or POCKET_CAPTURE_RADIUS here any more.

  Both were circles centred on the points below, and neither matched anything a
  player could see. The drawn hole was one radius, the capture was a smaller one,
  and the cushions were an unbroken rectangle that ignored both — so a ball could
  sit visibly inside the hole, be too far from its centre to drop, and be held
  there by a rail that was not drawn.

  A pocket is now the GAP its two neighbouring cushions leave, and a ball is
  pocketed when its centre crosses the plane between their noses. The shape is
  declared once, in `pool-physics-geometry.ts`, and the physics world, the
  renderer and the aim guide all read it from there.
*/

/**
 * Where the six pockets ARE, in table units: four corners and two in the middle
 * of the long rails.
 *
 * Nominal positions only — a name for each hole, used by the AI when it scores a
 * pot and by the result when it reports one. The SHAPE of a pocket, and whether
 * a ball has gone down it, is `pool-physics-geometry.ts`'s business.
 */
export const POCKETS: readonly Vec2[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: TABLE_CENTER_X, y: 0 }),
  Object.freeze({ x: TABLE_LENGTH, y: 0 }),
  Object.freeze({ x: 0, y: TABLE_WIDTH }),
  Object.freeze({ x: TABLE_CENTER_X, y: TABLE_WIDTH }),
  Object.freeze({ x: TABLE_LENGTH, y: TABLE_WIDTH }),
]) as readonly Vec2[];

/**
 * Rolling deceleration, in table units per second squared.
 *
 * Tuned against the table rather than against physics: a ball struck at
 * {@link MAX_SHOT_SPEED} covers `v² / 2a ≈ 660` units before stopping, which is
 * a shade over three table lengths — enough for a break to scatter the rack and
 * for the cue ball to come back, and not so much that every shot takes ten
 * seconds to settle.
 */
export const ROLLING_DECEL = 26;

/**
 * Below this speed a ball is stopped dead, in units per second.
 *
 * Not cosmetic. "Every ball has stopped" is the event that ends a shot, and a
 * ball creeping at 0.2 units/s would hold the whole turn structure open for
 * seconds after the shot was visually over.
 */
export const STOP_SPEED = 1.4;

/** Hard ceiling on any ball's speed, in units per second. */
export const MAX_BALL_SPEED = 190;

/** Speed of the softest shot the player can actually play. */
export const MIN_SHOT_SPEED = 40;
/** Speed of a full-power shot. Below {@link MAX_BALL_SPEED} by design. */
export const MAX_SHOT_SPEED = 185;

/**
 * How much of its speed a ball keeps when it rebounds off a cushion.
 *
 * 0.74 is roughly what cloth-covered rubber gives, and it matters more here than
 * it does in air hockey: a bouncy cushion makes every missed shot travel the
 * table three more times, and the wait between shots is most of what makes an
 * arcade pool game feel slow.
 */
export const CUSHION_RESTITUTION = 0.74;

/**
 * Ball-on-ball restitution. Near-elastic, as polished resin on polished resin
 * very nearly is.
 *
 * Kept high and kept purely NORMAL — no tangential friction, no spin. That is
 * what preserves the "90° rule" a player's intuition runs on (a full ball sends
 * the object ball along the line of centres and the cue ball off at a right
 * angle), and it is what makes the aim assistance honest rather than
 * approximate.
 */
export const BALL_RESTITUTION = 0.95;

/** The simulation step. Everything is tuned assuming a small, regular one. */
export const FIXED_STEP_MS = 1000 / 120;

/**
 * Where the cue ball is placed for the break, and the default legal position
 * whenever a player is handed ball-in-hand and does not move it.
 */
export const HEAD_SPOT: Vec2 = Object.freeze({ x: TABLE_LENGTH * 0.25, y: TABLE_CENTER_Y });

/** The apex of the rack, and where the 8-ball is re-spotted after a break pot. */
export const FOOT_SPOT: Vec2 = Object.freeze({ x: TABLE_LENGTH * 0.75, y: TABLE_CENTER_Y });

/**
 * Air between racked balls, in table units.
 *
 * Not zero. A rack built with the balls exactly touching starts every ball in
 * contact with its neighbours, and the very first collision pass resolves
 * fifteen simultaneous overlaps into a small explosion. A hair of space means
 * the rack is at rest until something hits it.
 */
export const RACK_GAP = 0.08;

/**
 * How long a shot may run before it is declared settled, in ms.
 *
 * A backstop, not a rule. Constant deceleration guarantees a ball stops within
 * `MAX_BALL_SPEED / ROLLING_DECEL ≈ 7.3` seconds, and collisions only ever
 * remove energy, so a real shot cannot reach this. It exists so that a
 * pathological state — two balls trading a jitter impulse forever — costs one
 * turn rather than freezing the match.
 */
export const MAX_SHOT_MS = 22_000;

/**
 * How long the break-setup beat lasts before the player may shoot, in ms.
 *
 * Pool's answer to Blobbi Dance's "3 — 2 — 1". A numeric countdown would be
 * absurd on a table nobody is racing, but the arcade lifecycle still needs a
 * moment between "Start" and "playing", and the player still needs to be told
 * whose break it is before a cue appears under their finger.
 */
export const READY_MS = 1500;

/** How long the "your turn" / "foul" banner stays up between shots, in ms. */
export const TURN_BANNER_MS = 1100;

/**
 * The shorter banner shown when the shooter keeps the table.
 *
 * Half the length, because it interrupts the person who is already winning the
 * exchange. A full pause after every pot makes a four-ball run feel like
 * paperwork.
 */
export const CONTINUE_BANNER_MS = 550;

/**
 * How long the winning or losing state is held before the result is reported.
 *
 * Long enough to see the last ball drop. The arcade's results panel replaces the
 * table entirely, so without this the deciding shot is never actually watched.
 */
export const MATCH_END_HOLD_MS = 1500;

/**
 * What "a match" is worth telling a player before they start, in ms.
 *
 * Four minutes. Measured by playing the Normal planner against itself over
 * thirty simulated matches: they land between about 150 and 380 seconds
 * depending on how early somebody gets a run of pots. The catalogue reads this
 * rather than restating a number, so the estimate on the table's card cannot
 * drift away from the game that produces it.
 */
export const TYPICAL_POOL_MATCH_MS = 240_000;

/** The rectangle a ball's CENTRE may occupy. */
export interface PoolBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export const BALL_BOUNDS: PoolBounds = Object.freeze({
  minX: BALL_RADIUS,
  maxX: TABLE_LENGTH - BALL_RADIUS,
  minY: BALL_RADIUS,
  maxY: TABLE_WIDTH - BALL_RADIUS,
});

// ── Shot power ──────────────────────────────────────────────────────────────

/**
 * How far back the cue must be pulled before a shot registers at all, in table
 * units.
 *
 * The accidental-tap guard. A pointer-down and pointer-up a few pixels apart —
 * which is what a tap on a phone actually produces — must not fire the cue, and
 * a mouse that twitches while the dialog is opening must not either. Inside the
 * dead zone the drag still re-aims, which turns the guard into a feature: a tap
 * behind the cue ball is how you aim without shooting.
 */
export const CUE_PULL_DEAD_ZONE = 3;

/** The pull distance that produces a full-power shot, past the dead zone. */
export const CUE_PULL_RANGE = 42;

/**
 * The least power a released drag may fire at.
 *
 * Separate from the dead zone, and both are needed. The dead zone stops a
 * *stationary* tap; this stops a short but real drag from producing a shot that
 * moves the cue ball four units and wastes the player's turn.
 */
export const MIN_SHOT_POWER = 0.08;

/**
 * Turn a 0..1 power into a launch speed.
 *
 * Linear between {@link MIN_SHOT_SPEED} and {@link MAX_SHOT_SPEED}. A curve was
 * tried and made the low end feel dead: most real shots are played between a
 * fifth and half power, so that is where the resolution needs to be, and a
 * squared response puts it all at the top.
 */
export function shotSpeedFor(power: number): number {
  const p = power < 0 ? 0 : power > 1 ? 1 : power;
  return MIN_SHOT_SPEED + p * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);
}

/** Turn a cue pull distance, in table units, into a 0..1 power. */
export function powerFromPull(pullDistance: number): number {
  if (!Number.isFinite(pullDistance)) return 0;
  const past = pullDistance - CUE_PULL_DEAD_ZONE;
  if (past <= 0) return 0;
  const p = past / CUE_PULL_RANGE;
  return p > 1 ? 1 : p;
}
