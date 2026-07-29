import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useStageOverlayHost } from '@/contexts/StageOverlayContext';
import type { ArcadeStatus } from '@/arcade/arcade-machine-state';

/**
 * ArcadeGameShell — the one dialog surface the arcade puts on screen.
 *
 * Three things are shown inside it, and it knows the difference only as a
 * `surface` string: the shared game **catalogue**, a running **game**, and a
 * **notice** panel for something that is not a game at all (the prize counter).
 * One dialog for all three is the point — nested modals that fight each other
 * over focus and Escape were the alternative.
 *
 * Replaces `GameModal`, which was a plain `absolute inset-0` div rendered INSIDE
 * `VirtualWorld`. That put it inside the world's uniform scale transform and
 * clipped it to the fixed 1046 × 697 box, so on a narrow viewport its text was
 * scaled down with the room and a game could never use the full screen. So it
 * became a Radix `Dialog` — and then overcorrected, portaling to `document.body`
 * and covering the entire browser page.
 *
 * ## Where it renders now: inside the game window
 *
 * A cabinet's screen belongs to the GAME, not to the website. Blacking out the
 * browser page around the cozy wood frame reads as "this site opened a dialog";
 * covering just the game window reads as "you are standing at a machine". So the
 * shell portals into the stage overlay host that `BlobbiFrame` provides
 * (`src/contexts/StageOverlayContext.tsx`) and lays itself out against THAT box:
 *
 *  - **desktop** — the overlay fills the framed canvas. The wood frame, the shell
 *    header and footer, and the page behind them stay visible and untouched;
 *  - **immersive / fullscreen** — the same host IS the screen, so one rule covers
 *    every presentation and there is no second code path to keep in step;
 *  - **no host** (a unit test rendering a room on its own) — `undefined` falls
 *    back to `document.body`, which is Radix's default, so nothing has to guard.
 *
 * The host sits OUTSIDE the world's subtree, so this does not reintroduce the
 * scale-transform bug `GameModal` had: the shell is measured against the stage
 * box, never against the 1046 × 697 world.
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
  /**
   * Drives the pause/exit controls.
   *
   * Optional, because two of the three surfaces this shell now hosts have no
   * run: the catalogue and the prize-counter panel are screens, not runs, and
   * giving them a borrowed `ArcadeStatus` would be exactly the "overload the
   * lifecycle with UI concepts" mistake `arcade-navigation.ts` exists to avoid.
   * When absent, `data-arcade-status` is absent too.
   */
  status?: ArcadeStatus;
  /**
   * Which kind of surface this is: `catalogue`, `game` or `notice`. Rendered as
   * `data-arcade-surface` so a test can tell the three apart without inferring
   * it from whatever text happens to be inside.
   */
  surface?: 'catalogue' | 'game' | 'notice';
  /**
   * Visible text on the dismiss control.
   *
   * It must describe the DESTINATION, and the destination changes: leaving a
   * live run abandons it, leaving a results screen goes back to the game list,
   * and closing the game list goes back to the room. One control, one label,
   * chosen by whoever knows where it goes.
   */
  closeLabel?: string;
  /** Accessible name for the dismiss control. Defaults to `${closeLabel} ${title}`. */
  closeAriaLabel?: string;
  /** Present only when a run can be paused. */
  onPause?: () => void;
  onResume?: () => void;
  /** The game surface, or a preview/coming-soon panel. */
  children: React.ReactNode;
  /** Actions rendered along the bottom (Start, Play again, Close, …). */
  footer?: React.ReactNode;
  className?: string;
  /**
   * Overrides for the scrolling content area.
   *
   * The default is right for a panel of text. It is wrong for a LIVE run: a
   * stray drag on a phone scrolls the lanes off screen mid-song, and the padding
   * that makes a paragraph readable is playfield a rhythm game needs. A game
   * passes `overflow-hidden` and tighter padding for exactly the statuses where
   * a run is on screen, and nothing else changes.
   */
  contentClassName?: string;
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
  surface,
  closeLabel = 'Leave',
  closeAriaLabel,
  onPause,
  onResume,
  children,
  footer,
  className,
  contentClassName,
}: ArcadeGameShellProps) {
  const reducedMotion = useReducedMotion();
  const overlayHost = useStageOverlayHost();

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

  const canPause = status !== undefined && PAUSABLE.includes(status) && Boolean(onPause);
  const canResume = status === 'paused' && Boolean(onResume);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        // Render inside the game window rather than over the browser page. The
        // pair is deliberate: `container` decides WHERE the portal lands, and
        // `inFrame` switches the overlay from `fixed inset-0` with a black
        // backdrop to `absolute inset-0` with the island's soft one.
        container={overlayHost}
        inFrame
        // The header carries Pause / Resume / the dismiss control, so the default
        // top-right X would both overlap them and give one dialog two close
        // affordances.
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
        data-arcade-surface={surface}
        className={cn(
          'flex flex-col gap-0 p-0 overflow-hidden',
          /*
            Sized against the STAGE, not the viewport.
            `inset-0` (with the centring transform cancelled) makes the surface
            exactly the game window, which is what a machine's screen should be.
            Viewport units are deliberately gone: `w-screen h-[100dvh]` measured
            the browser page, which is precisely the thing this dialog must no
            longer be the size of.

            A small inset on wider screens lets the room show through the soft
            backdrop, so the player can still see where they are standing.
          */
          'absolute inset-0 translate-x-0 translate-y-0 left-0 top-0',
          'h-auto w-auto max-w-none rounded-none',
          'sm:inset-3 sm:rounded-2xl',
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
                className="rounded-full min-h-[44px]"
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
                className="rounded-full min-h-[44px]"
              >
                Resume
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-arcade-close
              onClick={onClose}
              aria-label={closeAriaLabel ?? `${closeLabel} ${title}`}
              className="rounded-full min-h-[44px]"
            >
              {closeLabel}
            </Button>
          </div>
        </header>

        <div
          data-arcade-content
          className={cn('flex-1 min-h-0 overflow-y-auto px-4 py-4', contentClassName)}
        >
          {children}
        </div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-island-wood/20 shrink-0">
            {footer}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
