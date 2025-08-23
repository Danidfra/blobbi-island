import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCustomizedBlobbiSvg } from "@/lib/customizeSvg";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
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
  eyesClosed = false
}: CurrentBlobbiDisplayProps) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
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
          currentBlobbi.eyeColor,
          isSleeping || eyesClosed // Close eyes when either sleeping or seated with eyesClosed
        );

        // Add lazy loading attributes to SVG for performance
        const optimizedSvg = customizedSvg.replace(
          /<svg([^>]*)>/,
          (match, attributes) => {
            // Add loading attributes if not already present
            if (!attributes.includes('decoding=')) {
              attributes += ' decoding="async"';
            }
            if (!attributes.includes('fetchpriority=')) {
              attributes += ' fetchpriority="low"';
            }
            return `<svg${attributes}>`;
          }
        );

        setSvgContent(optimizedSvg);
      } catch (err) {
        console.error('Failed to load current Blobbi SVG:', err);
        setSvgContent("");
      } finally {
        setIsLoading(false);
      }
    };

    loadSvg();
  }, [currentBlobbi, isSleeping, eyesClosed]);

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
              size === "sm" && "h-6 w-6 md:h-8 md:w-8",
              size === "md" && "h-10 w-10 md:h-14 md:w-14",
              size === "lg" && "size-20 md:size-24",
              size === "xl" && "size-28 md:size-32"
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
          "flex items-center justify-center rounded-full blobbi-gradient-frame shadow-lg theme-transition",
          interactive && "cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200 blobbi-hover",
          sizeClasses[size],
          className
        )}
        title={`${currentBlobbi.name || currentBlobbi.id} - ${currentBlobbi.stage} stage${interactive ? ' (click to switch)' : ''}`}
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
        title={`No Blobbi selected${interactive ? ' (click to select)' : ''}`}
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