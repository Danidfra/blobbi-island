import { MessageCircle, Map as MapIcon, Home, PawPrint, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { DOCK_EVENTS } from "./dock-events";

function emit(name: string) {
  document.dispatchEvent(new CustomEvent(name));
}

interface DockAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface BlobbiActionDockProps {
  compact?: boolean;
  /** Whether the player is actively in the world (enables world-specific actions). */
  inWorld?: boolean;
  className?: string;
}

/**
 * BlobbiActionDock — the bottom action dock integrated into the game frame.
 *
 * Establishes the visual pattern for future gameplay actions, but only wires
 * actions that already exist:
 *   - Chat  → focuses the in-world ChatInputBar (custom event)
 *   - Map   → opens the existing MapModal
 *   - Home  → navigates to the Home location (existing location system)
 *   - Blobbi→ opens the existing BlobbiInfoModal (custom event)
 * No new gameplay is invented. Carries `data-block-move`.
 */
export function BlobbiActionDock({ compact = false, inWorld = true, className }: BlobbiActionDockProps) {
  const { setIsMapModalOpen, setCurrentLocation, currentLocation } = useLocation();

  const actions: DockAction[] = [
    {
      key: "chat",
      label: "Chat",
      icon: MessageCircle,
      onClick: () => emit(DOCK_EVENTS.focusChat),
      disabled: !inWorld,
    },
    {
      key: "map",
      label: "Map",
      icon: MapIcon,
      onClick: () => setIsMapModalOpen(true),
    },
    {
      key: "home",
      label: "Home",
      icon: Home,
      onClick: () => setCurrentLocation("home"),
      disabled: currentLocation === "home",
    },
    {
      key: "blobbi",
      label: "My Blobbi",
      icon: PawPrint,
      onClick: () => emit(DOCK_EVENTS.openMyBlobbi),
      disabled: !inWorld,
    },
  ];

  return (
    <div
      data-block-move
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "flex items-center justify-center",
        compact
          ? "gap-1.5 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2"
          : "gap-2 px-3 pb-3 pt-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center rounded-full border border-island-wood/30 bg-island-cream-2/95 shadow-cozy-raised backdrop-blur-sm",
          compact ? "gap-1 p-1" : "gap-1.5 p-1.5",
        )}
      >
        {actions.map(({ key, label, icon: Icon, onClick, disabled }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={cn(
              "group inline-flex flex-col items-center justify-center rounded-full",
              "text-island-ink transition-transform duration-150 ease-cozy",
              "hover:bg-island-cream hover:scale-105 active:scale-95",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-40 disabled:pointer-events-none",
              compact ? "size-10" : "min-w-[3.75rem] px-3 py-1.5",
            )}
          >
            <Icon className={cn("text-island-wood-dark", compact ? "size-5" : "size-5")} />
            {!compact && <span className="mt-0.5 text-[0.7rem] font-semibold leading-none">{label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
