import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";

interface BlobbiShellHeaderProps {
  /** Whether the browser supports the Fullscreen API (hide control if not). */
  fullscreenSupported: boolean;
  /** Whether the document is currently in fullscreen. */
  isFullscreen: boolean;
  /** Toggle fullscreen on/off. */
  onToggleFullscreen: () => void;
  /**
   * Pre-login screen: the login CTA lives inside the Island Pass card, so the
   * header hides its own account control to avoid a duplicate login button.
   */
  showAccount?: boolean;
  /** Open the collection / switch-Blobbi screen (used by the account menu). */
  onOpenCollection?: () => void;
  className?: string;
}

/**
 * BlobbiShellHeader: lightweight top bar for the desktop game shell.
 *
 * Intentionally minimal:
 *   left:  app icon + "Blobbi Island" wordmark
 *   right: account/menu button + fullscreen button
 *
 * The account menu is the single home for account identity, current Blobbi /
 * switch Blobbi, relays/network, account switching and logout, the header no
 * longer carries separate settings or current-Blobbi controls.
 *
 * Only rendered in the desktop (framed) shell, mobile landscape and desktop
 * fullscreen are immersive and never show this header (their account/settings
 * menu opens from the in-canvas HUD as a touch-friendly sheet instead).
 */
export function BlobbiShellHeader({
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  showAccount = true,
  onOpenCollection,
  className,
}: BlobbiShellHeaderProps) {
  const controlBtn = cn(
    "inline-flex size-10 items-center justify-center rounded-full",
    "border border-island-wood/30 bg-island-cream/95 text-island-wood-dark shadow-cozy-soft",
    "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  return (
    <header
      className={cn(
        "flex w-full shrink-0 items-center justify-between gap-3",
        "px-4 py-2.5 sm:px-6",
        className,
      )}
    >
      {/* Wordmark: real app icon (favicon) + title */}
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src="/icons/blobbi-island-icon-rounded-192.png"
          alt=""
          aria-hidden
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-full object-contain shadow-cozy-soft"
        />
        <span className="truncate text-lg font-bold text-island-ink">
          Blobbi Island
        </span>
      </div>

      {/* Right cluster: account/menu + fullscreen only */}
      <div className="flex shrink-0 items-center gap-2">
        {showAccount && (
          <AccountMenu variant="dropdown" onSwitchBlobbi={onOpenCollection} />
        )}

        {fullscreenSupported && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={cn(controlBtn, "shrink-0")}
          >
            <Maximize2 className="size-5" />
          </button>
        )}
      </div>
    </header>
  );
}
