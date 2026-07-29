/**
 * Cloud actors — three individual clouds that cross the sky, and nothing else.
 *
 * ## What this replaces, and why
 *
 * The first implementation drew clouds as three **tiled bands**: each band was a
 * 200%-wide element whose `background-image` held four or five cloud shapes,
 * repeated horizontally with `background-repeat: repeat-x`. Two things went wrong
 * with that, and both were visible on screen at once:
 *
 *  1. **Density.** Thirteen cloud groups per tile, tiled twice across the band,
 *     put roughly two dozen shapes on screen simultaneously. The result read as a
 *     continuous blanket of pale circles rather than as weather.
 *  2. **Clipping.** A repeated background tile is hard-clipped at its own edge —
 *     gradients do not bleed into the next repetition. Any cloud whose lobes
 *     reached within a few percent of the tile boundary was sliced in half, and
 *     the slice reappeared at the start of the next tile. That is the "visibly
 *     cut" shape, and it was permanent rather than a momentary edge crossing.
 *
 * So the band model is gone entirely. Each cloud is now one self-contained SVG
 * shape in its own absolutely-positioned actor, and there are exactly three.
 *
 * ## Sparseness is arithmetic, not luck
 *
 * Each actor travels a distance that is **longer than it needs to be**: the world
 * width, plus the cloud's own width, plus clearance on both sides, plus an
 * explicit `offscreenWaitPx`. At a constant linear speed that surplus becomes
 * time the cloud spends completely outside the viewport — a real gap, produced by
 * one linear keyframe and no JavaScript. `offscreenWaitSeconds` reports it.
 *
 * Because the three actors have different speeds, different wait distances and
 * staggered negative delays, their cycles are mutually irrational enough that
 * they do not line up: at any moment roughly one to three clouds are on screen.
 *
 * All three quantities are computed here rather than in the component, so the
 * arrangement can be asserted by a test instead of eyeballed.
 */

import { ISLAND_EPOCH_MS } from '@/lib/island-clock';
import {
  ISLAND_CLOUD_SHAPES,
  ISLAND_CLOUD_SHAPE_GEOMETRY,
  type IslandCloudShape,
  type IslandCloudSize,
  cloudShapeHeightPx,
  cloudShapeInkSpanPercent,
  cloudShapeWidthPx,
} from '@/lib/island-sky-cloud-shapes';

/** Travel direction. Two actors take the primary direction, one the reverse. */
export type IslandCloudDirection = 'rightToLeft' | 'leftToRight';

export interface IslandCloudActor {
  /** Stable key, and the class-free identity a test can assert against. */
  id: string;
  direction: IslandCloudDirection;
  /** Vertical placement within the sky layer, for the ordinary cloud shape. */
  topPercent: number;
  /**
   * The width the **travel arithmetic clears**, in world pixels — the widest this
   * actor can ever render, across every shape it may take at every size it is
   * allowed. It is deliberately not the rendered width.
   *
   * Keeping it fixed is what lets a passage index be derived from the clock: the
   * cycle duration must not depend on the size, and the size is chosen *per
   * passage*, which would otherwise be circular. A narrower passage simply clears
   * the edge by more than it needs to.
   */
  widthPx: number;
  /**
   * Sizes this actor may take. Only `cloud-a` is permitted `large`, which makes
   * "never all three large at once" a structural impossibility rather than a
   * statistical hope — and keeps the depth ladder intact, since the largest size
   * only ever appears on the lowest path.
   */
  allowedSizes: readonly IslandCloudSize[];
  /**
   * Authored size cycle, indexed by passage. Short and hand-written on purpose:
   * the brief asks for a deterministic authored sequence, not procedural noise.
   */
  sizeSequence: readonly IslandCloudSize[];
  /**
   * Where this actor reads the shared shape table, and how far it steps each
   * passage. Distinct, coprime-with-the-period strides mean each actor walks the
   * whole table without ever marching in step with another.
   */
  shapeOffset: number;
  shapeStride: number;
  /** Constant travel speed. Lower reads as further away. */
  speedPxPerSecond: number;
  /**
   * Surplus travel beyond the screen crossing, spent entirely offscreen. This is
   * what guarantees empty sky between clouds.
   */
  offscreenWaitPx: number;
  /**
   * Negative, so the actor starts mid-cycle instead of every cloud entering from
   * the same edge on load. Chosen to give a sparse opening composition.
   */
  delaySeconds: number;
  /** Per-actor opacity multiplier, applied on top of the sky state's own. */
  opacity: number;
  /**
   * Where the actor sits when travel is disabled (reduced motion). Chosen so the
   * three rest at different widths as well as different heights — a sparse static
   * composition rather than a stack.
   */
  restPx: number;
}

