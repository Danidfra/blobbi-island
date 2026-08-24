import { ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { StageOverlayContext } from "@/contexts/StageOverlayContext";
import { WORLD_ASPECT } from "@/lib/world-coordinates";

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

  // The in-world overlay host. State rather than a ref, because consumers portal
  // into this element and must re-render once it exists.
  const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);

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
  // Frame and canvas always resize as one unit. Never overflows / no scroll:
  // the frame fits inside the band minus the minimum gutter padding.
  return (
    <div
      className={cn(
        immersive
          ? "relative h-full w-full overflow-hidden bg-island-ink"
          : // The padding is the window's MINIMUM external gutter: on desktop
            // the whole decorated frame — wood border, rounded corners, shadow
            // — always keeps at least 16px (24px from `sm`) of page visible at
            // the left and right, however narrow the browser gets before the
            // immersive mode takes over. A previous pass replaced this with a
            // deliberate horizontal bleed past the viewport, which clipped the
            // wood border's flanks; that misread the feedback — the offending
            // gap was INSIDE the frame (see the bezel padding below), and the
            // external margin is wanted. Height-bound frames get naturally
            // larger side margins; this is only the floor.
            "flex h-full w-full items-center justify-center p-4 sm:p-6",
        className,
      )}
    >
      <div
        className={immersive ? "relative h-full w-full" : "relative w-full"}
        style={
          immersive
            ? undefined
            : {
                aspectRatio: `${WORLD_ASPECT}`,
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
              // Side padding = WORLD_ASPECT × vertical padding (12/8 and 18/12
              // ≈ 1046/697), NOT uniform. The aspect lock above includes this
              // border, so a uniform border left the bezel interior slightly
              // WIDER than the world's ratio — and VirtualWorld contain-scales
              // the fixed 1046×697 world into it, which letterboxed a ~4–6px
              // strip of blurred backdrop between the bezel and the wallpaper
              // on the left and right. Matching the padding to the ratio makes
              // the interior exactly world-shaped, so the wallpaper meets the
              // bezel flush on all four sides.
              "py-2 px-3 sm:py-3 sm:px-[1.125rem]",
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
            <div className="absolute inset-0">
              <StageOverlayContext.Provider value={overlayHost}>
                {children}
              </StageOverlayContext.Provider>
            </div>

            {/* HUD/dock wrappers are pointer-events-none so empty space around
                the visible controls lets world click-to-move through. The
                controls themselves re-enable pointer events. */}
            {hud && <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">{hud}</div>}

            {dock && <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none">{dock}</div>}

            {/*
              In-world overlay host — where the arcade's surfaces are portaled.

              Position matters three ways:
                • INSIDE the cream bezel, so on desktop the overlay covers the
                  game window and nothing else: the wood frame, the shell header
                  and footer, and the page behind them all stay visible. In
                  immersive and fullscreen this same box IS the screen, so one
                  rule covers all three presentations.
                • ABOVE the HUD and dock (z-30), because a machine's screen
                  should not leave the action dock pokable behind it.
                • OUTSIDE the world's own subtree, so a portaled surface never
                  inherits the world's scale transform — the mistake that made
                  `GameModal` shrink its own text on a narrow viewport, and the
                  reason the arcade shell moved to a Radix portal in Phase 2.

              `pointer-events-none` with children re-enabling is load-bearing:
              this element always covers the whole stage, so without it an EMPTY
              host would swallow every click-to-move in the world.
            */}
            <div
              ref={setOverlayHost}
              data-stage-overlay-host
              className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
