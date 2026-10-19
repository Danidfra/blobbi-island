/**
 * BlobbiActor: the shared Island-side actor primitive (Phase 2).
 *
 * One implementation of the GROUND-ANCHOR geometry for both the local player
 * (`MovableBlobbi`) and remote players (`RemoteBlobbiSprite`), replacing the
 * previously duplicated wrapper/shadow markup. For the same inputs, local and
 * remote actors produce identical anchor, scale, shadow, and pose geometry.
 *
 * Ground-anchor contract (src/lib/blobbi-ground.ts):
 *
 *   ANCHOR div      left/top = stored ground point; translate(-50%, -100%)
 *   │               → the anchor box's BOTTOM-CENTER sits exactly on the
 *   │                 stored world-percent position. Unscaled: it is the
 *   │                 chat-bubble portal host and label anchor.
 *   ├── SCALE RIG   transform: scale(depth × seat); origin: bottom center
 *   │   │           → scaling never moves the feet off the stored point.
 *   │   ├── SHADOW  on the DRAWING'S ground line, under its footprint (the
 *   │   │           body reports both, `actor-artwork-context.ts`); first in
 *   │   │           paint order, so it is always behind the body; inside the
 *   │   │           rig, so depth scales it with the body; outside the float
 *   │   │           wrapper, so the bob never lifts it (it breathes in step
 *   │   │           instead, `animate-shadow-float`); hidden while seated.
 *   │   └── FLOAT   animate-float for a body that floats (a baby; an adult
 *   │       │       stands, `blobbi-stage-motion.ts`), suppressed when
 *   │       │       sleeping/seated/moving-config; and the body's soft drop
 *   │       │       shadow (never the ground shadow's, never the label's)
 *   │       └── children (the pure renderer / local wrapper)
 *   ├── labelSlot   (remote name labels)
 *   └── debug markers (dev-only, via DebugOverlaysContext)
 *
 * This component owns NO input capture, movement state, presence logic,
 * boundary selection, or Nostr publishing; those stay in its two wrappers.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import type { GroundPosition } from '@/lib/blobbi-ground';
import { DEFAULT_GROUND_SHADOW, GROUND_SHADOW_ASPECT, sameGroundShadow, type GroundShadowGeometry } from '@/lib/blobbi-ground-shadow';
import type { BlobbiRenderSize } from '@blobbi-kit/renderer';
import { ActorArtworkContext, type ActorArtworkReport, type ReportActorArtwork } from './actor-artwork-context';

/**
 * The ground shadow: a soft pool in the Island's ink, darkest under the
 * middle of the contact and gone well before its edge. One gradient for every
 * size, form and distance, so the look is one look.
 */
const GROUND_SHADOW_BACKGROUND =
  'radial-gradient(ellipse at center, hsl(var(--island-ink) / 0.26) 0%, hsl(var(--island-ink) / 0.14) 40%, hsl(var(--island-ink) / 0) 72%)';

/** The body's own soft drop shadow: inside the rig, so it scales with depth like everything about the body. */
const BODY_DROP_SHADOW = 'drop-shadow(0 6px 12px hsl(var(--island-ink) / 0.16))';

export interface BlobbiActorProps {
  /** World-percent GROUND point the actor stands on. */
  position: GroundPosition;
  size: BlobbiRenderSize;
  /** Combined visual scale (depth × seat) applied to the rig around bottom-center. */
  scale: number;
  zIndex: number;
  /** DOM id for the anchor (chat-bubble portal target). */
  anchorId?: string;
  /** data-player-key value for remote actors. */
  playerKey?: string;
  /** Seat id (data attribute only, presentation is driven by props). */
  seatedIn?: string | null;
  /** Hiding-spot id (data attribute; pair with `visualHidden`). */
  hiddenIn?: string | null;
  /**
   * Paint nothing (sprite, shadow) while keeping the positioned anchor mounted,
   * the hiding-spot presentation. Input/portal behavior stays alive.
   */
  visualHidden?: boolean;
  hideShadow?: boolean;
  disableFloat?: boolean;
  /** Suppresses the position transition while animating per-frame. */
  isMoving?: boolean;
  /**
   * Ease non-walk repositions over 200ms (local actor behavior). Remote actors
   * pass false: their positions are integrated per-frame.
   */
  positionTransition?: boolean;
  className?: string;
  /** Extra name-label / overlay content anchored to the actor. */
  labelSlot?: React.ReactNode;
  children: React.ReactNode;
}

