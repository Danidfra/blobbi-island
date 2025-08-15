import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCustomizedBlobbiSvg } from "@/lib/customizeSvg";
import { cn } from "@/lib/utils";
import type { Blobbi } from "@/hooks/useBlobbis";

interface BlobbiCardProps {
  blobbi: Blobbi;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}

export function BlobbiCard({
  blobbi,
  isSelected,
  isCurrent,
  onSelect,
  onConfirm
}: BlobbiCardProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSvg = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Get adult_type from Blobbi interface - this should be available for adult stage Blobbis
        const adultType = blobbi.stage === 'adult' ?
          blobbi.adultType || 'bloomi' : // fallback to bloomi if not specified
          undefined;

        const customizedSvg = await loadCustomizedBlobbiSvg(
          blobbi.stage,
          adultType,
          blobbi.baseColor,
          blobbi.secondaryColor,
          blobbi.eyeColor
        );

        setSvgContent(customizedSvg);
      } catch (err) {
        console.error('Failed to load Blobbi SVG:', err);
        setError(err instanceof Error ? err.message : 'Failed to load SVG');
      } finally {
        setIsLoading(false);
      }
    };

    loadSvg();
  }, [blobbi]);

  return (
    <Card
      className={cn(
        "cursor-pointer blobbi-card-xl blobbi-hover theme-transition",
        "border-2 rounded-xl",
        isSelected && "ring-2 ring-purple-500 ring-offset-2 dark:ring-purple-400",
        isCurrent && "border-purple-500 dark:border-purple-400 blobbi-gradient-container"
      )}
      onClick={onSelect}
    >
      <CardContent className="blobbi-section space-y-4">
        {/* SVG Display */}
        <div className="relative h-32 md:h-40 w-full flex items-center justify-center blobbi-gradient-frame p-4">
          {isLoading ? (
            <Skeleton className="h-28 w-28 md:h-36 md:w-36 rounded-full" />
          ) : error ? (
            <div className="h-28 w-28 md:h-36 md:w-36 rounded-full bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center border-2 border-dashed border-purple-300 dark:border-purple-600">
              <span className="text-2xl md:text-3xl">🐾</span>
            </div>
          ) : (
            <div
              className="h-28 w-28 md:h-36 md:w-36"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          )}
        </div>

        {/* Blobbi Info */}
        <div className="text-center space-y-2">
          <h3 className="font-semibold text-lg blobbi-text">
            {blobbi.name || `Blobbi ${blobbi.id.slice(0, 8)}`}
          </h3>

          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-center gap-2">
              <span className="blobbi-text-muted font-medium">Stage:</span>
              <span className="blobbi-badge-baby capitalize">{blobbi.stage}</span>
            </div>

            {blobbi.baseColor && (
              <div className="flex items-center justify-center gap-2">
                <span className="blobbi-text-muted">Colors:</span>
                <div className="flex gap-1">
                  <div
                    className="w-4 h-4 rounded-full border-2 border-purple-200 dark:border-purple-600"
                    style={{ backgroundColor: blobbi.baseColor }}
                    title={`Base: ${blobbi.baseColor}`}
                  />
                  {blobbi.secondaryColor && (
                    <div
                      className="w-4 h-4 rounded-full border-2 border-purple-200 dark:border-purple-600"
                      style={{ backgroundColor: blobbi.secondaryColor }}
                      title={`Secondary: ${blobbi.secondaryColor}`}
                    />
                  )}
                  {blobbi.eyeColor && (
                    <div
                      className="w-4 h-4 rounded-full border-2 border-purple-200 dark:border-purple-600"
                      style={{ backgroundColor: blobbi.eyeColor }}
                      title={`Eyes: ${blobbi.eyeColor}`}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <Button
          className={cn(
            "w-full blobbi-button rounded-xl font-medium theme-transition",
            isCurrent
              ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
              : isSelected
                ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                : "border-purple-200 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/20"
          )}
          variant={isCurrent || isSelected ? "default" : "outline"}
          onClick={(e) => {
            e.stopPropagation();
            if (isSelected && !isCurrent) {
              onConfirm();
            } else {
              onSelect();
            }
          }}
        >
          {isCurrent ? "Current Companion" : isSelected ? "Confirm Selection" : "Select"}
        </Button>
      </CardContent>
    </Card>
  );
}