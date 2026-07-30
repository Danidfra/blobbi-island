/**
 * Data-driven configuration for the Blobbi Island theater's armchairs.
 *
 * ## 26 seats, 28 chairs
 *
 * The room draws **28 chair sprites**, of which **26 are occupiable** and **2
 * are decorative**. Both numbers are real and neither is a typo; the earlier
 * comments quoted whichever one suited the sentence, which made "how many seats
 * are there?" ambiguous. The model is explicit now:
 *
 * | | count | `occupiable` | behaviour |
 * | --- | --- | --- | --- |
 * | occupiable seat | 26 | `true` | clickable, walkable-to, can become `sittingIn` |
 * | decorative chair | 2 | `false` | drawn only: no id, no cursor, no handlers |
 *
 * The two decorative chairs are row B's outermost pair. The original flex row
 * was pushed 6 % outside the world on each side, so their centres land at
 * x ≈ −0.6 % and ≈ 100.7 % — off the edges of the world, unreachable by any
 * walk. They are still DRAWN, because deleting them would visibly change the
 * room, and {@link occupiableTheaterSeats} is what every occupancy question
 * should be asked of.
 *
 * Replaces six flex rows of anonymous `<InteractiveElement alt="Stage Chair">`
 * clones. Those produced 28 chairs that all collapsed to the same
 * `data-chair-id`, which made occupancy, arrival and "which seat am I in?"
 * unanswerable questions. Every seat here has a stable, unique id instead —
 * exactly the pattern `town-bushes-config.ts` established for hiding spots, and
 * the id that later carries into multiplayer presence.
 *
 * ## Geometry
 *
 * The layout is NOT re-designed: it reproduces the original flex rows exactly.
 * Each row was `flex items-center -space-x-4` (a −16 px overlap) of `w-28`
 * chairs inside the fixed 1046 × 697 virtual world, giving a 96 px pitch. The
 * centers derived below match the measured layout of the original markup to
 * within a rounding error, so the room looks unchanged.
 *
 * Placement is expressed as plain percentages applied via inline `style`, not as
 * Tailwind classes: 28 seats' worth of arbitrary-value classes would have to be
 * written out as string literals for Tailwind's scanner to emit them, and any
 * arithmetic mistake would be invisible. Percentages are checked by tests.
 *
 * ## What is deliberately absent
 *
 * Occupancy. Who is sitting where is runtime state derived from local state and
 * (later) multiplayer presence — never configuration.
 */

import { constrainPosition } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';

/** The three seating rows, front (a) to back (c). */
export type SeatRow = 'a' | 'b' | 'c';

export interface TheaterSeatConfig {
  /**
   * Stable id — local seated state, DOM lookup and (later) presence all key on
   * this. Format: `theater-seat-<row><n>`, numbered left to right across the
   * whole row (the centre aisle does not restart the numbering).
   */
  id: string;
  row: SeatRow;
  side: 'left' | 'right';
  /** Chair sprite. `chair-left.png` is the mirrored version of `chair.png`. */
  src: string;
  /** Accessible label, unique per seat so the DOM is legible. */
  alt: string;
  /** Left edge of the sprite, in percent of world width. */
  leftPercent: number;
  /** Distance from the world's bottom edge, in percent of world height. */
  bottomPercent: number;
  /** Sprite width, in percent of world width (height follows the art's ratio). */
  widthPercent: number;
  /**
   * Fractional aim point inside the sprite rect (0..1) used to compute both the
   * walk-to target and the position the Blobbi occupies once seated.
   * `{ x: 0.5, y: 0.2 }` is the seat's cushion line: horizontally centred, a
   * fifth of the way down the chair art.
   */
  interactionTarget: { x: number; y: number };
  /**
   * Extra world-percent nudge applied to the seated Blobbi if a chair's art ever
   * needs it. Unused today (the aim point is already right); kept so a single
   * odd seat can be corrected without special-casing the renderer.
   */
  seatedOffset?: { xPercent: number; yPercent: number };
  /**
   * Sprite scale multiplier applied ONLY while seated. Descends by row so the
   * three rows read as depth in a room that has no perspective scaling at all
   * (there is deliberately no `locationScalingConfig['stage-inside.png']` —
   * continuous y-scaling would make a Blobbi grow and shrink while walking the
   * aisle).
   */
  seatedScale: number;
  /**
   * Fixed chair z-index. CONSTANT — never raised to occlude a Blobbi. Depth
   * comes from the Blobbi's own y-position bands
   * (`backgroundZIndexConfigs['stage-inside.png']`), which already interleave
   * correctly with these values.
   */
  zIndex: number;
  /** Which way a Blobbi seated here is turned. Every theater seat faces the screen. */
  facing: 'front' | 'back';
  /**
   * Whether a Blobbi may sit here.
   *
   * `false` marks a **decorative chair**: it is drawn, and that is all. It
   * cannot be clicked, cannot start a walk, can never become `sittingIn`, and is
   * excluded from {@link occupiableTheaterSeats} — so occupancy APIs built on
   * that list cannot accidentally count it.
   */
  occupiable: boolean;
}

