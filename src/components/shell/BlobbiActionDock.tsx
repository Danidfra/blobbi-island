import { useCallback, useState } from "react";
import { MessageCircle, Map as MapIcon, Home, PawPrint, ChevronUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { readDockCollapsed, writeDockCollapsed } from "@/lib/first-session";
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
 * BlobbiActionDock: the bottom action dock integrated into the game frame.
 *
 * Establishes the visual pattern for future gameplay actions, but only wires
 * actions that already exist:
 *   - Talk  → opens the Communication panel (quick phrases, phrase builder,
 *             emotes, and free text where the policy allows it)
 *   - Map   → opens the existing MapModal
 *   - Home  → navigates to the Home location (existing location system)
 *   - Blobbi→ opens the existing BlobbiInfoModal (custom event)
 * No new gameplay is invented. Carries `data-block-move`.
 *
 * The dock is a LAUNCHER, not a composer. It used to transform in place into a
 * text field, which made it the owner of a message-composition surface it had no
 * other reason to know about; composing now lives in `CommunicationPanel`, which
 * `PlayingView` renders next to the publisher it needs.
 */
export function BlobbiActionDock({ compact = false, inWorld = true, className }: BlobbiActionDockProps) {
  const { setIsMapModalOpen, setCurrentLocation, currentLocation } = useLocation();
  /*
    VISIBLE BY DEFAULT, HIDDEN ONLY BY EXPLICIT CHOICE.

    The dock is how a new player discovers that there is anything to do; it
    used to start folded and fold itself again on every room change, which is
    the same as hiding the controls from the people who need them most. Now it
    opens on entry and stays however the player left it: a room change, a
    navigation transition, a remount of the shell; none of them touch it.
    Only the collapse arrow does, and that choice is remembered for this
    visit (`first-session.ts`).
  */
  const [expanded, setExpanded] = useState(() => !readDockCollapsed());

  const toggleDock = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeDockCollapsed(!next);
      return next;
    });
  }, []);

  const actions: DockAction[] = [
    {
      key: "talk",
      label: "Talk",
      icon: MessageCircle,
      onClick: () => emit(DOCK_EVENTS.openCommunication),
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
      className={cn(
        // Outer row spans the full width but must NOT block world clicks in its
        // transparent areas: only the visible pill below captures pointer events.
        "pointer-events-none flex items-center justify-center",
        compact
          ? "gap-1.5 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2"
          : "gap-2 px-3 pb-3 pt-2",
        className,
      )}
    >
      {/* Collapsed state: small arrow toggle */}
      {!expanded && (
        <button
          type="button"
          data-block-move
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleDock}
          aria-label="Open action dock"
          title="Open action dock"
          className={cn(
            "pointer-events-auto inline-flex items-center justify-center rounded-full",
            "border border-island-wood/30 bg-island-cream-2/95 shadow-cozy-raised backdrop-blur-sm",
            "text-island-wood-dark transition-all duration-200 ease-cozy",
            "hover:bg-island-cream hover:scale-110 active:scale-95",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "size-9" : "size-10",
          )}
        >
          <ChevronUp className={compact ? "size-5" : "size-5"} />
        </button>
      )}

      {/* Expanded state: the action row */}
      {expanded && (
        <div
          data-block-move
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-auto flex items-center rounded-full border border-island-wood/30 bg-island-cream-2/95 shadow-cozy-raised backdrop-blur-sm",
            "animate-in fade-in slide-in-from-bottom-2 duration-200",
            compact ? "gap-1 p-1" : "gap-1.5 p-1.5",
          )}
        >
          {/* Collapse arrow (first item in the expanded dock) */}
          <button
            type="button"
            onClick={toggleDock}
            aria-label="Collapse action dock"
            title="Collapse action dock"
            className={cn(
              "group inline-flex flex-col items-center justify-center rounded-full",
              "text-island-wood-dark transition-transform duration-150 ease-cozy",
              "hover:bg-island-cream hover:scale-105 active:scale-95",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact ? "size-10" : "min-w-[2.5rem] px-2 py-1.5",
            )}
          >
            <ChevronUp className={cn("rotate-180 transition-transform duration-200", compact ? "size-5" : "size-5")} />
          </button>
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
      )}
    </div>
  );
}
