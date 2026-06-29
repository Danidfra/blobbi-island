import { ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useImmersive } from "@/hooks/useImmersive";
import { useFullscreen } from "@/hooks/useFullscreen";
import { FullscreenPortalContext } from "@/contexts/FullscreenPortalContext";
import { BlobbiStage } from "./BlobbiStage";
import { BlobbiFrame } from "./BlobbiFrame";
import { BlobbiHUD } from "./BlobbiHUD";
import { BlobbiActionDock } from "./BlobbiActionDock";
import { BlobbiShellHeader } from "./BlobbiShellHeader";
import { BlobbiShellFooter } from "./BlobbiShellFooter";
import { FullscreenExitButton } from "./FullscreenExitButton";

type ShellScreen = "login" | "loading" | "selection" | "playing";

interface BlobbiAppShellProps {
  /** The current game screen (login / loading / selection / playing). */
  children: ReactNode;
  /** Which screen is showing — drives which global header controls appear. */
  screen?: ShellScreen;
  /** Show the in-world HUD/dock (true only while playing). */
  showGameChrome?: boolean;
  /** Live online player count for the HUD (optional). */
  onlineCount?: number;
  /** Open the collection / switch-Blobbi screen. */
  onOpenCollection?: () => void;
  /** True when the player is actively in the world (enables dock world actions). */
  inWorld?: boolean;
  /** Optional contextual content for the desktop bottom area (tips/CTA/status). */
  footerSlot?: ReactNode;
}

/**
 * BlobbiAppShell — the Blobbi Island game shell.
 *
 * Desktop (framed): a cozy browser-game layout inspired by classic web games —
 * a lightweight header on top carrying GLOBAL controls (account, change-Blobbi,
 * settings, fullscreen), a centered game canvas (intentionally smaller than the
 * full viewport so it feels placed, not lost), and a reserved contextual strip
 * below for tips / CTA / status. A fullscreen control makes the canvas
 * immersive on demand.
 *
 * Mobile landscape AND desktop fullscreen (immersive): no header/footer chrome —
 * the canvas fills the screen so it feels like a game, not a webpage. Global
 * controls remain reachable through the in-canvas HUD there, and a subtle exit
 * button is overlaid when in desktop fullscreen.
 *
 * Header = global app/account controls. Canvas/HUD/Dock = gameplay/world.
 *
 * The world's percent-based coordinate system and `data-world-surface` are
 * untouched; this shell only changes the chrome around the stage.
 */
export function BlobbiAppShell({
  children,
  screen = "playing",
  showGameChrome = false,
  onlineCount,
  onOpenCollection,
  inWorld = false,
  footerSlot,
}: BlobbiAppShellProps) {
  const immersive = useImmersive(); // true on real phones/tablets, false on desktop/laptop
  const rootRef = useRef<HTMLDivElement | null>(null);
  // State mirror of the root element so the portal-container context re-renders
  // consumers once the element mounts (refs alone don't trigger re-renders).
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const setRoot = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    setRootEl(el);
  };
  const { isSupported, isFullscreen, toggle, exit } = useFullscreen(rootRef);

  // While fullscreen is active, overlays (account menu, dialogs, sheets) must
  // portal INTO the fullscreened element — otherwise they render in
  // document.body, outside the fullscreen layer, and appear not to open.
  const portalContainer = isFullscreen ? rootEl : null;

  const isLogin = screen === "login";

  // In-canvas HUD/Dock are GAMEPLAY chrome. On desktop framed mode the global
  // controls live in the header, so the HUD's global cluster (settings, switch-
  // Blobbi) is redundant — hide it there. In immersive (mobile landscape / no
  // header) and fullscreen, the HUD keeps those controls so they stay reachable.
  const desktopFramed = !immersive && !isFullscreen;
  const hud = showGameChrome ? (
    <BlobbiHUD
      compact={immersive}
      onlineCount={onlineCount}
      onOpenCollection={onOpenCollection}
      showGlobalControls={!desktopFramed}
    />
  ) : undefined;
  const dock = showGameChrome ? <BlobbiActionDock compact={immersive} inWorld={inWorld} /> : undefined;

  // Mobile landscape (or any immersive device) and desktop-fullscreen both use
  // the edge-to-edge presentation: the canvas fills the available space and the
  // header/footer chrome is hidden.
  const fillScreen = immersive || isFullscreen;

  if (fillScreen) {
    return (
      <FullscreenPortalContext.Provider value={portalContainer}>
        <div ref={setRoot} className="fixed inset-0 overflow-hidden bg-island-ink">
          <BlobbiFrame variant="immersive" hud={hud} dock={dock}>
            <BlobbiStage fit="fill">{children}</BlobbiStage>
          </BlobbiFrame>

          {/* Desktop fullscreen only: an obvious clickable way out (Esc also
              works). Not shown in normal mobile-landscape immersive mode.
              Placed top-LEFT so it never collides with the account/menu control
              that lives top-right in the HUD. */}
          {isFullscreen && !immersive && <FullscreenExitButton onExit={exit} />}
        </div>
      </FullscreenPortalContext.Provider>
    );
  }

  // Desktop: header + centered (smaller) canvas + contextual bottom area.
  return (
    <FullscreenPortalContext.Provider value={portalContainer}>
      <div
        ref={setRoot}
        className={cn(
          "fixed inset-0 overflow-hidden",
          "flex flex-col",
          "bg-gradient-to-b from-island-sky/70 via-island-cream to-island-sand/60",
        )}
      >
        <BlobbiShellHeader
          fullscreenSupported={isSupported}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggle}
          // Pre-login: login lives in the passport card, so hide the header's
          // duplicate account control. After login the header shows the account
          // menu (the single home for account / current Blobbi / settings).
          showAccount={!isLogin}
          // The account menu hosts "Switch Blobbi"; only relevant once the player
          // has a world/collection.
          onOpenCollection={showGameChrome ? onOpenCollection : undefined}
        />

        {/* Centered game canvas — takes the remaining height between header and
            footer, and the frame inside is aspect-locked so it never fills the
            whole viewport. */}
        <div className="min-h-0 flex-1">
          <BlobbiFrame variant="desktop" hud={hud} dock={dock}>
            <BlobbiStage fit="framed">{children}</BlobbiStage>
          </BlobbiFrame>
        </div>

        <BlobbiShellFooter>{footerSlot}</BlobbiShellFooter>
      </div>
    </FullscreenPortalContext.Provider>
  );
}
