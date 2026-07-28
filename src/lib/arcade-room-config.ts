/**
 * The arcade's non-machine furniture: decoration, seating, the elevator and the
 * ground-floor counters.
 *
 * Split from `arcade-machines-config.ts` because these are a different kind of
 * thing: a machine has an identity a player interacts with, whereas most of this
 * file is scenery that must be *invisible to assistive technology* and must stop
 * claiming to be something it is not.
 *
 * ## Why the decoration is data rather than JSX
 *
 * Thirty sprites across three floors carried `alt="ticket counter"` — copy-paste
 * that made every neon sign, every piece of wall art, both tables and the
 * karaoke stage announce themselves to a screen reader as a ticket counter. The
 * microphone announced itself as "Right Chair". Listing them here, with the alt
 * text structurally absent rather than optionally wrong, is what makes
 * `arcade-machines-config.test.ts` able to assert it can never come back.
 *
 * Placement stays as the original Tailwind class strings so the rooms render
 * pixel-identically; they are static literals in a file Tailwind scans, so the
 * classes are emitted exactly as before.
 */

import type { ArcadeFloorId } from './arcade-machines-config';

/**
 * One purely decorative sprite.
 *
 * There is no `alt` field, by construction. Decoration is rendered with
 * `alt=""` + `aria-hidden`, and a config that cannot express a label cannot
 * accidentally carry a wrong one.
 */
export interface ArcadePropConfig {
  /** Unique within its floor; used as the React key and for debugging. */
  readonly id: string;
  readonly src: string;
  /** Tailwind placement classes, copied verbatim from the original markup. */
  readonly className: string;
}

const B1 = '/assets/locations/arcade/level-b1';
const L1 = '/assets/locations/arcade/level-1';
const GROUND = '/assets/locations/arcade/ground';

/**
 * Basement decoration — a music venue: neon instruments, two wall pieces and
 * the karaoke stage platform.
 *
 * The standing microphone (`mic.png`) is here, in the DECORATION list. It used
 * to be an `InteractiveElement` whose `onClick` was commented out, so it kept
 * `cursor-pointer` and `hover:scale-110` while doing nothing at all — the
 * definition of a dead affordance. A karaoke game may one day claim it; until
 * then it is scenery, and it looks like scenery.
 */
export const arcadeBasementProps: readonly ArcadePropConfig[] = [
  { id: 'yellow-guitar-neon', src: `${B1}/yellow-guitar-neon.png`, className: 'absolute top-[34%] left-[15%] w-[4%]' },
  { id: 'pink-headset-neon', src: `${B1}/pink-headset-neon.png`, className: 'absolute top-[27%] left-[10%] w-[4%]' },
  { id: 'yellow-mic-neon', src: `${B1}/yellow-mic-neon.png`, className: 'absolute top-[27%] left-[2%] w-[4%]' },
  { id: 'blue-mic-neon', src: `${B1}/blue-mic-neon.png`, className: 'absolute top-[40%] left-[10%] w-[4%]' },
  { id: 'song-neon', src: `${B1}/song-neon.png`, className: 'absolute top-[48%] left-[2%] w-[4%]' },
  { id: 'blue-notes-neon', src: `${B1}/blue-notes-neon.png`, className: 'absolute top-[32%] left-[28%] w-[4%]' },
  { id: 'cd-neon', src: `${B1}/cd-neon.png`, className: 'absolute top-[27%] left-[40%] w-[4%]' },
  { id: 'blue-wire-mic-neon', src: `${B1}/blue-wire-mic-neon.png`, className: 'absolute top-[27%] right-[30%] w-[4%]' },
  { id: 'yellow-note-up-neon', src: `${B1}/yellow-note-up-neon.png`, className: 'absolute top-[27%] right-[40%] w-[4%]' },
  { id: 'notes-neon', src: `${B1}/notes-neon.png`, className: 'absolute top-[34%] right-[17%] w-[4%]' },
  { id: 'pink-note-neon', src: `${B1}/pink-note-neon.png`, className: 'absolute top-[27%] right-[10%] w-[4%]' },
  { id: 'yellow-headset-neon', src: `${B1}/yellow-headset-neon.png`, className: 'absolute top-[27%] right-[2%] w-[4%]' },
  { id: 'purple-note-neon', src: `${B1}/purple-note-neon.png`, className: 'absolute top-[40%] right-[10%] w-[4%]' },
  { id: 'blue-note-neon', src: `${B1}/blue-note-neon.png`, className: 'absolute top-[48%] right-[2%] w-[4%]' },
  { id: 'wall-art-pac-blobbi', src: `${B1}/wall-art-pac-blobbi.png`, className: 'absolute top-[42%] left-[34%] w-[5%]' },
  { id: 'wall-art-blobbi-kong', src: `${B1}/wall-art-blobbi-kong.png`, className: 'absolute top-[42%] right-[34%] w-[5%]' },
  { id: 'karaoke-stage', src: `${B1}/arcade-tundra-stage.png`, className: 'absolute left-1/2 -translate-x-1/2 bottom-0 w-[50%]' },
  { id: 'stage-microphone', src: `${B1}/mic.png`, className: 'absolute left-1/2 -translate-x-1/2 bottom-[18%] w-[3%] z-[30]' },
];

