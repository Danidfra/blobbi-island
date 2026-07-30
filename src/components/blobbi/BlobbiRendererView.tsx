/**
 * BlobbiRendererView — the PURE Blobbi renderer.
 *
 * Renders exclusively from explicit props: no Nostr hooks, no profile hooks,
 * no equipment subscriptions, no location/world knowledge. Remote players,
 * previews and the local-player wrapper (`CurrentBlobbiDisplay`) all end here.
 *
 * Geometry contract (docs/blobbi-renderer-contract.md):
 *  - ONE square renderer box per size token (`BLOBBI_RENDER_SIZE_CLASSES`,
 *    fixed px, no viewport breakpoints);
 *  - the body SVG fills the box exactly (absolute inset-0 + the SVG's own
 *    width/height 100% and square viewBox);
 *  - accessories position by percentages of the SAME box and size as a
 *    fraction of it ({@link ACCESSORY_BASE_PERCENT} × saved scale);
 *  - accessories paint in normalized layer order: behind-body placements,
 *    then the body, then front placements (see `accessory-normalize.ts`);
 *  - accessories may overflow the box; the renderer clips nothing.
 */
import { useMemo, type CSSProperties } from 'react';
import { loadBlobbiSvg } from '@/lib/loadBlobbiSvg';
import { applyGazeMarkup } from '@/blobbi/ui/lib/svg';
import { accessoryImagePath } from '@/lib/asset-paths';
import { cn } from '@/lib/utils';
import {
  BLOBBI_RENDER_SIZE_CLASSES,
  ACCESSORY_BASE_PERCENT,
  type BlobbiRenderSize,
} from './lib/blobbi-render-size';
import type { NormalizedAccessoryPlacement } from './lib/accessory-normalize';

/** The visual identity of a Blobbi — everything the pure renderer needs. */
export interface BlobbiRenderVisual {
  stage?: 'egg' | 'baby' | 'adult';
  adultType?: string;
  baseColor?: string;
  secondaryColor?: string;
  eyeColor?: string;
  /** Display name; used only for the title/tooltip. */
  name?: string;
}

export interface BlobbiRendererViewProps {
  visual: BlobbiRenderVisual;
  /**
   * Stable id namespace for the inline SVG's gradient/clip ids. Two rendered
   * Blobbis must never share an instance id (their gradients would collide).
   */
  instanceId: string;
  size?: BlobbiRenderSize;
  isSleeping?: boolean;
  /** Kept distinct from sleeping for the seated legacy prop; both close eyes. */
  eyesClosed?: boolean;
  facing?: 'front' | 'back';
  /** Normalized gaze direction (-1..1 per axis); undefined renders statically. */
  eyeOffset?: { x: number; y: number };
  /** Pre-normalized accessory placements (already sorted; see accessory-normalize). */
  accessories?: readonly NormalizedAccessoryPlacement[];
  className?: string;
  title?: string;
  onClick?: () => void;
  interactive?: boolean;
  /**
   * false adds the legacy circular gradient frame around the same geometry.
   * The box and body fill are identical in both modes — only decoration
   * differs.
   */
  transparent?: boolean;
}

/** Static (non-editing) accessory image, sized as a fraction of the box. */
function AccessoryPlacementView({ placement }: { placement: NormalizedAccessoryPlacement }) {
  return (
    <div
      className="absolute select-none pointer-events-none"
      data-accessory-code={placement.code}
      data-accessory-layer={placement.layer}
      style={{
        left: `${placement.xPercent}%`,
        top: `${placement.yPercent}%`,
        // The box is square, so identical width/height percentages stay square.
        width: ACCESSORY_BASE_PERCENT,
        height: ACCESSORY_BASE_PERCENT,
        transform: `translate(-50%, -50%) scale(${placement.scale}) rotate(${placement.rotationDeg}deg) ${placement.flipX ? 'scaleX(-1)' : ''}`,
        transformOrigin: 'center',
      }}
      title={placement.code}
    >
      <img
        src={placement.imageUrl}
        alt={placement.code}
        className="h-full w-full max-w-none object-contain"
        draggable={false}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          // Fallback chain for missing images: .webp -> .png -> hide.
          const webpPath = accessoryImagePath(placement.slot, placement.code, 'webp');
          const pngPath = accessoryImagePath(placement.slot, placement.code, 'png');
          if (!target.src.includes(webpPath)) {
            target.src = webpPath;
          } else if (!target.src.includes(pngPath)) {
            target.src = pngPath;
          } else {
            target.style.display = 'none';
          }
        }}
      />
    </div>
  );
}

