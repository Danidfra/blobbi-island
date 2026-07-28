/**
 * Data-driven configuration for every machine in the Blobbi Island arcade.
 *
 * Replaces nine hand-written `<InteractiveElement>` blocks that all called
 * `handleElementClick('dance-machine')` — a pool table, an air hockey table and
 * six generic cabinets included. The audit's headline finding was that the
 * arcade *told players it had games it does not have*; this file is where that
 * stops being possible, because identity, floor, artwork, accessible name and
 * game assignment are now one record per machine instead of nine copies of a
 * string literal.
 *
 * Same shape as `theater-seats-config.ts` and `town-bushes-config.ts`, for the
 * same reasons: stable ids, measured placement, and tests that check the numbers
 * rather than trusting them.
 *
 * ## The rules this file encodes
 *
 * - **Identity is the `id`, never the filename.** `arcade-machine-green.png` and
 *   `snooker.png` were both labelled "Arcade Machine Green"; ids make that
 *   collision impossible and survive an artwork swap.
 * - **Game identity is separate from visual identity.** `gameId` is `null` for
 *   eight of the nine machines, which is the structural reason they cannot fake
 *   gameplay: the lifecycle reducer refuses to start a run without one.
 * - **Placement is numeric.** Percentages applied via inline `style`, not
 *   arbitrary-value Tailwind classes, so the arithmetic is checkable and a
 *   mistake is visible to a test rather than only to an eye.
 * - **Anchors are derived from the art.** Each machine's sprite ratio is
 *   recorded, so the walk-to point can be computed without a DOM — which is what
 *   lets `arcade-machines-config.test.ts` prove every anchor lands on walkable
 *   floor.
 *
 * ## Deliberately absent: movement blockers
 *
 * The brief allowed for a per-machine `blocker` rect. There is none, on purpose.
 * `MovableBlobbi.goTo` REFUSES a target inside a blocker, so a blocker placed
 * over a machine's footprint before its interaction anchor has been validated in
 * a real browser would silently make that machine unreachable — trading a
 * cosmetic overlap for a dead machine. Blockers belong in the phase that has a
 * playable game to walk up to; the anchors here are measured first.
 */

import type { Boundary } from '@/lib/boundaries';
import { locationBoundaries } from '@/lib/location-boundaries';

/** The virtual world is a fixed 1046 × 697 box, uniformly scaled to the viewport. */
export const ARCADE_WORLD_WIDTH = 1046;
export const ARCADE_WORLD_HEIGHT = 697;

/** The three arcade floors, keyed by the background file each one renders. */
export const ARCADE_FLOORS = {
  ground: 'arcade-inside.png',
  'floor-1': 'arcade-1.png',
  basement: 'arcade-minus1.png',
} as const;

export type ArcadeFloorId = keyof typeof ARCADE_FLOORS;
export type ArcadeBackgroundFile = (typeof ARCADE_FLOORS)[ArcadeFloorId];

export const ARCADE_BACKGROUND_FILES: readonly ArcadeBackgroundFile[] =
  Object.values(ARCADE_FLOORS);

/** True when a background file belongs to the arcade. */
export function isArcadeBackground(file: string): file is ArcadeBackgroundFile {
  return (ARCADE_BACKGROUND_FILES as readonly string[]).includes(file);
}

export function arcadeFloorForBackground(file: string): ArcadeFloorId | null {
  const entry = (Object.entries(ARCADE_FLOORS) as [ArcadeFloorId, string][]).find(
    ([, background]) => background === file,
  );
  return entry ? entry[0] : null;
}

export function arcadeBoundaryForFloor(floor: ArcadeFloorId): Boundary | undefined {
  return locationBoundaries[ARCADE_FLOORS[floor]];
}

/**
 * How ready a machine is.
 *
 * `playable` — a real game runs on this machine. Added in Phase 3, when one
 * finally did; before that its ABSENCE was what made "no machine can pretend to
 * be playable" a type-level fact rather than a promise.
 * `preview` — a real game is designed and coming, and the shell shows what it
 * will be. Nothing carries this today.
 * `coming-soon` — no game is designed for this machine yet, and the UI says so
 * without implying otherwise.
 *
 * `availability` is presentation. The load-bearing fact is still `gameId`: the
 * lifecycle reducer refuses to start a run without one, so a machine cannot be
 * made playable by editing this field.
 */
export type ArcadeMachineAvailability = 'playable' | 'preview' | 'coming-soon';

