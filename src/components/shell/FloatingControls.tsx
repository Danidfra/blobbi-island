import { Map } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";

interface FloatingControlsProps {
  compact?: boolean;
  className?: string;
}

/**
 * FloatingControls — cozy floating buttons overlaid on the world (currently the
 * Map button). Rendered inside a `pointer-events-none` layer in BlobbiFrame, so
 * each control re-enables pointer events and carries `data-block-move`.
 *
 * Only wires existing actions (map). New social/friends controls are Phase 4+.
 */
export function FloatingControls({ compact = false, className }: FloatingControlsProps) {
  const { setIsMapModalOpen } = useLocation();

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0",
        className,
      )}
    >
      {/* Map — bottom-left, cozy wooden-sign pill */}
      <button
        type="button"
        data-block-move
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setIsMapModalOpen(true)}
        aria-label="Open map"
        title="Open map"
        className={cn(
          "pointer-events-auto absolute left-3 bottom-20 sm:left-4 sm:bottom-24",
          "inline-flex items-center gap-1.5 rounded-full",
          "bg-island-cream/95 text-island-ink border border-island-wood/30 shadow-cozy-soft",
          "transition-transform duration-150 ease-cozy hover:brightness-105 hover:scale-105 active:scale-95",
          compact ? "p-2" : "px-3 py-2",
        )}
      >
        <Map className="size-5 text-island-wood-dark" />
        {!compact && <span className="text-sm font-semibold">Map</span>}
      </button>
    </div>
  );
}
