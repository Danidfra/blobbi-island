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
 *   │   └── FLOAT   animate-float (suppressed when sleeping/seated/moving-config)
 *   │       └── children (the pure renderer / local wrapper)
 *   ├── SHADOW      centered ON the ground point; width scales with depth;
 *   │               never inherits the float bob; hidden while seated/hidden.
 *   ├── labelSlot   (remote name labels)
 *   └── debug markers (dev-only, via DebugOverlaysContext)
 *
 * This component owns NO input capture, movement state, presence logic,
 * boundary selection, or Nostr publishing; those stay in its two wrappers.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { useDebugOverlays } from '@/contexts/DebugOverlaysContext';
import type { GroundPosition } from '@/lib/blobbi-ground';
import type { BlobbiRenderSize } from '@blobbi/react';

/** Fixed shadow widths per size (previous desktop `md:` values; no breakpoints). */
const SHADOW_WIDTH_CLASSES: Record<BlobbiRenderSize, string> = {
  sm: 'w-4',
  md: 'w-6',
  lg: 'w-8',
  xl: 'w-10',
  '2xl': 'w-16',
  '3xl': 'w-20',
};

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
          filter: visualHidden ? undefined : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.15))',
          zIndex,
        }}
      >
        {!visualHidden && (
          <>
            {/* Scale rig: depth × seat scaling around BOTTOM CENTER, so the
                feet stay planted on the stored ground point at every scale. */}
            <div
              className="relative"
              data-blobbi-scale-rig=""
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'bottom center',
              }}
            >
              <div
                className={cn(
                  !disableFloat && 'animate-float',
                  'transition-transform duration-1000 ease-in-out',
                )}
              >
                {children}
              </div>
            </div>
            {/* Ground shadow: CENTERED on the ground point (anchor bottom-
                center), outside the scale rig so it never inherits the float
                bob; its own width scales with depth. */}
            {!hideShadow && (
              <div
                data-blobbi-shadow=""
                className={cn(
                  'absolute top-full left-1/2 h-1.5 rounded-full',
                  SHADOW_WIDTH_CLASSES[size],
                )}
                style={{
                  background:
                    'radial-gradient(ellipse, rgba(0, 0, 0, 0.2) 0%, transparent 70%)',
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  transformOrigin: 'center center',
                }}
              />
            )}
          </>
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
