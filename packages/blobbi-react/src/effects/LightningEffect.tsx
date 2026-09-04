/**
 * The LIGHTNING renderer, the one effect that is structure, not scatter.
 *
 * Eleven of the twelve effects are particles: independent pieces whose beauty
 * is statistical, which is why they live as data in `effect-catalog.ts` and are
 * walked generically. A lightning bolt is the opposite, a single connected
 * jagged CHANNEL whose beauty is its continuity, so it is drawn as SVG paths
 * and animated with the one technique CSS has for "a line travelling along
 * itself": `stroke-dashoffset`. Each path carries `pathLength="100"`, so one
 * shared keyframe (`blobbi-fx-bolt-draw`, in `effect-styles.ts`) draws every
 * path from its own origin to its own tip in ~180 ms, flickers it
 * (1 → 0.3 → 1 → out over ~320 ms), and extinguishes it, a real return
 * stroke, growing upward from the Blobbi's feet because that is where each
 * path's `M` is.
 *
 * ## The look, layer by layer, a four-deep stroke stack per channel
 *
 *   impact ellipse   a radial white→gold→blue glow pooling at the origin
 *   halo stroke      the same path, very wide, electric blue, ~0.16 alpha
 *   bloom stroke     the same path, wide, gradient, ~0.34 alpha
 *   outer stroke     the crisp channel, blue→gold→white gradient, round joins
 *   core stroke      a thin pure-white line, the blown-out centre that makes
 *                    it read as plasma
 *   branches         thin electric-blue forks, each with one soft copy
 *
 * Tip and origin sparks are ordinary catalog pieces, timed to the same cycle.
 *
 * ## Why the glow is layered strokes and NOT an SVG filter
 *
 * The reference look asks for feGaussianBlur. A filter's input here would be
 * ANIMATING strokes, and a filter re-evaluates whenever its input changes, so
 * every frame of every strike would re-run two Gaussian convolutions per bolt,
 * a cost that scales with blur radius and device, and that this package cannot
 * bound (the audit's blur rule exists for exactly this class of hazard). Wide
 * round-capped translucent copies of the same path are plain vector paint,
 * linear, tiny, safe on anything, and stacked four deep they read within
 * shouting distance of a true Gaussian bloom. Every stack layer shares one
 * draw animation and one delay, so the bloom climbs with the strike.
 *
 * ## Why SVG is safe here when the shape vocabulary refuses it
 *
 * The shape vocabulary avoids SVG because paint-server ids are global to the
 * document. That is a solved problem in this package: the body SVG namespaces
 * every id by the renderer's `instanceId`, and this component does exactly the
 * same: its filter and gradients are `<instanceId>-fx…`, so two Blobbis on one
 * page cannot cross-reference each other's defs. (Two renderers given the SAME
 * instance id share ids, which is the documented meaning of doing that.)
 *
 * ## Determinism
 *
 * The bolt geometry is hand-authored and fixed. The only variation is a small
 * per-instance jitter on the branch delays, drawn from `unitFor`: the same
 * seeded hash the particles use, so re-renders never move anything and two
 * instances strike with slightly different fork timing. No `Math.random()`, no
 * timers, no state, no refs, no measurement.
 */
import type { CSSProperties } from 'react';
import { STRIKE_CYCLE_S } from './effect-catalog';
import { unitFor } from './deterministic';

/** One bolt: a main channel path, its forks, and where it strikes from. */
interface BoltSpec {
  /** Box coordinates (0–100), STARTING at the bottom origin, the dash draw
   *  direction is the path direction, and the strike must climb. */
  d: string;
  branches: readonly string[];
  origin: { x: number; y: number };
  /** Seconds into the shared cycle at which this bolt fires. */
  delay: number;
}

/**
 * Two bolts flanking the body, firing half a cycle apart. Channels hug the
 * body's flanks and the branches fork OUTWARD, lightning across the face
 * would break the one rule a body-overlay carries: the character stays
 * readable.
 */
const BOLTS: readonly BoltSpec[] = [
  {
    d: 'M 34 92 L 30 76 L 37 72 L 30 54 L 36 50 L 29 34',
    // The lower fork leaves mid-channel toward open air; the upper one is a
    // crown fork off the tip, above the face line; never across an eye.
    branches: ['M 33.5 63 L 25 57 L 23 49', 'M 30 37 L 24 30 L 23 22'],
    origin: { x: 34, y: 92 },
    delay: 0,
  },
  {
    d: 'M 66 90 L 71 76 L 64 71 L 70 55 L 65 50 L 70 38',
    branches: ['M 68 62 L 75 57 L 77 49'],
    origin: { x: 66, y: 90 },
    delay: STRIKE_CYCLE_S / 2,
  },
];

