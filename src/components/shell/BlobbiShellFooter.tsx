import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BlobbiShellFooterProps {
  /** Contextual content (tip / status / CTA / announcement). */
  children?: ReactNode;
  className?: string;
}

/**
 * BlobbiShellFooter: the reserved contextual strip below the desktop canvas.
 *
 * A quiet single-line area under the game window for tips, status, CTAs,
 * announcements or onboarding hints. Deliberately subtle: no heavy card or
 * border, fixed short height, `shrink-0` so it never steals canvas height on
 * short laptops, and it reads as part of the game shell rather than a website
 * footer. Only rendered in the desktop (framed) shell.
 *
 * When no children are provided it shows a neutral hint so the area still feels
 * intentional (not an empty gap).
 */
export function BlobbiShellFooter({ children, className }: BlobbiShellFooterProps) {
  return (
    <footer
      className={cn(
        "flex w-full shrink-0 items-center justify-center px-4 pb-2 pt-0.5 sm:px-6",
        className,
      )}
    >
      <div className="flex h-7 max-w-2xl items-center justify-center truncate rounded-full bg-island-cream/50 px-4 text-center text-xs text-island-ink-soft">
        {children ?? (
          <span>Tip: your Blobbi is happiest when you visit every day.</span>
        )}
      </div>
    </footer>
  );
}