export interface ArcadeMachineConfig {
  /** Stable, unique identity. Never derived from the filename. */
  readonly id: string;
  readonly floor: ArcadeFloorId;
  /** What the player is told this machine is. Honest, and unique per machine. */
  readonly displayName: string;
  /** Sprite path. */
  readonly src: string;
  /** Accessible name. Announced as a button, so it names the ACTION's target. */
  readonly alt: string;
  /**
   * Which world edge the machine is positioned from, mirroring the original
   * `left-[…]` / `right-[…]` markup. Kept rather than normalised to a single
   * left offset so the placement stays legible against the artwork it describes.
   */
  readonly anchor: 'left' | 'right';
  /** Distance from that edge, in percent of world width. */
  readonly offsetPercent: number;
  /** Distance from the world's bottom edge, in percent of world height. */
  readonly bottomPercent: number;
  /** Rendered width, in percent of world width. Height follows the art's ratio. */
  readonly widthPercent: number;
  /** Intrinsic sprite dimensions, used only to derive the rendered height. */
  readonly sprite: { readonly width: number; readonly height: number };
  /** Fixed stacking order within the room. Never changes at runtime. */
  readonly zIndex: number;
  /**
   * Fractional aim point inside the sprite rect (0..1) that the Blobbi walks to.
   * `y` near 1 puts the player at the machine's base — in FRONT of it — rather
   * than inside its artwork.
   */
  readonly interactionAnchor: { readonly x: number; readonly y: number };
  /**
   * The game this machine runs, or `null` when none exists.
   *
   * A stable game id, never a Nostr address and never an item id: those identify
   * protocol objects with their own lifecycles, and coupling a game's identity to
   * one would mean republishing an item to rename a game.
   */
  readonly gameId: string | null;
  readonly availability: ArcadeMachineAvailability;
  /** One-line honest description shown in the shell. Copy lives with the data. */
  readonly blurb: string;
}

/** The dance game's stable id. The only game id that exists. */
export const BLOBBI_DANCE_GAME_ID = 'blobbi-dance';

const pct = (px: number) => (px / ARCADE_WORLD_WIDTH) * 100;

/** Cabinets and the dance pad: stand at the base, facing the screen. */
const FRONT_OF_MACHINE = { x: 0.5, y: 0.9 } as const;
/** Tables: stand at the near edge, where a player would actually reach. */
const NEAR_EDGE_OF_TABLE = { x: 0.5, y: 0.95 } as const;