/** Floor-1 decoration — a classic arcade: neon signage and two wall pieces. */
export const arcadeFloor1Props: readonly ArcadePropConfig[] = [
  { id: 'trophy-neon', src: `${L1}/trophy-neon.png`, className: 'absolute top-[32%] left-[14%] w-[6%]' },
  { id: 'sword-neon', src: `${L1}/sword-neon.png`, className: 'absolute top-[26%] left-[6%] w-[5%] -rotate-12' },
  { id: 'play-neon', src: `${L1}/play-neon.png`, className: 'absolute top-[44%] left-[6%] w-[6%] -rotate-12' },
  { id: 'wall-art-blobbizard', src: `${L1}/wall-art-blobbizard.png`, className: 'absolute top-[42%] left-[34%] w-[5%]' },
  { id: 'wall-art-blobbi-adventure', src: `${L1}/wall-art-blobbi-adventure.png`, className: 'absolute top-[42%] right-[34%] w-[6%]' },
  { id: 'controller-neon', src: `${L1}/controller-neon.png`, className: 'absolute top-[32%] left-[26%] w-[7%] -rotate-12' },
  { id: 'star-neon', src: `${L1}/star-neon.png`, className: 'absolute left-1/2 -translate-x-1/2 top-[27%] w-[5%]' },
  { id: 'dice-neon', src: `${L1}/dice-neon.png`, className: 'absolute top-[31%] right-[26%] w-[6%]' },
  { id: 'pac-man-neon', src: `${L1}/pac-man-neon.png`, className: 'absolute top-[32%] right-[15%] w-[4.5%] rotate-12' },
  { id: 'game-boy-neon', src: `${L1}/game-boy-neon.png`, className: 'absolute top-[28%] right-[4%] w-[4%] rotate-12' },
  { id: 'retro-controller-neon', src: `${L1}/retro-controller-neon.png`, className: 'absolute top-[44%] right-[6%] w-[6%] rotate-12' },
];

/** Ground-floor decoration — the commerce floor's wall art and signage. */
export const arcadeGroundProps: readonly ArcadePropConfig[] = [
  { id: 'wall-art-super-blobbi', src: `${GROUND}/wall-art-super-blobbi.png`, className: 'absolute top-[6%] right-[10%] w-[20%]' },
  { id: 'wall-art-game-boy', src: `${GROUND}/wall-art-game-boy.png`, className: 'absolute top-[12%] left-[2%] w-[10%]' },
  { id: 'play-up-neon', src: `${GROUND}/play-up-neon.png`, className: 'absolute top-[18%] left-[28%] w-[8%]' },
  { id: 'trophy-money-neon', src: `${GROUND}/trophy-money-neon.png`, className: 'absolute top-[18%] right-[31%] w-[6%]' },
];

export const arcadePropsByFloor: Record<ArcadeFloorId, readonly ArcadePropConfig[]> = {
  ground: arcadeGroundProps,
  'floor-1': arcadeFloor1Props,
  basement: arcadeBasementProps,
};

// ── Basement seating ───────────────────────────────────────────────────────

export interface ArcadeSeatConfig {
  /** Stable, unique id across the whole room. */
  readonly id: string;
  readonly src: string;
  /** Accessible name. Unique — four chairs previously shared two labels. */
  readonly alt: string;
  readonly className: string;
}

export interface ArcadeSeatGroupConfig {
  readonly id: string;
  /** Placement of the table + chair cluster. */
  readonly className: string;
  readonly tableSrc: string;
  readonly tableClassName: string;
  readonly seats: readonly ArcadeSeatConfig[];
}

function seatGroup(index: 1 | 2, containerClass: string): ArcadeSeatGroupConfig {
  return {
    id: `arcade-b1-table-${index}`,
    className: containerClass,
    tableSrc: `${B1}/table.png`,
    tableClassName: 'absolute left-1/2 -translate-x-1/2 top-[20%] w-[44%] z-[27]',
    seats: [
      {
        id: `arcade-b1-table-${index}-left-chair`,
        src: `${B1}/left-chair.png`,
        alt: `Table ${index}, left chair`,
        className: 'left-[18%] bottom-[36%] w-[40%] z-[25]',
      },
      {
        id: `arcade-b1-table-${index}-right-chair`,
        src: `${B1}/right-chair.png`,
        alt: `Table ${index}, right chair`,
        className: 'left-[30%] bottom-[36%] w-[40%] z-[25]',
      },
    ],
  };
}

/**
 * The two identical table-and-chairs clusters facing the karaoke stage.
 *
 * They were byte-identical blocks of JSX producing four chairs that shared two
 * `alt` values ("Left Chair" twice, "Right Chair" twice) — so a screen-reader
 * user, and any test, saw two chairs where there are four.
 */