// ── Measured constants (virtual world is 1046 × 697) ────────────────────────

const WORLD_W = 1046;
const WORLD_H = 697;
/** `w-28` = 112 px. */
const CHAIR_W = 112;
/** 112 px at the sprite's intrinsic 128 × 123 ratio. */
const CHAIR_H = (CHAIR_W * 123) / 128;
/** `-space-x-4` overlaps neighbours by 16 px. */
const PITCH = CHAIR_W - 16;

const CHAIR_W_PCT = (CHAIR_W / WORLD_W) * 100;
/** Rendered chair height in percent of world height (documentation/tests). */
export const SEAT_SPRITE_HEIGHT_PERCENT = (CHAIR_H / WORLD_H) * 100;

/** Default cushion aim point, shared by every seat. */
export const SEAT_CUSHION_TARGET = { x: 0.5, y: 0.2 } as const;

interface RowSpec {
  row: SeatRow;
  /** `bottom-*` of the original row container, in percent of world height. */
  bottomPercent: number;
  zIndex: number;
  seatedScale: number;
  /**
   * The original row containers' CSS `left` / `right` values, in percent of
   * world width. Negative means the container was pushed outside the world,
   * which is how row B ended up with two unreachable seats.
   */
  leftOffsetPercent: number;
  rightOffsetPercent: number;
  countPerSide: number;
}

const ROW_SPECS: RowSpec[] = [
  // Row A (front): `bottom-0 left-0` / `bottom-0 right-0`, z-30, 4 + 4.
  { row: 'a', bottomPercent: 0, zIndex: 30, seatedScale: 0.85, leftOffsetPercent: 0, rightOffsetPercent: 0, countPerSide: 4 },
  // Row B (middle): `bottom-[5%] -left-[6%]` / `-right-[6%]`, z-20, 5 + 5.
  { row: 'b', bottomPercent: 5, zIndex: 20, seatedScale: 0.78, leftOffsetPercent: -6, rightOffsetPercent: -6, countPerSide: 5 },
  // Row C (back): `bottom-[10%] -left-[2%]` / `-right-[2%]`, z-10, 5 + 5.
  { row: 'c', bottomPercent: 10, zIndex: 10, seatedScale: 0.72, leftOffsetPercent: -2, rightOffsetPercent: -2, countPerSide: 5 },
];

/** A chair whose sprite centre falls outside this band is unreachable. */
const OCCUPIABLE_CENTER_RANGE = { min: 2, max: 98 } as const;

function buildRow(spec: RowSpec): TheaterSeatConfig[] {
  const { row, bottomPercent, zIndex, seatedScale, countPerSide } = spec;
  const blockWidthPx = countPerSide * CHAIR_W - (countPerSide - 1) * 16;

  const seats: TheaterSeatConfig[] = [];

  // Left block: the container's left edge, then one pitch per chair.
  const leftBlockStartPx = (spec.leftOffsetPercent / 100) * WORLD_W;
  // Right block: the container is anchored to the right edge (possibly pushed
  // outside it), so its left edge is derived from the block's total width.
  const rightBlockStartPx = WORLD_W - (spec.rightOffsetPercent / 100) * WORLD_W - blockWidthPx;

  const blocks: Array<{ side: 'left' | 'right'; startPx: number; src: string }> = [
    { side: 'left', startPx: leftBlockStartPx, src: '/assets/locations/stage/chair-left.png' },
    { side: 'right', startPx: rightBlockStartPx, src: '/assets/locations/stage/chair.png' },
  ];

  let index = 0;
  for (const block of blocks) {
    for (let i = 0; i < countPerSide; i += 1) {
      index += 1;
      const leftPx = block.startPx + i * PITCH;
      const leftPercent = (leftPx / WORLD_W) * 100;
      const centerPercent = leftPercent + CHAIR_W_PCT / 2;
      const occupiable =
        centerPercent >= OCCUPIABLE_CENTER_RANGE.min && centerPercent <= OCCUPIABLE_CENTER_RANGE.max;

      seats.push({
        id: `theater-seat-${row}${index}`,
        row,
        side: block.side,
        src: block.src,
        alt: `Theater seat ${row.toUpperCase()}${index}`,
        leftPercent,
        bottomPercent,
        widthPercent: CHAIR_W_PCT,
        interactionTarget: { ...SEAT_CUSHION_TARGET },
        seatedScale,
        zIndex,
        facing: 'back',
        occupiable,
      });
    }
  }

  return seats;
}

/** Every CHAIR in the theater, in render order (front row first). 28 of them. */
export const theaterSeats: TheaterSeatConfig[] = ROW_SPECS.flatMap(buildRow);

/**
 * The seats a Blobbi can actually sit in. **This is the occupancy universe** —
 * any "who is sitting where", "is the room full", "pick a free seat" question
 * must be asked of this list, never of {@link theaterSeats}.
 */
export const occupiableTheaterSeats: TheaterSeatConfig[] = theaterSeats.filter((s) => s.occupiable);

/** The chairs that exist only as scenery. */
export const decorativeTheaterSeats: TheaterSeatConfig[] = theaterSeats.filter((s) => !s.occupiable);

