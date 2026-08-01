/**
 * The TWELVE PRESETS, as data.
 *
 * An effect is a list of piece GROUPS. A group says: put `count` copies of this
 * shape on this layer, scatter them inside these ranges, carry them with this
 * track animation and animate them in place with that one. Everything varying
 * is a range, and every value inside a range is drawn deterministically from
 * `deterministic.ts` — never from `Math.random()`.
 *
 * Expressing effects as data rather than as twelve components is what keeps the
 * renderer to a single generic walker, keeps the caps enforceable by a test
 * that reads the numbers directly, and makes "what does Mystic Fog actually
 * do?" answerable by reading one object.
 *
 * ## Coordinates
 *
 * `xPct`/`yPct` place a piece's CENTRE in the renderer box (0–100, the same
 * space accessory placements use). `sizePct` is the piece's width AND height as
 * a percentage of the box — the box is square, so one number keeps every shape
 * undistorted at every size token.
 *
 * ## Layers
 *
 * `behind` paints before the behind-accessories, `mid` between the body and the
 * front accessories, `front` after everything. An effect that needs depth uses
 * two groups on two layers — Mystic Fog's rear bank and foreground veil are the
 * clearest case.
 *
 * ## The resting state
 *
 * Every group's `xPct`/`yPct` describe a composition that already looks right
 * WITH NO ANIMATION, because that is exactly what a reduced-motion user sees.
 * Rising particles are therefore authored scattered through the body's height
 * and travel upward from there, rather than authored in a heap at the feet.
 */
import type { EffectPieceKind } from './effect-shapes';
import type { BlobbiVisualEffectId, BlobbiEffectSlot } from './effect-model';
import { EFFECT_SLOTS } from './effect-model';

/** Which of the renderer's three effect layers a group paints into. */
export type EffectLayer = 'behind' | 'mid' | 'front';

/** An inclusive-ish `[min, max)` range; a deterministic draw lands inside it. */
export type EffectRange = readonly [min: number, max: number];

/** How a group's pieces TRAVEL. */
export interface EffectTrackSpec {
  /** A keyframe name from `effect-styles.ts`, or absent for a still track. */
  animation?: string;
  durationS?: EffectRange;
  delayS?: EffectRange;
  timing?: string;
  direction?: 'normal' | 'reverse';
  /** Travel distances, as percentages OF THE BOX (the track is box-sized). */
  dxPct?: EffectRange;
  dyPct?: EffectRange;
  /** Lateral sway amplitude for `rise`/`fall`. */
  swayPct?: EffectRange;
  /**
   * A fixed rotation of the whole track. Applied ONLY when the track has no
   * animation of its own — a static transform and an animated one on the same
   * element cannot both win, and silently losing one is worse than the rule.
   * Rotating the track swings the piece around the box centre AND turns it,
   * which is what arranges electric arcs radially around the body.
   */
  rotateDeg?: EffectRange;
}

/** What a group's pieces ARE, and what they do in place. */
export interface EffectPieceSpec {
  kind: EffectPieceKind;
  sizePct: EffectRange;
  xPct: EffectRange;
  yPct: EffectRange;
  /** Resting opacity before the caller's intensity is applied. */
  opacity: EffectRange;
  animation?: string;
  durationS?: EffectRange;
  delayS?: EffectRange;
  timing?: string;
  direction?: 'normal' | 'reverse';
  /** Displacement amplitudes for `blobbi-fx-glitch`, as % of the piece. */
  glitchXPct?: EffectRange;
  glitchYPct?: EffectRange;
  /**
   * `backwards` keeps the FIRST keyframe applied during the initial
   * animation-delay. Ambient particles deliberately omit it — they should be
   * visible at their authored spots from the first frame, not fade in over
   * their stagger window — but strike-synchronized pieces must stay dark until
   * their cue.
   */
  fill?: 'backwards';
}

