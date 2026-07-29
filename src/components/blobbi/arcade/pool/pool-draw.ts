/**
 * Pool — everything that puts pixels on the canvas.
 *
 * Presentation only. It reads a {@link PoolMatchState} and draws it; it never
 * changes one, never decides anything, and never talks to React. That split is
 * why `match.ts` can be tested by calling functions with numbers.
 *
 * ## Why a canvas
 *
 * Sixteen balls, a cue, two guide lines, a ghost ball and a scatter of contact
 * ripples, all moving at 120 Hz and none of them carrying text a screen reader
 * needs. Drawing that with DOM elements would mean a node per ripple, created
 * and destroyed several times a second, and a layout pass every frame.
 *
 * The accessible content — whose turn it is, which group each side is on, how
 * many balls are left, the foul message, the result — is real DOM AROUND the
 * canvas, so nothing a player needs to READ lives inside the picture. The canvas
 * itself is `aria-hidden`.
 *
 * ## Two layouts, one simulation
 *
 * The simulation's table is always 200 long by 100 across with the break end at
 * `x = 0`. How it is LAID OUT is a presentation decision, and it has to be,
 * because the space the game is given changes shape completely:
 *
 * | where | box | good layout |
 * | --- | --- | --- |
 * | desktop, inside the arcade frame | ~956 × 382, wide | landscape |
 * | phone held upright, expanded | ~390 × 700, tall | portrait |
 * | phone held sideways, expanded | ~740 × 350, wide | landscape |
 *
 * A 2:1 table fitted landscape into an upright phone is 390 × 195 — a quarter of
 * the screen, with the balls too small to tell apart. Turned a quarter, it is
 * 350 × 700, which is nearly four times the playfield.
 *
 * ```
 *   landscape   sim (x, y) → screen (x, y)
 *               the break end on the LEFT, matching the "You … Rival" HUD
 *
 *   portrait    sim (x, y) → screen (y, TABLE_LENGTH − x)
 *               the break end at the BOTTOM, nearest the hands holding
 *               the phone
 * ```
 *
 * Both matrices are proper rotations (determinant +1), never mirrors, so a
 * rebound on screen is always the rebound the simulation computed — and a shot
 * aimed at a pocket goes to that pocket in both layouts. That is the whole
 * reason the simulation was kept in abstract table units.
 *
 * ## The rails are part of the picture, not the physics
 *
 * `src/arcade/pool/` knows about a 200 × 100 playfield and nothing else.
 * {@link RAIL_WIDTH} is declared HERE, and {@link fitTable} reserves room for it
 * so a cushion can be drawn OUTSIDE the cloth. Without that the rails would have
 * to eat into the playfield, and the ball that visually touches the rail would
 * not be the ball the simulation bounces.
 */

import {
  BALL_RADIUS,
  TABLE_CENTER_Y,
  TABLE_LENGTH,
  TABLE_WIDTH,
  HEAD_SPOT,
  FOOT_SPOT,
} from '@/arcade/pool/table';
import {
  CORNER_MOUTH,
  CUSHION_DEPTH,
  POOL_CUSHIONS,
  POOL_POCKETS,
} from '@/arcade/pool/pool-physics-geometry';
import {
  CUE_BALL,
  EIGHT_BALL,
  isLegalBallPosition,
  predictCuePath,
  unitFromAngle,
  type PoolBall,
  type Vec2,
} from '@/arcade/pool/physics';
import type { PoolMatchState } from '@/arcade/pool/match';
import { groupOf, type PoolGroup } from '@/arcade/pool/rules';

/**
 * The table's colours.
 *
 * Warm green cloth in a honey-wood frame, rather than the deep indigo neon of
 * the dance machine and the air hockey table. Those two are cabinets with lit
 * screens; a pool table is a piece of furniture, and it should look like it was
 * carried into the room. The wood is the same family as `island-wood`, so it
 * still reads as one arcade.
 *
 * Nothing about the game state is communicated by colour alone: whose turn it
 * is, which group is whose and how many balls are left are all words in the DOM
 * above the canvas.
 */
