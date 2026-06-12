import { useMemo } from "react";
import { loadBlobbiSvg } from "@/lib/loadBlobbiSvg";
import { cn } from "@/lib/utils";

/**
 * MascotBlobbi — the original purple Blobbi used as Blobbi Island's mascot/guide.
 *
 * Renders via the standalone SVG core (no Nostr / no hooks), so it can appear
 * in onboarding, the portrait-rotate screen, and empty/error states without
 * any data dependencies. Purple is the brand accent color.
 */

const MASCOT_BASE_COLOR = "#8E6BE8"; // island purple
const MASCOT_SECONDARY = "#B79CF2";
const MASCOT_EYE = "#3A2A1A";

const sizeClasses = {
  sm: "h-20 w-20",
  md: "h-32 w-32",
  lg: "h-44 w-44",
  xl: "h-60 w-60",
} as const;

interface MascotBlobbiProps {
  size?: keyof typeof sizeClasses;
  /** Gentle idle float. Default true. */
  float?: boolean;
  /** Render the sleeping (closed-eye) variant. */
  sleeping?: boolean;
  className?: string;
}

export function MascotBlobbi({
  size = "lg",
  float = true,
  sleeping = false,
  className,
}: MascotBlobbiProps) {
  const svg = useMemo(
    () =>
      loadBlobbiSvg(
        "baby",
        undefined,
        MASCOT_BASE_COLOR,
        MASCOT_SECONDARY,
        MASCOT_EYE,
        sleeping,
        "mascot",
      ),
    [sleeping],
  );

  return (
    <div
      className={cn(
        sizeClasses[size],
        float && "animate-float",
        "drop-shadow-[0_10px_18px_rgba(58,42,26,0.18)] select-none",
        className,
      )}
      role="img"
      aria-label="Blobbi mascot"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