/**
 * Clearance past the world edge before a cloud is considered fully gone. Larger
 * than any lobe overhang, so the animation's reset always happens while the shape
 * is invisible and no seam can be seen.
 */
export const ISLAND_CLOUD_EDGE_MARGIN_PX = 60;

/**
 * The lowest a cloud silhouette may reach, as a percentage of the world height.
 *
 * The island's locations have far less usable sky than an empty gradient
 * suggests: Plaza's artwork turns opaque at ~38% and its town hall occupies the
 * central upper sky, Mine's conifer line starts at ~30%, Nostr Station's hill
 * climbs into the frame, and Beach's horizon sits at 50%. A cloud that drifts
 * below this line stops reading as sky and starts competing with buildings,
 * hills, tree lines and the interactive art in front of them.
 *
 * Every actor's *drawn* silhouette — not just its box — stays above this, which
 * `island-sky-clouds.test.ts` checks arithmetically so it cannot regress by an
 * eyeballed tweak.
 */
export const ISLAND_CLOUD_MAX_BOTTOM_PERCENT = 26;


/**
 * Exactly three actors. Two travel right-to-left, one left-to-right.
 *
 * ## Depth ladder
 *
 * Size, height and speed are one coherent depth cue rather than three
 * independent knobs: the small cloud is the highest, palest and slowest (far
 * away), the large one is the lowest of the three, most opaque and fastest
 * (nearest). All three still sit in the upper sky — the large cloud is lower
 * only because it is *nearer*, never to separate it from the others.
 *
 * ## Density
 *
 * Each actor is on screen for `crossing / distance` of its cycle, which these
 * numbers put at roughly 0.37 / 0.36 / 0.29. That sums to just over 1, so the
 * usual state of the sky is **one** cloud; two happens regularly, three is rare
 * and only ever a large one with a small distant one well away from it, and an
 * empty sky is a normal part of the cycle rather than a bug.
 *
 * The three durations (≈331 s, ≈452 s, ≈787 s) are deliberately non-harmonic. An
 * earlier arrangement had two actors within 3% of the same period, which meant
 * their relative phase barely moved within a play session and the sky kept
 * repeating the same pairing.
 *
 * The reverse-direction actor is the smallest, slowest and faintest of the three:
 * a cloud crossing against the others is a nice detail for a moment and an
 * irritation if it demands attention.
 */
export const ISLAND_CLOUD_ACTORS: readonly IslandCloudActor[] = [
  {
    // Nearest, lowest path, and the only actor allowed to be large.
    id: 'cloud-a',
    direction: 'rightToLeft',
    topPercent: 13,
    widthPx: 172,
    allowedSizes: ['medium', 'large'],
    sizeSequence: [
      'medium', 'large', 'medium', 'medium', 'large', 'medium',
      'large', 'medium', 'medium', 'large', 'medium', 'medium',
    ],
    shapeOffset: 0,
    shapeStride: 1,
    speedPxPerSecond: 11,
    offscreenWaitPx: 2303,
    // Starts well into its offscreen wait, so the opening sky is not led by the
    // biggest cloud. Re-enters after ~2.5 minutes.
    delaySeconds: -182,
    opacity: 0.92,
    restPx: 840,
  },
  {
    // Upper-middle path. Small or medium — never large.
    id: 'cloud-b',
    direction: 'rightToLeft',
    topPercent: 8.5,
    widthPx: 136,
    allowedSizes: ['small', 'medium'],
    sizeSequence: [
      'small', 'medium', 'medium', 'small', 'medium', 'small',
      'medium', 'medium', 'small', 'medium', 'small', 'medium',
    ],
    shapeOffset: 101,
    shapeStride: 7,
    speedPxPerSecond: 8,
    offscreenWaitPx: 2314,
    // The one cloud on screen at load, around the middle of the frame.
    delaySeconds: -68,
    opacity: 0.72,
    restPx: 470,
  },
  {
    // Distant, highest path, travelling against the other two. Mostly small.
    id: 'cloud-c',
    direction: 'leftToRight',
    topPercent: 3,
    widthPx: 136,
    allowedSizes: ['small', 'medium'],
    sizeSequence: [
      'small', 'small', 'medium', 'small', 'small', 'small',
      'medium', 'small', 'small', 'medium', 'small', 'small',
    ],
    shapeOffset: 197,
    shapeStride: 11,
    speedPxPerSecond: 5.5,
    offscreenWaitPx: 3054,
    // Offscreen at load; drifts in against the others after ~3 minutes.
    delaySeconds: -590,
    opacity: 0.58,
    restPx: 90,
  },
];

