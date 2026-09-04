/**
 * The island sky, drawn behind the location artwork.
 *
 * Purely decorative: `pointer-events: none`, `aria-hidden`, no
 * `data-world-surface`, no interactive children. It cannot intercept a click, a
 * drag, a touch gesture or a hover, and removing it would change nothing except
 * how the world looks.
 *
 * ## How it stays smooth without animating in React
 *
 * The sky is a stack of gradient layers, one per authored keyframe in
 * `ISLAND_SKY_KEYFRAMES`, each holding that moment's colours as a static
 * `background-image`. Only two layers are ever mid-flight: everything below the
 * current keyframe sits at `opacity: 1` (and is occluded, so it costs no paint),
 * the current keyframe is at `1`, the next is at the blend weight, and everything
 * above is at `0`. Because every layer is fully opaque, that composite is exactly
 * a two-colour interpolation between the two authored moments.
 *
 * The gain over the obvious approach; one layer whose gradient colours are CSS
 * variables: is that **`opacity` interpolates in every browser**, whereas
 * interpolating a colour held in a custom property requires `@property`
 * registration and would degrade to a visible step every ten seconds where that
 * is unsupported. So React sets a handful of numbers twice a minute and the
 * compositor does the rest.
 *
 * ## Why the inactive layers do not transition
 *
 * When the cycle wraps, the keyframe index jumps from last to first. If the
 * layers being switched off animated, the composite would briefly show a blend of
 * the whole stack, a muddy flash at the exact moment the loop is supposed to be
 * seamless. Giving only the two active layers a transition duration makes the
 * others snap, and the snap is invisible because the wrap keyframe is authored to
 * be identical to the first one.
 */

import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import {
  ISLAND_SKY_KEYFRAMES,
  islandCelestialPosition,
  islandSkyKeyframeBackground,
} from '@/lib/island-sky';
import { getLocationSkyConfig } from '@/lib/island-sky-locations';
import {
  ISLAND_CLOUD_SHAPE_GEOMETRY,
  type IslandCloudShape,
  cloudShapeWidthPx,
} from '@/lib/island-sky-cloud-shapes';
import {
  islandCloudPreviewParkPx,
  resolveIslandCloudDev,
  useIslandSkyDev,
} from '@/lib/island-sky-dev';
import {
  useIslandCloudPassages,
  useIslandSkyState,
  useIslandSkyTransitionMs,
} from '@/hooks/useIslandSky';
import { WORLD_WIDTH } from '@/lib/world-coordinates';
import type { LocationId } from '@/lib/location-types';

/**
 * A fixed, hand-scattered star field. Two dozen entries as CSS gradient stops
 * inside two elements; not two dozen DOM nodes, and not a random layout that
 * would rearrange itself on every render.
 *
 * `[xPercent, yPercent, diameterPx, alpha]`, positioned within the star band.
 */
const FAR_STARS: readonly [number, number, number, number][] = [
  [6, 22, 1.4, 0.7], [14, 9, 1.2, 0.55], [21, 31, 1.4, 0.6], [28, 14, 1.2, 0.5],
  [35, 26, 1.4, 0.65], [43, 7, 1.2, 0.5], [49, 34, 1.4, 0.6], [57, 17, 1.2, 0.55],
  [64, 29, 1.4, 0.6], [71, 11, 1.2, 0.5], [78, 24, 1.4, 0.65], [85, 8, 1.2, 0.5],
  [91, 32, 1.4, 0.6], [96, 19, 1.2, 0.55], [11, 40, 1.2, 0.45], [88, 42, 1.2, 0.45],
];

const NEAR_STARS: readonly [number, number, number, number][] = [
  [10, 15, 2.4, 0.95], [24, 5, 2.2, 0.85], [39, 19, 2.6, 0.95], [53, 9, 2.2, 0.85],
  [67, 22, 2.4, 0.9], [76, 5, 2.2, 0.85], [82, 30, 2.4, 0.9], [94, 12, 2.2, 0.85],
  [32, 37, 2.2, 0.8], [60, 39, 2.2, 0.8],
];

function starFieldBackground(stars: readonly [number, number, number, number][]): string {
  return stars
    .map(
      ([x, y, size, alpha]) =>
        `radial-gradient(circle ${size}px at ${x}% ${y}%, rgba(255,255,255,${alpha}) 0%, rgba(255,255,255,0) 100%)`,
    )
    .join(', ');
}

