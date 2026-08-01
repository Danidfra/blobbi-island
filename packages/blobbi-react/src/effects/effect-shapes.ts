/**
 * The DRAWING ATOMS effects are built from.
 *
 * Twelve effects, but only twelve shapes — because an effect is mostly a
 * choice of shape, palette, count and timing, and keeping the shape vocabulary
 * small is what stops "add an effect" from meaning "add a renderer". (The one
 * exception proves the rule: lightning is a connected channel, not a particle,
 * and has its own structural renderer in `LightningEffect.tsx`.)
 *
 * Every shape is pure CSS on a single `<div>`: `background`, `border-radius`,
 * `clip-path`, a mask, and where a shape needs light, a small `drop-shadow` or
 * `box-shadow` bloom. No SVG element, no `<canvas>`, and no `blur()` beyond the
 * small one on fog. That is deliberate:
 *
 *  - an SVG shape would need ids, and ids collide between instances (the exact
 *    problem `uniquifySvgIds` exists to solve for the body);
 *  - `clip-path` with PERCENTAGE polygons scales with the element, so one
 *    definition works at a 32 px box and at a 288 px box;
 *  - `background`/`clip-path`/`transform`/`opacity` are the properties a
 *    browser can animate on the compositor without re-layout.
 *
 * Sizes are never in pixels. A piece's width and height are percentages of the
 * renderer box, so an effect is the same effect at every size token — which is
 * the same rule the accessory layer already follows
 * (`ACCESSORY_BASE_PERCENT`).
 */
import type { CSSProperties } from 'react';

/** The shape vocabulary. */
export type EffectPieceKind =
  | 'dot'
  | 'glow-dot'
  | 'star4'
  | 'star6'
  | 'bubble'
  | 'heart'
  | 'pixel'
  | 'ring'
  | 'halo'
  | 'rays'
  | 'fog'
  | 'rainbow-ring';

/**
 * A four-point sparkle. The classic "twinkle" star: long thin points with a
 * pinched waist, which is what distinguishes it from a plus sign.
 */
const STAR4_POLYGON =
  'polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)';

/** A six-point crystal, for frost. Shorter points than the sparkle, so it
 *  reads as a snowflake glimmer rather than a star. */
const STAR6_POLYGON =
  'polygon(50% 0%, 58% 35%, 93% 25%, 68% 50%, 93% 75%, 58% 65%, 50% 100%, 42% 65%, 7% 75%, 32% 50%, 7% 25%, 42% 35%)';

/**
 * A heart, sampled at 22 points from the standard cardioid
 * `x = 16sin³t, y = 13cos t − 5cos2t − 2cos3t − cos4t` and normalized to the
 * 0–100 % box. Sampled rather than hand-drawn so the lobes are symmetric and
 * the point is actually centered — both are obvious when it is wrong at 8 px.
 */
const HEART_POLYGON =
  'polygon(50% 24%, 51% 18%, 58% 7%, 72% 0%, 89% 4%, 100% 18%, 100% 37%, 89% 55%, 72% 71%, 58% 85%, 51% 96%, 50% 100%, 49% 96%, 42% 85%, 28% 71%, 11% 55%, 0% 37%, 0% 18%, 11% 4%, 28% 0%, 42% 7%, 49% 18%)';

/**
 * Build the CSS for one piece.
 *
 * `color` is the piece's own (deterministically picked) colour; `accent` is the
 * effect's secondary colour, used by the shapes that need two.
 */
