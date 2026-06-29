import { ChevronDown, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginArea } from "@/components/auth/LoginArea";
import { CurrentBlobbiDisplay } from "@/components/blobbi/CurrentBlobbiDisplay";
import { useBlobbis } from "@/hooks/useBlobbis";
import { useBlobbonautProfile } from "@/hooks/useBlobbonautProfile";

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
  className?: string;
}

/**
 * CurrentBlobbiControl — a compact "current Blobbi" button for the slim header.
 *
 * Avatar-only: shows just the current Blobbi inside a circular button (visually
 * matching the in-canvas active-Blobbi chip) plus a small caret to signal it's
 * clickable. No visible name/id/tag — the Blobbi's name is only used for the
 * accessible label / tooltip when safely available. Reads the same reactive
 * source as the rest of the app (useBlobbis + useBlobbonautProfile), so it
 * updates immediately when the active Blobbi changes — no reload.
 */
function CurrentBlobbiControl({ onClick }: { onClick?: () => void }) {
  const { data: blobbis } = useBlobbis();
  const { data: profile } = useBlobbonautProfile();
  const currentCompanionId = profile?.currentCompanion;
  const current = currentCompanionId
    ? blobbis?.find((b) => b.id === currentCompanionId)
    : undefined;

  const name = current?.name?.trim();
  const title = name ? `${name} — change Blobbi` : "Change Blobbi";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name ? `Your Blobbi: ${name} — change Blobbi` : "Change Blobbi"}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full py-1 pl-1 pr-2",
        "border border-island-wood/30 bg-island-cream/95 text-island-wood-dark shadow-cozy-soft",
        "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
        <CurrentBlobbiDisplay
          size="sm"
          showFallback
          transparent
          showAccessories={false}
          className="size-full"
        />
      </span>
      <ChevronDown className="size-4 shrink-0 opacity-70" />
    </button>
  );
}

/**
 * BlobbiShellHeader — lightweight top bar for the desktop game shell.
 *
 * Carries GLOBAL app/account controls. Kept intentionally simple:
 *   wordmark · current-Blobbi control · account · fullscreen.
 *
 * Account/network/settings management lives in the account area (LoginArea),
 * which is the single home for those controls — the header no longer carries a
 * separate settings/network button.
 *
 * Only rendered in the desktop (framed) shell — mobile landscape and desktop
 * fullscreen are immersive and never show this header (their global controls,
 * including settings, remain reachable via the in-canvas HUD instead).
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
      <div className="flex shrink-0 items-center gap-2">
        {showSwitchBlobbi && (
          <CurrentBlobbiControl onClick={onOpenCollection} />
        )}

        {showAccount && (
          <div className="shrink-0 rounded-full bg-island-cream/80 shadow-cozy-soft">
            <LoginArea />
          </div>
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