export const POOL_PALETTE = {
  feltLight: '#2F8F63',
  felt: '#257953',
  feltDark: '#1C5F41',
  railLight: '#B0763F',
  rail: '#8C6239',
  railDark: '#6B4826',
  pocket: '#120D08',
  pocketRim: '#2A1D10',
  /** The cushion, cloth-covered: darker than the bed, so the rail reads as raised. */
  cushion: '#175840',
  cushionNose: 'rgba(255, 255, 255, 0.22)',
  marking: 'rgba(255, 255, 255, 0.22)',
  cue: '#F6F2E8',
  cueRim: '#D6CBB4',
  cueStick: '#C89A5C',
  cueStickDark: '#8A6534',
  cueTip: '#4B7FBF',
  aim: 'rgba(255, 255, 255, 0.72)',
  aimSoft: 'rgba(255, 255, 255, 0.28)',
  ghost: 'rgba(255, 255, 255, 0.55)',
  objectLine: '#FFD666',
  danger: '#F0554B',
  ok: '#7BE0A5',
} as const;

/**
 * The fifteen object balls, in the colours everybody already knows.
 *
 * Standard pool numbering, kept deliberately: a player who has ever seen a pool
 * table knows the 8 is black and the 1 is yellow before they read anything, and
 * inventing a palette would throw that away for nothing.
 */
export const BALL_COLOURS: Readonly<Record<number, string>> = Object.freeze({
  1: '#F2C230',
  2: '#2B62C4',
  3: '#D93A2B',
  4: '#7A3FA8',
  5: '#EE8B2D',
  6: '#1F9E5A',
  7: '#8C3B2E',
  8: '#16130F',
  9: '#F2C230',
  10: '#2B62C4',
  11: '#D93A2B',
  12: '#7A3FA8',
  13: '#EE8B2D',
  14: '#1F9E5A',
  15: '#8C3B2E',
});

/**
 * The wooden frame around the whole table, in table units.
 *
 * Deep enough to contain the cushions ({@link CUSHION_DEPTH}) and the deepest
 * pocket well — a corner's, whose radius is {@link CORNER_MOUTH}. Derived rather
 * than typed in, because a change to either would otherwise clip a pocket at the
 * edge of the canvas.
 */
export const RAIL_WIDTH = Math.max(CUSHION_DEPTH, CORNER_MOUTH) + 1;

/** A short-lived contact mark. Owned by the caller; drawn here. */
export interface PoolRipple {
  readonly x: number;
  readonly y: number;
  /** 0..1, how hard the contact was. Scales the ring. */
  readonly strength: number;
  /** Seconds since it happened. The caller ages it; past `RIPPLE_LIFE_S` it is dropped. */
  age: number;
  readonly tint: string;
}

export const RIPPLE_LIFE_S = 0.4;

export type PoolOrientation = 'landscape' | 'portrait';

export interface PoolTransform {
  /** CSS pixels per table unit. Uniform — the table never stretches. */
  readonly scale: number;
  /** Where table unit `(0, 0)` lands, in CSS pixels. Includes the rail inset. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Which layout this transform maps into. Carried so the inverse can agree. */
  readonly orientation: PoolOrientation;
}

/** The playfield's on-screen shape, in table units, for a layout. */
export function tableDisplaySize(orientation: PoolOrientation): {
  readonly width: number;
  readonly height: number;
} {
  return orientation === 'landscape'
    ? { width: TABLE_LENGTH, height: TABLE_WIDTH }
    : { width: TABLE_WIDTH, height: TABLE_LENGTH };
}

/** The whole table including its rails, in table units. */
export function tableOuterSize(orientation: PoolOrientation): {
  readonly width: number;
  readonly height: number;
} {
  const inner = tableDisplaySize(orientation);
  return { width: inner.width + RAIL_WIDTH * 2, height: inner.height + RAIL_WIDTH * 2 };
}

/**
 * The layout that fills a box best.
 *
 * Measured, never guessed from a user agent: a wide box gets the long axis
 * across it, a tall box gets the long axis down it. This is what makes a phone
 * rotate correctly — the container changes shape and the answer changes with it.
 * A square box is a tie, and landscape wins it because the HUD reads
 * left-to-right.
 */