// ---------------------------------------------------------------------------
// Per-passage variation: which shape, and at what size
// ---------------------------------------------------------------------------

/**
 * Length of the authored shape table. 300 passages per lap, with 16 special slots
 * in it, gives the ~5 % special rate the brief asks for while keeping the authored
 * data to sixteen lines.
 */
export const ISLAND_CLOUD_SHAPE_PERIOD = 300;

/**
 * The authored special slots. Every other slot in the period is `normal`, so the
 * ordinary cloud stays the overwhelming majority by construction rather than by
 * tuning a probability.
 *
 * Positions are spread across the period and deliberately not evenly spaced, so a
 * player does not learn a rhythm. Counts: 4 egg, 4 baby, 4 adult, 3 heart, 1 poop —
 * which is 1.33 % / 1.33 % / 1.33 % / 1.00 % / 0.33 %, and 5.33 % in total.
 */
export const ISLAND_CLOUD_SPECIAL_SLOTS: readonly (readonly [number, IslandCloudShape])[] = [
  [7, 'blobbi-adult'],
  [17, 'blobbi-egg'],
  [41, 'blobbi-baby'],
  [59, 'heart'],
  [76, 'blobbi-adult'],
  [98, 'blobbi-baby'],
  [113, 'blobbi-egg'],
  [131, 'heart'],
  [148, 'blobbi-adult'],
  [164, 'blobbi-baby'],
  // The rarest slot in the table, by a factor of four. A joke formation that turns
  // up several times a day stops being a joke.
  [185, 'poop'],
  [206, 'blobbi-egg'],
  [223, 'blobbi-adult'],
  [239, 'blobbi-baby'],
  [254, 'heart'],
  [271, 'blobbi-egg'],
];

const SPECIAL_SLOT_LOOKUP = new Map<number, IslandCloudShape>(
  ISLAND_CLOUD_SPECIAL_SLOTS.map(([slot, shape]) => [slot, shape]),
);

/** Positive modulo, so pre-epoch (negative) passage indices behave. */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Which passage an actor is on at a given instant.
 *
 * Derived from the island epoch and the actor's own fixed cycle length, so it is
 * a pure function of UTC time. Two clients with roughly synchronised clocks
 * compute the same index and therefore see the same cloud — the same property the
 * sky's phase relies on, applied to cloud variation.
 *
 * `floor` rather than truncation, so indices decrease monotonically before the
 * epoch instead of folding around zero.
 */
export function islandCloudCycleIndexAt(
  actor: IslandCloudActor,
  worldWidthPx: number,
  nowMs: number,
): number {
  if (!Number.isFinite(nowMs)) return 0;
  const { durationSeconds } = islandCloudTravel(actor, worldWidthPx);
  const elapsedSeconds = (nowMs - ISLAND_EPOCH_MS) / 1000 - actor.delaySeconds;
  return Math.floor(elapsedSeconds / durationSeconds);
}

/** Seconds since the island epoch at which a given passage begins. */
export function islandCloudPassageStartSeconds(
  actor: IslandCloudActor,
  worldWidthPx: number,
  cycleIndex: number,
): number {
  const { durationSeconds } = islandCloudTravel(actor, worldWidthPx);
  return cycleIndex * durationSeconds + actor.delaySeconds;
}

/**
 * The shape this actor's passage would take, ignoring what the other actors are
 * doing. Separated from {@link islandCloudPassage} so the conflict rule can
 * consult it for a higher-priority actor without recursing.
 */
export function islandCloudAuthoredShape(
  actor: IslandCloudActor,
  cycleIndex: number,
): IslandCloudShape {
  const slot = mod(cycleIndex * actor.shapeStride + actor.shapeOffset, ISLAND_CLOUD_SHAPE_PERIOD);
  return SPECIAL_SLOT_LOOKUP.get(slot) ?? 'normal';
}

/** The size this actor's passage would take, before any conflict resolution. */
export function islandCloudAuthoredSize(
  actor: IslandCloudActor,
  cycleIndex: number,
): IslandCloudSize {
  return actor.sizeSequence[mod(cycleIndex, actor.sizeSequence.length)];
}

