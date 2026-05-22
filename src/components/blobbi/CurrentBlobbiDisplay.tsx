import { useState, useEffect, useRef } from "react";
import { loadBlobbiSvg } from "@/lib/loadBlobbiSvg";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
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
}: CurrentBlobbiDisplayProps) {
  const scopeIdRef = useRef<string>(
    idSuffix ??
    `bb-${(visualOverride?.name ?? 'blobbi')}-${Math.random().toString(36).slice(2,8)}`
  );
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
      );

      setSvgContent(customizedSvg);
    } catch (err) {
      console.error('Failed to load Blobbi SVG:', err);
      setSvgContent("");
    }
  }, [currentBlobbi, visualOverride, isSleeping, eyesClosed]);

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

  // Show Blobbi SVG
  if (svgContent && (currentBlobbi || visualOverride)) {
    const blobbiData = (currentBlobbi || visualOverride)!;
    const displayName = blobbiData.name || (visualOverride ? 'Remote Blobbi' : (currentBlobbi?.id || 'Blobbi'));
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
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />

          {/* Accessory Overlay for transparent mode */}
          {showAccessories && (
            <AccessoryOverlay
              isStatic={true}
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
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />

        {/* Accessory Overlay for default mode */}
        {showAccessories && (
          <AccessoryOverlay
            isStatic={true}
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