export interface EffectPieceGroup {
  layer: EffectLayer;
  count: number;
  /** Colours cycled deterministically across the group's pieces. */
  colors: readonly string[];
  /** The secondary colour the two-colour shapes use. */
  accent: string;
  track: EffectTrackSpec;
  piece: EffectPieceSpec;
}

export interface BlobbiVisualEffectPreset {
  id: BlobbiVisualEffectId;
  slot: BlobbiEffectSlot;
  displayName: string;
  /** One sentence, presentation-level. Rarity and item identity are Island's. */
  description: string;
  groups: readonly EffectPieceGroup[];
  /**
   * Keyframes used by this effect's STRUCTURAL renderer (`LightningEffect`),
   * which the group walk cannot discover. `BlobbiEffectStyles` merges these
   * into the emitted stylesheet; the catalog test verifies each one exists.
   */
  extraAnimations?: readonly string[];
}

/**
 * Per-effect piece cap.
 *
 * Not a guess: the repository already decided once that an unbounded particle
 * system is the decoration most able to cost a frame budget
 * (`dance-visuals.ts`, `RECEPTOR_SPARK_COUNT`). This restates it as a number a
 * test can check, so a future preset cannot quietly grow past it.
 */
export const MAX_PIECES_PER_EFFECT = 18;

/** Cap across all four slots at once — the worst case a single Blobbi can be. */
export const MAX_PIECES_TOTAL = 48;

/** No decorative animation may cycle faster than this. Anti-flicker floor. */
export const MIN_ANIMATION_DURATION_S = 1.2;

// ─── Palettes ───────────────────────────────────────────────────────────────
// Kept as named constants rather than inline hex so an effect's identity is
// visible at a glance and two effects cannot drift into the same colour.

const GOLD = ['#ffe9a3', '#ffd35c', '#fff6d6', '#ffc63d'] as const;
const BUBBLE_BLUE = ['#bfe9ff', '#e6f7ff', '#a5dcf7'] as const;
const HEART_PINK = ['#ff8fb1', '#ff6f9c', '#ffb3c9'] as const;
const FIREFLY = ['#eaff6e', '#cdf249', '#fff2a0'] as const;
const VIOLET_FOG = ['#a98cf0', '#8f6fe0', '#c3a9ff'] as const;
// Vapour stays pale; the CRYSTALS carry saturation, because a near-white
// snowflake is invisible on the island's cream interiors.
const FROST_VAPOUR = ['#dffaff', '#b6ecf7', '#ffffff'] as const;
const FROST_CRYSTAL = ['#bfeffb', '#8fd6ea', '#eafaff'] as const;
const ARCADE = ['#4ff0ff', '#ff5ce0', '#ffe74f'] as const;
const CELESTIAL = ['#cfd8ff', '#a9b8ff', '#ffffff'] as const;
const SOLAR = ['#ffe9b0', '#ffd070', '#fff8e0'] as const;
const VOID_MOTE = ['#c4a6ff', '#9a74e8', '#e3d4ff'] as const;
const PASTEL = ['#ffc7de', '#ffe9b8', '#c9f2d4', '#bfe4ff', '#d9cdff'] as const;

// ─── Lightning ──────────────────────────────────────────────────────────────
//
// Electric Charge is the one effect that is STRUCTURE, not scatter: a bolt is
// a single connected channel, so it is drawn as SVG strokes with a dash-offset
// draw-on (`LightningEffect.tsx`) rather than as catalog pieces. What remains
// here is the part that IS particles — the tip and origin sparks — plus the
// shared cycle constant both halves are timed against, so the sparks can pop
// exactly when the leader arrives.

/** One shared cycle for the whole strike, so every delay stays in phase. */
export const STRIKE_CYCLE_S = 2.8;

