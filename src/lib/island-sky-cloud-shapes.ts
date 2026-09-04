/**
 * Cloud silhouettes: the ordinary cloud, plus four rare formations.
 *
 * Every variant is **real geometry**, not one SVG relabelled; each entry below is
 * a different set of primitives with a different viewBox and a different aspect
 * ratio. `island-sky-cloud-shapes.test.ts` asserts that no two variants share a
 * part list, so "same shape, different `data-*`" cannot slip in.
 *
 * ## The lobe-assembly correction
 *
 * The three character formations were first built the same way the ordinary cloud
 * is: a stack of circles, ellipses and rounded rects. In-app review found that
 * `blobbi-egg`, `blobbi-baby` and `blobbi-adult` **all read as poop clouds**, and
 * the cause was structural rather than a tuning miss: each was a set of rounded
 * tiers narrowing towards the top, which *is* the poop-swirl construction. Any
 * character assembled that way lands on it.
 *
 * So the characters no longer approximate anything. `blobbi-baby` and
 * `blobbi-adult` are now the **verbatim `data-blobbi-body="true"` contours** from
 * the production SVG data, and `blobbi-egg` is derived from the baby contour
 * (the island has no egg artwork). One continuous path each, so there are no tiers
 * to read as a swirl.
 *
 * The accidental poop shape was too good to throw away, so `poop` is now a
 * deliberate formation: and the rarest of them all.
 *
 * ## Construction rules
 *
 * - **Rounded geometry only**: circles, ellipses, rounded rects, and `M`/`Q`
 *   contours. No polygons, no sharp corners, no strokes, no text, no logos.
 * - **Characters use one continuous contour**, never a stack of lobes. `normal` and
 *   `heart` may still be assembled: neither is a character, so neither can be
 *   mistaken for one.
 * - **One opaque fill, opacity applied to the wrapper.** Overlaps must not show as
 *   darker patches, so the parts are painted at full alpha inside the SVG and the
 *   whole group is faded by the actor.
 * - **Everything inside the viewBox**, checked arithmetically by
 *   `cloudShapeInkBounds`, so no lobe can be clipped by its own wrapper.
 * - **Ink bounds are derived, never hand-written.** The upper-sky budget is
 *   enforced against the computed bounding box of the actual parts, so retuning a
 *   lobe cannot silently push a formation over a tree line.
 *
 * ## Where the Blobbi silhouettes come from
 *
 * These are simplifications of the project's own artwork, not invented characters.
 * References inspected:
 *
 * - **Baby**: `packages/blobbi-react/src/artwork/baby-blobbi/lib/baby-svg-data.ts`, body path
 *   `M 50 15 Q 72 25 75 55 Q 75 80 50 88 Q 25 80 25 55 Q 28 25 50 15` in a 100×100
 *   viewBox: a narrow apex at (50, 15) widening to its full width around y≈55 and
 *   closing on a broad round base at y≈88. Squat, round, widest low.
 * - **Adult**: `packages/blobbi-react/src/artwork/adult-blobbi/lib/adult-svg-data.ts`, body path
 *   `M 100 40 Q 70 60 60 90 Q 55 120 70 140 Q 85 155 100 160 Q 115 155 130 140
 *   Q 145 120 140 90 Q 130 60 100 40` in a 200×200 viewBox: a rounded apex at
 *   (100, 40), flanks bulging outward to x≈55/145 by y≈90–120, then a wide rounded
 *   base at y≈160. That is the onigiri silhouette, **convex sides and round
 *   corners, which is exactly what stops it being a triangle.**
 * - **Egg**: the island has no egg SVG: `loadBlobbiSvg` falls back to the baby
 *   drawing for the egg stage, and `BlobbiHatchingCeremony` draws its egg as
 *   `borderRadius: '50%'` shapes behind a radial gradient. So the honest reference
 *   is the baby body's ovoid proportions with the tuft removed and the whole form
 *   stretched taller and narrower.
 *
 * Each formation keeps only the **outer contour**. No eyes, mouth, colours,
 * patterns, internal lines, accessories or outlines, a white cloud that happens
 * to be shaped like the thing.
 */

