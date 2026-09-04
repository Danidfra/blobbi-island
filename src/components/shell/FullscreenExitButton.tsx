import { Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FullscreenExitButtonProps {
  onExit: () => void;
  className?: string;
}

/**
 * FullscreenExitButton: a small cozy control overlaid inside the canvas while
 * desktop fullscreen is active.
 *
 * In fullscreen the shell header is hidden, so this gives an obvious clickable
 * way out (Esc still works natively). Intentionally subtle: top-LEFT, small,
 * semi-translucent until hover. Placed on the left so it never collides with the
 * account/menu control, which lives top-right inside the HUD. Only rendered for
 * desktop fullscreen: normal mobile-landscape immersive mode does not show it.
 *
 * Carries `data-block-move` so tapping it never triggers world click-to-move.
 */
export function FullscreenExitButton({ onExit, className }: FullscreenExitButtonProps) {
  return (
    <div
      data-block-move
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "pointer-events-none absolute left-3 top-3 z-40",
        "pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]",
        className,
      )}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label="Exit fullscreen"
        title="Exit fullscreen (Esc)"
        className={cn(
          "pointer-events-auto inline-flex size-10 items-center justify-center rounded-full",
          "border border-island-wood/30 bg-island-cream/80 text-island-wood-dark shadow-cozy-soft backdrop-blur-sm",
          "opacity-70 transition-all duration-150 ease-cozy hover:opacity-100 hover:brightness-105 active:scale-95",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
        )}
      >
        <Minimize2 className="size-5" />
      </button>
    </div>
  );
}
