import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STAGE_ASPECT } from "./BlobbiStage";

interface BlobbiFrameProps {
  /** The game stage (world) goes here. */
  children: ReactNode;
  /** Top HUD overlay. */
  hud?: ReactNode;
  /** Bottom action dock overlay. */
  dock?: ReactNode;
  /** Floating controls (map, etc.) overlaid on the world. */
  floating?: ReactNode;
  /**
   * "desktop" — cozy wood frame, centered with breathing room, aspect-locked.
   * "immersive" — near-fullscreen (mobile landscape / embed): thin frame, fills screen.
   */
  variant?: "desktop" | "immersive";
  className?: string;
}

/**
 * BlobbiFrame — the cozy game window.
 *
 * Desktop: a soft cartoon-wood frame with cream edges, rounded corners and a
 * gentle drop shadow, sized to fit the viewport while preserving the world's
 * 3:2 aspect ratio. HUD and dock are integrated into the frame (overlaid on the
 * world's top/bottom edges). The world remains the visual focus.
 *
 * Immersive: minimal chrome, fills the available space (used for mobile
 * landscape and future embed mode).
 *
 * IMPORTANT: HUD/dock/floating overlays must each carry `data-block-move`
 * (handled by their own components) so taps don't trigger world click-to-move.
 * Only the world stage exposes `data-world-surface` (via PlaceBackground).
 */
export function BlobbiFrame({
  children,
  hud,
  dock,
  floating,
  variant = "desktop",
  className,
}: BlobbiFrameProps) {
  if (variant === "immersive") {
    return (
      <div className={cn("relative w-full h-full overflow-hidden bg-island-ink", className)}>
        <div className="absolute inset-0">{children}</div>
        {hud && <div className="absolute inset-x-0 top-0 z-30">{hud}</div>}
        {floating && <div className="absolute inset-0 z-20 pointer-events-none">{floating}</div>}
        {dock && <div className="absolute inset-x-0 bottom-0 z-30">{dock}</div>}
      </div>
    );
  }

  // Desktop: aspect-locked wrapper that fits within the available viewport box.
  // The wrapper is sized by whichever dimension is the binding constraint so the
  // frame never overflows a small laptop and never causes page scroll.
  return (
    <div className={cn("flex h-full w-full items-center justify-center p-4 sm:p-6", className)}>
      <div
        className={cn(
          "relative",
          // Bind by both width and height; keep the 3:2 ratio.
          "w-full",
          "max-w-[min(100%,calc((100dvh-3rem)*1.5))]",
        )}
        style={{ aspectRatio: `${STAGE_ASPECT}` }}
      >
        {/* Cozy wood frame */}
        <div
          className={cn(
            "relative h-full w-full overflow-hidden rounded-[1.75rem]",
            "bg-island-wood",
            "p-2 sm:p-3",
            "shadow-cozy-frame",
            "ring-1 ring-island-wood-dark/40",
          )}
        >
          {/* Inner cream bezel + world */}
          <div className="relative h-full w-full overflow-hidden rounded-[1.25rem] bg-island-cream shadow-[inset_0_2px_8px_rgba(58,42,26,0.18)]">
            {/* World stage */}
            <div className="absolute inset-0">{children}</div>

            {/* Floating controls (over the world, below HUD/dock) */}
            {floating && (
              <div className="absolute inset-0 z-20 pointer-events-none">{floating}</div>
            )}

            {/* Top HUD */}
            {hud && <div className="absolute inset-x-0 top-0 z-30">{hud}</div>}

            {/* Bottom dock */}
            {dock && <div className="absolute inset-x-0 bottom-0 z-30">{dock}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
