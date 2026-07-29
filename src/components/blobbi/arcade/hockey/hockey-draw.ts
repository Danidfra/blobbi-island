/**
 * Air Hockey — everything that puts pixels on the canvas.
 *
 * Presentation only. It reads a {@link HockeyMatchState} and draws it; it never
 * changes one, never decides anything, and never talks to React. That split is
 * why `match.ts` can be tested by calling functions with numbers.
 *
 * ## Why a canvas at all
 *
 * Blobbi Dance deliberately uses DOM elements — a dozen notes with text, focus
 * rings and a screen-reader story, none of which a canvas gives you free. Air
 * Hockey is the opposite case: three moving circles, a puck trail, contact
 * ripples and a table's worth of markings, none of which carry text and none of
 * which a keyboard user tabs to. Drawing that with elements would mean a DOM
 * node per trail sample and per ripple, created and destroyed several times a
 * second.
 *
 * The accessible content — both scores, the phase, the countdown, the result —
 * is real DOM ABOVE the canvas, so nothing a player needs to READ lives inside
 * the picture. The canvas itself is `aria-hidden`.
 *
 * ## Table units in, pixels out
 *
 * {@link applyTableTransform} installs a transform once per frame, after which
 * every coordinate in this file is a table unit and matches the simulation
 * exactly. There is no second copy of the geometry to drift: the goal mouth is
 * drawn from `GOAL_HALF_WIDTH`, the puck from `PUCK_RADIUS`, the centre line
 * from `TABLE_CENTER_Y`.
 */

