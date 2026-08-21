import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Map as MapIcon, Home, PawPrint, Send, X, ChevronUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { Input } from "@/components/ui/input";
import { CHAT_MAX_LEN } from "@/lib/chat-config";
import { DOCK_EVENTS, type SendChatDetail } from "./dock-events";

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
 *   - Chat  → transforms the dock IN PLACE into a compact chat input
 *             ([ message input ] [ Send ] [ X ]); sending or X restores the dock
 *   - Map   → opens the existing MapModal
 *   - Home  → navigates to the Home location (existing location system)
 *   - Blobbi→ opens the existing BlobbiInfoModal (custom event)
 * No new gameplay is invented. Carries `data-block-move`.
 *
 * Chat send still flows through the existing pipeline: the dock dispatches a
 * `DOCK_EVENTS.sendChat` event with the text, and PlayingView publishes it via
 * the unchanged chat function. Bubble anchoring is untouched.
 */
export function BlobbiActionDock({ compact = false, inWorld = true, className }: BlobbiActionDockProps) {
  const { setIsMapModalOpen, setCurrentLocation, currentLocation } = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleDock = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const openChat = useCallback(() => {
    setExpanded(true);
    setChatMode(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeChat = useCallback(() => {
    setChatMode(false);
    setMessage("");
    setExpanded(false);
    inputRef.current?.blur();
  }, []);

  const sendChat = useCallback(() => {
    const trimmed = message.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    const text = trimmed.slice(0, CHAT_MAX_LEN);
    document.dispatchEvent(
      new CustomEvent<SendChatDetail>(DOCK_EVENTS.sendChat, { detail: { text } }),
    );
    // Keep chat mode open for longer conversations: clear the input and keep
    // focus so the user can immediately type again. Chat mode only closes via
    // the X button, Escape, or a location change (handled below).
    setMessage("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [message]);

  // Allow other UI (e.g. a future button) to open chat via the existing event.
  useEffect(() => {
    document.addEventListener(DOCK_EVENTS.focusChat, openChat);
    return () => document.removeEventListener(DOCK_EVENTS.focusChat, openChat);
  }, [openChat]);

  // Close chat mode and collapse dock when the player changes location/screen.
  useEffect(() => {
    closeChat();
  }, [currentLocation, closeChat]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeChat();
      }
    },
    [sendChat, closeChat],
  );

  const actions: DockAction[] = [
    {
      key: "chat",
      label: "Chat",
      icon: MessageCircle,
      onClick: openChat,
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
        // transparent areas — only the visible pill below captures pointer events.
        "pointer-events-none flex items-center justify-center",
        compact
          ? "gap-1.5 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2"
          : "gap-2 px-3 pb-3 pt-2",
        className,
      )}
    >
      {/* Collapsed state: small arrow toggle */}
      {!expanded && !chatMode && (
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

      {/* Expanded state: full dock with buttons or chat input */}
      {(expanded || chatMode) && (
        <div
          data-block-move
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-auto flex items-center rounded-full border border-island-wood/30 bg-island-cream-2/95 shadow-cozy-raised backdrop-blur-sm",
            "animate-in fade-in slide-in-from-bottom-2 duration-200",
            chatMode
              ? // Chat input occupies the same dock footprint; it doesn't float.
                cn("gap-1.5 p-1.5", compact ? "w-[min(80vw,22rem)]" : "w-[min(70vw,26rem)]")
              : compact
                ? "gap-1 p-1"
                : "gap-1.5 p-1.5",
          )}
        >
          {chatMode ? (
            <>
              <Input
                ref={inputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                maxLength={CHAT_MAX_LEN}
                className={cn(
                  "h-8 flex-1 min-w-0 rounded-full border-0 bg-transparent px-3 text-sm",
                  "focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-island-ink-soft",
                )}
              />
              <button
                type="button"
                onClick={sendChat}
                disabled={!message.trim()}
                aria-label="Send message"
                title="Send"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  "bg-island-ocean text-island-cream transition-transform duration-150 ease-cozy",
                  "hover:brightness-105 active:scale-95",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                <Send className="size-4" />
              </button>
              <button
                type="button"
                onClick={closeChat}
                aria-label="Close chat"
                title="Close chat"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  "text-island-wood-dark transition-transform duration-150 ease-cozy",
                  "hover:bg-island-cream hover:scale-105 active:scale-95",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
