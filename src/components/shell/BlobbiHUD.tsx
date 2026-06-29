import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { LocationId } from "@/lib/location-types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RelaySelector } from "@/components/RelaySelector";
import { CurrentBlobbiDisplay } from "@/components/blobbi/CurrentBlobbiDisplay";
import { LocationPill, OnlineCountChip, ActiveBlobbiChip } from "./hud-primitives";

// Friendly display names (kept in sync with LocationIndicator).
const LOCATION_NAMES: Record<LocationId, string> = {
  town: "Town Square",
  home: "Cozy Home",
  beach: "Sunny Beach",
  mine: "Crystal Mine",
  "nostr-station": "Nostr Station",
  "nostr-station-inside": "Nostr Station",
  plaza: "Central Plaza",
  "plaza-inside": "Plaza Interior",
  arcade: "Game Arcade",
  "arcade-1": "Arcade · Floor 1",
  "arcade-minus1": "Arcade · Basement",
  stage: "Performance Stage",
  shop: "Village Shop",
  "back-yard": "Back Yard",
  "cave-open": "Mining Cave",
  "clothing-store-inside": "Clothing Store",
};

interface BlobbiHUDProps {
  /** Compact (mobile landscape) vs full (desktop) layout. */
  compact?: boolean;
  /** Live online players count, if available. Hidden when undefined. */
  onlineCount?: number;
  /** Open the Blobbi collection / switch screen. */
  onOpenCollection?: () => void;
  /**
   * Render the global controls (settings, change-Blobbi) inside the HUD.
   * Desktop framed mode sets this false because those live in the shell header;
   * immersive / fullscreen (no header) keeps them true so they stay reachable.
   * Location pill and online count are always shown (world/status info).
   */
  showGlobalControls?: boolean;
}

/**
 * BlobbiHUD — the in-game top HUD (replaces the website navbar).
 *
 * Left: current location pill (the HUD focuses on location only).
 * Right: online count, active-Blobbi chip (collection/switch entry), settings.
 *
 * Carries `data-block-move` so taps on the HUD never move the Blobbi. Relay /
 * network settings live behind the Settings popover, not in the main bar.
 */
export function BlobbiHUD({ compact = false, onlineCount, onOpenCollection, showGlobalControls = true }: BlobbiHUDProps) {
  const { currentLocation } = useLocation();
  const { user } = useCurrentUser();
  const locationName = LOCATION_NAMES[currentLocation] ?? "The Island";
  const size = compact ? "compact" : "default";

  return (
    <div
      className={cn(
        // Root spans full width; transparent gaps must let world clicks through,
        // so the root is pointer-events-none and each cluster re-enables them.
        "pointer-events-none flex items-center justify-between gap-2",
        compact
          ? "px-2 pt-[max(0.4rem,env(safe-area-inset-top))] pb-2"
          : "px-3 sm:px-4 pt-3 pb-2",
      )}
    >
      {/* Left: current location only */}
      <div data-block-move className="pointer-events-auto flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <LocationPill label={locationName} size={size} />
        </div>
      </div>

      {/* Right: status + actions */}
      <div data-block-move className="pointer-events-auto flex items-center gap-2 shrink-0">
        {typeof onlineCount === "number" && <OnlineCountChip count={onlineCount} size={size} />}

        {showGlobalControls && user && (
          <ActiveBlobbiChip size={size} onClick={onOpenCollection} name={undefined}>
            <CurrentBlobbiDisplay
              size="sm"
              showFallback={false}
              transparent
              showAccessories={false}
              className="size-full"
            />
          </ActiveBlobbiChip>
        )}

        {/* Settings (relay/network tucked away here, not in the bar) */}
        {showGlobalControls && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                className={cn(
                  "inline-flex items-center justify-center rounded-full border border-island-wood/30 bg-island-cream/95 text-island-ink shadow-cozy-soft",
                  "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  compact ? "size-8" : "size-10",
                )}
              >
                <Settings className="size-5 text-island-wood-dark" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              data-block-move
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
      </div>
    </div>
  );
}