/** Stroke widths in box units, the reference's 8 : 3 : 2 px at its own scale. */
const OUTER_W = 2.2;
const CORE_W = 0.85;
const BRANCH_W = 0.6;

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** Inline animation + intensity for one stroke or flash element. */
function strikeStyle(
  animation: 'blobbi-fx-bolt-draw' | 'blobbi-fx-impact-flash',
  delayS: number,
  opacity: number,
  intensity: number,
): CSSProperties {
  const style: CSSProperties = {
    // `backwards` fill matters: during the element's initial delay the FIRST
    // keyframe (invisible, undrawn) applies, instead of the base style, a
    // bolt must not stand fully lit for 1.4 s waiting for its first strike.
    animation: `${animation} ${STRIKE_CYCLE_S}s linear ${round(delayS, 2)}s infinite normal backwards`,
  };
  (style as Record<string, string>)['--fx-o'] = String(round(opacity * intensity, 3));
  return style;
}

export interface LightningEffectProps {
  /** Sanitized renderer instance id, namespaces this SVG's def ids. */
  instanceId: string;
  /** The deterministic seed the walker uses for this effect instance. */
  seed: string;
  /** Clamped caller intensity; scales opacity exactly like `--fx-o` does. */
  intensity: number;
}

/**
 * The strike SVG, mounted on the `mid` effect layer: over the body, under the
 * front accessories, exactly where a body-overlay belongs.
 *
 * The viewBox is `-40 -40 180 180` because the effect layer extends 40 %
 * beyond the renderer box on every side, with that offset, path coordinates
 * are plain box coordinates (0–100), the same space every catalog piece uses.
 */
export function LightningEffect({ instanceId, seed, intensity }: LightningEffectProps) {
  const gradId = `${instanceId}-fxlgrad`;
  const impactId = `${instanceId}-fxlimpact`;

  let branchIndex = 0;

  return (
    <svg
      aria-hidden="true"
      className="blobbi-fx-strike"
      viewBox="-40 -40 180 180"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        {/* Electric blue at the tip, gold mid-channel, white-hot at the origin.
            objectBoundingBox, so each bolt grades along its own height. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#70d6ff" />
          <stop offset="50%" stopColor="#ffd166" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>

        <radialGradient id={impactId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="30%" stopColor="#ffd166" stopOpacity="0.8" />
          <stop offset="70%" stopColor="#70d6ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#70d6ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {BOLTS.map((bolt) => (
        <g key={bolt.origin.x}>
          {/* Strike-point glow pooling where the bolt leaves the ground. The
              radial gradient is inherently soft; it needs no filter. */}
          <ellipse
            className="blobbi-fx-impact"
            cx={bolt.origin.x}
            cy={bolt.origin.y}
            rx={15}
            ry={3.6}
            fill={`url(#${impactId})`}
            style={strikeStyle('blobbi-fx-impact-flash', bolt.delay, 1, intensity)}
          />
          {/* Forks: thin, electric blue over a soft wide copy, firing just
              after their channel with a small deterministic per-instance
              jitter: the "randomized delays" of the reference, without a
              random number in sight. */}
          {bolt.branches.map((d) => {
            const jitter = round(unitFor(seed, branchIndex++, 'br') * 0.08, 2);
            const delay = bolt.delay + 0.1 + jitter;
            return (
              <g key={d}>
                <path
                  className="blobbi-fx-bolt"
                  d={d}
                  pathLength={100}
                  stroke="#70d6ff"
                  strokeWidth={BRANCH_W * 3}
                  style={strikeStyle('blobbi-fx-bolt-draw', delay, 0.3, intensity)}
                />
                <path
                  className="blobbi-fx-bolt"
                  d={d}
                  pathLength={100}
                  stroke="#70d6ff"
                  strokeWidth={BRANCH_W}
                  style={strikeStyle('blobbi-fx-bolt-draw', delay, 0.85, intensity)}
                />
              </g>
            );
          })}
          {/* The channel, four strokes deep down the SAME path on the SAME
              cue: halo, bloom, crisp gradient, white core. The two translucent
              wide copies are the glow, layered vector paint instead of a
              Gaussian filter, per the module note. */}
          <path
            className="blobbi-fx-bolt"
            d={bolt.d}
            pathLength={100}
            stroke="#70d6ff"
            strokeWidth={OUTER_W * 3.4}
            style={strikeStyle('blobbi-fx-bolt-draw', bolt.delay, 0.16, intensity)}
          />
          <path
            className="blobbi-fx-bolt"
            d={bolt.d}
            pathLength={100}
            stroke={`url(#${gradId})`}
            strokeWidth={OUTER_W * 1.9}
            style={strikeStyle('blobbi-fx-bolt-draw', bolt.delay, 0.34, intensity)}
          />
          <path
            className="blobbi-fx-bolt"
            d={bolt.d}
            pathLength={100}
            stroke={`url(#${gradId})`}
            strokeWidth={OUTER_W}
            style={strikeStyle('blobbi-fx-bolt-draw', bolt.delay, 0.95, intensity)}
          />
          <path
            className="blobbi-fx-bolt"
            d={bolt.d}
            pathLength={100}
            stroke="#ffffff"
            strokeWidth={CORE_W}
            style={strikeStyle('blobbi-fx-bolt-draw', bolt.delay, 1, intensity)}
          />
        </g>
      ))}
    </svg>
  );
}
