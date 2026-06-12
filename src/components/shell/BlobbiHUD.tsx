import { Settings, PawPrint } from "lucide-react";
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
import { LocationPill, OnlineCountChip, HudIconButton, ActiveBlobbiChip } from "./hud-primitives";

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
}

/**
 * BlobbiHUD — the in-game top HUD (replaces the website navbar).
 *
 * Left: Blobbi Island wordmark (wooden sign feel).
 * Center: current location pill.
 * Right: online count, active-Blobbi chip, collection, settings.
 *
 * Carries `data-block-move` so taps on the HUD never move the Blobbi. Relay /
 * network settings live behind the Settings popover, not in the main bar.
 */
export function BlobbiHUD({ compact = false, onlineCount, onOpenCollection }: BlobbiHUDProps) {
  const { currentLocation } = useLocation();
  const { user } = useCurrentUser();
  const locationName = LOCATION_NAMES[currentLocation] ?? "The Island";
  const size = compact ? "compact" : "default";

  return (
    <div
      data-block-move
      className={cn(
        "flex items-center justify-between gap-2",
        compact
          ? "px-2 pt-[max(0.4rem,env(safe-area-inset-top))] pb-2"
          : "px-3 sm:px-4 pt-3 pb-2",
      )}
    >
      {/* Left: wordmark */}
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-island-wood text-island-cream font-bold shadow-cozy-soft border border-island-wood-dark/40 shrink-0",
            compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
          )}
        >
          <span aria-hidden>🏝️</span>
          {!compact && <span>Blobbi Island</span>}
        </div>
        {/* Location pill */}
        <div className="min-w-0">
          <LocationPill label={locationName} size={size} />
        </div>
      </div>

      {/* Right: status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        {typeof onlineCount === "number" && <OnlineCountChip count={onlineCount} size={size} />}

        {user && (
          <ActiveBlobbiChip size={size} onClick={onOpenCollection} name={undefined}>
            <CurrentBlobbiDisplay
              size="sm"
              showFallback={false}
              transparent
              showAccessories={false}
            />
          </ActiveBlobbiChip>
        )}

        {onOpenCollection && (
          <HudIconButton
            size={size}
            label="My Blobbis"
            onClick={onOpenCollection}
            icon={<PawPrint className="size-5 text-island-wood-dark" />}
          />
        )}

        {/* Settings (relay/network tucked away here, not in the bar) */}
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
      </div>
    </div>
  );
}
