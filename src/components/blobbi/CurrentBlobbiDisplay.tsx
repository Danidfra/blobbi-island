import { useState, useEffect, useRef, type CSSProperties } from "react";
import { loadBlobbiSvg } from "@/lib/loadBlobbiSvg";
import { applyGazeMarkup } from "@/blobbi/ui/lib/svg";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { getBlobbiDisplayName } from "@/lib/blobbi-legacy";
import { AccessoryOverlay } from "./AccessoryOverlay";
import { cn } from "@/lib/utils";

export interface CurrentBlobbiDisplayProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showFallback?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  transparent?: boolean;
  isSleeping?: boolean;
  eyesClosed?: boolean;
  showAccessories?: boolean;
  accessorySizeMultiplier?: number; // Add prop to pass custom size multiplier
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
  /** New: if provided, component renders THIS visual instead of fetching local hooks */
  visualOverride?: {
    name?: string;
    baseColor?: string;
    secondaryColor?: string;
    eyeColor?: string;
    pattern?: string;
    specialMark?: string;
    stage?: "egg" | "baby" | "adult";
    adultType?: string;
  };
}

const sizeClasses = {
  sm: "h-8 w-8 md:h-10 md:w-10",
  md: "h-12 w-12 md:h-16 md:w-16",
  lg: "h-16 w-16 md:h-20 md:w-20",
  xl: "h-24 w-24 md:h-32 md:w-32"
};

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
  accessorySizeMultiplier,
  idSuffix,
  visualOverride,
  eyeOffset,
  facing = "front",
}: CurrentBlobbiDisplayProps) {
  const scopeIdRef = useRef<string>(
    idSuffix ??
    `bb-${(visualOverride?.name ?? 'blobbi')}-${Math.random().toString(36).slice(2,8)}`
  );
  const isRearFacing = facing === "back";
  // Whether this instance participates in eye-gaze. Stable boolean so the SVG
  // is only re-generated when gaze is toggled on/off, never per gaze update.
  // A rear-facing Blobbi has no pupils in its markup at all, so gaze is skipped
  // outright rather than relying on `applyGazeMarkup` finding nothing.
  const gazeEnabled = eyeOffset !== undefined && !isRearFacing;
  // Always run hooks, but only use data when needed (for local player)
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  const [svgContent, setSvgContent] = useState<string>("");
  const [currentBlobbi, setCurrentBlobbi] = useState<Blobbi | null>(null);

  // Only use local data for local player (when visualOverride is not provided)
  useEffect(() => {
    if (visualOverride) {
      // For remote players, don't use local data
      setCurrentBlobbi(null);
      return;
    }

    // For local player, find the current Blobbi
    if (currentCompanionId && blobbis) {
      const blobbi = blobbis.find(b => b.id === currentCompanionId);
      setCurrentBlobbi(blobbi || null);
    } else {
      setCurrentBlobbi(null);
    }
  }, [currentCompanionId, blobbis, visualOverride]);

  // Load the SVG for the current Blobbi or visual override
  useEffect(() => {
    let blobbiData: typeof currentBlobbi | typeof visualOverride;

    if (visualOverride) {
      // Use visualOverride data for remote players
      if (!visualOverride.baseColor && !visualOverride.secondaryColor) {
        setSvgContent("");
        return;
      }
      blobbiData = visualOverride;
    } else {
      // Use local data for local player only
      if (!currentBlobbi) {
        setSvgContent("");
        return;
      }
      blobbiData = currentBlobbi;
    }

    try {
      const stage = blobbiData.stage || 'baby';
      const adultType = stage === 'adult' ?
        blobbiData.adultType || 'bloomi' :
        undefined;

      const customizedSvg = loadBlobbiSvg(
        stage,
        adultType,
        blobbiData.baseColor,
        blobbiData.secondaryColor,
        blobbiData.eyeColor,
        isSleeping || eyesClosed, // Close eyes when either sleeping or seated with eyesClosed
        scopeIdRef.current,
        isRearFacing ? 'rear' : 'front',
      );

      // When gaze is enabled, mark the pupils/highlights once so they can be
      // moved via CSS variables. Static contexts (no eyeOffset) keep the SVG
      // untouched, so previews/modals/cards render exactly as before.
      setSvgContent(gazeEnabled ? applyGazeMarkup(customizedSvg) : customizedSvg);
    } catch (err) {
      console.error('Failed to load Blobbi SVG:', err);
      setSvgContent("");
    }
  }, [currentBlobbi, visualOverride, isSleeping, eyesClosed, gazeEnabled, isRearFacing]);

  // Calculate accessory size multiplier based on blobbi size or use custom multiplier
  const getAccessorySizeMultiplier = () => {
    if (accessorySizeMultiplier !== undefined) {
      return accessorySizeMultiplier;
    }
    switch (size) {
      case "sm": return 0.3;
      case "md": return 0.5;
      case "lg": return 0.7;
      case "xl": return 1.0;
      default: return 1.0;
    }
  };

  // Build the gaze CSS variables for the wrapper. These only set
  // `--blobbi-eye-x/y` (consumed by the injected `.blobbi-pupil` style), so
  // only the pupils/highlights move — not the whole SVG. Undefined eyeOffset
  // renders statically (no variables, no transition) so previews/modals/cards
  // are unaffected.
  const clampGaze = (v: number): number => Math.max(-1, Math.min(1, v));
  const gazeStyle: CSSProperties | undefined = eyeOffset
    ? ({
        ["--blobbi-eye-x" as string]: `${clampGaze(eyeOffset.x)}`,
        ["--blobbi-eye-y" as string]: `${clampGaze(eyeOffset.y)}`,
      } as CSSProperties)
    : undefined;

  // Show Blobbi SVG
  if (svgContent && (currentBlobbi || visualOverride)) {
    const blobbiData = (currentBlobbi || visualOverride)!;
    // For a local Blobbi, resolve the friendly user-facing name (never the raw
    // id/d-tag). For a remote visualOverride, the caller already resolved the
    // name, so use it as-is with a friendly fallback.
    const displayName = currentBlobbi
      ? getBlobbiDisplayName(currentBlobbi)
      : (visualOverride?.name || 'Remote Blobbi');
    const stage = blobbiData.stage || 'baby';

    // Transparent mode - show only the SVG without background
    if (transparent) {
      return (
        <div
          className={cn(
            "flex items-center justify-center relative",
            interactive && "cursor-pointer hover:scale-105 transition-all duration-200",
            sizeClasses[size],
            className
          )}
          title={`${displayName} - ${stage} stage${interactive ? ' (click to switch)' : ''}`}
          onClick={onClick}
        >
          <div
            className={cn(
              "flex items-center justify-center",
              size === "sm" && "h-6 w-6 md:h-8 md:w-8",
              size === "md" && "h-10 w-10 md:h-14 md:w-14",
              size === "lg" && "size-20 md:size-24",
              size === "xl" && "size-28 md:size-32"
            )}
            style={gazeStyle}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />

          {/* Accessory Overlay for transparent mode */}
          {showAccessories && (
            <AccessoryOverlay
              isStatic={true}
              facing={facing}
              sizeMultiplier={getAccessorySizeMultiplier()}
              className="absolute inset-0"
            />
          )}
        </div>
      );
    }

    // Default mode - show with background circle
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full blobbi-gradient-frame shadow-lg theme-transition relative",
          interactive && "cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 blobbi-hover",
          sizeClasses[size],
          className
        )}
        title={`${displayName} - ${stage} stage${interactive ? ' (click to switch)' : ''}`}
        onClick={onClick}
      >
        <div
          className={cn(
            "flex items-center justify-center",
            size === "sm" && "h-6 w-6 md:h-8 md:w-8",
            size === "md" && "h-10 w-10 md:h-14 md:w-14",
            size === "lg" && "h-14 w-14 md:h-18 md:w-18",
            size === "xl" && "h-20 w-20 md:h-28 md:w-28"
          )}
          style={gazeStyle}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />

        {/* Accessory Overlay for default mode */}
        {showAccessories && (
          <AccessoryOverlay
            isStatic={true}
            facing={facing}
            sizeMultiplier={getAccessorySizeMultiplier()}
            className="absolute inset-0"
          />
        )}
      </div>
    );
  }

  // Show fallback if enabled and no Blobbi/visual is selected
  if (showFallback && !currentBlobbi && !visualOverride) {
    const titleText = visualOverride ? 'Remote Blobbi' : 'No Blobbi selected';
    const clickText = interactive ? (visualOverride ? '' : ' (click to select)') : '';

    // Transparent mode fallback - show only the emoji without background
    if (transparent) {
      return (
        <div
          className={cn(
            "flex items-center justify-center",
            interactive && "cursor-pointer hover:scale-105 transition-all duration-200",
            sizeClasses[size],
            className
          )}
          title={`${titleText}${clickText}`}
          onClick={onClick}
        >
          <span className={cn(
            "text-muted-foreground",
            size === "sm" && "text-lg md:text-xl",
            size === "md" && "text-2xl md:text-3xl",
            size === "lg" && "text-3xl md:text-4xl",
            size === "xl" && "text-4xl md:text-5xl"
          )}>
            🥚
          </span>
        </div>
      );
    }

    // Default mode fallback - show with background circle
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full blobbi-card border-2 border-dashed border-purple-300 dark:border-purple-600 theme-transition",
          interactive && "cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-200",
          sizeClasses[size],
          className
        )}
        title={`${titleText}${clickText}`}
        onClick={onClick}
      >
        <span className={cn(
          "text-muted-foreground",
          size === "sm" && "text-lg md:text-xl",
          size === "md" && "text-2xl md:text-3xl",
          size === "lg" && "text-3xl md:text-4xl",
          size === "xl" && "text-4xl md:text-5xl"
        )}>
          🥚
        </span>
      </div>
    );
  }

  // Show nothing if no fallback and no Blobbi
  return null;
}