export const arcadeMachines: readonly ArcadeMachineConfig[] = [
  // ── Basement: the music venue, and the only machine with a game ──────────
  {
    id: 'arcade-dance-machine',
    floor: 'basement',
    displayName: 'Dance Dance Blobbi',
    src: '/assets/locations/arcade/level-b1/dance-machine.png',
    alt: 'Dance Dance Blobbi dance machine',
    anchor: 'right',
    offsetPercent: 18,
    // The original markup gave this sprite no width class, so it rendered at its
    // intrinsic 162 px inside the 1046 px world. Recorded explicitly here so the
    // size no longer depends on a CSS shrink-to-fit accident.
    bottomPercent: 36,
    widthPercent: pct(162),
    sprite: { width: 162, height: 162 },
    // The only machine that previously had no z-index at all. Fixed at 5: above
    // the room art, below every Blobbi depth band on this floor (the lowest is
    // 9), so a player standing at the pad is always drawn in front of it.
    zIndex: 5,
    interactionAnchor: { x: 0.5, y: 0.92 },
    gameId: BLOBBI_DANCE_GAME_ID,
    availability: 'playable',
    blurb: 'A 68-second rhythm game. Finish a run to earn Arcade Tickets.',
  },

  // ── Floor 1: six cabinets and two tables, none of them a game yet ────────
  {
    id: 'arcade-cabinet-pink',
    floor: 'floor-1',
    displayName: 'Pink Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-pink.png',
    alt: 'Pink arcade cabinet',
    anchor: 'left',
    offsetPercent: 18,
    bottomPercent: 28,
    widthPercent: 12,
    sprite: { width: 195, height: 298 },
    zIndex: 15,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
  {
    id: 'arcade-cabinet-black',
    floor: 'floor-1',
    displayName: 'Black Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-black.png',
    alt: 'Black arcade cabinet',
    anchor: 'left',
    offsetPercent: 11,
    bottomPercent: 22,
    widthPercent: 12.5,
    sprite: { width: 194, height: 296 },
    zIndex: 20,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
  {
    id: 'arcade-cabinet-classic',
    floor: 'floor-1',
    displayName: 'Classic Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-classic.png',
    alt: 'Classic arcade cabinet',
    anchor: 'left',
    offsetPercent: 4,
    bottomPercent: 16,
    widthPercent: 12.5,
    sprite: { width: 176, height: 300 },
    zIndex: 25,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
  {
    id: 'arcade-pool-table',
    floor: 'floor-1',
    displayName: 'Pool Table',
    // Previously labelled "Arcade Machine Green", colliding with the actual
    // green cabinet, and it opened a dance game when clicked.
    src: '/assets/locations/arcade/level-1/snooker.png',
    alt: 'Pool table',
    anchor: 'left',
    offsetPercent: 30,
    bottomPercent: 10,
    widthPercent: 17.5,
    sprite: { width: 353, height: 175 },
    zIndex: 30,
    interactionAnchor: NEAR_EDGE_OF_TABLE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'Nobody has racked the balls yet. Pool is not playable.',
  },
  {
    id: 'arcade-air-hockey',
    floor: 'floor-1',
    displayName: 'Air Hockey Table',
    src: '/assets/locations/arcade/level-1/air-hockey.png',
    alt: 'Air hockey table',
    anchor: 'right',
    offsetPercent: 30,
    bottomPercent: 10,
    widthPercent: 17.5,
    sprite: { width: 350, height: 160 },
    zIndex: 30,
    interactionAnchor: NEAR_EDGE_OF_TABLE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'The puck is still in the box. Air hockey is not playable.',
  },
  {
    id: 'arcade-cabinet-green',
    floor: 'floor-1',
    displayName: 'Green Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-green.png',
    alt: 'Green arcade cabinet',
    anchor: 'right',
    offsetPercent: 18,
    bottomPercent: 28,
    widthPercent: 12.5,
    sprite: { width: 197, height: 285 },
    zIndex: 15,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
  {
    id: 'arcade-cabinet-purple',
    floor: 'floor-1',
    displayName: 'Purple Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-purple.png',
    alt: 'Purple arcade cabinet',
    anchor: 'right',
    offsetPercent: 11,
    bottomPercent: 22,
    widthPercent: 12.5,
    sprite: { width: 195, height: 296 },
    zIndex: 20,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
  {
    id: 'arcade-cabinet-red',
    floor: 'floor-1',
    displayName: 'Red Cabinet',
    src: '/assets/locations/arcade/level-1/arcade-machine-red.png',
    alt: 'Red arcade cabinet',
    anchor: 'right',
    offsetPercent: 4,
    bottomPercent: 16,
    widthPercent: 12.5,
    sprite: { width: 209, height: 296 },
    zIndex: 25,
    interactionAnchor: FRONT_OF_MACHINE,
    gameId: null,
    availability: 'coming-soon',
    blurb: 'This cabinet has no game yet. Its screen is dark for now.',
  },
];

const MACHINES_BY_ID = new Map(arcadeMachines.map((m) => [m.id, m]));

export function getArcadeMachine(id: string | null | undefined): ArcadeMachineConfig | undefined {
  return id ? MACHINES_BY_ID.get(id) : undefined;
}

/**
 * The machines on one floor, in a stable render order.
 *
 * Sorted by `zIndex` so DOM order and paint order agree; ties keep their
 * declaration order, which keeps the array itself the source of truth.
 */
export function arcadeMachinesForFloor(floor: ArcadeFloorId): ArcadeMachineConfig[] {
  return arcadeMachines
    .filter((m) => m.floor === floor)
    .sort((a, b) => a.zIndex - b.zIndex);
}

/** Rendered height of a machine's sprite, in percent of world height. */
export function machineHeightPercent(machine: ArcadeMachineConfig): number {
  const widthPx = (machine.widthPercent / 100) * ARCADE_WORLD_WIDTH;
  const heightPx = widthPx * (machine.sprite.height / machine.sprite.width);
  return (heightPx / ARCADE_WORLD_HEIGHT) * 100;
}

/** Left edge of a machine, in percent of world width, whichever edge it hangs off. */
export function machineLeftPercent(machine: ArcadeMachineConfig): number {
  return machine.anchor === 'left'
    ? machine.offsetPercent
    : 100 - machine.offsetPercent - machine.widthPercent;
}

/**
 * The world-percent point the Blobbi walks to for this machine, computed from
 * the configuration alone.
 *
 * DOM-free on purpose. `ArcadeMachine` reads the live rect at click time (so the
 * target is right no matter how the world is scaled or letterboxed), but this
 * function computes the same point without a browser — which is what lets the
 * config test prove every anchor lands on walkable floor before anyone clicks
 * anything.
 */
export function machineAnchorPosition(machine: ArcadeMachineConfig): { x: number; y: number } {
  const heightPercent = machineHeightPercent(machine);
  const spriteTopPercent = 100 - machine.bottomPercent - heightPercent;
  return {
    x: machineLeftPercent(machine) + machine.widthPercent * machine.interactionAnchor.x,
    y: spriteTopPercent + heightPercent * machine.interactionAnchor.y,
  };
}