export type IslandCloudShape =
  | 'normal'
  | 'blobbi-egg'
  | 'blobbi-baby'
  | 'blobbi-adult'
  | 'heart'
  | 'poop';

export type IslandCloudSize = 'small' | 'medium' | 'large';

export const ISLAND_CLOUD_SHAPES: readonly IslandCloudShape[] = [
  'normal',
  'blobbi-egg',
  'blobbi-baby',
  'blobbi-adult',
  'heart',
  'poop',
];

export const ISLAND_CLOUD_SIZES: readonly IslandCloudSize[] = ['small', 'medium', 'large'];

/** Every formation is a union of these. Rounded only, by construction. */
export type IslandCloudPart =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  /**
   * A single continuous contour. This is how the character formations are drawn,
   * see the header for why lobe assembly was abandoned.
   */
  | { kind: 'path'; d: string };

export interface IslandCloudShapeGeometry {
  viewBoxWidth: number;
  viewBoxHeight: number;
  parts: readonly IslandCloudPart[];
  /** Rendered width in world pixels, per size category. */
  widthPx: Record<IslandCloudSize, number>;
  /**
   * Vertical placement for this formation, as a percentage of world height.
   *
   * `undefined` means "use the actor's own path": that is the normal cloud, whose
   * height is part of the actors' depth ladder. The formations are rare and tall,
   * so they get their own high placement instead: a tall shape on the large
   * actor's low path would break the upper-sky budget.
   */
  topPercent?: number;
}

const NORMAL: IslandCloudShapeGeometry = {
  viewBoxWidth: 200,
  viewBoxHeight: 100,
  widthPx: { small: 108, medium: 136, large: 172 },
  parts: [
    { kind: 'rect', x: 16, y: 56, width: 168, height: 38, rx: 19 },
    { kind: 'circle', cx: 56, cy: 60, r: 26 },
    { kind: 'circle', cx: 102, cy: 44, r: 34 },
    { kind: 'circle', cx: 148, cy: 60, r: 24 },
  ],
};

/**
 * Egg.
 *
 * The island has **no egg artwork at all**: `loadBlobbiSvg` falls back to the baby
 * drawing for the egg stage, and `BlobbiHatchingCeremony` draws its egg from
 * `borderRadius: '50%'` shapes. So this contour is the only one here that is
 * *derived* rather than copied, the baby ovoid with its pinched apex smoothed into
 * a dome and the whole form drawn narrower and taller.
 *
 * The smooth dome is what separates it from the baby at a glance: the baby's real
 * path has a distinct pinch at the top, and an egg has none.
 */
const BLOBBI_EGG: IslandCloudShapeGeometry = {
  viewBoxWidth: 100,
  viewBoxHeight: 130,
  widthPx: { small: 58, medium: 72, large: 88 },
  topPercent: 4,
  parts: [
    {
      kind: 'path',
      d: 'M 50 10 Q 70 32 73 72 Q 73 104 50 116 Q 27 104 27 72 Q 30 32 50 10 Z',
    },
  ],
};

/**
 * Baby: the **real** body path, verbatim.
 *
 * `packages/blobbi-react/src/artwork/baby-blobbi/lib/baby-svg-data.ts`, the shape carrying
 * `data-blobbi-body="true"` in `BABY_BASE_SVG`, in its own 100×100 viewBox. The
 * odd `Q 50 10 50 15` is in the production artwork and is kept: it is the pinch at
 * the crown that makes a baby Blobbi a baby Blobbi rather than an egg.
 */
const BLOBBI_BABY: IslandCloudShapeGeometry = {
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  widthPx: { small: 76, medium: 94, large: 112 },
  topPercent: 5,
  parts: [
    {
      kind: 'path',
      d: 'M 50 15 Q 50 10 50 15 Q 72 25 75 55 Q 75 80 50 88 Q 25 80 25 55 Q 28 25 50 15 Z',
    },
  ],
};

