import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { ArcadeStatus } from '@/arcade/arcade-machine-state';

/**
 * ArcadeGameShell — the surface every arcade game is played on.
 *
 * Replaces `GameModal`, which was a plain `absolute inset-0` div rendered INSIDE
 * `VirtualWorld`. That put it inside the world's uniform scale transform and
 * clipped it to the fixed 1046 × 697 box, so on a narrow viewport its text was
 * scaled down with the room and a game could never use the full screen. Every
 * other modal in the app uses Radix `Dialog`, which portals to `document.body`;
 * this one does too.
 *
 * ## What the shell owns
 *
 * Open/close, the title bar, pause and exit controls, the reduced-motion
 * decision, and the status-driven frame around whatever the game draws. What it
 * does NOT own: any game's rules, any score, any Nostr event, any inventory
 * write. It imports none of those, which is what stops "the shell" from quietly
 * becoming "the game".
 *
 * ## Why it unmounts on close
 *
 * `GameModal` set its content but never cleared it, so the last game's markup
 * stayed mounted behind a closed modal forever. Here `open === false` renders
 * nothing at all: `children` are only mounted while the shell is open, so a
 * closed shell cannot keep a timer, an audio node or a listener alive.
 *
 * ## World input while open
 *
 * Radix renders a modal dialog: it portals outside `[data-world-surface]`, marks
 * the rest of the document inert, and traps focus. A pointer event therefore
 * never reaches the world's click-to-move listener, and focus returns to the
 * element that opened the shell when it closes. `data-block-move` on the content
 * is belt and braces for the one path that could bypass the portal (a test
 * rendering the shell inside the surface).
 */

export interface ArcadeGameShellProps {
  open: boolean;
  /**
   * Dismissal. The controller decides what that MEANS — mid-run it must abort
   * the run, which is the lifecycle reducer's job, not this component's.
   */
  onClose: () => void;
  /** Shown in the title bar and announced as the dialog's accessible name. */
  title: string;
  /** Short description under the title. Also the dialog's accessible description. */
  description?: string;
  /** Which machine/game this shell is showing. Rendered as data attributes. */
  machineId: string;
  gameId?: string | null;
  /** Drives the pause/exit controls. */
  status: ArcadeStatus;
  /** Present only when a run can be paused. */
  onPause?: () => void;
  onResume?: () => void;
  /** The game surface, or a preview/coming-soon panel. */
  children: React.ReactNode;
  /** Actions rendered along the bottom (Start, Play again, Close, …). */
  footer?: React.ReactNode;
  className?: string;
}

/** Statuses in which a live run exists and pause/exit are meaningful. */
const PAUSABLE: readonly ArcadeStatus[] = ['countdown', 'playing'];

export function ArcadeGameShell({
  open,
  onClose,
  title,
  description,
  machineId,
  gameId = null,
  status,
  onPause,
  onResume,
  children,
  footer,
  className,
}: ArcadeGameShellProps) {
  const reducedMotion = useReducedMotion();

  /**
   * The element to return focus to when the shell closes.
   *
   * Radix's default restores focus to the `DialogTrigger`, and this dialog has
   * none: it is opened by the movement system on ARRIVAL, not by a button
   * press. Without this, leaving the shell dropped focus onto `<body>` and a
   * keyboard user lost their place in the room entirely.
   *
   * `onOpenAutoFocus` fires while `document.activeElement` is still whatever the
   * player was on (Radix captures it and only then dispatches the event), so it
   * is the correct moment to remember the machine they walked up to.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  const canPause = PAUSABLE.includes(status) && Boolean(onPause);
  const canResume = status === 'paused' && Boolean(onResume);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        // The header carries Pause / Resume / Leave, so the default top-right X
        // would both overlap them and give one dialog two close affordances.
        hideDefaultClose
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          // The machine may have been unmounted (the player changed floor while
          // the shell was open), in which case there is nothing to return to.
          if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
        }}
        data-block-move
        data-arcade-shell
        data-arcade-machine={machineId}
        data-arcade-game={gameId ?? undefined}
        data-arcade-status={status}
        className={cn(
          // Full-viewport on phones (a rhythm game needs the height), a
          // comfortable panel on desktop. `h-[100dvh]` rather than `100vh` so
          // mobile browser chrome does not crop the bottom controls.
          'flex flex-col gap-0 p-0 overflow-hidden',
          'w-screen h-[100dvh] max-w-none rounded-none',
          'sm:w-[min(92vw,900px)] sm:h-[min(86dvh,640px)] sm:max-w-none sm:rounded-2xl',
          'blobbi-card-xl border-2 border-island-wood/30',
          // Decorative entrance only. Reduced motion keeps the fade (which
          // conveys nothing) and drops the zoom (which is the moving part).
          reducedMotion &&
            'data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 duration-0',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-island-wood/20 shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-lg sm:text-xl font-bold text-island-ink truncate">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="text-sm blobbi-text-muted">
                {description}
              </DialogDescription>
            ) : (
              // Radix warns without a description; an empty one keeps the DOM
              // honest rather than inventing copy.
              <DialogDescription className="sr-only">
                {title} — arcade machine
              </DialogDescription>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canPause && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPause}
                aria-label={`Pause ${title}`}
                className="rounded-full"
              >
                Pause
              </Button>
            )}
            {canResume && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onResume}
                aria-label={`Resume ${title}`}
                className="rounded-full"
              >
                Resume
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label={`Leave ${title}`}
              className="rounded-full"
            >
              Leave
            </Button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-island-wood/20 shrink-0">
            {footer}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
