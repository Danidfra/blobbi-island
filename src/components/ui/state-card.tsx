import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MascotBlobbi } from "@/components/blobbi/MascotBlobbi";

/**
 * StateCard: the island's loading, empty, error and waiting states.
 *
 * Every screen that fetches something needs these four, and left to themselves
 * every screen invents them: a bare `<Loader2 className="animate-spin" />`
 * here, a grey "No items found" paragraph there, a red sentence somewhere else.
 * That inconsistency is most visible exactly where the game is least in
 * control: a slow relay, an empty inventory, a settlement still confirming,
 * which is the worst moment for the UI to look unfinished.
 *
 * One component, one shape: mascot, title, message, optional action, optional
 * extra slot (a RelaySelector, a balance, a hint).
 *
 * ## The kinds
 *
 * - `loading`: we asked and are waiting. The mascot floats, a spinner sits on
 *   its shoulder.
 * - `pending`: something is happening that we cannot cancel and must not
 *   present as an error: a Coin settlement confirming, a mine session closing.
 *   Distinct from `loading` because the copy and the stakes differ, and because
 *   an offered "Retry" would be actively wrong.
 * - `empty`: the answer arrived and it is nothing.
 * - `error`: the answer did not arrive. The mascot sleeps.
 *
 * `compact` drops the mascot and the padding for use inside a panel or a modal
 * body, where a full-size mascot would push the real content off screen.
 */

export type StateKind = "loading" | "pending" | "empty" | "error";

interface StateCardProps {
  kind: StateKind;
  title: string;
  message?: string;
  /**
   * Primary action: Retry, Create, Go shopping.
   *
   * Deliberately ignored for `pending`: that state exists precisely for work
   * the player cannot influence, and a button that cannot help is worse than
   * no button.
   */
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary slot: a RelaySelector on an empty state, a hint, a balance. */
  children?: React.ReactNode;
  /** Inline form: no mascot, tighter padding. For use inside a panel. */
  compact?: boolean;
  className?: string;
}

export function StateCard({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  children,
  compact = false,
  className,
}: StateCardProps) {
  const busy = kind === "loading" || kind === "pending";
  const showAction = Boolean(actionLabel && onAction) && kind !== "pending";

  return (
    <div
      // `status` rather than `alert` even for errors: these render as part of a
      // page's normal flow, and `alert` interrupts whatever a screen reader is
      // saying. A genuinely interruptive failure should raise a toast.
      role="status"
      aria-live={busy ? "polite" : "off"}
      aria-busy={busy || undefined}
      className={cn(
        "mx-auto flex flex-col items-center text-center",
        compact
          ? "max-w-sm gap-3 px-4 py-6"
          : "max-w-sm gap-5 rounded-panel border border-island-wood/20 bg-island-cream/90 p-8 shadow-cozy-soft",
        className,
      )}
    >
      {!compact && (
        <div className="relative">
          <MascotBlobbi size="md" sleeping={kind === "error"} float={kind !== "error"} />
          {busy && (
            <Loader2 className="absolute -bottom-1 -right-1 size-6 animate-spin text-island-ocean motion-reduce:animate-none" />
          )}
        </div>
      )}

      {compact && busy && (
        <Loader2 className="size-6 animate-spin text-island-ocean motion-reduce:animate-none" />
      )}

      <div className="space-y-1.5">
        <h3
          className={cn(
            "text-base font-bold sm:text-lg",
            kind === "error" ? "text-island-danger" : "text-island-ink",
          )}
        >
          {title}
        </h3>
        {message && <p className="text-sm leading-snug text-island-ink-soft">{message}</p>}
      </div>

      {children}

      {showAction && (
        <Button variant="playful" onClick={onAction} className="w-full">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
