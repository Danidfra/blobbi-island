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
/**
 * GROUND-anchor semantics (Phase 2): the fraction names where the Blobbi's
 * FEET stop. Default aim: the bush's BASE half (y 0.85) — feet land at the
 * foliage base so the body visibly walks INTO the bush and covers it, which is
 * what the center-era 0.5 produced on screen when the stored point still meant
 * the body center. The two bottom bushes override this with hand-fitted
 * fractions that steer their approach lines around the streetlight foot
 * plates (x 17.4–21.1 / 77.0–80.7, y 88.2–89.6) from every Town entry point —
 * pinned by InteractiveElements.town-blockers.test.tsx.
 */
export const BUSH_CENTER_TARGET = { x: 0.5, y: 0.85 } as const;

export const townBushes: TownBushConfig[] = [
  {
    id: 'town-bush-1',
    src: '/assets/world/props/bush-3.png',
    alt: 'Bush',
    positionClass: 'left-[0%] top-[64%] w-[16%]',
    zIndex: 10,
    // Feet land at the foliage base (~8%, 80%) — inside the walkable arch,
    // far above the streetlight foot plates.
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
  {
    id: 'town-bush-2',
    src: '/assets/world/props/bush-3.png',
    alt: 'Bush',
    positionClass: 'right-0 top-[69%] w-[15%]',
    zIndex: 10,
    // Feet land at the foliage base (~92.5%, 84%).
    interactionTarget: { ...BUSH_CENTER_TARGET },
  },
  {
    id: 'town-bush-3',
    src: '/assets/world/props/bush-1.png',
    alt: 'Bush',
    positionClass: '-left-[2%] -bottom-[2%] w-[20%]',
    zIndex: 20,
    // Base-aimed with a leftward bias (~6%, 97.6%): dead-center base would
    // drag the stage-exit approach line through the left streetlight's foot
    // plate; aiming at the base's left portion clears it from all four Town
    // entries while the body still ends up covering the bush.
    interactionTarget: { x: 0.4, y: 0.8 },
  },
  {
    id: 'town-bush-4',
    src: '/assets/world/props/bush-2.png',
    alt: 'Bush',
    positionClass: '-right-[2%] -bottom-[2%] w-[20%]',
    zIndex: 20,
    // Base-aimed with a rightward bias (~94%, 95%): clears the right
    // streetlight's foot plate from all four Town entries (the map-spawn and
    // arcade-exit lines duck under it; stage/shop lines pass above it).
    interactionTarget: { x: 0.6, y: 0.72 },
  },
];

/** Shared bush-rustle sound effect path (played on arrival, not on click). */
export const BUSH_RUSTLE_SFX = '/assets/audio/sfx/bush-rustle.mp3';

/** Background file whose walk boundary the bush targets are clamped into. */
export const TOWN_BACKGROUND_FILE = 'town-open.webp';