import {
  GOAL_HALF_WIDTH,
  MALLET_RADIUS,
  PUCK_RADIUS,
  TABLE_CENTER_X,
  TABLE_CENTER_Y,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '@/arcade/hockey/table';
import type { HockeyMatchState } from '@/arcade/hockey/match';
import type { HockeySide, Vec2 } from '@/arcade/hockey/physics';

/**
 * The table's colours.
 *
 * Deep indigo felt with neon markings — the same family as the dance game's
 * playfield, so the two machines read as the same arcade. The two sides are
 * told apart by HUE (purple for the player, amber for the opponent) and also by
 * POSITION and by the labelled scores in the DOM, so nothing about the game
 * state is communicated by colour alone.
 */
export const HOCKEY_PALETTE = {
  feltTop: '#241a3d',
  feltBottom: '#15102a',
  rail: '#0d0a1c',
  line: 'rgba(255, 255, 255, 0.26)',
  lineSoft: 'rgba(255, 255, 255, 0.13)',
  player: '#9C7BF0',
  playerDark: '#6B4FC4',
  opponent: '#F0A35C',
  opponentDark: '#B96F2C',
  puck: '#FDFBFF',
  puckRim: '#C9B6FF',
} as const;

/** A short-lived contact mark. Owned by the caller; drawn here. */
export interface HockeyRipple {
  readonly x: number;
  readonly y: number;
  /** 0..1, how hard the contact was. Scales the ring. */
  readonly strength: number;
  /** Seconds since it happened. The caller ages it; past `RIPPLE_LIFE_S` it is dropped. */
  age: number;
  readonly tint: string;
}

export const RIPPLE_LIFE_S = 0.42;
/** How many puck positions the trail remembers. */
export const TRAIL_LENGTH = 14;

/**
 * ## Two layouts, one simulation
 *
 * The simulation's table is always the same shape: 100 wide, 160 long, with the
 * player's goal at `y = 160`. How it is LAID OUT is a presentation decision, and
 * it has to be, because the space the game is given changes shape completely:
 *
 * | where | box | good layout |
 * | --- | --- | --- |
 * | desktop, contained in the arcade frame | ~975 × 460, wide | landscape |
 * | phone held upright, expanded | ~390 × 700, tall | portrait |
 * | phone held sideways, expanded | ~740 × 350, wide | landscape |
 *
 * Fitting a portrait table into the desktop box left about 60% of the playfield
 * as empty margin; fitting a landscape one into an upright phone does the same
 * thing the other way round. So the renderer supports both, chosen from the
 * measured container and overridable by the player on desktop, and **nothing in
 * `src/arcade/hockey/` knows which one is in use.**
 *
 * ```
 *   landscape   sim (x, y) → screen (TABLE_HEIGHT − y, x)
 *               player's goal on the LEFT, matching the "You … Rival"
 *               scoreboard above it
 *
 *   portrait    sim (x, y) → screen (x, y)
 *               player's goal at the BOTTOM, nearest the hands holding
 *               the phone
 * ```
 *
 * Both matrices are proper rotations (determinant +1), never mirrors, so a
 * rebound on screen is always the rebound the simulation computed. That is the
 * whole reason the simulation was kept in abstract table units rather than
 * pixels: the layout changed twice after the physics was tuned, and not one
 * number in `table.ts` moved either time.
 */

export type HockeyOrientation = 'landscape' | 'portrait';

export interface TableTransform {
  /** CSS pixels per table unit. Uniform — the table never stretches. */
  readonly scale: number;
  /** Letterbox offset in CSS pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Which layout this transform maps into. Carried so the inverse can agree. */
  readonly orientation: HockeyOrientation;
}

/** The table's on-screen shape, in table units, for a layout. */
export function tableDisplaySize(orientation: HockeyOrientation): {
  readonly width: number;
  readonly height: number;
} {
  return orientation === 'landscape'
    ? { width: TABLE_HEIGHT, height: TABLE_WIDTH }
    : { width: TABLE_WIDTH, height: TABLE_HEIGHT };
}

/** The CSS `aspect-ratio` value the table's box should be laid out at. */
export function tableAspectRatio(orientation: HockeyOrientation): string {
  const { width, height } = tableDisplaySize(orientation);
  return `${width} / ${height}`;
}

/**
 * The layout that fills a box best.
 *
 * Measured, never guessed from a user agent: a wide box gets the long axis
 * across it, a tall box gets the long axis down it. This is what makes a phone
 * rotate correctly — the container changes shape and the answer changes with it.
 * A square box is a tie, and landscape wins it because the scoreboard reads
 * left-to-right.
 */
export function autoOrientation(widthPx: number, heightPx: number): HockeyOrientation {
  if (!(widthPx > 0) || !(heightPx > 0)) return 'landscape';
  return widthPx >= heightPx ? 'landscape' : 'portrait';
}

/**
 * Fit the table into a box, preserving its aspect ratio.
 *
 * Uniform scale and a letterbox rather than a stretch, because a stretched table
 * would mean a pointer position that does not map back to a table unit the
 * simulation would agree with — the puck would appear to leave the mallet at the
 * wrong angle, and no amount of tuning would fix it.
 */
export function fitTable(
  widthPx: number,
  heightPx: number,
  orientation: HockeyOrientation = 'landscape',
): TableTransform {
  const size = tableDisplaySize(orientation);
  const scale = Math.min(widthPx / size.width, heightPx / size.height);
  return {
    scale,
    offsetX: (widthPx - size.width * scale) / 2,
    offsetY: (heightPx - size.height * scale) / 2,
    orientation,
  };
}

/**
 * Map a point in CSS pixels (relative to the canvas box) to table units.
 *
 * The one place pointer input crosses into the simulation's coordinate system,
 * and the exact inverse of {@link applyTableTransform} — layout included.
 * Because both directions read the same `orientation` off the same object, a
 * resize, a device rotation or a manual layout switch cannot desynchronise where
 * the player points from where the mallet goes: there is no second copy of the
 * mapping to update.
 */
export function toTableUnits(point: Vec2, transform: TableTransform): Vec2 {
  if (transform.scale <= 0) return { x: TABLE_CENTER_X, y: TABLE_CENTER_Y };
  const px = (point.x - transform.offsetX) / transform.scale;
  const py = (point.y - transform.offsetY) / transform.scale;

  return transform.orientation === 'landscape'
    ? { x: py, y: TABLE_HEIGHT - px }
    : { x: px, y: py };
}

/**
 * Install the table-unit coordinate system for this frame, layout included.
 *
 * After this call every coordinate in this module is a SIMULATION table unit and
 * matches `match.ts` exactly. There is no second copy of the geometry to drift.
 */
export function applyTableTransform(
  ctx: CanvasRenderingContext2D,
  transform: TableTransform,
  devicePixelRatio: number,
): void {
  const s = transform.scale * devicePixelRatio;
  const ox = transform.offsetX * devicePixelRatio;
  const oy = transform.offsetY * devicePixelRatio;

  if (transform.orientation === 'landscape') {
    // screenX = −simY · s + (TABLE_HEIGHT · s + offsetX)
    // screenY =  simX · s + offsetY
    ctx.setTransform(0, s, -s, 0, TABLE_HEIGHT * s + ox, oy);
  } else {
    ctx.setTransform(s, 0, 0, s, ox, oy);
  }
}

/**
 * Which way is DOWN the screen, expressed in simulation units.
 *
 * Drop shadows are the only thing drawn here that has an opinion about gravity,
 * and after a quarter turn "down" is no longer `+y`. Getting this wrong puts
 * every shadow out to one side, which reads as a rendering bug rather than as a
 * shadow.
 */
export function screenDownInSim(orientation: HockeyOrientation): Vec2 {
  return orientation === 'landscape' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** The felt, the markings and the two goal mouths. Redrawn every frame — it is cheap. */
export function drawTable(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, TABLE_HEIGHT);
  gradient.addColorStop(0, HOCKEY_PALETTE.feltTop);
  gradient.addColorStop(0.5, HOCKEY_PALETTE.feltBottom);
  gradient.addColorStop(1, HOCKEY_PALETTE.feltTop);
  ctx.fillStyle = gradient;
  roundedRect(ctx, 0, 0, TABLE_WIDTH, TABLE_HEIGHT, 6);
  ctx.fill();

  // Centre line and circle.
  ctx.strokeStyle = HOCKEY_PALETTE.line;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(0, TABLE_CENTER_Y);
  ctx.lineTo(TABLE_WIDTH, TABLE_CENTER_Y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(TABLE_CENTER_X, TABLE_CENTER_Y, 15, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = HOCKEY_PALETTE.lineSoft;
  ctx.beginPath();
  ctx.arc(TABLE_CENTER_X, TABLE_CENTER_Y, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Goal creases — a semicircle in front of each mouth, tinted to whoever
  // defends it. A player glancing at the table can tell which end is theirs
  // without reading anything.
  drawCrease(ctx, 0, HOCKEY_PALETTE.opponent);
  drawCrease(ctx, TABLE_HEIGHT, HOCKEY_PALETTE.player);

  drawGoalMouth(ctx, 0, HOCKEY_PALETTE.opponent);
  drawGoalMouth(ctx, TABLE_HEIGHT, HOCKEY_PALETTE.player);

  // Rail highlight, so the playfield reads as inset.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.8;
  roundedRect(ctx, 0.4, 0.4, TABLE_WIDTH - 0.8, TABLE_HEIGHT - 0.8, 6);
  ctx.stroke();
}

function drawCrease(ctx: CanvasRenderingContext2D, lineY: number, tint: string): void {
  const towardCentre = lineY === 0 ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(
    TABLE_CENTER_X,
    lineY,
    26,
    towardCentre > 0 ? 0 : Math.PI,
    towardCentre > 0 ? Math.PI : Math.PI * 2,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Thickness of the painted goal line, in table units. */
const GOAL_LINE_WIDTH = 2.6;

function drawGoalMouth(ctx: CanvasRenderingContext2D, lineY: number, tint: string): void {
  // Drawn just INSIDE the goal line rather than centred on it. A stroke centred
  // on `y = 0` puts half its width outside the canvas, so the mouth appeared as
  // a thin sliver at the top and vanished completely at the bottom — the two
  // most important marks on the table, and the only ones telling a player which
  // end is theirs. The simulation's goal line is untouched: this moves paint,
  // not geometry.
  const inset = GOAL_LINE_WIDTH / 2;
  const y = lineY === 0 ? inset : lineY - inset;

  ctx.save();
  ctx.strokeStyle = tint;
  ctx.lineWidth = GOAL_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TABLE_CENTER_X - GOAL_HALF_WIDTH, y);
  ctx.lineTo(TABLE_CENTER_X + GOAL_HALF_WIDTH, y);
  ctx.stroke();

  // The two posts, so the mouth's edges are readable as edges rather than as
  // the ends of a line.
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  const postDepth = lineY === 0 ? 5 : -5;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(TABLE_CENTER_X + side * GOAL_HALF_WIDTH, y);
    ctx.lineTo(TABLE_CENTER_X + side * GOAL_HALF_WIDTH, y + postDepth);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The puck's recent path.
 *
 * Motion feedback, not decoration: at speed the puck moves several of its own
 * diameters between frames, and without a trail it reads as a flicker rather
 * than as a thing travelling in a direction. Suppressed under reduced motion by
 * the caller simply not collecting samples.
 */
export function drawTrail(ctx: CanvasRenderingContext2D, trail: readonly Vec2[]): void {
  if (trail.length < 2) return;
  ctx.save();
  for (let i = 0; i < trail.length; i += 1) {
    const t = (i + 1) / trail.length;
    ctx.globalAlpha = 0.05 + t * 0.2;
    ctx.fillStyle = HOCKEY_PALETTE.puckRim;
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, PUCK_RADIUS * (0.35 + t * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawPuck(ctx: CanvasRenderingContext2D, puck: Vec2, down: Vec2): void {
  ctx.save();
  // `down` is screen-down expressed in sim units, so the shadow falls under the
  // puck in both layouts rather than out to one side in one of them.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(puck.x + down.x, puck.y + down.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = HOCKEY_PALETTE.puck;
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = HOCKEY_PALETTE.puckRim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, PUCK_RADIUS - 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawMallet(
  ctx: CanvasRenderingContext2D,
  mallet: Vec2,
  side: HockeySide,
  down: Vec2,
): void {
  const face = side === 'player' ? HOCKEY_PALETTE.player : HOCKEY_PALETTE.opponent;
  const rim = side === 'player' ? HOCKEY_PALETTE.playerDark : HOCKEY_PALETTE.opponentDark;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(mallet.x + down.x * 1.4, mallet.y + down.y * 1.4, MALLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(mallet.x, mallet.y, MALLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(mallet.x, mallet.y, MALLET_RADIUS - 1.4, 0, Math.PI * 2);
  ctx.fill();

  // The knob, so the mallet reads as a handle you are holding rather than a disc.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(mallet.x, mallet.y, MALLET_RADIUS * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawRipples(ctx: CanvasRenderingContext2D, ripples: readonly HockeyRipple[]): void {
  if (ripples.length === 0) return;
  ctx.save();
  for (const ripple of ripples) {
    const t = Math.min(1, ripple.age / RIPPLE_LIFE_S);
    ctx.globalAlpha = (1 - t) * 0.55;
    ctx.strokeStyle = ripple.tint;
    ctx.lineWidth = 1.4 * (1 - t) + 0.3;
    ctx.beginPath();
    ctx.arc(
      ripple.x,
      ripple.y,
      PUCK_RADIUS + t * (7 + ripple.strength * 12),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A wash over the whole table when a goal goes in, tinted to whoever scored.
 *
 * `intensity` is 0..1 and the caller fades it; at reduced motion the caller
 * holds it at a low constant instead, so the event is still communicated
 * without a flash.
 */
export function drawGoalWash(
  ctx: CanvasRenderingContext2D,
  scorer: HockeySide,
  intensity: number,
): void {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.4, intensity * 0.4);
  ctx.fillStyle = scorer === 'player' ? HOCKEY_PALETTE.player : HOCKEY_PALETTE.opponent;
  roundedRect(ctx, 0, 0, TABLE_WIDTH, TABLE_HEIGHT, 6);
  ctx.fill();
  ctx.restore();
}

/** Draw a whole frame. The only function the game component calls. */
export function drawHockeyFrame(
  ctx: CanvasRenderingContext2D,
  state: HockeyMatchState,
  options: {
    readonly transform: TableTransform;
    readonly devicePixelRatio: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly trail: readonly Vec2[];
    readonly ripples: readonly HockeyRipple[];
    readonly goalWash: number;
  },
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, options.pixelWidth, options.pixelHeight);
  applyTableTransform(ctx, options.transform, options.devicePixelRatio);

  const down = screenDownInSim(options.transform.orientation);

  drawTable(ctx);
  drawTrail(ctx, options.trail);
  drawRipples(ctx, options.ripples);
  drawMallet(ctx, state.opponentMallet, 'opponent', down);
  drawMallet(ctx, state.playerMallet, 'player', down);
  drawPuck(ctx, state.puck, down);
  if (state.lastScorer) drawGoalWash(ctx, state.lastScorer, options.goalWash);
}