/** 26. Asserted against the geometry by `theater-seats-config.test.ts`. */
export const THEATER_OCCUPIABLE_SEAT_COUNT = 26;

/** 2 — row B's outermost chairs, which hang off the edges of the world. */
export const THEATER_DECORATIVE_CHAIR_COUNT = 2;

const SEATS_BY_ID = new Map(theaterSeats.map((seat) => [seat.id, seat]));

/** Look up a chair by id. Returns undefined for unknown or stale ids. */
export function getTheaterSeat(seatId: string | null | undefined): TheaterSeatConfig | undefined {
  return seatId ? SEATS_BY_ID.get(seatId) : undefined;
}

/** True when the id names a seat a Blobbi is allowed to occupy. */
export function isOccupiableSeat(seatId: string | null | undefined): boolean {
  return getTheaterSeat(seatId)?.occupiable === true;
}

/** The configured cushion-surface point of a seat (the `interactionTarget` fraction). */
export function seatCushionPoint(seat: TheaterSeatConfig): { x: number; y: number } {
  const spriteTop = 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT;
  return {
    x: seat.leftPercent + seat.widthPercent * seat.interactionTarget.x,
    y: spriteTop + SEAT_SPRITE_HEIGHT_PERCENT * seat.interactionTarget.y,
  };
}

/** The theater renders the room-size token 'xl' (128 world px box). */
const SEATED_BLOBBI_BOX_PX = 128;
const WORLD_HEIGHT_PX = 697;

/**
 * How much of the SCALED seated body sinks below the cushion line.
 *
 * The seated pose is an explicit VISUAL POSE ANCHOR, not a standing ground
 * point: under BlobbiActor's bottom-center geometry the anchor is where the
 * body's bottom lands, and the ratio is applied to the row-SCALED body height
 * so front/middle/back rows sink proportionally and changing a row's
 * seatedScale keeps the same visual cushion contact.
 *
 * CALIBRATION — 0.5 is DERIVED, not eyeballed: the last known-good
 * (pre-ground-anchor) renderer placed the seated body's CENTER on the cushion
 * line with center-origin scaling, so its visible bottom sat at
 * `cushion + scaledBody/2`. Solving `ratio = (desiredPose − cushion) /
 * scaledBody` against that legacy bottom gives exactly 0.5 for every row —
 * one global ratio reproduces the legacy seated look (head and shoulders over
 * the own backrest, lower body tucked into the chair). An interim 0.3 sat the
 * body visibly too high in the chair.
 */
export const SEAT_CONTACT_RATIO = 0.5;

/**
 * Resolve the seated POSE ANCHOR for a seat (calibrated to the cushion):
 *
 *   pose = cushion line + SEAT_CONTACT_RATIO × (seated-scaled body height)
 *
 * Reached via `goTo(..., immediate)`, deliberately bypassing the walk boundary
 * — a chair cushion is not walkable floor. DOM-free, so every client and test
 * computes the same point; local and remote both consume it through
 * `resolveSeatedRender`.
 */
export function seatAnchorPosition(seat: TheaterSeatConfig): { x: number; y: number } {
  const cushion = seatCushionPoint(seat);
  const seatedBodyPercent = (SEATED_BLOBBI_BOX_PX * seat.seatedScale * 100) / WORLD_HEIGHT_PX;
  return {
    x: cushion.x + (seat.seatedOffset?.xPercent ?? 0),
    y: cushion.y + SEAT_CONTACT_RATIO * seatedBodyPercent + (seat.seatedOffset?.yPercent ?? 0),
  };
}

/**
 * The walk APPROACH fraction for a seat: the floor at the seat sprite's front
 * base (just below the sprite, clamped into the walk boundary by
 * `computeSeatTarget`). Distinct from `interactionTarget`, which is the
 * CUSHION fraction used by the seated pose — walking must aim at the floor in
 * front of the chair, never at the cushion itself.
 */
export const SEAT_APPROACH_TARGET = { x: 0.5, y: 1.05 } as const;

/**
 * DOM-free mirror of the runtime approach target (`TheaterSeat`'s
 * `computeSeatTarget` with {@link SEAT_APPROACH_TARGET}), clamped into the
 * theater walk boundary — the GROUND point the feet stop on before the seated
 * snap. Used by tests and dev diagnostics.
 */
export function seatApproachPosition(seat: TheaterSeatConfig): { x: number; y: number } {
  const spriteTop = 100 - seat.bottomPercent - SEAT_SPRITE_HEIGHT_PERCENT;
  const raw = {
    x: seat.leftPercent + seat.widthPercent * SEAT_APPROACH_TARGET.x,
    y: spriteTop + SEAT_SPRITE_HEIGHT_PERCENT * SEAT_APPROACH_TARGET.y,
  };
  const boundary = locationBoundaries['stage-inside.png'];
  return boundary ? constrainPosition(raw, boundary) : raw;
}

/** Background file whose walk boundary seat targets are clamped into. */
export const THEATER_BACKGROUND_FILE = 'stage-inside.png';