/**
 * Adult: the **real** body of the default adult form, verbatim.
 *
 * `packages/blobbi-react/src/artwork/adult-blobbi/lib/adult-svg-data.ts`, the `data-blobbi-body="true"`
 * shape in `CATTI_BASE`: `ellipse cx="100" cy="120" rx="45" ry="60"` in a 200×200
 * viewBox. A broad upright oval.
 *
 * ## Why this one, out of sixteen
 *
 * There is no shared adult path: each of the sixteen `ADULT_SVG_MAP` forms draws its
 * own body: circles (bloomi, cloudi, owli, pandi, rosey, leafy), ovals (catti,
 * froggi), a rounded rect (cacti), polygons (crysti, rocky, starri) and a few paths.
 * Reproducing them all is explicitly out of scope, so one has to stand for the rest.
 *
 * Two independent places pick the same one: `getDefaultAdultForm()` returns
 * `catti`, and `getFallbackAdultSvg` draws `ellipse rx="50" ry="60"`. Both are broad
 * upright ovals, so that *is* the project's shared adult direction.
 *
 * ## Why not `DROPPI_BASE`'s path
 *
 * It was the first choice, a real contour, and it carries the same `Q x y x y`
 * opening quirk as the baby path, marking it as the baby ovoid at adult
 * proportions. That turned out to be the problem: rendered as a cloud it is
 * indistinguishable from `blobbi-baby`, because it is the same teardrop. The
 * default form's oval is equally real and visibly broader, which is what lets a
 * player tell an adult cloud from a baby one at sky scale. The lifecycle then reads
 * as a genuine ladder: narrow pointed egg → pinched teardrop baby → broad oval
 * adult.
 */
const BLOBBI_ADULT: IslandCloudShapeGeometry = {
  viewBoxWidth: 200,
  viewBoxHeight: 200,
  widthPx: { small: 92, medium: 112, large: 132 },
  topPercent: 3,
  parts: [{ kind: 'ellipse', cx: 100, cy: 120, rx: 45, ry: 60 }],
};

/**
 * Heart: two top lobes over a tapering body, closed with a soft round tip rather
 * than a point.
 *
 * Deliberately imperfect: the right lobe is smaller and sits higher than the left,
 * and the body ellipse is off-centre. A symmetrical version reads as a UI icon.
 *
 * Lobe assembly is fine here, and only here: a heart is not a character, so there
 * is no real silhouette to be faithful to and nothing to be mistaken for.
 */
const HEART: IslandCloudShapeGeometry = {
  viewBoxWidth: 100,
  viewBoxHeight: 86,
  widthPx: { small: 88, medium: 108, large: 130 },
  topPercent: 6,
  parts: [
    { kind: 'circle', cx: 33, cy: 32, r: 25 },
    { kind: 'circle', cx: 66, cy: 29, r: 23 },
    { kind: 'ellipse', cx: 49, cy: 46, rx: 34, ry: 26 },
    { kind: 'circle', cx: 50, cy: 62, r: 17 },
    { kind: 'circle', cx: 50, cy: 74, r: 9 },
  ],
};

/**
 * Poop: deliberately, this time.
 *
 * The three Blobbi formations used to be built from stacked rounded mounds that got
 * smaller towards the top, and in-app review found they all read as poop clouds.
 * That was not bad luck: **tiers narrowing upward is the poop-swirl construction**,
 * so any character assembled that way lands on it. Diagnosing that is what moved
 * the Blobbi shapes onto real contours, and it also meant the island had an
 * accidental poop cloud worth keeping on purpose, as the rarest formation of all.
 *
 * One continuous contour with three tiers, so the shape is the silhouette rather
 * than a pile of parts.
 */