/**
 * One cloud, as a single connected silhouette.
 *
 * The geometry comes from `ISLAND_CLOUD_SHAPE_GEOMETRY`: five genuinely different
 * part lists, not one drawing relabelled. All parts are opaque white inside the SVG
 * and the actor's opacity is applied to the wrapper, so overlaps leave no internal
 * seams or darker patches. Every part sits inside its own viewBox (asserted by
 * `island-sky-cloud-shapes.test.ts`), which is what guarantees no lobe is ever
 * clipped by its own wrapper. The only clipping is the world viewport at entrance
 * and exit, which is what a cloud drifting past an edge should look like.
 */
function IslandCloudShapeSvg({ shape }: { shape: IslandCloudShape }) {
  const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
  return (
    <svg
      viewBox={`0 0 ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`}
      className="block w-full"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="#ffffff">
        {geometry.parts.map((part, index) =>
          part.kind === 'circle' ? (
            <circle key={index} cx={part.cx} cy={part.cy} r={part.r} />
          ) : part.kind === 'ellipse' ? (
            <ellipse key={index} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} />
          ) : part.kind === 'rect' ? (
            <rect
              key={index}
              x={part.x}
              y={part.y}
              width={part.width}
              height={part.height}
              rx={part.rx}
            />
          ) : (
            <path key={index} d={part.d} />
          ),
        )}
      </g>
    </svg>
  );
}

/** Sky-layer percentages the celestial arc is authored against. */
const HORIZON_PERCENT = 52;

interface IslandSkyLayerProps {
  location: LocationId;
  className?: string;
}

