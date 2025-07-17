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
        "cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105",
        "border-2 rounded-xl",
        isSelected && "ring-2 ring-primary ring-offset-2",
        isCurrent && "border-primary bg-primary/5"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-6 space-y-4">
        {/* SVG Display */}
        <div className="relative h-32 md:h-40 w-full flex items-center justify-center">
          {isLoading ? (
            <Skeleton className="h-28 w-28 md:h-36 md:w-36 rounded-full" />
          ) : error ? (
            <div className="h-28 w-28 md:h-36 md:w-36 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/30">
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
          <h3 className="font-semibold text-lg">
            {blobbi.name || `Blobbi ${blobbi.id.slice(0, 8)}`}
          </h3>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="capitalize">
              <span className="font-medium">Stage:</span> {blobbi.stage}
            </p>

            {blobbi.baseColor && (
              <div className="flex items-center justify-center gap-2">
                <span>Colors:</span>
                <div className="flex gap-1">
                  <div
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: blobbi.baseColor }}
                    title={`Base: ${blobbi.baseColor}`}
                  />
                  {blobbi.secondaryColor && (
                    <div
                      className="w-4 h-4 rounded-full border border-border"
                      style={{ backgroundColor: blobbi.secondaryColor }}
                      title={`Secondary: ${blobbi.secondaryColor}`}
                    />
                  )}
                  {blobbi.eyeColor && (
                    <div
                      className="w-4 h-4 rounded-full border border-border"
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
          className="w-full"
          variant={isCurrent ? "default" : isSelected ? "default" : "outline"}
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