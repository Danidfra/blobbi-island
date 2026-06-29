import { Maximize2, PawPrint, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginArea } from "@/components/auth/LoginArea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RelaySelector } from "@/components/RelaySelector";

interface BlobbiShellHeaderProps {
  /** Whether the browser supports the Fullscreen API (hide control if not). */
  fullscreenSupported: boolean;
  /** Whether the document is currently in fullscreen. */
  isFullscreen: boolean;
  /** Toggle fullscreen on/off. */
  onToggleFullscreen: () => void;
  /**
   * Pre-login screen: the login CTA lives inside the passport card, so the
   * header hides its own LoginArea to avoid a duplicate login button.
   */
  showAccount?: boolean;
  /** Show the change/select-Blobbi control (logged in + relevant state). */
  showSwitchBlobbi?: boolean;
  /** Open the collection / switch-Blobbi screen. */
  onOpenCollection?: () => void;
  /** Show the settings (network) control in the header. */
  showSettings?: boolean;
  className?: string;
}

/**
 * BlobbiShellHeader — lightweight top bar for the desktop game shell.
 *
 * Carries GLOBAL app/account controls (wordmark, account, change-Blobbi,
 * settings, fullscreen). Gameplay/world controls stay in the in-canvas HUD/Dock.
 *
 * Only rendered in the desktop (framed) shell — mobile landscape and desktop
 * fullscreen are immersive and never show this header (their global controls
 * remain reachable via the in-canvas HUD instead).
 *
 * Auth is delegated to the stable <LoginArea /> unchanged.
 */
export function BlobbiShellHeader({
  fullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  showAccount = true,
  showSwitchBlobbi = false,
  onOpenCollection,
  showSettings = false,
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
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          aria-hidden
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-island-purple text-base shadow-cozy-soft"
        >
          🐾
        </span>
        <span className="truncate text-lg font-bold text-island-ink">
          Blobbi Island
        </span>
      </div>

      {/* Right cluster: global controls only */}
      <div className="flex items-center gap-2 shrink-0">
        {showSwitchBlobbi && (
          <button
            type="button"
            onClick={onOpenCollection}
            aria-label="Change Blobbi"
            title="Change Blobbi"
            className={controlBtn}
          >
            <PawPrint className="size-5" />
          </button>
        )}

        {showSettings && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                className={controlBtn}
              >
                <Settings className="size-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-72 rounded-2xl border-2 border-island-wood/30 bg-island-cream shadow-cozy-raised"
            >
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-island-ink">Settings</h3>
                  <p className="text-xs text-island-ink-soft">Connection &amp; advanced options</p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-island-ink-soft">Network</span>
                  <RelaySelector className="w-full" />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {showAccount && (
          <div className="rounded-full bg-island-cream/80 shadow-cozy-soft">
            <LoginArea />
          </div>
        )}

        {fullscreenSupported && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={controlBtn}
          >
            <Maximize2 className="size-5" />
          </button>
        )}
      </div>
    </header>
  );
}