/** One exactly-placed, exactly-timed strike spark. */
function strikeSpark(opts: {
  x: number;
  y: number;
  size: number;
  delay: number;
  layer: EffectLayer;
}): EffectPieceGroup {
  return {
    layer: opts.layer,
    count: 1,
    colors: ['#ffffff'],
    accent: 'rgba(112,214,255,0.7)',
    track: {},
    piece: {
      kind: 'glow-dot',
      sizePct: [opts.size, opts.size],
      xPct: [opts.x, opts.x],
      yPct: [opts.y, opts.y],
      opacity: [0.95, 0.95],
      animation: 'blobbi-fx-bolt-seg',
      durationS: [STRIKE_CYCLE_S, STRIKE_CYCLE_S],
      delayS: [opts.delay, opts.delay],
      timing: 'linear',
      fill: 'backwards',
    },
  };
}

/**
 * Every effect this package draws.
 *
 * Ordered as the catalogue is presented to players (common → mythic), which is
 * NOT the render order — that is `EFFECT_SLOT_ORDER`, resolved per Blobbi.
 */
export const BLOBBI_VISUAL_EFFECT_PRESETS: Readonly<
  Record<BlobbiVisualEffectId, BlobbiVisualEffectPreset>
> = {
  // ── ambient-particles ────────────────────────────────────────────────────

  'golden-sparkles': {
    id: 'golden-sparkles',
    slot: 'ambient-particles',
    displayName: 'Golden Sparkles',
    description:
      'A cheerful constellation of golden stars that twinkles and drifts around your Blobbi wherever it goes.',
    groups: [
      {
        // The rear stars are the larger ones: depth reads better when the
        // background layer is not simply a dimmer copy of the front.
        layer: 'behind',
        count: 5,
        colors: GOLD,
        accent: '#ffb800',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [5.5, 8],
          delayS: [0, 6],
          dyPct: [-52, -34],
          swayPct: [3, 7],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'star4',
          sizePct: [5, 8],
          xPct: [6, 94],
          yPct: [30, 82],
          opacity: [0.65, 0.9],
          animation: 'blobbi-fx-twinkle',
          durationS: [1.8, 3],
          delayS: [0, 2.4],
        },
      },
      {
        layer: 'front',
        count: 5,
        colors: GOLD,
        accent: '#ffb800',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [4.5, 7],
          delayS: [0, 5],
          dyPct: [-46, -28],
          swayPct: [2, 6],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'star4',
          sizePct: [2.6, 4.6],
          xPct: [10, 90],
          yPct: [26, 78],
          opacity: [0.75, 1],
          animation: 'blobbi-fx-twinkle',
          durationS: [1.4, 2.6],
          delayS: [0, 2],
        },
      },
    ],
  },

  'bubble-bliss': {
    id: 'bubble-bliss',
    slot: 'ambient-particles',
    displayName: 'Bubble Bliss',
    description:
      'A playful stream of shimmering bubbles that gently rises and pops around your Blobbi.',
    groups: [
      {
        layer: 'behind',
        count: 4,
        colors: BUBBLE_BLUE,
        accent: 'rgba(180,230,255,0.28)',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [6, 9],
          delayS: [0, 6],
          dyPct: [-64, -42],
          swayPct: [4, 9],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'bubble',
          sizePct: [7, 11],
          xPct: [10, 90],
          yPct: [40, 88],
          opacity: [0.42, 0.62],
          animation: 'blobbi-fx-bob',
          durationS: [2.6, 4],
          delayS: [0, 2],
        },
      },
      {
        layer: 'front',
        count: 5,
        colors: BUBBLE_BLUE,
        accent: 'rgba(180,230,255,0.3)',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [5, 8],
          delayS: [0, 6.5],
          dyPct: [-58, -36],
          swayPct: [3, 8],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'bubble',
          sizePct: [3.5, 7],
          xPct: [8, 92],
          yPct: [44, 92],
          opacity: [0.5, 0.75],
          animation: 'blobbi-fx-bob',
          durationS: [2.2, 3.6],
          delayS: [0, 2.4],
        },
      },
    ],
  },

  'love-burst': {
    id: 'love-burst',
    slot: 'ambient-particles',
    displayName: 'Love Burst',
    description:
      'Tiny glowing hearts appear around your Blobbi and float upward in warm little bursts of affection.',
    groups: [
      {
        layer: 'behind',
        count: 2,
        colors: HEART_PINK,
        accent: '#ff4f86',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [5, 7],
          // A long, wide delay spread is what makes this read as intermittent
          // bursts rather than a continuous cloud of hearts — with no timer and
          // no state, because the stagger is baked into the delays.
          delayS: [0, 7],
          dyPct: [-48, -32],
          swayPct: [3, 6],
          timing: 'ease-out',
        },
        piece: {
          kind: 'heart',
          sizePct: [5, 7.5],
          xPct: [18, 82],
          yPct: [46, 80],
          opacity: [0.5, 0.72],
          animation: 'blobbi-fx-twinkle',
          durationS: [2.4, 3.4],
          delayS: [0, 2],
        },
      },
      {
        layer: 'front',
        count: 6,
        colors: HEART_PINK,
        accent: '#ff4f86',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [4, 6.5],
          delayS: [0, 8],
          dyPct: [-44, -26],
          swayPct: [2, 6],
          timing: 'ease-out',
        },
        piece: {
          kind: 'heart',
          sizePct: [4, 8],
          xPct: [12, 88],
          yPct: [44, 86],
          opacity: [0.78, 1],
          animation: 'blobbi-fx-twinkle',
          durationS: [2, 3.2],
          delayS: [0, 2.2],
        },
      },
    ],
  },

  'firefly-friends': {
    id: 'firefly-friends',
    slot: 'ambient-particles',
    displayName: 'Firefly Friends',
    description:
      'A friendly circle of tiny fireflies follows your Blobbi, blinking softly as they wander through the air.',
    groups: [
      {
        // Orbit rather than drift: rotating the box-sized track is one animated
        // property and produces a genuine curved path, where a translate-based
        // wander would need waypoints per particle.
        layer: 'behind',
        count: 3,
        colors: FIREFLY,
        accent: 'rgba(150,205,60,0.6)',
        track: {
          animation: 'blobbi-fx-orbit',
          durationS: [17, 26],
          delayS: [0, 8],
          timing: 'linear',
        },
        piece: {
          kind: 'glow-dot',
          sizePct: [4.5, 6.5],
          xPct: [14, 86],
          yPct: [22, 70],
          opacity: [0.55, 0.8],
          animation: 'blobbi-fx-blink',
          durationS: [1.9, 3.4],
          delayS: [0, 3],
        },
      },
      {
        layer: 'front',
        count: 4,
        colors: FIREFLY,
        accent: 'rgba(150,205,60,0.65)',
        track: {
          animation: 'blobbi-fx-orbit',
          // Reversed and slower, so the two rings do not lock into one visual
          // wheel the way co-rotating rings do.
          direction: 'reverse',
          durationS: [20, 30],
          delayS: [0, 9],
          timing: 'linear',
        },
        piece: {
          kind: 'glow-dot',
          sizePct: [3, 5],
          xPct: [16, 84],
          yPct: [30, 84],
          opacity: [0.65, 0.95],
          animation: 'blobbi-fx-blink',
          durationS: [1.6, 3],
          delayS: [0, 3.4],
        },
      },
    ],
  },

  // ── ground-local ─────────────────────────────────────────────────────────

  'mystic-fog': {
    id: 'mystic-fog',
    slot: 'ground-local',
    displayName: 'Mystic Fog',
    description:
      'An enchanted veil of violet mist curls around your Blobbi, making every appearance feel mysterious.',
    groups: [
      {
        layer: 'behind',
        count: 4,
        colors: VIOLET_FOG,
        accent: 'rgba(120,90,200,0.30)',
        track: {
          animation: 'blobbi-fx-drift',
          durationS: [11, 17],
          delayS: [0, 8],
          dxPct: [-9, 9],
          dyPct: [-3, 3],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'fog',
          sizePct: [44, 72],
          xPct: [12, 88],
          yPct: [62, 86],
          opacity: [0.3, 0.46],
          animation: 'blobbi-fx-shimmer',
          durationS: [6, 10],
          delayS: [0, 5],
        },
      },
      {
        // The foreground veil crosses the lower body. Kept thinner and fainter
        // than the rear bank so it never turns the feet into a smudge.
        layer: 'front',
        count: 3,
        colors: VIOLET_FOG,
        accent: 'rgba(120,90,200,0.22)',
        track: {
          animation: 'blobbi-fx-drift',
          durationS: [13, 19],
          delayS: [0, 9],
          dxPct: [-11, 11],
          dyPct: [-2, 2],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'fog',
          sizePct: [32, 56],
          xPct: [10, 90],
          yPct: [76, 94],
          opacity: [0.22, 0.34],
          animation: 'blobbi-fx-shimmer',
          durationS: [7, 11],
          delayS: [0, 6],
        },
      },
      {
        // Enchantment motes glinting INSIDE the mist — the tell that this fog
        // is magical rather than meteorological. Slow, sparse, low.
        layer: 'front',
        count: 3,
        colors: ['#e6d8ff', '#cdb2ff', '#f2ecff'],
        accent: 'rgba(180,140,255,0.5)',
        track: {
          animation: 'blobbi-fx-drift',
          durationS: [9, 14],
          delayS: [0, 7],
          dxPct: [-6, 6],
          dyPct: [-3, 3],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'glow-dot',
          sizePct: [1.8, 3],
          xPct: [18, 82],
          yPct: [64, 88],
          opacity: [0.5, 0.8],
          animation: 'blobbi-fx-twinkle',
          durationS: [3.5, 5.5],
          delayS: [0, 4],
        },
      },
    ],
  },

  'frost-breath': {
    id: 'frost-breath',
    slot: 'ground-local',
    displayName: 'Frost Breath',
    description:
      'Cool crystal air swirls around your Blobbi, leaving tiny snowflakes and icy glimmers in its wake.',
    groups: [
      {
        layer: 'behind',
        count: 3,
        colors: FROST_VAPOUR,
        accent: 'rgba(170,225,240,0.28)',
        track: {
          animation: 'blobbi-fx-drift',
          durationS: [10, 15],
          delayS: [0, 7],
          dxPct: [-8, 8],
          dyPct: [-2, 2],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'fog',
          sizePct: [34, 52],
          xPct: [16, 84],
          yPct: [60, 82],
          opacity: [0.24, 0.36],
          animation: 'blobbi-fx-shimmer',
          durationS: [5.5, 9],
          delayS: [0, 4],
        },
      },
      {
        // Crystals SETTLE. Falling rather than rising is most of what keeps
        // this from reading as world weather: room snow falls through the whole
        // scene, while these appear at chest height and sink to the feet.
        layer: 'front',
        count: 6,
        colors: FROST_CRYSTAL,
        accent: '#4fb3cc',
        track: {
          animation: 'blobbi-fx-fall',
          durationS: [5.5, 9],
          delayS: [0, 7],
          dyPct: [20, 38],
          swayPct: [3, 8],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'star6',
          sizePct: [3.4, 6],
          xPct: [10, 90],
          yPct: [44, 70],
          opacity: [0.82, 1],
          animation: 'blobbi-fx-spin',
          durationS: [7, 12],
          delayS: [0, 4],
          timing: 'linear',
        },
      },
    ],
  },

  // ── body-overlay ─────────────────────────────────────────────────────────

  'pixel-glitch': {
    id: 'pixel-glitch',
    slot: 'body-overlay',
    displayName: 'Pixel Glitch',
    description:
      'Arcade pixels flicker around your Blobbi in a playful digital distortion from another dimension.',
    groups: [
      {
        // On `mid`: over the body, under the front accessories. The body itself
        // is never transformed or filtered — the fragments sit ON it, so the
        // silhouette, the face and any hat stay perfectly readable.
        layer: 'mid',
        count: 10,
        colors: ARCADE,
        accent: '#ffffff',
        track: { rotateDeg: [0, 0] },
        piece: {
          kind: 'pixel',
          sizePct: [2.4, 5.4],
          xPct: [14, 86],
          yPct: [18, 84],
          opacity: [0.5, 0.8],
          animation: 'blobbi-fx-glitch',
          durationS: [1.8, 3.4],
          delayS: [0, 3],
          // Discrete jumps, not a slide. This is the whole visual identity.
          timing: 'steps(1, end)',
          glitchXPct: [40, 120],
          glitchYPct: [30, 90],
        },
      },
      {
        layer: 'front',
        count: 4,
        colors: ARCADE,
        accent: '#ffffff',
        track: { rotateDeg: [0, 0] },
        piece: {
          kind: 'pixel',
          sizePct: [1.8, 3.4],
          xPct: [8, 92],
          yPct: [22, 88],
          opacity: [0.6, 0.9],
          animation: 'blobbi-fx-glitch',
          durationS: [1.6, 3],
          delayS: [0, 2.6],
          timing: 'steps(1, end)',
          glitchXPct: [60, 160],
          glitchYPct: [40, 110],
        },
      },
    ],
  },

  'electric-charge': {
    id: 'electric-charge',
    slot: 'body-overlay',
    displayName: 'Electric Charge',
    description:
      'Bright electric arcs crackle around your Blobbi with the energy of a fully charged arcade machine.',
    // The bolts themselves are SVG strokes drawn by `LightningEffect` on the
    // mid layer — see the module note above. These groups are the sparks that
    // ride the same 2.8 s cycle: a pair popping at each origin as the strike
    // leaves the ground, and one at each tip as the leader arrives.
    extraAnimations: ['blobbi-fx-bolt-draw', 'blobbi-fx-impact-flash'],
    groups: [
      // Left bolt (fires at 0.0s): origin cluster, then the tip.
      strikeSpark({ x: 30, y: 90, size: 2.6, delay: 0.02, layer: 'mid' }),
      strikeSpark({ x: 38, y: 89, size: 2, delay: 0.05, layer: 'mid' }),
      strikeSpark({ x: 29, y: 34, size: 2.4, delay: 0.2, layer: 'front' }),
      // Right bolt (fires half a cycle later).
      strikeSpark({ x: 70, y: 88, size: 2.2, delay: 1.42, layer: 'mid' }),
      strikeSpark({ x: 70, y: 38, size: 2.2, delay: 1.6, layer: 'front' }),
    ],
  },

  // ── aura ─────────────────────────────────────────────────────────────────

  'celestial-aura': {
    id: 'celestial-aura',
    slot: 'aura',
    displayName: 'Celestial Aura',
    description:
      'A radiant celestial halo surrounds your Blobbi while tiny stars orbit in a calm blue-violet glow.',
    groups: [
      {
        layer: 'behind',
        count: 1,
        colors: ['rgba(150,170,255,0.55)'],
        accent: 'rgba(110,120,230,0.22)',
        track: {},
        piece: {
          kind: 'halo',
          sizePct: [148, 148],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.6, 0.6],
          animation: 'blobbi-fx-pulse',
          durationS: [6.5, 6.5],
          delayS: [0, 0],
        },
      },
      {
        layer: 'behind',
        count: 4,
        colors: CELESTIAL,
        accent: 'rgba(160,180,255,0.5)',
        track: {
          animation: 'blobbi-fx-orbit',
          durationS: [19, 27],
          delayS: [0, 10],
          timing: 'linear',
        },
        piece: {
          kind: 'dot',
          sizePct: [3.2, 5],
          xPct: [8, 92],
          yPct: [16, 84],
          opacity: [0.6, 0.9],
          animation: 'blobbi-fx-twinkle',
          durationS: [2.4, 4],
          delayS: [0, 3],
        },
      },
      {
        layer: 'front',
        count: 3,
        colors: CELESTIAL,
        accent: 'rgba(160,180,255,0.5)',
        track: {
          animation: 'blobbi-fx-orbit',
          direction: 'reverse',
          durationS: [22, 30],
          delayS: [0, 11],
          timing: 'linear',
        },
        piece: {
          kind: 'star4',
          sizePct: [2.6, 4.2],
          xPct: [14, 86],
          yPct: [22, 80],
          opacity: [0.7, 1],
          animation: 'blobbi-fx-twinkle',
          durationS: [2, 3.4],
          delayS: [0, 2.6],
        },
      },
    ],
  },

  'solar-radiance': {
    id: 'solar-radiance',
    slot: 'aura',
    displayName: 'Solar Radiance',
    description:
      'Warm rays of miniature sunlight shine behind your Blobbi, filling the air with golden energy.',
    groups: [
      {
        // The rays are what separates this from Golden Sparkles: a rotating
        // structured light source rather than discrete twinkling motes.
        layer: 'behind',
        count: 1,
        colors: ['rgba(255,220,140,0.42)'],
        accent: 'rgba(255,196,90,0.26)',
        track: {},
        piece: {
          kind: 'rays',
          sizePct: [172, 172],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.68, 0.68],
          animation: 'blobbi-fx-spin',
          // Slow enough to read as radiance rather than as a spinning wheel.
          durationS: [34, 34],
          delayS: [0, 0],
          timing: 'linear',
        },
      },
      {
        layer: 'behind',
        count: 1,
        colors: ['rgba(255,231,170,0.6)'],
        accent: 'rgba(255,200,100,0.24)',
        track: {},
        piece: {
          kind: 'halo',
          sizePct: [130, 130],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.6, 0.6],
          animation: 'blobbi-fx-pulse',
          durationS: [5.5, 5.5],
          delayS: [0, 0],
        },
      },
      {
        layer: 'front',
        count: 5,
        colors: SOLAR,
        accent: '#ffbe55',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [6, 9],
          delayS: [0, 6],
          dyPct: [-40, -22],
          swayPct: [2, 5],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'dot',
          sizePct: [2.4, 4.2],
          xPct: [16, 84],
          yPct: [34, 78],
          opacity: [0.6, 0.85],
          animation: 'blobbi-fx-shimmer',
          durationS: [2.6, 4.4],
          delayS: [0, 3],
        },
      },
    ],
  },

  'void-whispers': {
    id: 'void-whispers',
    slot: 'aura',
    displayName: 'Void Whispers',
    description:
      'Dark cosmic motes and faint violet rings drift around your Blobbi as if the void itself were quietly listening.',
    groups: [
      {
        layer: 'behind',
        count: 1,
        colors: ['rgba(72,40,120,0.62)'],
        accent: 'rgba(40,20,70,0.30)',
        track: {},
        piece: {
          kind: 'halo',
          sizePct: [142, 142],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.58, 0.58],
          animation: 'blobbi-fx-pulse',
          durationS: [7, 7],
          delayS: [0, 0],
        },
      },
      {
        // The rings carry the LIGHT colour, not the dark one. A dark aura on a
        // dark room would otherwise vanish; the pale violet rim is what keeps
        // this legible against the mine and the night grade.
        layer: 'behind',
        count: 2,
        colors: ['#c4a6ff', '#a884f0'],
        accent: 'rgba(160,110,255,0.5)',
        track: {
          animation: 'blobbi-fx-inhale',
          durationS: [7, 10],
          delayS: [0, 5],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'ring',
          sizePct: [108, 132],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.4, 0.55],
          animation: 'blobbi-fx-shimmer',
          durationS: [4.5, 7],
          delayS: [0, 3],
        },
      },
      {
        layer: 'front',
        count: 6,
        colors: VOID_MOTE,
        accent: 'rgba(150,100,240,0.4)',
        track: {
          animation: 'blobbi-fx-inhale',
          durationS: [6, 9.5],
          delayS: [0, 7],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'dot',
          sizePct: [2.4, 4.4],
          xPct: [10, 90],
          yPct: [18, 86],
          opacity: [0.65, 0.9],
          animation: 'blobbi-fx-shimmer',
          durationS: [3, 5],
          delayS: [0, 3.5],
        },
      },
    ],
  },

  'rainbow-dream': {
    id: 'rainbow-dream',
    slot: 'aura',
    displayName: 'Rainbow Dream',
    description:
      'A dreamy ribbon of rainbow light and sparkling color dances gently around your Blobbi.',
    groups: [
      {
        // The colour cycling is a SLOW ROTATION of a fixed pastel gradient, not
        // a hue-rotate. A hue strobe is the exact thing a mythic cosmetic must
        // not be, and rotation gives the same shifting-colour impression at a
        // fraction of the visual cost.
        layer: 'behind',
        count: 1,
        colors: ['#ffffff'],
        accent: '#ffffff',
        track: {},
        piece: {
          kind: 'rainbow-ring',
          sizePct: [152, 152],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.56, 0.56],
          animation: 'blobbi-fx-spin',
          durationS: [26, 26],
          delayS: [0, 0],
          timing: 'linear',
        },
      },
      {
        layer: 'behind',
        count: 1,
        colors: ['rgba(255,214,236,0.5)'],
        accent: 'rgba(200,220,255,0.22)',
        track: {},
        piece: {
          kind: 'halo',
          sizePct: [122, 122],
          xPct: [50, 50],
          yPct: [50, 50],
          opacity: [0.5, 0.5],
          animation: 'blobbi-fx-pulse',
          durationS: [6, 6],
          delayS: [0, 0],
        },
      },
      {
        layer: 'front',
        count: 6,
        colors: PASTEL,
        accent: '#ffffff',
        track: {
          animation: 'blobbi-fx-rise',
          durationS: [5.5, 8.5],
          delayS: [0, 6],
          dyPct: [-38, -20],
          swayPct: [3, 7],
          timing: 'ease-in-out',
        },
        piece: {
          kind: 'star4',
          sizePct: [2.6, 4.8],
          xPct: [10, 90],
          yPct: [24, 80],
          opacity: [0.7, 0.95],
          animation: 'blobbi-fx-twinkle',
          durationS: [1.8, 3.2],
          delayS: [0, 2.8],
        },
      },
    ],
  },
};

/** Total piece count of a preset — the number the caps are checked against. */
export function presetPieceCount(preset: BlobbiVisualEffectPreset): number {
  return preset.groups.reduce((total, group) => total + group.count, 0);
}

/** Presentation metadata for one effect. Rarity and item identity are Island's. */
export interface BlobbiVisualEffectInfo {
  id: BlobbiVisualEffectId;
  slot: BlobbiEffectSlot;
  displayName: string;
  description: string;
  pieceCount: number;
}

/** Everything a UI needs to describe an effect, without exposing the presets. */
export function getBlobbiVisualEffectInfo(
  id: BlobbiVisualEffectId,
): BlobbiVisualEffectInfo {
  const preset = BLOBBI_VISUAL_EFFECT_PRESETS[id];
  return {
    id: preset.id,
    slot: EFFECT_SLOTS[id],
    displayName: preset.displayName,
    description: preset.description,
    pieceCount: presetPieceCount(preset),
  };
}
