/**
 * CurrentBlobbiDisplay — the LOCAL-PLAYER wrapper around the pure renderer.
 *
 * This component owns the data side: it resolves the current companion via
 * Nostr-backed hooks (`useBlobbis`, `useBlobbonautProfile`), fetches the local
 * player's equipped accessories, normalizes them, and hands everything to the
 * pure `BlobbiRendererView` as explicit props. Remote players do NOT go
 * through here — `RemoteBlobbiSprite` uses `BlobbiRendererView` directly, so
 * rendering someone else's Blobbi never subscribes to the local player's data.
 *
 * `visualOverride` remains supported for the info modal's read-only remote
 * preview (a single modal instance, where the extra local hooks are the
 * pre-existing behavior).
 *
 * Geometry lives entirely in the pure renderer: one square fixed-px box per
 * size token, shared by body and accessories (see lib/blobbi-render-size.ts
 * and docs/blobbi-renderer-contract.md).
 */
import { useRef } from "react";
import { useBlobbis } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import { cn } from "@/lib/utils";
import { BlobbiRendererView, type BlobbiRenderVisual } from "./BlobbiRendererView";
import { normalizeAccessoryPlacements } from "./lib/accessory-normalize";
import { useAccessoryManagement } from "./hooks/useAccessoryManagement";
import { BLOBBI_RENDER_SIZE_CLASSES, type BlobbiRenderSize } from "./lib/blobbi-render-size";

export interface CurrentBlobbiDisplayProps {
  className?: string;
  size?: BlobbiRenderSize;
  showFallback?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  transparent?: boolean;
  isSleeping?: boolean;
  eyesClosed?: boolean;
  showAccessories?: boolean;
  idSuffix?: string;
  /**
   * Normalized gaze direction (each axis roughly -1..1). When provided, the
   * Blobbi's face is nudged slightly toward this direction to convey "looking".
   * Undefined (the default) renders statically — used by previews/modals/cards.
   */
  eyeOffset?: { x: number; y: number };
  /**
   * Which way the character is turned. `"back"` renders the Blobbi seen from
   * behind: same body, colours, silhouette, limbs, accessories and particles,
   * with the face (eyes, pupils, mouth, nose/beak/whiskers, blush) not drawn.
   *
   * This is a semantic rendering mode, not a CSS trick — the SVG itself is
   * derived (`loadBlobbiSvg(..., 'rear')`), so nothing of the face survives in
   * the DOM and no mirroring is involved. Face-only accessories are hidden too
   * (see `REAR_VIEW_HIDDEN_SLOTS`).
   */
  facing?: "front" | "back";
  /** If provided, component renders THIS visual instead of the local companion. */
  visualOverride?: BlobbiRenderVisual & {
    pattern?: string;
    specialMark?: string;
  };
}

export function CurrentBlobbiDisplay({
  className,
  size = "lg",
  showFallback = true,
  onClick,
  interactive = false,
  transparent = false,
  isSleeping = false,
  eyesClosed = false,
  showAccessories = true,
  idSuffix,
  visualOverride,
  eyeOffset,
  facing = "front",
}: CurrentBlobbiDisplayProps) {
  const scopeIdRef = useRef<string>(
    idSuffix ??
    `bb-${(visualOverride?.name ?? 'blobbi')}-${Math.random().toString(36).slice(2, 8)}`
  );

  // Local-player data. These hooks are the reason this wrapper exists — the
  // pure renderer below must never call them.
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const { equipment } = useAccessoryManagement();

  const currentBlobbi = visualOverride
    ? null
    : (profile?.currentCompanion && blobbis
        ? blobbis.find((b) => b.id === profile.currentCompanion) ?? null
        : null);

  // A visualOverride without any colors renders nothing (legacy remote-preview
  // behavior: the caller refines the visual once relay data arrives).
  const overrideHasColors = !!(visualOverride?.baseColor || visualOverride?.secondaryColor);
  const visual: BlobbiRenderVisual | null = visualOverride
    ? (overrideHasColors ? visualOverride : null)
    : currentBlobbi
      ? {
          stage: currentBlobbi.stage,
          adultType: currentBlobbi.adultType,
          baseColor: currentBlobbi.baseColor,
          secondaryColor: currentBlobbi.secondaryColor,
          eyeColor: currentBlobbi.eyeColor,
          name: getBlobbiDisplayName(currentBlobbi),
        }
      : null;

  if (visual) {
    const displayName = currentBlobbi
      ? getBlobbiDisplayName(currentBlobbi)
      : (visualOverride?.name || 'Remote Blobbi');
    const stage = visual.stage || 'baby';
    const accessories = showAccessories
      ? normalizeAccessoryPlacements(equipment ?? [], { facing })
      : [];

    return (
      <BlobbiRendererView
        visual={visual}
        instanceId={scopeIdRef.current}
        size={size}
        isSleeping={isSleeping}
        eyesClosed={eyesClosed}
        facing={facing}
        eyeOffset={eyeOffset}
        accessories={accessories}
        transparent={transparent}
        interactive={interactive}
        onClick={onClick}
        className={className}
        title={`${displayName} - ${stage} stage${interactive ? ' (click to switch)' : ''}`}
      />
    );
  }

  // Fallback if enabled and no Blobbi/visual is available.
  if (showFallback && !currentBlobbi && !visualOverride) {
    const titleText = 'No Blobbi selected';
    const clickText = interactive ? ' (click to select)' : '';

    return (
      <div
        className={cn(
          "flex items-center justify-center",
          transparent
            ? interactive && "cursor-pointer hover:scale-105 transition-all duration-200"
            : cn(
                "rounded-full blobbi-card border-2 border-dashed border-purple-300 dark:border-purple-600 theme-transition",
                interactive && "cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-200",
              ),
          BLOBBI_RENDER_SIZE_CLASSES[size],
          className
        )}
        title={`${titleText}${clickText}`}
        onClick={onClick}
      >
        <span className={cn(
          "text-muted-foreground",
          size === "sm" && "text-lg",
          size === "md" && "text-2xl",
          size === "lg" && "text-3xl",
          size === "xl" && "text-4xl",
          (size === "2xl" || size === "3xl") && "text-5xl"
        )}>
          🥚
        </span>
      </div>
    );
  }

  // No fallback and no Blobbi (or an override waiting for colors).
  return null;
}