export function pieceShapeStyle(
  kind: EffectPieceKind,
  color: string,
  accent: string,
): CSSProperties {
  switch (kind) {
    case 'dot':
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color} 32%, transparent 72%)`,
      };

    case 'glow-dot':
      // A hot white core inside a coloured bloom — how a small light source
      // actually reads — with a halo thrown PAST the element by box-shadow, so
      // the light appears to land on the air around the firefly rather than
      // stopping at its own edge.
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle, #ffffff 0%, ${color} 38%, ${accent} 58%, transparent 74%)`,
        boxShadow: `0 0 7px 1px ${accent}`,
      };

    case 'star4':
      // A hot white heart cooling to the effect's colour at the points, with a
      // soft bloom that follows the star's own silhouette. The bloom is what
      // turns a flat polygon into a light source.
      return {
        clipPath: STAR4_POLYGON,
        background: `radial-gradient(circle, #ffffff 0%, ${color} 48%, ${accent} 100%)`,
        filter: `drop-shadow(0 0 2px ${accent})`,
      };

    case 'star6':
      return {
        clipPath: STAR6_POLYGON,
        background: `linear-gradient(180deg, #ffffff 0%, ${color} 55%, ${accent} 100%)`,
        filter: `drop-shadow(0 0 2px ${color})`,
      };

    case 'bubble':
      // Rim + off-centre highlight + a faint second glint low on the opposite
      // side. The paired highlights are what read as a curved film catching
      // light from one side and bouncing it off the other; the soft violet in
      // the inset rim is the soap-film iridescence, kept just under conscious
      // notice.
      return {
        borderRadius: '50%',
        background: [
          `radial-gradient(circle at 68% 74%, rgba(190,255,225,0.35) 0%, transparent 26%)`,
          `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 14%, ${color} 42%, ${accent} 68%, transparent 74%)`,
        ].join(', '),
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.6), inset -2px -3px 4px rgba(150,150,255,0.28)`,
      };

    case 'heart':
      // Candy-glass: a specular glint on the upper-left lobe over the warm
      // gradient, plus a pink bloom following the heart's outline.
      return {
        clipPath: HEART_POLYGON,
        background: [
          `radial-gradient(circle at 30% 26%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 30%)`,
          `linear-gradient(160deg, ${color} 0%, ${accent} 100%)`,
        ].join(', '),
        filter: `drop-shadow(0 0 3px ${accent})`,
      };

    case 'pixel':
      // Still a flat square — softening the fill would turn it into a bokeh
      // mote — but a CRT square: a tight neon halo in its own colour plus a
      // magenta/cyan pair offset one step to either side, the classic RGB
      // channel mis-registration of a glitching arcade monitor.
      return {
        background: color,
        boxShadow: `0 0 5px ${color}, 2px 1px 0 rgba(255,92,224,0.4), -2px -1px 0 rgba(79,240,255,0.4)`,
      };

    case 'ring':
      // Lit from both faces: an outer cast and an inner wash, so the ring
      // reads as a band of light rather than a stroked circle.
      return {
        borderRadius: '50%',
        border: `2px solid ${color}`,
        boxShadow: `0 0 9px ${accent}, inset 0 0 7px ${accent}`,
      };

    case 'halo':
      // A held bright core, then the falloff: the flat inner plateau (0–22%)
      // is what gives the halo a luminous heart instead of a single smeared
      // gradient peak.
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color} 22%, ${accent} 48%, transparent 70%)`,
      };

    case 'rays': {
      // A conic gradient of alternating light wedges, faded out at the rim by a
      // mask so it dissolves into the room instead of ending on a hard circle.
      const mask = 'radial-gradient(circle, #000 18%, rgba(0,0,0,0.55) 46%, transparent 72%)';
      return {
        borderRadius: '50%',
        background: `conic-gradient(from 0deg, ${color} 0deg, transparent 22deg, transparent 45deg, ${accent} 60deg, transparent 82deg, transparent 105deg, ${color} 120deg, transparent 142deg, transparent 165deg, ${accent} 180deg, transparent 202deg, transparent 225deg, ${color} 240deg, transparent 262deg, transparent 285deg, ${accent} 300deg, transparent 322deg, transparent 345deg, ${color} 360deg)`,
        maskImage: mask,
        WebkitMaskImage: mask,
      };
    }

    case 'fog':
      // Three offset lobes rather than one ellipse: real fog is lumpy, and two
      // displaced sub-clouds inside the same element give each bank internal
      // structure that the drift animation then parallaxes for free.
      return {
        borderRadius: '50%',
        background: [
          `radial-gradient(ellipse 55% 45% at 32% 62%, ${color} 0%, transparent 70%)`,
          `radial-gradient(ellipse 50% 42% at 70% 40%, ${accent} 0%, transparent 72%)`,
          `radial-gradient(ellipse at center, ${color} 0%, ${accent} 40%, transparent 68%)`,
        ].join(', '),
        // 3px, not 30px. A large blur radius forces a paint region far bigger
        // than the element and is the single most expensive thing a decorative
        // layer can ask for (see the audit, §2.4).
        filter: 'blur(3px)',
      };

    case 'rainbow-ring': {
      // A ribbon, not a disc: the mask cuts the middle out so the body stays
      // readable through it, and softens both edges so the band has no seam.
      const mask =
        'radial-gradient(closest-side, transparent 54%, rgba(0,0,0,0.65) 63%, #000 74%, rgba(0,0,0,0.6) 88%, transparent 100%)';
      return {
        borderRadius: '50%',
        background: `conic-gradient(from 0deg, #ffb3c7, #ffc9a8, #ffe3a0, #fdf2ac, #d8f2b8, #b0ecd0, #a8e2f2, #a8ccff, #c0b8ff, #dcb4f6, #f4b2e4, #ffb3c7)`,
        maskImage: mask,
        WebkitMaskImage: mask,
      };
    }
  }
}