export const arcadeBasementSeatGroups: readonly ArcadeSeatGroupConfig[] = [
  seatGroup(1, 'flex absolute bottom-[25%] left-[24%] w-[16.5%] gap-[40%]'),
  seatGroup(2, 'flex absolute bottom-[25%] right-[24%] w-[16.5%] gap-[40%]'),
];

// ── Elevator ───────────────────────────────────────────────────────────────

/**
 * Fixed stacking order for the elevator doors, on every arcade floor.
 *
 * **The explicit layering rule:** the elevator doors are the back wall of the
 * alcove, so a Blobbi standing anywhere in the room is IN FRONT of them. The
 * lowest Blobbi depth band on any arcade floor is `z-9`
 * (`backgroundZIndexConfigs` in `interactive-elements-config.ts`), so the doors
 * sit at 8 — strictly below every band, with no tie to resolve.
 *
 * Previously the container was `z-10`, which tied with the ground floor's
 * `0–52 %` band and with nothing else; ties resolve by DOM order, and the doors
 * won, so the Blobbi rendered *inside* a closed elevator. Depth is now a stated
 * rule rather than an accident of where a `<div>` happens to sit.
 */
export const ARCADE_ELEVATOR_Z_INDEX = 8;

export interface ArcadeElevatorConfig {
  /** Placement of the two-door container on this floor. */
  readonly containerClassName: string;
}

export const arcadeElevatorByFloor: Record<ArcadeFloorId, ArcadeElevatorConfig> = {
  ground: { containerClassName: 'top-[16%] w-[17.5%]' },
  'floor-1': { containerClassName: 'top-[40.5%] w-[10%]' },
  basement: { containerClassName: 'top-[41.4%] w-[7.8%]' },
};

export const ARCADE_ELEVATOR_DOOR_SRC = `${B1}/elevator-door.png`;

// ── Ground-floor counters ──────────────────────────────────────────────────

/**
 * Where the Blobbi stands to use each ground-floor counter, as an explicit
 * world-percent point.
 *
 * ## Why these are configured rather than derived
 *
 * Both counters are mounted HIGH on the back wall, well above the ground floor's
 * walkable band (`y ≥ 48`). The generic "aim at the element's base" rule
 * therefore produces a point off the floor, and clamping it merely moves it onto
 * the floor's top EDGE — which is worse: the edge runs straight through the
 * mouth of the narrow elevator alcove (`x ∈ [45,55], y ∈ [36,48]`), so a walk
 * along it can be captured by the alcove and never converge. Browser-reproduced:
 * the Blobbi slid along the back wall and the modal never opened, which is the
 * same symptom the audit recorded (§8.3).
 *
 * Picking the point deliberately — a comfortable distance onto open floor,
 * horizontally centred on the counter and clear of the alcove — removes the
 * whole class of problem. `arcade-machines-config.test.ts` checks both.
 */
export const ARCADE_COUNTER_STAND_Y = 60;

export const ARCADE_TICKET_COUNTER = {
  baseSrc: `${GROUND}/ticket.png`,
  windowSrc: `${GROUND}/ticket-out.png`,
  containerClassName: 'relative left-[20%] top-[26%]',
  /** Accessible name for the interactive window. Names the action's target. */
  alt: 'Ticket counter — buy an Arcade Pass',
  /** Roughly under the counter (its sprite spans x ≈ 20–28 %). */
  interactionPoint: { x: 24, y: ARCADE_COUNTER_STAND_Y },
} as const;

/**
 * The PRIZES counter.
 *
 * Its only previous effect was a `console.log`; it did not even walk the Blobbi
 * over. It is a real future feature — the prize shop is where Arcade Tickets get
 * spent — so it keeps its affordance and gets an honest coming-soon state rather
 * than being stripped out.
 */
export const ARCADE_PRIZE_COUNTER = {
  id: 'arcade-prize-counter',
  src: `${GROUND}/prizes.png`,
  containerClassName: 'absolute right-[7%] top-[33%]',
  alt: 'Prize counter',
  displayName: 'Prize Counter',
  blurb: 'The prize shop is not open yet. Arcade Tickets cannot be spent here.',
  /** Roughly under the counter (its sprite spans x ≈ 68–93 %). */
  interactionPoint: { x: 80, y: ARCADE_COUNTER_STAND_Y },
} as const;

/**
 * Where the Blobbi stands to call the elevator, per floor.
 *
 * Same reasoning as the counters: the doors are on the back wall, and their
 * derived base point lands on (ground floor) or above (upper floors) the
 * walkable band. The alcove makes the ground floor's edge especially unsafe to
 * walk along, so the stand point is stated instead.
 */
export const arcadeElevatorStandPoint: Record<ArcadeFloorId, { x: number; y: number }> = {
  ground: { x: 50, y: 58 },
  'floor-1': { x: 50, y: 66 },
  basement: { x: 50, y: 60 },
};