/**
 * One accessory layer group (behind or in front of the body). Placements are
 * already sorted by the normalizer; DOM order is the paint order.
 */
export function AccessoryLayerView({
  placements,
  layer,
  className,
}: {
  placements: readonly NormalizedAccessoryPlacement[];
  layer: 'behind' | 'front';
  className?: string;
}) {
  const layerPlacements = placements.filter((p) => p.layer === layer);
  if (layerPlacements.length === 0) return null;

  return (
    <div
      className={cn('absolute inset-0 pointer-events-none', className)}
      data-accessory-layer-group={layer}
    >
      {layerPlacements.map((placement) => (
        <AccessoryPlacementView key={placement.id} placement={placement} />
      ))}
    </div>
  );
}

const clampGaze = (v: number): number => Math.max(-1, Math.min(1, v));

export function BlobbiRendererView({
  visual,
  instanceId,
  size = 'lg',
  isSleeping = false,
  eyesClosed = false,
  facing = 'front',
  eyeOffset,
  accessories = [],
  className,
  title,
  onClick,
  interactive = false,
  transparent = true,
}: BlobbiRendererViewProps) {
  const isRearFacing = facing === 'back';
  // A rear-facing Blobbi has no pupils in its markup at all, so gaze markup is
  // skipped outright rather than relying on `applyGazeMarkup` finding nothing.
  const gazeEnabled = eyeOffset !== undefined && !isRearFacing;

  const svgContent = useMemo(() => {
    try {
      const stage = visual.stage || 'baby';
      const adultType = stage === 'adult' ? visual.adultType || 'bloomi' : undefined;
      const customizedSvg = loadBlobbiSvg(
        stage,
        adultType,
        visual.baseColor,
        visual.secondaryColor,
        visual.eyeColor,
        isSleeping || eyesClosed,
        instanceId,
        isRearFacing ? 'rear' : 'front',
      );
      // When gaze is enabled, mark the pupils/highlights once so they can be
      // moved via CSS variables. Static contexts (no eyeOffset) keep the SVG
      // untouched, so previews/modals/cards render exactly as before.
      return gazeEnabled ? applyGazeMarkup(customizedSvg) : customizedSvg;
    } catch (err) {
      console.error('Failed to load Blobbi SVG:', err);
      return '';
    }
  }, [
    visual.stage,
    visual.adultType,
    visual.baseColor,
    visual.secondaryColor,
    visual.eyeColor,
    isSleeping,
    eyesClosed,
    instanceId,
    isRearFacing,
    gazeEnabled,
  ]);

  if (!svgContent) return null;

  // Gaze CSS variables on the body wrapper: only the pupils/highlights move
  // (via the injected `.blobbi-pupil` style), never the whole SVG.
  const gazeStyle: CSSProperties | undefined = eyeOffset
    ? ({
        ['--blobbi-eye-x' as string]: `${clampGaze(eyeOffset.x)}`,
        ['--blobbi-eye-y' as string]: `${clampGaze(eyeOffset.y)}`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={cn(
        'relative',
        // Decoration only — geometry is identical in both modes.
        !transparent && 'rounded-full blobbi-gradient-frame shadow-lg theme-transition',
        interactive &&
          (transparent
            ? 'cursor-pointer hover:scale-105 transition-all duration-200'
            : 'cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 blobbi-hover'),
        BLOBBI_RENDER_SIZE_CLASSES[size],
        className,
      )}
      data-blobbi-renderer=""
      data-blobbi-size={size}
      title={title}
      onClick={onClick}
    >
      <AccessoryLayerView placements={accessories} layer="behind" />
      {/* The body fills the renderer box exactly: the wrapper is inset-0 and
          the SVG carries width/height="100%" with its square viewBox
          (xMidYMid meet), so it neither distorts nor overflows. */}
      <div
        className="absolute inset-0"
        data-blobbi-body-box=""
        style={gazeStyle}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
      <AccessoryLayerView placements={accessories} layer="front" />
    </div>
  );
}