const POOP: IslandCloudShapeGeometry = {
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  widthPx: { small: 80, medium: 98, large: 118 },
  topPercent: 5,
  parts: [
    {
      kind: 'path',
      d:
        'M 50 8 Q 62 14 60 24 Q 78 26 80 42 Q 96 46 94 64 Q 96 84 74 88 ' +
        'Q 50 94 26 88 Q 4 84 6 64 Q 4 46 20 42 Q 22 26 40 24 Q 38 14 50 8 Z',
    },
  ],
};

export const ISLAND_CLOUD_SHAPE_GEOMETRY: Record<IslandCloudShape, IslandCloudShapeGeometry> = {
  normal: NORMAL,
  'blobbi-egg': BLOBBI_EGG,
  'blobbi-baby': BLOBBI_BABY,
  'blobbi-adult': BLOBBI_ADULT,
  heart: HEART,
  poop: POOP,
};

/** Which shapes are the rare formations rather than the everyday cloud. */
export const ISLAND_CLOUD_SPECIAL_SHAPES: readonly IslandCloudShape[] =
  ISLAND_CLOUD_SHAPES.filter((shape) => shape !== 'normal');

export function isSpecialCloudShape(shape: IslandCloudShape): boolean {
  return shape !== 'normal';
}

/**
 * Bounding box of a path's **control-point hull**, in viewBox units.
 *
 * Every coordinate pair in the `d` string, min/maxed. For quadratic curves the
 * true outline is inside the hull of its control points, so this is a
 * **conservative over-estimate**: never smaller than the real ink. That is the
 * right direction to be wrong in: the upper-sky budget and the
 * everything-inside-the-viewBox check both stay safe, and the only cost is a little
 * unused margin.
 *
 * These paths are hand-checked `M`/`Q`/`Z` contours from the production artwork, so
 * a full path parser would be machinery without a purpose.
 */
function pathControlHull(d: string): [number, number, number, number] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }
  return [minX, maxX, minY, maxY];
}

/**
 * Bounding box of a formation's ink, in viewBox units.
 *
 * Derived from the parts rather than recorded alongside them, so the upper-sky
 * budget is checked against the geometry that actually renders.
 */
export function cloudShapeInkBounds(geometry: IslandCloudShapeGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const part of geometry.parts) {
    const [x0, x1, y0, y1] =
      part.kind === 'circle'
        ? [part.cx - part.r, part.cx + part.r, part.cy - part.r, part.cy + part.r]
        : part.kind === 'ellipse'
          ? [part.cx - part.rx, part.cx + part.rx, part.cy - part.ry, part.cy + part.ry]
          : part.kind === 'rect'
            ? [part.x, part.x + part.width, part.y, part.y + part.height]
            : pathControlHull(part.d);
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
  }

  return { minX, maxX, minY, maxY };
}

/** Rendered element height for a formation at a given size, in world pixels. */
export function cloudShapeHeightPx(
  shape: IslandCloudShape,
  size: IslandCloudSize,
): number {
  const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
  const width = geometry.widthPx[size];
  return (width * geometry.viewBoxHeight) / geometry.viewBoxWidth;
}

/** Rendered element width for a formation at a given size, in world pixels. */
export function cloudShapeWidthPx(shape: IslandCloudShape, size: IslandCloudSize): number {
  return ISLAND_CLOUD_SHAPE_GEOMETRY[shape].widthPx[size];
}

/**
 * Vertical extent of a formation's ink, as percentages of world height, for a
 * given top placement. This is the number the upper-sky constraint is about.
 */
export function cloudShapeInkSpanPercent(
  shape: IslandCloudShape,
  size: IslandCloudSize,
  topPercent: number,
  worldHeightPx: number,
): { topPercent: number; bottomPercent: number } {
  const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
  const heightPx = cloudShapeHeightPx(shape, size);
  const bounds = cloudShapeInkBounds(geometry);
  const toPercent = (viewBoxY: number) =>
    ((viewBoxY / geometry.viewBoxHeight) * heightPx / worldHeightPx) * 100;
  return {
    topPercent: topPercent + toPercent(bounds.minY),
    bottomPercent: topPercent + toPercent(bounds.maxY),
  };
}
