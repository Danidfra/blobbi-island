/**
 * Shared configuration for the interactive bushes in the Town scene.
 *
 * A single source of truth so the bushes are described by data instead of
 * duplicated JSX/behavior. Each entry drives one <TownBush>: its art, on-screen
 * placement, fixed z-index, the point the Blobbi walks to when hiding, and the
 * stable id used to represent "hidden in this bush" in local + multiplayer
 * state.
 *
 * Placement values mirror the original hard-coded Town markup so the visual
 * layout is unchanged. Positioning is expressed as raw Tailwind edge classes
 * (left/right/top/bottom) applied by <TownBush>; the stacking order is a fixed
 * numeric z-index that NEVER changes at runtime — hiding is an explicit
 * visibility state (the Blobbi visual is not rendered at all), not a z-index
 * illusion, so a bush can never incorrectly overlap another bush.
 */
export interface TownBushConfig {
  /**
   * Stable id used for React keys / debugging AND as the semantic hiding-spot id
   * shared across local state and multiplayer presence (e.g. "town-bush-1").
   * Must be unique per bush instance.
   */
  id: string;
  /** Sprite path for the bush art. */
  src: string;
  /** Accessible alt text. */
  alt: string;
  /**
   * Tailwind edge-position classes placing the bush inside the Town world,
   * copied from the original markup (e.g. "left-0 bottom-0").
   */
  positionClass: string;
  /**
   * Fixed z-index of the bush. This is CONSTANT — it is never raised to occlude
   * the Blobbi.
   */
  zIndex: number;
  /**
   * Fractional offsets (0..1) into the bush's rendered rect, used to compute the
   * world-surface point the Blobbi walks toward when interacting with this bush.
   *
   * `x` — fraction of the bush width  (0 = left edge, 1 = right edge).
   * `y` — fraction of the bush height (0 = top edge,  1 = bottom edge).
   *
   * `{ x: 0.5, y: 0.5 }` is the visual center. It is configurable per bush
   * because the artwork and dimensions differ, so the center of the foliage is
   * not always the geometric center of the sprite box — and because parts of a
   * sprite can fall outside the walkable arch or inside a MovementBlocker.
   * The computed point is clamped into the Town walk boundary by <TownBush>.
   */
  interactionTarget: { x: number; y: number };
}

/**
 * Default interaction target: the bush's visual center. Individual bushes
 * override it when their art needs a different aim point.
 */
export const BUSH_CENTER_TARGET = { x: 0.5, y: 0.5 } as const;

export const townBushes: TownBushConfig[] = [
  {
    id: 'town-bush-1',
    src: '/assets/world/props/bush-3.png',
    alt: 'Bush',
    positionClass: 'left-[0%] top-[64%] w-[16%]',
    zIndex: 10,
    // Center lands around (8%, 73%) — inside the walkable arch, clear of the
    // streetlight blockers (which cover y 86–90).
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
  {
    id: 'town-bush-2',
    src: '/assets/world/props/bush-3.png',
    alt: 'Bush',
    positionClass: 'right-0 top-[69%] w-[15%]',
    zIndex: 10,
    // Center lands around (92%, 78%).
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
  {
    id: 'town-bush-3',
    src: '/assets/world/props/bush-1.png',
    alt: 'Bush',
    positionClass: '-left-[2%] -bottom-[2%] w-[20%]',
    zIndex: 20,
    // Center lands around (8%, 91%), just below the left streetlight blocker
    // (x 8–12.5, y 86–90). Aiming higher into this bush would land *inside* that
    // blocker, and MovableBlobbi.goTo refuses a blocked target outright.
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
  {
    id: 'town-bush-4',
    src: '/assets/world/props/bush-2.png',
    alt: 'Bush',
    positionClass: '-right-[2%] -bottom-[2%] w-[20%]',
    zIndex: 20,
    // Center lands around (92%, 92%), below the right streetlight blocker
    // (x 82.5–87, y 86–90) for the same reason as town-bush-3.
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
];

/** Shared bush-rustle sound effect path (played on arrival, not on click). */
export const BUSH_RUSTLE_SFX = '/assets/audio/sfx/bush-rustle.mp3';

/** Background file whose walk boundary the bush targets are clamped into. */
export const TOWN_BACKGROUND_FILE = 'town-open.webp';
