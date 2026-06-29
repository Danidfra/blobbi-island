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
 * IMPORTANT: HUD/dock overlays must each carry `data-block-move` (handled by
 * their own components) so taps don't trigger world click-to-move. Only the
 * world stage exposes `data-world-surface` (via PlaceBackground).
 */
export function BlobbiFrame({
  children,
  hud,
  dock,
  variant = "desktop",
  className,
}: BlobbiFrameProps) {
  if (variant === "immersive") {
    return (
      <div className={cn("relative w-full h-full overflow-hidden bg-island-ink", className)}>
        <div className="absolute inset-0">{children}</div>
        {/* HUD/dock wrappers are pointer-events-none so empty space around the
            visible controls lets world click-to-move through. The controls
            themselves re-enable pointer events (see BlobbiHUD/BlobbiActionDock). */}
        {hud && <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">{hud}</div>}
        {dock && <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">{dock}</div>}
      </div>
    );
  }

  // Desktop: aspect-locked frame that fits within the available box (the band
  // between the shell header and footer — NOT the full viewport). The whole unit
  // (wood frame + cream bezel + world) is ONE aspect-locked box. We let it take
  // the full available width, then cap its height to the band; with a fixed
  // `aspect-ratio`, the browser shrinks the width to honor `max-height`, so the
  // frame and canvas always resize together and the 3:2 ratio is preserved.
  // Whichever axis is tighter (width on narrow windows, height on short ones)
  // becomes the binding constraint automatically. Never overflows / no scroll.
  return (
    <div className={cn("flex h-full w-full items-center justify-center p-4 sm:p-6", className)}>
      <div
        className="relative w-full"
        style={{
          aspectRatio: `${STAGE_ASPECT}`,
          maxHeight: "100%",
          maxWidth: "100%",
        }}
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

            {/* Top HUD */}
            {hud && <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">{hud}</div>}

            {/* Bottom dock */}
            {dock && <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">{dock}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