export function autoOrientation(widthPx: number, heightPx: number): PoolOrientation {
  if (!(widthPx > 0) || !(heightPx > 0)) return 'landscape';
  return widthPx >= heightPx ? 'landscape' : 'portrait';
}

/**
 * Fit the table — rails included — into a box, preserving its aspect ratio.
 *
 * Uniform scale and a letterbox rather than a stretch, because a stretched table
 * would mean a pointer position that does not map back to a table unit the
 * simulation would agree with: the aim line would leave the cue ball at one
 * angle and the ball at another, and no amount of tuning would fix it.
 */
export function fitTable(
  widthPx: number,
  heightPx: number,
  orientation: PoolOrientation = 'landscape',
): PoolTransform {
  const outer = tableOuterSize(orientation);
  const scale = Math.min(widthPx / outer.width, heightPx / outer.height);
  return {
    scale,
    offsetX: (widthPx - outer.width * scale) / 2 + RAIL_WIDTH * scale,
    offsetY: (heightPx - outer.height * scale) / 2 + RAIL_WIDTH * scale,
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
 * the player points from where the cue aims: there is no second copy of the
 * mapping to update.
 */
export function toTableUnits(point: Vec2, transform: PoolTransform): Vec2 {
  if (transform.scale <= 0) return { x: TABLE_LENGTH / 2, y: TABLE_CENTER_Y };
  const px = (point.x - transform.offsetX) / transform.scale;
  const py = (point.y - transform.offsetY) / transform.scale;

  return transform.orientation === 'landscape'
    ? { x: px, y: py }
    : { x: TABLE_LENGTH - py, y: px };
}

/** Map table units to CSS pixels relative to the canvas box. The forward direction. */
export function toCanvasPixels(point: Vec2, transform: PoolTransform): Vec2 {
  const s = transform.scale;
  return transform.orientation === 'landscape'
    ? { x: transform.offsetX + point.x * s, y: transform.offsetY + point.y * s }
    : {
        x: transform.offsetX + point.y * s,
        y: transform.offsetY + (TABLE_LENGTH - point.x) * s,
      };
}

/**
 * Install the table-unit coordinate system for this frame, layout included.
 *
 * After this call every coordinate in this module is a SIMULATION table unit and
 * matches `match.ts` exactly. There is no second copy of the geometry to drift:
 * the pockets are drawn from `POCKETS`, the balls from `BALL_RADIUS`, the cloth
 * from `TABLE_LENGTH` and `TABLE_WIDTH`.
 */
export function applyTableTransform(
  ctx: CanvasRenderingContext2D,
  transform: PoolTransform,
  devicePixelRatio: number,
): void {
  const s = transform.scale * devicePixelRatio;
  const ox = transform.offsetX * devicePixelRatio;
  const oy = transform.offsetY * devicePixelRatio;

  if (transform.orientation === 'landscape') {
    ctx.setTransform(s, 0, 0, s, ox, oy);
  } else {
    // screenX = simY · s + offsetX
    // screenY = (TABLE_LENGTH − simX) · s + offsetY
    ctx.setTransform(0, -s, s, 0, ox, TABLE_LENGTH * s + oy);
  }
}

/**
 * Which way is DOWN the screen, expressed in simulation units.
 *
 * Drop shadows are the only thing drawn here with an opinion about gravity, and
 * after a quarter turn "down" is no longer `+y`. Getting this wrong puts every
 * shadow out to one side, which reads as a rendering bug rather than as a
 * shadow.
 */
export function screenDownInSim(orientation: PoolOrientation): Vec2 {
  return orientation === 'landscape' ? { x: 0, y: 1 } : { x: -1, y: 0 };
}

/**
 * How much to rotate text so it reads upright on screen.
 *
 * A ball number drawn under the portrait transform would run up the side of the
 * screen. Counter-rotating by a quarter turn puts it back the right way round —
 * which matters, because the number is how a player tells the 3 from the 11.
 */
export function textRotationFor(orientation: PoolOrientation): number {
  return orientation === 'landscape' ? 0 : Math.PI / 2;
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

// ── The table ───────────────────────────────────────────────────────────────

/**
 * The wooden frame, the cloth, the markings, the pockets and the cushions.
 *
 * ## Drawn from the physics, not alongside it
 *
 * Every cushion here is a polygon out of {@link POOL_CUSHIONS} — literally the
 * same vertex list Planck's static bodies are built from — and every pocket is
 * the gap between two of them. There is no separate "pocket radius" any more,
 * because there is nothing to tune: the hole on screen IS the hole in the table.
 *
 * That is the fix for the defect this rewrite was commissioned for. The previous
 * renderer drew a cut-back cushion over an unbroken rectangular collider, so a
 * ball could stop dead against a rail that was not there, or sit inside a
 * painted hole it was too far from the centre of to fall into.
 *
 * Order matters: **frame → cloth → markings → pocket wells → cushions**. The
 * wells are drawn before the cushions so a well can be a simple shape and let
 * the cushion polygons trim it back to exactly the mouth.
 */
export function drawTable(ctx: CanvasRenderingContext2D): void {
  drawFrame(ctx);

  // The cloth. A soft gradient reads as light falling across a table.
  const cloth = ctx.createLinearGradient(0, 0, 0, TABLE_WIDTH);
  cloth.addColorStop(0, POOL_PALETTE.feltLight);
  cloth.addColorStop(0.55, POOL_PALETTE.felt);
  cloth.addColorStop(1, POOL_PALETTE.feltDark);
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, TABLE_LENGTH, TABLE_WIDTH);

  drawMarkings(ctx);
  drawPocketWells(ctx);
  drawCushions(ctx);
}

/** The wooden surround. Everything else is drawn inside it. */
function drawFrame(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = POOL_PALETTE.rail;
  roundedRect(
    ctx,
    -RAIL_WIDTH,
    -RAIL_WIDTH,
    TABLE_LENGTH + RAIL_WIDTH * 2,
    TABLE_WIDTH + RAIL_WIDTH * 2,
    RAIL_WIDTH * 0.7,
  );
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = POOL_PALETTE.railLight;
  ctx.lineWidth = 1.2;
  roundedRect(
    ctx,
    -RAIL_WIDTH + 0.6,
    -RAIL_WIDTH + 0.6,
    TABLE_LENGTH + RAIL_WIDTH * 2 - 1.2,
    TABLE_WIDTH + RAIL_WIDTH * 2 - 1.2,
    RAIL_WIDTH * 0.65,
  );
  ctx.stroke();
}

/** The head string and the two spots. Faint — they orient, they do not decorate. */
function drawMarkings(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = POOL_PALETTE.marking;
  ctx.lineWidth = 0.4;
  ctx.setLineDash([2, 2.5]);
  ctx.beginPath();
  ctx.moveTo(HEAD_SPOT.x, 0);
  ctx.lineTo(HEAD_SPOT.x, TABLE_WIDTH);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = POOL_PALETTE.marking;
  for (const spot of [HEAD_SPOT, FOOT_SPOT]) {
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const TAU = Math.PI * 2;
const normaliseAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/**
 * The six pocket wells: for each, the part of a circle that lies BEYOND its
 * mouth chord.
 *
 * The circle is centred on the pocket and has {@link PoolPocket.wellRadius} — the
 * distance to its own cushion noses — so it reaches exactly to the ends of the
 * opening. Keeping only the far side of the chord is what makes this honest:
 *
 *  - it fills the whole corner, the way a hole cut into the slate does, instead
 *    of hanging off the corner as a separate dark shape;
 *  - it does not put one pixel of dark on playable cloth, because the chord IS
 *    the capture plane. A ball over the dark is a ball in the pocket.
 *
 * A plain circle would fail the second: at a corner it would blacken felt eight
 * units out along the diagonal that a ball can happily rest on.
 */
function drawPocketWells(ctx: CanvasRenderingContext2D): void {
  for (const pocket of POOL_POCKETS) {
    const { centre, mouthA, mouthB, outward, wellRadius } = pocket;

    const angleA = Math.atan2(mouthA.y - centre.y, mouthA.x - centre.x);
    const angleB = Math.atan2(mouthB.y - centre.y, mouthB.x - centre.x);
    const angleOut = Math.atan2(outward.y, outward.x);
    // Sweep the way that passes through the OUTWARD direction — the long way
    // round at a corner, the short way at a side pocket.
    const clockwiseSpan = normaliseAngle(angleB - angleA);
    const clockwiseHasOut = normaliseAngle(angleOut - angleA) <= clockwiseSpan;

    ctx.save();
    ctx.fillStyle = POOL_PALETTE.pocket;
    ctx.beginPath();
    ctx.moveTo(mouthA.x, mouthA.y);
    ctx.arc(centre.x, centre.y, wellRadius, angleA, angleB, !clockwiseHasOut);
    ctx.closePath();
    ctx.fill();

    // A lip along the mouth, so the opening reads as an edge rather than fading
    // into the cloth.
    ctx.strokeStyle = POOL_PALETTE.pocketRim;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(mouthA.x, mouthA.y);
    ctx.lineTo(mouthB.x, mouthB.y);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The six cushions, from the same polygons the physics uses.
 *
 * Drawn after the wells, so the noses trim each well back to its true mouth.
 */
function drawCushions(ctx: CanvasRenderingContext2D): void {
  for (const shape of POOL_CUSHIONS) {
    ctx.save();
    ctx.beginPath();
    shape.vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();

    ctx.fillStyle = POOL_PALETTE.cushion;
    ctx.fill();

    // A thin bright line along the NOSE only — the edge a ball actually meets.
    ctx.strokeStyle = POOL_PALETTE.cushionNose;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(shape.noseA.x, shape.noseA.y);
    ctx.lineTo(shape.noseB.x, shape.noseB.y);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Balls ───────────────────────────────────────────────────────────────────

/**
 * One ball: shadow, body, stripe, highlight, number.
 *
 * The number is drawn only when it would be legible — below about seven screen
 * pixels of radius it becomes a smudge that makes the ball look dirty rather
 * than numbered. The colour and the stripe still tell the player everything the
 * rules need; the number is the detail on top.
 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: PoolBall,
  down: Vec2,
  textRotation: number,
  screenRadiusPx: number,
): void {
  const isCue = ball.number === CUE_BALL;
  const colour = isCue ? POOL_PALETTE.cue : (BALL_COLOURS[ball.number] ?? '#888');
  const striped = ball.number > 8;

  ctx.save();

  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.arc(ball.x + down.x * 0.9, ball.y + down.y * 0.9, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(textRotation);

  // Body. A striped ball is a white ball with a band across it, which is what a
  // striped ball is.
  ctx.fillStyle = striped ? '#F6F2E8' : colour;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  if (striped) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = colour;
    ctx.fillRect(-BALL_RADIUS, -BALL_RADIUS * 0.56, BALL_RADIUS * 2, BALL_RADIUS * 1.12);
    ctx.restore();
  }

  // A soft top-left highlight — the one thing that stops a flat disc reading as
  // a sticker instead of a sphere.
  const shine = ctx.createRadialGradient(
    -BALL_RADIUS * 0.34,
    -BALL_RADIUS * 0.4,
    0,
    0,
    0,
    BALL_RADIUS * 1.25,
  );
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  shine.addColorStop(0.42, 'rgba(255, 255, 255, 0.05)');
  shine.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 0.32;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_RADIUS - 0.16, 0, Math.PI * 2);
  ctx.stroke();

  if (!isCue && screenRadiusPx >= 7) {
    const discR = BALL_RADIUS * 0.56;
    ctx.fillStyle = '#FBF8F1';
    ctx.beginPath();
    ctx.arc(0, 0, discR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#211C16';
    ctx.font = `700 ${(BALL_RADIUS * 0.82).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A hair below centre: `middle` baselines sit optically high for digits.
    ctx.fillText(String(ball.number), 0, BALL_RADIUS * 0.06);
  }

  ctx.restore();
  ctx.restore();
}

/**
 * A ring around the balls the player is currently allowed to hit.
 *
 * The single most useful thing on the table for a new player, and the reason
 * "am I solids or stripes?" never has to be answered by squinting. It is a
 * reinforcement, not the only signal — the HUD says it in words too.
 */
export function drawTargetRings(
  ctx: CanvasRenderingContext2D,
  balls: readonly PoolBall[],
  group: PoolGroup | null,
  onTheEight: boolean,
): void {
  ctx.save();
  ctx.lineWidth = 0.55;
  ctx.setLineDash([1.6, 1.4]);
  for (const ball of balls) {
    if (ball.pocketed || ball.number === CUE_BALL) continue;
    const isTarget = onTheEight
      ? ball.number === EIGHT_BALL
      : group === null
        ? ball.number !== EIGHT_BALL
        : groupOf(ball.number) === group;
    if (!isTarget) continue;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ── The cue and the aim ─────────────────────────────────────────────────────

export interface AimState {
  /** Where the cue is pointing, in radians, in table space. */
  readonly angle: number;
  /** 0..1. Drawn as how far the cue is drawn back. */
  readonly power: number;
  /** True while the player is actually dragging. Brightens the guide. */
  readonly dragging: boolean;
}

/** How far behind the cue ball the tip sits at zero power, in table units. */
const CUE_REST_GAP = 2.4;
/** How far further back a full-power pull draws it. */
const CUE_PULL_TRAVEL = 16;
const CUE_LENGTH = 72;

/**
 * The cue stick, drawn behind the ball along the aim, pulled back by power.
 *
 * The pull IS the power meter. A number would be more precise and much less
 * useful: the thing a player is doing with their finger is pulling a cue back,
 * and showing that happening is what makes the control explain itself. The DOM
 * meter beside the table is the precise version, for anyone who wants it.
 */
export function drawCue(ctx: CanvasRenderingContext2D, cue: Vec2, aim: AimState): void {
  const direction = unitFromAngle(aim.angle);
  const back = CUE_REST_GAP + aim.power * CUE_PULL_TRAVEL;

  const tipX = cue.x - direction.x * (BALL_RADIUS + back);
  const tipY = cue.y - direction.y * (BALL_RADIUS + back);
  const buttX = tipX - direction.x * CUE_LENGTH;
  const buttY = tipY - direction.y * CUE_LENGTH;

  ctx.save();
  ctx.lineCap = 'round';

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY + 0.9);
  ctx.lineTo(buttX, buttY + 0.9);
  ctx.stroke();

  const shaft = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  shaft.addColorStop(0, POOL_PALETTE.cueStick);
  shaft.addColorStop(1, POOL_PALETTE.cueStickDark);
  ctx.strokeStyle = shaft;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(buttX, buttY);
  ctx.stroke();

  ctx.strokeStyle = POOL_PALETTE.cueTip;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - direction.x * 2.2, tipY - direction.y * 2.2);
  ctx.stroke();

  ctx.restore();
}

/**
 * The aim assistance: where the cue ball goes, and what it hits.
 *
 * Three marks, and no more:
 *
 *  - a dashed line from the cue ball to the first thing in its way;
 *  - a ghost ball at the point of contact;
 *  - a short arrow showing which way the struck ball would set off.
 *
 * The third is exact rather than approximate — the collision carries no spin, so
 * the object ball genuinely leaves along the line of centres — and it is the one
 * piece of information that turns aiming from guesswork into a skill.
 *
 * What it deliberately does NOT show: how far the object ball travels, whether
 * it reaches the pocket, where the cue ball ends up, or anything past the first
 * contact. A guide that answers "does this shot go in?" has played the shot for
 * the player.
 */
export function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  cue: Vec2,
  balls: readonly PoolBall[],
  aim: AimState,
): void {
  const direction = unitFromAngle(aim.angle);
  const prediction = predictCuePath(cue, direction, balls);

  ctx.save();
  ctx.lineCap = 'round';

  ctx.strokeStyle = aim.dragging ? POOL_PALETTE.aim : POOL_PALETTE.aimSoft;
  ctx.lineWidth = 0.55;
  ctx.setLineDash([2.6, 2.6]);
  ctx.beginPath();
  ctx.moveTo(cue.x + direction.x * BALL_RADIUS, cue.y + direction.y * BALL_RADIUS);
  ctx.lineTo(prediction.contact.x, prediction.contact.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (prediction.end === 'ball') {
    ctx.strokeStyle = POOL_PALETTE.ghost;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(prediction.contact.x, prediction.contact.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    if (prediction.objectDirection) {
      const from = prediction.contact;
      const dir = prediction.objectDirection;
      // Anchored on the object ball's far side, so the arrow reads as the ball
      // leaving rather than as a line drawn through it.
      const startX = from.x + dir.x * BALL_RADIUS * 3;
      const startY = from.y + dir.y * BALL_RADIUS * 3;
      ctx.strokeStyle = POOL_PALETTE.objectLine;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + dir.x * 12, startY + dir.y * 12);
      ctx.stroke();
    }
  } else if (prediction.end === 'pocket') {
    // The cue ball is heading straight down a hole. Saying so is honest, and it
    // is the one mistake a beginner cannot see coming.
    ctx.strokeStyle = POOL_PALETTE.danger;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(prediction.contact.x, prediction.contact.y, BALL_RADIUS * 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * The cue ball during ball-in-hand: a dashed halo, red where it may not go.
 *
 * Colour is the reinforcement here rather than the signal — the confirm button
 * beside the table carries the words, and an illegal placement is snapped to a
 * legal one on confirm anyway, so nobody can be stuck.
 */
export function drawPlacementHalo(
  ctx: CanvasRenderingContext2D,
  cue: Vec2,
  legal: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = legal ? POOL_PALETTE.ok : POOL_PALETTE.danger;
  ctx.lineWidth = 0.7;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, BALL_RADIUS + 2.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawRipples(ctx: CanvasRenderingContext2D, ripples: readonly PoolRipple[]): void {
  if (ripples.length === 0) return;
  ctx.save();
  for (const ripple of ripples) {
    const t = Math.min(1, ripple.age / RIPPLE_LIFE_S);
    ctx.globalAlpha = (1 - t) * 0.6;
    ctx.strokeStyle = ripple.tint;
    ctx.lineWidth = 1.1 * (1 - t) + 0.25;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, BALL_RADIUS + t * (5 + ripple.strength * 9), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ── The frame ───────────────────────────────────────────────────────────────

export interface DrawPoolFrameOptions {
  readonly transform: PoolTransform;
  readonly devicePixelRatio: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Present only while the player may aim. */
  readonly aim: AimState | null;
  readonly ripples: readonly PoolRipple[];
  /** Ring the balls this side may legally strike. */
  readonly showTargets: boolean;
  /** True while the player is dragging the cue ball into place. */
  readonly placing: boolean;
}

/** Draw a whole frame. The only function the game component calls. */
export function drawPoolFrame(
  ctx: CanvasRenderingContext2D,
  state: PoolMatchState,
  options: DrawPoolFrameOptions,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, options.pixelWidth, options.pixelHeight);
  applyTableTransform(ctx, options.transform, options.devicePixelRatio);

  const down = screenDownInSim(options.transform.orientation);
  const textRotation = textRotationFor(options.transform.orientation);
  const screenRadiusPx = BALL_RADIUS * options.transform.scale;

  drawTable(ctx);

  if (options.showTargets) {
    const group = state.assignment.player;
    const onTheEight =
      group !== null &&
      state.balls.every((b) => b.pocketed || groupOf(b.number) !== group);
    drawTargetRings(ctx, state.balls, group, onTheEight);
  }

  drawRipples(ctx, options.ripples);

  const cue = state.balls.find((b) => b.number === CUE_BALL);

  // The aim guide goes UNDER the balls: a dashed line drawn over the object ball
  // it points at makes the ball look like it is behind glass.
  if (options.aim && cue && !cue.pocketed) {
    drawAimGuide(ctx, cue, state.balls, options.aim);
  }

  for (const ball of state.balls) {
    if (ball.pocketed) continue;
    drawBall(ctx, ball, down, textRotation, screenRadiusPx);
  }

  if (cue && !cue.pocketed) {
    if (options.placing) {
      drawPlacementHalo(ctx, cue, isLegalBallPosition(cue, state.balls, CUE_BALL));
    } else if (options.aim) {
      drawCue(ctx, cue, options.aim);
    }
  }
}
