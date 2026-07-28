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

type ShellScreen = "login" | "loading" | "selection" | "hatching" | "playing";

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

  // Overlays (account menu, dialogs, sheets) portal INTO the game shell root
  // element rather than document.body. This keeps them visually inside the game
  // window — the auth dialogs read like they appear inside Blobbi Island, and
  // their backdrop only covers the game window, not the whole browser page.
  // It is ALSO required for fullscreen: when fullscreen is active the shell root
  // is the fullscreened element, so anything in document.body would render
  // outside the fullscreen layer and appear not to open. Using rootEl in every
  // mode covers desktop-framed, immersive (mobile landscape), and fullscreen.
  const portalContainer = rootEl;

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

  // ⚠️ ONE TREE, TWO PRESENTATIONS.
  //
  // This shell used to `return` early for the fill-screen case, producing a
  // structurally different tree: the framed layout has the header at child
  // index 0, the fill layout has the frame there. React matches state by
  // POSITION, so every toggle of `isFullscreen` unmounted the entire game and
  // mounted a fresh copy — new `PlayingView` (Blobbi back at its spawn point,
  // seat lost), new `MultiplayerLayer` (new presence session id, ghost player
  // on every other screen until the old one expired), new `TheaterStage` (the
  // YouTube player destroyed and the watch session dropped, orphaning a host's
  // own session). Nothing navigated and nothing reloaded — it was a remount,
  // and it looked exactly like a reload.
  //
  // So the chain is now identical in both presentations: the header and footer
  // are conditional CHILDREN in fixed slots, and everything below the canvas
  // wrapper keeps its position. Only classes and props change.
  return (
    <FullscreenPortalContext.Provider value={portalContainer}>
      <div
        ref={setRoot}
        className={cn(
          "fixed inset-0 overflow-hidden",
          fillScreen
            ? "bg-island-ink"
            : "flex flex-col bg-gradient-to-b from-island-sky/70 via-island-cream to-island-sand/60",
        )}
      >
        {!fillScreen && (
          <BlobbiShellHeader
            fullscreenSupported={isSupported}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggle}
            // Pre-login: login lives in the Island Pass card, so hide the header's
            // duplicate account control. After login the header shows the account
            // menu (the single home for account / current Blobbi / settings).
            showAccount={!isLogin}
            // The account menu hosts "Switch Blobbi"; only relevant once the player
            // has a world/collection.
            onOpenCollection={showGameChrome ? onOpenCollection : undefined}
          />
        )}

        {/* Game canvas. Framed: takes the remaining height between header and
            footer, aspect-locked inside so it never fills the whole viewport.
            Fill: the whole fixed root. */}
        <div className={fillScreen ? "relative h-full w-full" : "min-h-0 flex-1"}>
          <BlobbiFrame variant={fillScreen ? "immersive" : "desktop"} hud={hud} dock={dock}>
            <BlobbiStage fit={fillScreen ? "fill" : "framed"}>{children}</BlobbiStage>
          </BlobbiFrame>
        </div>

        {!fillScreen && <BlobbiShellFooter>{footerSlot}</BlobbiShellFooter>}

        {/* Desktop fullscreen only: an obvious clickable way out (Esc also
            works). Not shown in normal mobile-landscape immersive mode.
            Placed top-LEFT so it never collides with the account/menu control
            that lives top-right in the HUD. */}
        {isFullscreen && !immersive && <FullscreenExitButton onExit={exit} />}
      </div>
    </FullscreenPortalContext.Provider>
  );
}
