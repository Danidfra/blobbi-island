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
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <button
            className="absolute top-0 right-1 text-white bg-black/50 rounded-full p-1.5 hover:bg-black/75 transition-colors"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

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
