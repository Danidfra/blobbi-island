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
 * ACCESSORY OWNERSHIP. Accessories follow the visual, never the component:
 *
 *   no `visualOverride`                    → local companion + local equipment
 *   `visualOverride`, no `accessoryOverride` → that visual, wearing nothing
 *   `visualOverride` + `accessoryOverride` → that visual, wearing exactly those
 *
 * The middle row is a deliberate behavior change (Phase 5). Previously the
 * local player's equipment was drawn on top of ANY visual, so the info modal's
 * read-only preview of another player's Blobbi rendered it wearing *your* hats.
 * Accessories are not a property of "the local user"; they are a property of
 * the Blobbi being drawn, and a caller that does not supply them does not have
 * them. Fetching another player's equipment is out of scope — the honest render
 * of "unknown equipment" is none.
 *
 * Geometry lives entirely in the pure renderer: one square fixed-px box per
 * size token, shared by body and accessories (see lib/blobbi-render-size.ts
 * and docs/blobbi-renderer-contract.md).
 */
import { useId } from "react";
import { useBlobbis } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import { cn } from "@/lib/utils";
import {
  BlobbiRendererView,
  BLOBBI_RENDER_SIZE_CLASSES,
  DEFAULT_STAGE,
  normalizeAccessoryPlacements,
  type AccessoryPlacementInput,
  type BlobbiRenderSize,
  type BlobbiRenderVisual,
} from "@blobbi/react";
import { islandAccessorySources } from "./lib/island-accessory-sources";
import { useAccessoryManagement } from "./hooks/useAccessoryManagement";

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
  /**
   * Accessories to draw on a {@link visualOverride}. Plain, serializable data —
   * the caller states what that Blobbi is wearing.
   *
   * Meaningful ONLY alongside `visualOverride`: without an override the local
   * companion's own equipment is authoritative and this prop is ignored, so it
   * can never be used to dress the local Blobbi in something it does not own.
   * With an override and no value here, the Blobbi wears nothing (see the
   * ownership table in the module doc).
   */
  accessoryOverride?: readonly AccessoryPlacementInput[];
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
  accessoryOverride,
  eyeOffset,
  facing = "front",
}: CurrentBlobbiDisplayProps) {
  // SVG id namespace for this instance. A caller-supplied `idSuffix` always
  // wins — remote actors and tests depend on a stable, meaningful id.
  //
  // The fallback is `useId()` rather than `Math.random()`: React guarantees it
  // is unique per component instance AND identical between a server render and
  // its hydration, so multiple Blobbis on one page still cannot share gradient
  // ids while the renderer stays safe to server-render later. (`useId` returns
  // e.g. `:r3:`; the punctuation is normalized away by the render model.)
  const generatedId = useId();
  const scopeId = idSuffix ?? `bb${generatedId}`;

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
    // The renderer resolves its own stage; this is only the tooltip's copy of
    // the same answer, so it reads the shared default instead of restating it.
    const stage = visual.stage || DEFAULT_STAGE;
    // Accessories follow the VISUAL. An override draws only what the caller
    // explicitly handed over; the local player's equipment is reachable solely
    // on the local-companion path. See the ownership table in the module doc.
    const wornAccessories = visualOverride ? accessoryOverride : equipment;
    const accessories = showAccessories
      ? normalizeAccessoryPlacements(wornAccessories ?? [], {
          facing,
          resolveSources: islandAccessorySources,
        })
      : [];

    return (
      <BlobbiRendererView
        visual={visual}
        instanceId={scopeId}
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
