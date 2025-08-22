import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCustomizedBlobbiSvg } from "@/lib/customizeSvg";
import { useBlobbis, type Blobbi } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";
import { cn } from "@/lib/utils";

interface StaticBlobbiDisplayProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  showFallback?: boolean;
  isSleeping?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8 md:h-10 md:w-10",
  md: "h-12 w-12 md:h-16 md:w-16",
  lg: "h-16 w-16 md:h-20 md:w-20",
  xl: "h-24 w-24 md:h-32 md:w-32",
  "2xl": "h-48 w-48 md:h-64 md:w-64",
  "3xl": "h-64 w-64 md:h-80 md:w-80"
};

export function StaticBlobbiDisplay({
  className,
  size = "lg",
  showFallback = true,
  isSleeping = false
}: StaticBlobbiDisplayProps) {
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
          isSleeping
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
  }, [currentBlobbi, isSleeping]);

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

  // Show current Blobbi SVG - transparent mode for static display
  if (svgContent && currentBlobbi) {
    return (
      <div
        className={cn(
          "flex items-center justify-center",
          sizeClasses[size],
          className
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center",
            size === "sm" && "h-6 w-6 md:h-8 md:w-8",
            size === "md" && "h-10 w-10 md:h-14 md:w-14",
            size === "lg" && "h-14 w-14 md:h-18 md:w-18",
            size === "xl" && "h-20 w-20 md:h-28 md:w-28",
            size === "2xl" && "h-40 w-40 md:h-56 md:w-56",
            size === "3xl" && "h-56 w-56 md:h-72 md:w-72"
          )}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    );
  }

  // Show fallback if enabled and no Blobbi is selected
  if (showFallback) {
    return (
      <div
        className={cn(
          "flex items-center justify-center",
          sizeClasses[size],
          className
        )}
      >
        <span className={cn(
          "text-muted-foreground",
          size === "sm" && "text-lg md:text-xl",
          size === "md" && "text-2xl md:text-3xl",
          size === "lg" && "text-3xl md:text-4xl",
          size === "xl" && "text-4xl md:text-5xl",
          size === "2xl" && "text-6xl md:text-7xl",
          size === "3xl" && "text-7xl md:text-8xl"
        )}>
          🥚
        </span>
      </div>
    );
  }

  // Show nothing if no fallback and no Blobbi
  return null;
}