/**
 * Actors in priority order. Conflicts are resolved by yielding to everything
 * earlier in this list, which makes the outcome a total order and therefore the
 * same on every client without any coordination.
 */
const PRIORITY: readonly string[] = ISLAND_CLOUD_ACTORS.map((actor) => actor.id);

/**
 * Every passage of `other` that overlaps `actor`'s passage `cycleIndex`.
 *
 * The window compared is the whole passage, not just its visible part, so the
 * answer cannot change while the cloud is on screen — which is what makes a
 * formation stable for its entire visible passage. At most a handful of indices,
 * because no cycle is more than ~2.4× another.
 */
function overlappingIndices(
  actor: IslandCloudActor,
  other: IslandCloudActor,
  worldWidthPx: number,
  cycleIndex: number,
): number[] {
  const start = islandCloudPassageStartSeconds(actor, worldWidthPx, cycleIndex);
  const end = start + islandCloudTravel(actor, worldWidthPx).durationSeconds;
  const otherDuration = islandCloudTravel(other, worldWidthPx).durationSeconds;

  const first = Math.floor((start - other.delaySeconds) / otherDuration);
  const last = Math.floor((end - other.delaySeconds) / otherDuration);
  const indices: number[] = [];
  for (let i = first; i <= last; i += 1) indices.push(i);
  return indices;
}

export interface IslandCloudPassage {
  cycleIndex: number;
  shape: IslandCloudShape;
  size: IslandCloudSize;
  /** Rendered width in world pixels. */
  widthPx: number;
  /** Rendered height in world pixels. */
  heightPx: number;
  /** Vertical placement, as a percentage of world height. */
  topPercent: number;
  /** True when a conflict rule downgraded the authored choice. */
  suppressed: boolean;
}

/**
 * Everything about one cloud passage: which silhouette, at what size, where.
 *
 * Pure, and a function of the passage index alone — so it cannot change while the
 * cloud is visible, and a new one is only chosen when the index advances, which
 * happens while the actor is offscreen in its travel wait.
 *
 * Two conflict rules, both resolved against higher-priority actors only:
 *
 *  1. **Never two special formations at once.** A rare shape is rare partly
 *     because it arrives alone; two at the same time would read as a theme rather
 *     than a surprise.
 *  2. **A large cloud travels with small company.** When a higher-priority actor
 *     is large across an overlapping passage, this actor drops to its smallest
 *     allowed size, which is what keeps a large passage from crowding the sky.
 */
export function islandCloudPassage(
  actor: IslandCloudActor,
  worldWidthPx: number,
  cycleIndex: number,
): IslandCloudPassage {
  const authoredShape = islandCloudAuthoredShape(actor, cycleIndex);
  const authoredSize = islandCloudAuthoredSize(actor, cycleIndex);

  const higherPriority = ISLAND_CLOUD_ACTORS.filter(
    (other) => PRIORITY.indexOf(other.id) < PRIORITY.indexOf(actor.id),
  );

  let shape = authoredShape;
  let size = authoredSize;
  let suppressed = false;

  for (const other of higherPriority) {
    for (const otherIndex of overlappingIndices(actor, other, worldWidthPx, cycleIndex)) {
      if (shape !== 'normal' && islandCloudAuthoredShape(other, otherIndex) !== 'normal') {
        shape = 'normal';
        suppressed = true;
      }
      if (islandCloudAuthoredSize(other, otherIndex) === 'large' && size !== 'small') {
        const smallest = actor.allowedSizes.includes('small') ? 'small' : actor.allowedSizes[0];
        if (smallest !== size) {
          size = smallest;
          suppressed = true;
        }
      }
    }
  }

  const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
  return {
    cycleIndex,
    shape,
    size,
    widthPx: cloudShapeWidthPx(shape, size),
    heightPx: cloudShapeHeightPx(shape, size),
    topPercent: geometry.topPercent ?? actor.topPercent,
    suppressed,
  };
}

/** The passage an actor is on right now. */
export function islandCloudPassageAt(
  actor: IslandCloudActor,
  worldWidthPx: number,
  nowMs: number,
): IslandCloudPassage {
  return islandCloudPassage(
    actor,
    worldWidthPx,
    islandCloudCycleIndexAt(actor, worldWidthPx, nowMs),
  );
}

/**
 * The widest this actor can ever render — the value `widthPx` must be at least, so
 * that the travel endpoints clear the edge for every shape and size it may take.
 * Asserted by a test rather than trusted.
 */
