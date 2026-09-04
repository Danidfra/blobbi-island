import React, { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WORLD_WIDTH, WORLD_HEIGHT } from "@/lib/world-coordinates";

/**
 * The world's fixed virtual design resolution. All world art, object positions
 * (percent) AND object sizes (px/rem) were authored against this exact box, so
 * rendering the world at this fixed size and scaling the whole layer uniformly
 * keeps every element, background, Blobbi, furniture, buildings, arcade items,
 * doors, hotspots, interactives, perfectly aligned at any viewport size.
 *
 * The values live in the pure coordinate module
 * (`src/lib/world-coordinates.ts`, the single source of truth).
 */

interface VirtualWorldProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * VirtualWorld: a fixed {@link WORLD_WIDTH}×{@link WORLD_HEIGHT} coordinate
 * space, uniformly scaled (CSS transform) to fit its parent box and centered.
 *
 * Why this exists:
 *   The world mixes percent-based POSITIONS (resolution-independent) with
 *   px/rem-based SIZES (resolution-dependent: the Blobbi, furniture, some
 *   interactive elements, map hotspots). The old hardcoded 1046×697 container
 *   hid the mismatch; the responsive Phase-2 stage exposed it (Blobbi too small,
 *   furniture too big, arcade/elevator misaligned). Rendering the world at the
 *   fixed design resolution and scaling the entire layer once restores a single
 *   consistent coordinate system.
 *
 * Why it is safe for the protected systems:
 *   - `getBoundingClientRect()` returns POST-transform (visual) rects, so the
 *     click→percent math `(clientX - rect.left) / rect.width * 100` used by
 *     MovableBlobbi / MultiplayerLayer / Furniture / chair logic is invariant
 *     under a uniform scale. Movement targets stay correct.
 *   - `data-world-surface`, `MovementBlockerProvider`, `#my-blobbi-anchor` and
 *     remote `[data-player-key]` all live INSIDE this scaled layer, so chat
 *     bubble portals and multiplayer anchors keep resolving correct on-screen
 *     positions.
 *   - Gaze uses percent positions only and is unaffected.
 *
 * UI/HUD/dock/chat/modals are rendered OUTSIDE this component and therefore do
 * not scale as world objects.
 */
export function VirtualWorld({ children, className }: VirtualWorldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const recompute = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const next = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
      // Avoid pointless state churn (sub-pixel jitter from ResizeObserver).
      setScale((prev) => (Math.abs(prev - next) > 0.0005 ? next : prev));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={cn("relative h-full w-full overflow-hidden", className)}>
      {/* Fixed-resolution world, centered and uniformly scaled to fit. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
