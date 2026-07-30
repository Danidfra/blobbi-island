/**
 * Data-driven configuration for every machine in the Blobbi Island arcade.
 *
 * Replaces nine hand-written `<InteractiveElement>` blocks that all called
 * `handleElementClick('dance-machine')` — a pool table, an air hockey table and
 * six generic cabinets included. The audit's headline finding was that the
 * arcade *told players it had games it does not have*; this file is where that
 * stops being possible, because identity, floor, artwork and accessible name are
 * now one record per machine instead of nine copies of a string literal.
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
 * - **What a machine DOES is one explicit, discriminated field.** `activation`
 *   says whether a machine opens the shared cabinet catalogue, launches one
 *   specific game, or shows one specific game's coming-soon screen. It replaced
 *   a nullable `gameId` plus a loose `availability` plus a free-text `blurb`,
 *   three fields whose combinations included several that meant nothing, and
 *   then briefly replaced NOTHING at all — a pass that made every machine open
 *   the shared catalogue, which turned a pool table into a menu. Behaviour is
 *   never inferred from a filename, artwork or a display name.
 * - **The arcade has two kinds of machine.** Six *generic cabinets* whose screens
 *   can show anything, and three *dedicated machines* — a dance pad, a pool
 *   table, an air hockey table — that ARE one physical game and can never be
 *   another. Only the generic six open the shared catalogue.
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
import { WORLD_WIDTH, WORLD_HEIGHT } from '@/lib/world-coordinates';
import { blobbiHalfHeightPercent } from '@/lib/blobbi-ground';
import {
  ARCADE_AIR_HOCKEY_MACHINE_ID,
  ARCADE_POOL_MACHINE_ID,
  BLOBBI_AIR_HOCKEY_GAME_ID,
  BLOBBI_DANCE_GAME_ID,
  BLOBBI_DANCE_MACHINE_ID,
  BLOBBI_POOL_GAME_ID,
} from '@/arcade/catalogue';

/** The virtual world is a fixed 1046 × 697 box, uniformly scaled to the viewport. */
export const ARCADE_WORLD_WIDTH = WORLD_WIDTH;
export const ARCADE_WORLD_HEIGHT = WORLD_HEIGHT;

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
 * What happens when a Blobbi arrives at a machine.
 *
 * A closed, discriminated set, because "what does this machine do?" has exactly
 * three answers today and a fourth would be a product decision rather than a
 * new combination of flags.
 */
export type ArcadeMachineActivation =
  /**
   * A generic cabinet. Opens the shared catalogue of games available to every
   * cabinet. The machine's id is carried through as context.
   */
  | { readonly type: 'shared-catalogue' }
  /**
   * A dedicated machine with a playable game. Launches that game directly — no
   * menu in between, because the physical object IS the game.
   */
  | { readonly type: 'dedicated-game'; readonly gameId: string }
  /**
   * A dedicated machine whose game is not built yet. Shows THAT game's own
   * coming-soon screen: a pool table talks about pool.
   *
   * No machine uses this today — all three dedicated machines now have games —
   * and it is kept because it is the state every future machine passes through,
   * and because deleting it would mean the next one has to reinvent the rule
   * that a coming-soon machine still talks about its OWN game.
   */
  | { readonly type: 'dedicated-preview'; readonly experienceId: string };

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
  /** What arriving at this machine does. See {@link ArcadeMachineActivation}. */
  readonly activation: ArcadeMachineActivation;
}

const pct = (px: number) => (px / ARCADE_WORLD_WIDTH) * 100;

/** Cabinets and the dance pad: stand at the base, facing the screen. */
const FRONT_OF_MACHINE = { x: 0.5, y: 0.9 } as const;
/** Tables: stand at the near edge, where a player would actually reach. */
const NEAR_EDGE_OF_TABLE = { x: 0.5, y: 0.95 } as const;

/** Shared by the six generic cabinets. One object, so they cannot drift apart. */
const SHARED_CATALOGUE = { type: 'shared-catalogue' } as const;

