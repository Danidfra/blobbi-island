import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    /**
     * When true, the overlay covers its portal CONTAINER (absolute) with a
     * lighter, game-like backdrop instead of blacking out the whole viewport.
     * Used by in-frame dialogs portaled into the game shell root.
     */
    inFrame?: boolean
  }
>(({ className, inFrame, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      inFrame
        ? "absolute inset-0 bg-island-ink/20"
        : "fixed inset-0 bg-black/80",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass the game shell root to render inside the game window. */
    container?: HTMLElement | null
    /**
     * Render the dialog INSIDE its portal container (the game window) rather
     * than over the whole viewport: the overlay becomes absolute with a lighter
     * backdrop, and the content is absolutely centered within the container.
     * Pair with `container` set to the game shell root.
     */
    inFrame?: boolean
    /**
     * Suppress the built-in top-right close button.
     *
     * For dialogs that provide their own header controls (the arcade game
     * shell), the default X would overlap them and give the same dialog two
     * close affordances.
     */
    hideDefaultClose?: boolean
  }
>(({ className, children, container, inFrame, hideDefaultClose, ...props }, ref) => (
  <DialogPortal container={container ?? undefined}>
    <DialogOverlay inFrame={inFrame} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 grid w-full max-w-lg gap-4 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        inFrame
          ? // Centered within the portal container (the game window). Soft,
            // game-like entrance: just fade + a gentle scale/pop (NO slide).
            // motion-reduce disables the scale so it only fades.
            "absolute left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] duration-300 ease-cozy data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 motion-reduce:data-[state=closed]:zoom-out-100 motion-reduce:data-[state=open]:zoom-in-100"
          : "fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg duration-200 sm:rounded-lg data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      {children}
      {!inFrame && !hideDefaultClose && (
        // ONE element, not two. `DialogPrimitive.Close` already renders a
        // `<button>`; wrapping a second `<button>` inside it produced invalid
        // DOM (`validateDOMNesting: <button> cannot appear as a descendant of
        // <button>`), two overlapping hit targets and two accessible names.
        //
        // The merged geometry is the OLD geometry: the outer Close was a
        // zero-width box pinned at `right-4 top-4` (both its children were out
        // of flow), and the visible circle sat at `right-1` inside it — i.e.
        // 1rem + 0.25rem = 1.25rem from the content edge. Hence `right-5`.
        // `transition` replaces the pair `transition-opacity` (outer) and
        // `transition-colors` (inner) now that one element owns both.
        <DialogPrimitive.Close className="absolute right-5 top-4 rounded-full border border-island-wood/30 bg-island-cream p-1.5 text-island-ink-soft shadow-cozy-soft ring-offset-background transition hover:text-island-ink hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

/**
 * Sizing and padding for a normal CARD dialog rendered with `inFrame`.
 *
 * ## Why this exists
 *
 * The two branches above are not symmetrical, and the asymmetry is easy to miss:
 * the body-portal branch carries `p-6` (plus `border`, `bg-background`,
 * `shadow-lg`), and the `inFrame` branch carries **positioning and animation
 * only**. That is deliberate — the in-frame dialogs written first are full-bleed
 * artwork boards that pass `p-0 border-0 bg-transparent` — but it means a dialog
 * MOVED from `document.body` to a frame silently loses all of its padding, and
 * its `w-full` starts resolving against the game stage instead of the viewport,
 * so it also loses its side margins.
 *
 * That is exactly what happened to the three arcade dialogs when they were
 * contained: `blobbi-card-xl` supplies background, border, radius and shadow but
 * no padding, so their titles ended up flush against the card edge and the card
 * itself was flush against the stage.
 *
 * ## The rule
 *
 * - `w-[calc(100%-2rem)]` — 1rem of visible stage on each side, at every size.
 *   Percent of the STAGE, not of the viewport: `vw` units would measure the
 *   browser window, which is the thing a contained dialog is no longer sized by.
 * - `max-w-md` — a normal card on desktop, where the stage is wide.
 * - `max-h-[calc(100%-2rem)]` + `overflow-y-auto` — a tall dialog scrolls inside
 *   itself instead of overflowing the stage, which the frame's `overflow-hidden`
 *   would otherwise clip.
 * - `p-5 sm:p-6` — the padding the body-portal branch would have given it.
 *
 * Callers append their own surface classes (`blobbi-card-xl`, borders, radius).
 * Anything here can still be overridden per dialog: `cn()` is tailwind-merge, so
 * a later `max-w-lg` or `p-0` wins.
 */
export const inFrameDialogPanelClass =
  "w-[calc(100%-2rem)] max-w-md max-h-[calc(100%-2rem)] overflow-y-auto p-5 sm:p-6"

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
