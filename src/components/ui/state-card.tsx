import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MascotBlobbi } from "@/components/blobbi/MascotBlobbi";

/**
 * StateCard — cozy loading / empty / error states for Blobbi Island.
 *
 * Replaces utilitarian spinners and bare "No X found" cards with a warm,
 * mascot-driven panel. Use across collection, world load, and data screens.
 */

type StateKind = "loading" | "empty" | "error";

interface StateCardProps {
  kind: StateKind;
  title: string;
  message?: string;
  /** Primary action (e.g. Retry, Create). */
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary slot, e.g. a RelaySelector for empty/error states. */
  children?: React.ReactNode;
  className?: string;
}

export function StateCard({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  children,
  className,
}: StateCardProps) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-sm flex-col items-center gap-5 rounded-[1.5rem] border-2 border-island-wood/30 bg-island-cream/90 p-8 text-center shadow-cozy-raised",
        className,
      )}
    >
      <div className="relative">
        <MascotBlobbi size="md" sleeping={kind === "error"} float={kind !== "error"} />
        {kind === "loading" && (
          <Loader2 className="absolute -bottom-1 -right-1 size-6 animate-spin text-island-ocean" />
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold text-island-ink">{title}</h3>
        {message && <p className="text-sm text-island-ink-soft">{message}</p>}
      </div>

      {children}

      {actionLabel && onAction && (
        <Button variant="playful" onClick={onAction} className="w-full">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