export const arcadeMachines: readonly ArcadeMachineConfig[] = [
  // ── Basement: the dance machine, on the music-venue floor ────────────────
  //
  // A DEDICATED machine. It is the Blobbi Dance machine and nothing else, so it
  // is named for the game it hosts: a player looking for the dance game should
  // be able to find it by reading the room. (A corrective pass briefly renamed
  // it "Dance Pad Cabinet" to satisfy an architectural rule that turned out to
  // be wrong — the rule, not the name, was the mistake.)
  {
    id: BLOBBI_DANCE_MACHINE_ID,
    floor: 'basement',
    displayName: 'Blobbi Dance Machine',
    src: '/assets/locations/arcade/level-b1/dance-machine.png',
    alt: 'Blobbi Dance machine',
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
    activation: { type: 'dedicated-game', gameId: BLOBBI_DANCE_GAME_ID },
  },

  // ── Floor 1: six generic cabinets, and two dedicated tables ─────────────
  //
  // The six cabinets are interchangeable furniture and open the shared
  // catalogue. The pool table and the air hockey table are not: each is one
  // physical game, and each now launches that game directly — no menu, and never
  // another machine's game.
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
    activation: SHARED_CATALOGUE,
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
    activation: SHARED_CATALOGUE,
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
    activation: SHARED_CATALOGUE,
  },
  {
    id: ARCADE_POOL_MACHINE_ID,
    floor: 'floor-1',
    displayName: 'Pool Table',
    // Previously labelled "Arcade Machine Green", colliding with the actual
    // green cabinet, and it opened a dance game when clicked. It is a POOL
    // table: it opens pool's own screen, and never a menu or another game.
    src: '/assets/locations/arcade/level-1/snooker.png',
    alt: 'Pool table',
    anchor: 'left',
    offsetPercent: 30,
    bottomPercent: 10,
    widthPercent: 17.5,
    sprite: { width: 353, height: 175 },
    zIndex: 30,
    interactionAnchor: NEAR_EDGE_OF_TABLE,
    // The third machine in the arcade with a real game behind it. Walking up to
    // it racks a frame directly — no menu, because the physical object IS the
    // game — and `canLaunchArcadeGame` refuses Pool from anywhere else.
    activation: { type: 'dedicated-game', gameId: BLOBBI_POOL_GAME_ID },
  },
  {
    id: ARCADE_AIR_HOCKEY_MACHINE_ID,
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
    // The second machine in the arcade with a real game behind it. Walking up to
    // it starts a match directly — no menu, because the physical object IS the
    // game — and `canLaunchArcadeGame` refuses Air Hockey from anywhere else.
    activation: { type: 'dedicated-game', gameId: BLOBBI_AIR_HOCKEY_GAME_ID },
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
    activation: SHARED_CATALOGUE,
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
    activation: SHARED_CATALOGUE,
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
    activation: SHARED_CATALOGUE,
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

/** The six generic cabinets — every machine that opens the shared catalogue. */
export function sharedCatalogueMachines(): ArcadeMachineConfig[] {
  return arcadeMachines.filter((m) => m.activation.type === 'shared-catalogue');
}

/** The dance machine, the pool table and the air hockey table. */
export function dedicatedMachines(): ArcadeMachineConfig[] {
  return arcadeMachines.filter((m) => m.activation.type !== 'shared-catalogue');
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
/**
 * Ground-anchor offset (Phase 2): the anchor FRACTIONS were authored against
 * center semantics ("body center stops at 90% of the cabinet"), which put the
 * FEET half a scaled body lower — on the floor in front of the machine. The
 * stored position now IS the feet, so the same on-screen stop point is the
 * fraction point plus the depth-scaled half body height (arcade floors render
 * the lg 96 px box; scale from each floor's ramp at the anchor's y).
 */
const ARCADE_FLOOR_SCALES: Record<ArcadeFloorId, { front: number; back: number; minY: number; maxY: number }> = {
  // arcade-inside has no depth ramp (xl room, scale 1) but hosts no machines.
  ground: { front: 1, back: 1, minY: 0, maxY: 100 },
  'floor-1': { front: 1.2, back: 1.2, minY: 59.3, maxY: 100 },
  basement: { front: 1.2, back: 0.8, minY: 54.5, maxY: 100 },
};

/**
 * Depth-scaled half body height at `y` on an arcade floor, in world percent —
 * the actor-target ground offset. Shared by the DOM-free `machineAnchorPosition`
 * AND the runtime live-rect target (`ArcadeMachine.computeMachineTarget`), so
 * the two can never disagree about where the feet stop. Applied EXACTLY ONCE,
 * always by the target computation, never by config data.
 */
export function arcadeMachineGroundOffsetPercent(floor: ArcadeFloorId, y: number): number {
  const ramp = ARCADE_FLOOR_SCALES[floor];
  const f = ramp.maxY > ramp.minY ? Math.max(0, Math.min(1, (y - ramp.minY) / (ramp.maxY - ramp.minY))) : 1;
  const scale = ramp.back + (ramp.front - ramp.back) * f;
  // Ground floor renders the 'xl' (128 px) room token, the other floors 'lg'
  // (96 px). The offset is the canonical center↔ground half height.
  return blobbiHalfHeightPercent(floor === 'ground' ? 'xl' : 'lg', scale);
}

export function machineAnchorPosition(machine: ArcadeMachineConfig): { x: number; y: number } {
  const heightPercent = machineHeightPercent(machine);
  const spriteTopPercent = 100 - machine.bottomPercent - heightPercent;
  const centerY = spriteTopPercent + heightPercent * machine.interactionAnchor.y;
  return {
    x: machineLeftPercent(machine) + machine.widthPercent * machine.interactionAnchor.x,
    y: centerY + arcadeMachineGroundOffsetPercent(machine.floor, centerY),
  };
}