export const BlobbiActor = React.forwardRef<HTMLDivElement, BlobbiActorProps>(
  (
    {
      position,
      size,
      scale,
      zIndex,
      anchorId,
      playerKey,
      seatedIn,
      hiddenIn,
      visualHidden = false,
      hideShadow = false,
      disableFloat = false,
      isMoving = false,
      positionTransition = true,
      className,
      labelSlot,
      children,
    },
    ref,
  ) => {
    const { showDebugOverlays } = useDebugOverlays();

    // What the body is, as the body reports it (see actor-artwork-context):
    // standing on the box's bottom edge, and floating, until it has said
    // otherwise. The float is the baby's (`stageFloats`); an adult stands.
    const [reported, setReported] = useState<ActorArtworkReport | null>(null);
    const report = useCallback<ReportActorArtwork>((next) => {
      setReported((current) => (current === next || (current && next && current.floats === next.floats && sameGroundShadow(current.shadow, next.shadow)) ? current : next));
    }, []);
    const shadow: GroundShadowGeometry = reported?.shadow ?? DEFAULT_GROUND_SHADOW;
    const floats = !disableFloat && (reported?.floats ?? true);
    const shadowStyle = useMemo<React.CSSProperties>(
      () => ({
        left: `${shadow.centerX * 100}%`,
        top: `${shadow.groundY * 100}%`,
        width: `${shadow.width * 100}%`,
        height: `${shadow.width * GROUND_SHADOW_ASPECT * 100}%`,
        background: GROUND_SHADOW_BACKGROUND,
        transform: 'translate(-50%, -50%)',
        transformOrigin: 'center center',
      }),
      [shadow],
    );

    return (
      <div
        ref={ref}
        id={anchorId}
        data-player-key={playerKey}
        data-blobbi-actor=""
        data-visual-hidden={visualHidden ? 'true' : undefined}
        data-seated-in={seatedIn ?? undefined}
        data-hidden-in={hiddenIn ?? undefined}
        // The day/night world grade darkens environment sprites at night. The
        // Blobbi is not scenery: its body is inline SVG but its accessory
        // overlays ARE <img> elements. See the opt-out contract in src/index.css.
        data-island-world-grade="exclude"
        className={cn(
          'absolute blobbi-character',
          positionTransition && 'transition-all duration-200 ease-out',
          isMoving && 'transition-none',
          className,
        )}
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          // Ground anchor: the box's bottom-center sits on the stored point.
          // The anchor itself is NEVER scaled (bubble portal + label host).
          transform: 'translate(-50%, -100%)',
          zIndex,
        }}
      >
        {!visualHidden && (
          <ActorArtworkContext.Provider value={report}>
            {/* Scale rig: depth × seat scaling around BOTTOM CENTER, so the
                feet stay planted on the stored ground point at every scale. */}
            <div
              className="relative"
              data-blobbi-scale-rig=""
              data-blobbi-size={size}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'bottom center',
              }}
            >
              {/* Ground shadow: on the drawing's ground line, under its
                  footprint; first, so the body paints over it; sized as a
                  fraction of the box, so every size and form gets the same
                  proportion; inside the rig, so depth scales it with the
                  body; outside the float wrapper, so the bob never lifts it. */}
              {!hideShadow && (
                <div
                  data-blobbi-shadow=""
                  aria-hidden
                  className={cn('pointer-events-none absolute rounded-[50%]', floats && 'animate-shadow-float')}
                  style={shadowStyle}
                />
              )}
              <div
                className={cn(
                  'relative',
                  floats && 'animate-float',
                  'transition-transform duration-1000 ease-in-out',
                )}
                data-blobbi-body=""
                data-blobbi-floats={floats ? 'true' : 'false'}
                style={{ filter: BODY_DROP_SHADOW }}
              >
                {children}
              </div>
            </div>
          </ActorArtworkContext.Provider>
        )}
        {labelSlot}
        {showDebugOverlays && (
          <div className="pointer-events-none absolute inset-0" data-blobbi-actor-debug="">
            {/* Actor box outline */}
            <div className="absolute inset-0 border border-cyan-400/70" />
            {/* Ground-point crosshair at the anchor's bottom-center */}
            <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 bg-red-500/40" />
            <div className="absolute left-1/2 top-full h-px w-6 -translate-x-1/2 bg-red-500" />
            {/* Readout */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1 text-[9px] leading-tight text-white">
              g({position.x.toFixed(1)}, {position.y.toFixed(1)}) ×{scale.toFixed(2)} z{zIndex}
            </div>
          </div>
        )}
      </div>
    );
  },
);

BlobbiActor.displayName = 'BlobbiActor';
