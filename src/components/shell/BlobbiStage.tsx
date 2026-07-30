import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MovementBlockerProvider } from "@/contexts/MovementBlockerContext";
import { WORLD_ASPECT } from "@/lib/world-coordinates";

interface BlobbiStageProps {
  children: ReactNode;
  className?: string;
  /**
   * "framed"  — desktop: a centered, aspect-locked stage with breathing room.
   * "fill"    — mobile landscape / embed: fill the available box (100%).
   */
  fit?: "framed" | "fill";
}

/**
 * BlobbiStage — the responsive game stage.
 *
 * Replaces the old fixed-size game container which hardcoded 1046×697px. The
 * world inside is percent-based (PlaceBackground is w-full/h-full), so the stage
 * only needs to provide a correctly-proportioned, responsive box. We preserve
 * the original ~3:2 authoring aspect ratio (1046/697 ≈ 1.5) so location art and
 * boundaries line up exactly as before.
 *
 * MovementBlockerProvider stays mounted here (as it was in the old container)
 * so furniture/blocker context is available to the world unchanged.
 */

export function BlobbiStage({ children, className, fit = "framed" }: BlobbiStageProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        fit === "framed"
          ? // Aspect-locked, scales down to fit small laptops, never overflows.
            "w-full h-full max-w-full max-h-full mx-auto"
          : "w-full h-full",
        className,
      )}
      style={
        fit === "framed"
          ? { aspectRatio: `${WORLD_ASPECT}` }
          : undefined
      }
    >
      <MovementBlockerProvider>{children}</MovementBlockerProvider>
    </div>
  );
}
