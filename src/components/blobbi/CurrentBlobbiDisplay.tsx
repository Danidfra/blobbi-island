import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCustomizedBlobbiSvg } from "@/lib/customizeSvg";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useCurrentCompanion } from "@/hooks/useCurrentCompanion";
import { cn } from "@/lib/utils";

interface CurrentBlobbiDisplayProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showFallback?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  /** If true, shows only the SVG without background circle */
  transparent?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
  xl: "h-24 w-24"
};

export function CurrentBlobbiDisplay({
  className,
  size = "lg",
  showFallback = true,
  onClick,
  interactive = false,
  transparent = false
}: CurrentBlobbiDisplayProps) {
  const { data: blobbis } = useBlobbis();
  const { data: currentCompanionId } = useCurrentCompanion();
  const [svgContent, setSvgContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentBlobbi, setCurrentBlobbi] = useState<Blobbi | null>(null);

  // Find the current Blobbi
  useEffect(() => {
    if (currentCompanionId && blobbis) {
      const blobbi = blobbis.find(b => b.id === currentCompanionId);
      setCurrentBlobbi(blobbi || null);
    } else {
      setCurrentBlobbi(null);
    }
  }, [currentCompanionId, blobbis]);

  // Load the SVG for the current Blobbi
  useEffect(() => {
    const loadSvg = async () => {
      if (!currentBlobbi) {
        setSvgContent("");
        return;
      }

      setIsLoading(true);

      try {
        const adultType = currentBlobbi.stage === 'adult' ?
          currentBlobbi.adultType || 'bloomi' :
          undefined;

        const customizedSvg = await loadCustomizedBlobbiSvg(
          currentBlobbi.stage,
          adultType,
          currentBlobbi.baseColor,
          currentBlobbi.secondaryColor,
          currentBlobbi.eyeColor
        );

        setSvgContent(customizedSvg);
      } catch (err) {
        console.error('Failed to load current Blobbi SVG:', err);
        setSvgContent("");
      } finally {
        setIsLoading(false);
      }
    };

    loadSvg();
  }, [currentBlobbi]);

  // Show loading skeleton
  if (isLoading) {
    return (
      <Skeleton
        className={cn(
          "rounded-full",
          sizeClasses[size],
          className
        )}
      />
    );
  }

  // Show current Blobbi SVG
  if (svgContent && currentBlobbi) {
    // Transparent mode - show only the SVG without background
    if (transparent) {
      return (
        <div
          className={cn(
            "flex items-center justify-center",
            interactive && "cursor-pointer hover:scale-105 transition-all duration-200",
            sizeClasses[size],
            className
          )}
          title={`${currentBlobbi.name || currentBlobbi.id} - ${currentBlobbi.stage} stage${interactive ? ' (click to switch)' : ''}`}
          onClick={onClick}
        >
          <div
            className={cn(
              "flex items-center justify-center",
              size === "sm" && "h-6 w-6",
              size === "md" && "h-10 w-10",
              size === "lg" && "h-14 w-14",
              size === "xl" && "h-20 w-20"
            )}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      );
    }

    // Default mode - show with background circle
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-50 to-green-50 border-2 border-primary/20 shadow-lg",
          interactive && "cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200",
          sizeClasses[size],
          className
        )}
        title={`${currentBlobbi.name || currentBlobbi.id} - ${currentBlobbi.stage} stage${interactive ? ' (click to switch)' : ''}`}
        onClick={onClick}
      >
        <div
          className={cn(
            "flex items-center justify-center",
            size === "sm" && "h-6 w-6",
            size === "md" && "h-10 w-10",
            size === "lg" && "h-14 w-14",
            size === "xl" && "h-20 w-20"
          )}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    );
  }

  // Show fallback if enabled and no Blobbi is selected
  if (showFallback) {
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
          title={`No Blobbi selected${interactive ? ' (click to select)' : ''}`}
          onClick={onClick}
        >
          <span className={cn(
            "text-muted-foreground",
            size === "sm" && "text-lg",
            size === "md" && "text-2xl",
            size === "lg" && "text-3xl",
            size === "xl" && "text-4xl"
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
          "flex items-center justify-center rounded-full bg-muted border-2 border-dashed border-muted-foreground/30",
          interactive && "cursor-pointer hover:bg-muted/80 transition-all duration-200",
          sizeClasses[size],
          className
        )}
        title={`No Blobbi selected${interactive ? ' (click to select)' : ''}`}
        onClick={onClick}
      >
        <span className={cn(
          "text-muted-foreground",
          size === "sm" && "text-lg",
          size === "md" && "text-2xl",
          size === "lg" && "text-3xl",
          size === "xl" && "text-4xl"
        )}>
          🥚
        </span>
      </div>
    );
  }

  // Show nothing if no fallback and no Blobbi
  return null;
}