export function islandCloudWidestRenderedPx(actor: IslandCloudActor): number {
  return Math.max(
    ...ISLAND_CLOUD_SHAPES.flatMap((shape) =>
      actor.allowedSizes.map((size) => cloudShapeWidthPx(shape, size)),
    ),
  );
}

/**
 * Vertical extent of an actor's drawn silhouette, as percentages of the world
 * height — the numbers the upper-sky constraint is actually about.
 */
export function islandCloudInkSpanPercent(
  actor: IslandCloudActor,
  worldHeightPx: number,
  shape: IslandCloudShape = 'normal',
  size?: IslandCloudSize,
): { topPercent: number; bottomPercent: number } {
  // Defaults to the actor's WORST case — its largest allowed size — because that is
  // the value the upper-sky budget has to hold for.
  const worstSize =
    size ??
    (actor.allowedSizes.includes('large')
      ? 'large'
      : actor.allowedSizes.includes('medium')
        ? 'medium'
        : 'small');
  const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
  return cloudShapeInkSpanPercent(
    shape,
    worstSize,
    geometry.topPercent ?? actor.topPercent,
    worldHeightPx,
  );
}

export interface IslandCloudTravel {
  /** Starting `translateX`, in world pixels. Fully outside the world. */
  fromPx: number;
  /** Ending `translateX`, in world pixels. Fully outside the world. */
  toPx: number;
  /** Total travel, always positive. */
  distancePx: number;
  durationSeconds: number;
  /** How long per cycle the cloud is completely offscreen. */
  offscreenWaitSeconds: number;
}

/**
 * Start and end offsets for one actor.
 *
 * Both endpoints are outside `[0, worldWidthPx]` by at least the cloud's own
 * width plus {@link ISLAND_CLOUD_EDGE_MARGIN_PX}, in both directions, so the
 * reverse-travelling actor is a true mirror rather than an approximation — its
 * offscreen start edge, offscreen end edge, transform direction and reset point
 * are all reflected.
 */
export function islandCloudTravel(
  actor: IslandCloudActor,
  worldWidthPx: number,
): IslandCloudTravel {
  const margin = ISLAND_CLOUD_EDGE_MARGIN_PX;
  const crossing = worldWidthPx + actor.widthPx + margin * 2;
  const distancePx = crossing + actor.offscreenWaitPx;

  // The surplus is appended AFTER the exit, so the cloud keeps drifting away from
  // the world while it is invisible. That is the wait.
  const [fromPx, toPx] =
    actor.direction === 'rightToLeft'
      ? [worldWidthPx + margin, worldWidthPx + margin - distancePx]
      : [-actor.widthPx - margin, -actor.widthPx - margin + distancePx];

  return {
    fromPx,
    toPx,
    distancePx,
    durationSeconds: distancePx / actor.speedPxPerSecond,
    offscreenWaitSeconds: actor.offscreenWaitPx / actor.speedPxPerSecond,
  };
}

/**
 * Is the actor at least partly within the world at this point of its cycle?
 *
 * Pure, so a test can sample the whole cycle and prove the composition never
 * becomes a row of clouds — and never goes permanently empty either.
 */
export function islandCloudOnScreenAt(
  actor: IslandCloudActor,
  worldWidthPx: number,
  timeSeconds: number,
): boolean {
  const travel = islandCloudTravel(actor, worldWidthPx);
  const elapsed = timeSeconds - actor.delaySeconds;
  const phase =
    ((elapsed % travel.durationSeconds) + travel.durationSeconds) % travel.durationSeconds;
  const progress = phase / travel.durationSeconds;
  const x = travel.fromPx + (travel.toPx - travel.fromPx) * progress;
  // The RENDERED width, not the travel width: a small passage is genuinely on
  // screen for less of its cycle than a large one, and the density figures should
  // reflect what the player sees.
  const cycleIndex = Math.floor(elapsed / travel.durationSeconds);
  const { widthPx } = islandCloudPassage(actor, worldWidthPx, cycleIndex);
  return x + widthPx > 0 && x < worldWidthPx;
}

/** How many actors are on screen at a given moment. */
export function islandCloudsOnScreenAt(worldWidthPx: number, timeSeconds: number): number {
  return ISLAND_CLOUD_ACTORS.filter((actor) =>
    islandCloudOnScreenAt(actor, worldWidthPx, timeSeconds),
  ).length;
}
