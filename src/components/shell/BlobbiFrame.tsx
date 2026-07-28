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
  const immersive = variant === "immersive";

  // ⚠️ ONE TREE, TWO PRESENTATIONS — never two trees.
  //
  // This component used to `return` a completely different element chain per
  // variant: immersive nested the world two levels deep, desktop four. React
  // identifies state by POSITION, so switching variant unmounted everything
  // below and mounted it again — destroying the world's React state (seat,
  // position, watch session) and the YouTube player with it. Toggling
  // fullscreen changes `variant`, so a fullscreen click reset the game.
  //
  // The chain below is therefore IDENTICAL in both variants; only classes and
  // the aspect lock differ. The extra wrappers are visually inert when
  // immersive (full-size, unstyled), and `{children}` keeps the same position
  // in the tree, which is what keeps it mounted.
  //
  // Desktop: aspect-locked frame that fits within the available box (the band
  // between the shell header and footer — NOT the full viewport). The whole unit
  // (wood frame + cream bezel + world) is ONE aspect-locked box.
  //
  // The frame targets an intentional, comfortable size — a classic browser-game
  // window that stays centered rather than stretching across huge monitors. We
  // cap the width at an ideal max (≈ the world art's native 1046px) so it never
  // grows endlessly; with a fixed `aspect-ratio`, the browser also honors
  // `max-height: 100%` (the band height) and shrinks the width to match. So:
  //   • Large desktop → pinned to the ideal max width, centered.
  //   • Narrow window → width is the binding constraint, shrinks responsively.
  //   • Short height  → height is binding, shrinks proportionally (3:2 kept).
  // Frame and canvas always resize as one unit. Never overflows / no scroll.
  return (
    <div
      className={cn(
        immersive
          ? "relative h-full w-full overflow-hidden bg-island-ink"
          : "flex h-full w-full items-center justify-center p-4 sm:p-6",
        className,
      )}
    >
      <div
        className={immersive ? "relative h-full w-full" : "relative w-full"}
        style={
          immersive
            ? undefined
            : {
                aspectRatio: `${STAGE_ASPECT}`,
                maxHeight: "100%",
                maxWidth: "min(100%, 1040px)",
              }
        }
      >
        {/* Cozy wood frame (desktop) / inert wrapper (immersive) */}
        <div
          className={cn(
            "relative h-full w-full overflow-hidden",
            !immersive && [
              "rounded-[1.75rem]",
              "bg-island-wood",
              "p-2 sm:p-3",
              "shadow-cozy-frame",
              "ring-1 ring-island-wood-dark/40",
            ],
          )}
        >
          {/* Inner cream bezel + world (desktop) / inert wrapper (immersive) */}
          <div
            className={cn(
              "relative h-full w-full overflow-hidden",
              !immersive &&
                "rounded-[1.25rem] bg-island-cream shadow-[inset_0_2px_8px_rgba(58,42,26,0.18)]",
            )}
          >
            {/* World stage */}
            <div className="absolute inset-0">{children}</div>

            {/* HUD/dock wrappers are pointer-events-none so empty space around
                the visible controls lets world click-to-move through. The
                controls themselves re-enable pointer events. */}
            {hud && <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">{hud}</div>}

            {dock && <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">{dock}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
