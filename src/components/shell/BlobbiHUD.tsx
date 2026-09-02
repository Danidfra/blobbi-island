import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { LocationId } from "@/lib/location-types";
import { AccountMenu } from "./AccountMenu";
import { LocationPill, OnlineCountChip } from "./hud-primitives";

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
  "badges-store-inside": "Badges Store",
  "care-store-inside": "Care Store",
  "furniture-store-inside": "Furniture Store",
};

interface BlobbiHUDProps {
  /** Compact (mobile landscape) vs full (desktop) layout. */
  compact?: boolean;
  /** Live online players count, if available. Hidden when undefined. */
  onlineCount?: number;
  /** Open the Blobbi collection / switch screen. */
  onOpenCollection?: () => void;
  /**
   * Render the global account/menu control inside the HUD. Desktop framed mode
   * sets this false because the account menu lives in the shell header;
   * immersive / fullscreen (no header) keeps it true so it stays reachable.
   * Location pill and online count are always shown (world/status info).
   */
  showGlobalControls?: boolean;
}

/**
 * BlobbiHUD — the in-game top HUD (replaces the website navbar).
 *
 * Center: current location pill (an in-world location sign, centered at the top).
 * Right:  online count + account/menu.
 *
 * Carries `data-block-move` so taps on the HUD never move the Blobbi. In
 * immersive / fullscreen mode (no header) the account/menu is the single home
 * for account, current Blobbi / switch Blobbi, relays/network and logout — it
 * opens as a centered, touch-friendly game modal rather than a cramped popover
 * or a tall bottom drawer.
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
        // `relative` so the centered location sign can be absolutely positioned
        // without being pushed around by the left/right clusters.
        "pointer-events-none relative flex items-center justify-between gap-2",
        compact
          ? "px-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-2"
          : "px-3 sm:px-4 pt-2 pb-2",
      )}
    >
      {/* Center: current location — an in-world location sign, centered at the
          top of the canvas. Absolutely centered (both axes) so it never shifts
          with the right cluster, sits on the same line as the side controls,
          and never collides with the account/menu (right) or the
          fullscreen-exit control (left). On very narrow widths the pill's own
          max-width keeps it clear of the side clusters. */}
      <div
        data-block-move
        className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 flex items-center"
      >
        <LocationPill label={locationName} size={size} />
      </div>

      {/* Left spacer — keeps the right cluster right-aligned via justify-between
          while the location sign floats centered above. */}
      <div aria-hidden className="min-w-0 flex-1" />

      {/* Right: status + account/menu */}
      <div data-block-move className="pointer-events-auto flex items-center gap-2 shrink-0">
        {typeof onlineCount === "number" && <OnlineCountChip count={onlineCount} size={size} />}

        {/* Single home for account / current Blobbi / switch Blobbi / relays /
            logout. Opens as a centered, touch-friendly game modal in
            immersive/fullscreen (a bottom drawer wastes scarce landscape
            height). */}
        {showGlobalControls && user && (
          <AccountMenu variant="modal" onSwitchBlobbi={onOpenCollection} />
        )}
      </div>
    </div>
  );
}