export function IslandSkyLayer({ location, className }: IslandSkyLayerProps) {
  const sky = useIslandSkyState();
  const dev = useIslandSkyDev();
  const transitionMs = useIslandSkyTransitionMs();

  const config = getLocationSkyConfig(location);

  const layers = useMemo(
    () => ISLAND_SKY_KEYFRAMES.map((keyframe) => islandSkyKeyframeBackground(keyframe)),
    [],
  );
  const farStars = useMemo(() => starFieldBackground(FAR_STARS), []);
  const nearStars = useMemo(() => starFieldBackground(NEAR_STARS), []);
  const clouds = useIslandCloudPassages(WORLD_WIDTH);

  if (!config.enabled) return null;

  const showClouds = config.showClouds && dev.cloudsEnabled;
  const showStars = config.showStars && sky.starOpacity > 0.001;

  const sun = islandCelestialPosition(sky.sunProgress, { horizonPercent: HORIZON_PERCENT });
  const moon = islandCelestialPosition(sky.moonProgress, {
    horizonPercent: HORIZON_PERCENT - 2,
    peakPercent: 12,
  });

  // Warm and dim the clouds through the day. The 1.2px blur is the whole of the
  // "soft edges" treatment, enough to take the vector hardness off the
  // silhouette, far short of turning a cloud into fog. The function list is
  // constant so the browser interpolates it component-by-component; changing its
  // shape between renders would make the filter snap instead.
  const cloudFilter =
    `blur(1.2px) ` +
    `brightness(${sky.cloudBrightness.toFixed(3)}) ` +
    `sepia(${(sky.warmth * 0.32).toFixed(3)}) ` +
    `saturate(${(1 + sky.warmth * 0.25).toFixed(3)})`;

  return (
    <div
      aria-hidden
      data-island-sky-reduced-motion={dev.simulateReducedMotion ? 'true' : 'false'}
      className={cn('absolute inset-0 overflow-hidden pointer-events-none', className)}
      style={{
        // An opaque floor under the crossfade stack: if a layer is ever mid-load
        // or a rounding error leaves a hairline, it reads as sky rather than as
        // the frame showing through.
        backgroundColor: sky.gradient.mid,
        transition: `background-color ${transitionMs}ms linear`,
      }}
    >
      {/* Sky gradient crossfade stack. */}
      {layers.map((background, index) => {
        const isActive = index === sky.keyframeIndex || index === sky.keyframeIndex + 1;
        const opacity =
          index <= sky.keyframeIndex ? 1 : index === sky.keyframeIndex + 1 ? sky.keyframeBlend : 0;
        return (
          <div
            key={ISLAND_SKY_KEYFRAMES[index].minute}
            className="absolute inset-0"
            style={{
              backgroundImage: background,
              opacity,
              transition: `opacity ${isActive ? transitionMs : 0}ms linear`,
            }}
          />
        );
      })}

      {/* Stars: behind the clouds, above the gradient. */}
      {showStars && (
        <div
          className="absolute inset-x-0 top-0 h-[58%]"
          style={{
            opacity: sky.starOpacity,
            transition: `opacity ${transitionMs}ms linear`,
            maskImage: 'linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)',
          }}
        >
          <div className="absolute inset-0" style={{ backgroundImage: farStars }} />
          <div
            className="island-sky-star-breathe absolute inset-0"
            style={{ backgroundImage: nearStars }}
          />
        </div>
      )}

      {/* Sun. */}
      <div
        className="absolute rounded-full"
        style={{
          left: `${sun.xPercent}%`,
          top: `${sun.yPercent}%`,
          width: 58,
          height: 58,
          transform: 'translate(-50%, -50%)',
          opacity: sky.sunOpacity,
          background:
            'radial-gradient(circle, #FFFDF2 0%, #FFF0B8 42%, #FFD37A 68%, rgba(255,196,110,0) 100%)',
          boxShadow: '0 0 42px 18px rgba(255, 216, 140, 0.38)',
          filter: `saturate(${(1 + sky.warmth * 0.5).toFixed(3)}) sepia(${(sky.warmth * 0.3).toFixed(3)})`,
          transition: `left ${transitionMs}ms linear, top ${transitionMs}ms linear, opacity ${transitionMs}ms linear, filter ${transitionMs}ms linear`,
        }}
      />

      {/* Moon. No phases, the brief rules out real lunar cycles for this phase. */}
      <div
        className="absolute rounded-full"
        style={{
          left: `${moon.xPercent}%`,
          top: `${moon.yPercent}%`,
          width: 40,
          height: 40,
          transform: 'translate(-50%, -50%)',
          opacity: sky.moonOpacity,
          background:
            'radial-gradient(circle at 38% 34%, #FDFBF3 0%, #EDE7D6 55%, #C9C3B4 82%, rgba(201,195,180,0) 100%)',
          boxShadow: '0 0 30px 12px rgba(226, 232, 255, 0.28)',
          transition: `left ${transitionMs}ms linear, top ${transitionMs}ms linear, opacity ${transitionMs}ms linear`,
        }}
      />

      {/*
        Clouds: three individual actors, above the celestial bodies so the sun
        can pass behind one.

        Each actor is `left: 0` and moved purely by `translate3d`, so its start and
        end offsets are plain world-pixel numbers computed by `islandCloudTravel`
        and both lie outside the world box. No `overflow: hidden` anywhere in the
        chain, so the SVG silhouette is never cut by its own wrapper; the only
        clipping is the sky root's viewport at entrance and exit.
      */}
      {showClouds &&
        clouds.map(({ actor, travel, passage }) => {
          // Production selection first, then the DEV overlay on top of it. The
          // overlay is read-only: it never feeds back into `islandCloudPassage`, so
          // returning a control to Auto restores the UTC-derived choice instantly.
          const preview = resolveIslandCloudDev(actor.id, dev, {
            worldWidthPx: WORLD_WIDTH,
            renderedWidthPx: passage.widthPx,
          });
          if (preview.hidden) return null;

          const shape = preview.shape ?? passage.shape;
          const size = preview.size ?? passage.size;
          const widthPx = cloudShapeWidthPx(shape, size);
          const geometry = ISLAND_CLOUD_SHAPE_GEOMETRY[shape];
          const topPercent = geometry.topPercent ?? actor.topPercent;
          // Recomputed with the FINAL width: the resolver had to guess with the
          // production width before the shape override was known.
          const parkPx =
            preview.parkPx === null
              ? null
              : islandCloudPreviewParkPx({ worldWidthPx: WORLD_WIDTH, renderedWidthPx: widthPx });

          return (
            <div
              key={actor.id}
              data-island-cloud={actor.id}
              data-island-cloud-direction={actor.direction}
              data-island-cloud-shape={shape}
              data-island-cloud-size={size}
              className="island-sky-cloud absolute left-0"
              style={{
                top: `${topPercent}%`,
                width: widthPx,
                opacity: sky.cloudOpacity * actor.opacity,
                filter: cloudFilter,
                // Read by the keyframes. Two separate custom properties, each
                // constant per element, so the animation interpolates between two
                // resolved transforms without needing @property support.
                ['--island-cloud-from' as string]: `${travel.fromPx.toFixed(1)}px`,
                ['--island-cloud-to' as string]: `${travel.toPx.toFixed(1)}px`,
                animationDuration: `${travel.durationSeconds.toFixed(1)}s`,
                animationDelay: `${actor.delaySeconds}s`,
                // Preview parks the actor on screen instead of waiting for its
                // passage to come round, so the animation is switched off for it.
                ...(parkPx !== null ? { animationName: 'none' } : null),
                // The resting position, used when the animation is off; either for
                // reduced motion or for a preview park. An animation overrides it
                // while it is running.
                transform: `translate3d(${parkPx ?? actor.restPx}px, 0, 0)`,
                transition: `opacity ${transitionMs}ms linear, filter ${transitionMs}ms linear`,
              }}
            >
              <IslandCloudShapeSvg shape={shape} />
            </div>
          );
        })}
    </div>
  );
}
