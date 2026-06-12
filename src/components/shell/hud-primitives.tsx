import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * HUD primitives for the Blobbi Island game HUD.
 *
 * These are presentational (props-driven) and viewport-agnostic so they can be
 * composed into the full desktop HUD, a compact mobile HUD, or a minimal embed
 * HUD. Data wiring (location, presence count, active Blobbi) happens where the
 * HUD is assembled, not here.
 *
 * NOTE: when placed over the game world, the containing HUD element must carry
 * `data-block-move` so taps on it don't trigger world click-to-move.
 */

type HudSize = "default" | "compact";

/** Location pill — e.g. "📍 Town Square". */
export function LocationPill({
  label,
  size = "default",
  className,
}: {
  label: string;
  size?: HudSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-island-wood/30 bg-island-cream/95 font-semibold text-island-ink shadow-cozy-soft",
        size === "compact" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        className,
      )}
    >
      <MapPin className={cn("text-island-ocean", size === "compact" ? "size-3.5" : "size-4")} />
      <span className="truncate max-w-[10rem]">{label}</span>
    </div>
  );
}

/** Online players count chip — e.g. "🟢 6 online". */
export function OnlineCountChip({
  count,
  size = "default",
  className,
}: {
  count: number;
  size?: HudSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-island-wood/30 bg-island-cream/95 font-semibold text-island-ink shadow-cozy-soft",
        size === "compact" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        className,
      )}
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-island-grass opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-island-grass" />
      </span>
      <span>{count}</span>
      {size !== "compact" && <span className="text-island-ink-soft font-normal">online</span>}
    </div>
  );
}

/** A cozy HUD icon button (settings, collection, menu, etc.). */
export function HudIconButton({
  icon,
  label,
  onClick,
  size = "default",
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  size?: HudSize;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-island-wood/30 bg-island-cream/95 text-island-ink shadow-cozy-soft",
        "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "compact" ? "size-8" : "size-10",
        className,
      )}
    >
      {icon}
    </button>
  );
}

/**
 * Active-Blobbi chip — a circular game-style avatar button.
 *
 * The actual Blobbi art is passed as children (e.g. CurrentBlobbiDisplay) so
 * this primitive stays decoupled from data hooks. Rendered as a perfect circle
 * (not a stretched web pill) with the avatar centered and clipped inside.
 */
export function ActiveBlobbiChip({
  children,
  name,
  onClick,
  size = "default",
  className,
}: {
  children: React.ReactNode;
  name?: string;
  onClick?: () => void;
  size?: HudSize;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name ? `Your Blobbi: ${name}` : "Your Blobbi"}
      className={cn(
        "inline-flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-full",
        "border border-island-wood/30 bg-island-cream/95 shadow-cozy-soft",
        "transition-transform duration-150 ease-cozy hover:brightness-105 active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "compact" ? "size-8 p-0.5" : "size-10 p-1",
        className,
      )}
    >
      <span className="flex size-full items-center justify-center">{children}</span>
    </button>
  );
}
