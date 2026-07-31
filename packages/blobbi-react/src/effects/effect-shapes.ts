/**
 * The DRAWING ATOMS effects are built from.
 *
 * Twelve effects, but only thirteen shapes — because an effect is mostly a
 * choice of shape, palette, count and timing, and keeping the shape vocabulary
 * small is what stops "add an effect" from meaning "add a renderer".
 *
 * Every shape is pure CSS on a single `<div>`: `background`, `border-radius`,
 * `clip-path` or a mask. No SVG element, no `<canvas>`, no filter chain beyond
 * a small blur on the two fog shapes. That is deliberate:
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
  | 'bolt'
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

/** A lightning bolt: down-right, kink, down-left. */
const BOLT_POLYGON =
  'polygon(46% 0%, 68% 0%, 54% 42%, 74% 42%, 32% 100%, 44% 56%, 24% 56%)';

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
      // actually reads, and what makes a firefly look lit rather than painted.
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle, #ffffff 0%, ${color} 38%, ${accent} 58%, transparent 74%)`,
      };

    case 'star4':
      return { clipPath: STAR4_POLYGON, background: color };

    case 'star6':
      return { clipPath: STAR6_POLYGON, background: color };

    case 'bubble':
      // Rim + off-centre highlight. The highlight is what sells "bubble"; a
      // plain translucent circle reads as a dot.
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.35) 14%, ${color} 42%, ${accent} 68%, transparent 74%)`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.55)`,
      };

    case 'heart':
      return {
        clipPath: HEART_POLYGON,
        background: `linear-gradient(160deg, ${color} 0%, ${accent} 100%)`,
      };

    case 'bolt':
      return {
        clipPath: BOLT_POLYGON,
        background: `linear-gradient(180deg, #ffffff 0%, ${color} 28%, ${accent} 100%)`,
      };

    case 'pixel':
      // No radius, no gradient: an arcade fragment is a flat square, and any
      // softening immediately makes it look like a bokeh mote instead.
      return { background: color };

    case 'ring':
      return {
        borderRadius: '50%',
        border: `1.5px solid ${color}`,
        boxShadow: `0 0 6px ${accent}`,
      };

    case 'halo':
      return {
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${accent} 42%, transparent 70%)`,
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
      return {
        borderRadius: '50%',
        background: `radial-gradient(ellipse at center, ${color} 0%, ${accent} 38%, transparent 68%)`,
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
        background: `conic-gradient(from 0deg, #ffb3c7, #ffd9a0, #fff3a8, #b8f0c4, #a8e0ff, #c9b8ff, #f2b8ef, #ffb3c7)`,
        maskImage: mask,
        WebkitMaskImage: mask,
      };
    }
  }
}
