import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useImmersive } from "@/hooks/useImmersive";
import { BlobbiStage } from "./BlobbiStage";
import { BlobbiFrame } from "./BlobbiFrame";
import { BlobbiHUD } from "./BlobbiHUD";
import { BlobbiActionDock } from "./BlobbiActionDock";

interface BlobbiAppShellProps {
  /** The current game screen (login / loading / selection / playing). */
  children: ReactNode;
  /** Show the in-world HUD/dock (true only while playing). */
  showGameChrome?: boolean;
  /** Live online player count for the HUD (optional). */
  onlineCount?: number;
  /** Open the collection / switch-Blobbi screen. */
  onOpenCollection?: () => void;
  /** True when the player is actively in the world (enables dock world actions). */
  inWorld?: boolean;
}

/**
 * BlobbiAppShell — world-first shell. No website navbar, no footer, no page
 * scroll. A soft cozy background supports a centered cozy game frame on desktop,
 * and a near-fullscreen immersive frame on mobile landscape.
 *
 * The world's percent-based coordinate system and `data-world-surface` are
 * untouched; this shell only changes the chrome around the stage.
 */
export function BlobbiAppShell({
  children,
  showGameChrome = false,
  onlineCount,
  onOpenCollection,
  inWorld = false,
}: BlobbiAppShellProps) {
  const immersive = useImmersive(); // true on real phones/tablets, false on desktop/laptop

  const hud = showGameChrome ? (
    <BlobbiHUD compact={immersive} onlineCount={onlineCount} onOpenCollection={onOpenCollection} />
  ) : undefined;
  const dock = showGameChrome ? <BlobbiActionDock compact={immersive} inWorld={inWorld} /> : undefined;

  return (
    <div
      className={cn(
        // Lock the main game view to the viewport — no page scroll.
        "fixed inset-0 overflow-hidden",
        // Soft cozy backdrop behind the frame.
        immersive
          ? "bg-island-ink"
          : "bg-gradient-to-b from-island-sky/70 via-island-cream to-island-sand/60",
      )}
    >
      <BlobbiFrame
        variant={immersive ? "immersive" : "desktop"}
        hud={hud}
        dock={dock}
      >
        <BlobbiStage fit={immersive ? "fill" : "framed"}>{children}</BlobbiStage>
      </BlobbiFrame>
    </div>
  );
}
