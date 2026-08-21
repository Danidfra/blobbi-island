import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * BlobbiModal — the cozy game modal.
 *
 * ## What it is
 *
 * A COMPOSITION over the canonical `Dialog` and vaul `Drawer` primitives, not a
 * rival implementation of them. It adds the two things a game modal needs that
 * a generic dialog does not:
 *
 *  - **A presentation that changes with the viewport.** Centered card on
 *    desktop; bottom sheet on a phone, where a centered card puts the primary
 *    action out of thumb reach and the close button in the worst corner of the
 *    screen. This is the Phase-11 rule that a dialog must not merely shrink.
 *  - **The cozy frame** — wood edge, cream panel, plaque title — expressed once
 *    so a shop, a chest and a settings surface are recognisably the same object
 *    in the world rather than three hand-built overlays that drifted.
 *
 * Everything underneath (focus trap, ESC, backdrop dismiss, `aria-modal`,
 * restore-focus-on-close, scroll lock) comes from the primitives. The Island's
 * hand-rolled `absolute inset-0` overlays have none of it; see
 * `docs/design-system.md` for the list still to migrate.
 *
 * ## Colours
 *
 * Every colour here is a token. A theme changes what this modal looks like
 * without this file being touched — including Lantern Night, where `cream`
 * becomes a dark panel and `ink` becomes light.
 */

interface BlobbiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Plaque-style title. Also the modal's accessible name.
   *
   * Required, and typed as `string` rather than `ReactNode` on purpose: an
   * unnamed dialog is announced as nothing at all, and letting callers pass
   * markup here is how a title stops being usable as an accessible name. Use
   * `children` for anything richer than a line of text.
   */
  title: string;
  /** One line under the title. Becomes the dialog's accessible description. */
  description?: string;
  /**
   * Hide the plaque while keeping the accessible name. For a modal whose own
   * content already carries the heading (an artwork board, a full-bleed game).
   */
  hideTitle?: boolean;
  children?: React.ReactNode;
  /** Footer actions. Stacked on mobile, right-aligned on desktop. */
  footer?: React.ReactNode;
  className?: string;
  /** Hide the close button, e.g. for a forced flow. */
  hideClose?: boolean;
  /** Force a presentation regardless of viewport. Default: by screen size. */
  variant?: "auto" | "dialog" | "sheet";
  /**
   * Portal target. Pass `useFullscreenPortalContainer()` for app chrome, so the
   * modal still renders above the game while the shell is fullscreened —
   * anything left in `document.body` is outside the fullscreened element and
   * appears not to open at all.
   */
  container?: HTMLElement;
}

/** The close affordance, identical in both presentations. */
function closeButtonClass(extra?: string) {
  return cn(
    "absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full",
    "bg-island-cream-2 text-island-ink border border-island-wood/30",
    "shadow-cozy-soft transition-transform duration-150 ease-cozy",
    "hover:brightness-105 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream",
    extra,
  );
}

/**
 * The carved-sign title treatment shared by both presentations.
 *
 * Title and description are rendered as SEPARATE elements — the title into the
 * primitive's Title slot, the description into its Description slot — rather
 * than as one styled block handed to Title via `asChild`. Nesting them makes
 * the description part of the dialog's accessible NAME, so a screen reader
 * announces the entire paragraph every time focus enters the dialog instead of
 * announcing "Theme, dialog" and offering the description as the description.
 */
const PlaqueTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  // Forwards ref and props because it is rendered through `asChild`: Radix
  // hands the Title slot's `id` down to whatever element it wraps, and that id
  // is what `aria-labelledby` on the dialog points at. A component that
  // swallows its props here leaves the dialog with no accessible name at all.
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("text-center", className)} {...props}>
      <span className="inline-flex items-center justify-center rounded-full bg-island-sand px-4 py-1 font-semibold text-island-wood-dark shadow-cozy-soft">
        {children}
      </span>
    </div>
  ),
);
PlaqueTitle.displayName = "PlaqueTitle";

function plaqueDescriptionClass(hidden: boolean) {
  return hidden ? "sr-only" : "px-2 pt-1.5 text-center text-sm text-island-ink-soft";
}

export function BlobbiModal({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  children,
  footer,
  className,
  hideClose = false,
  variant = "auto",
  container,
}: BlobbiModalProps) {
  const isMobile = useIsMobile();
  const useSheet = variant === "sheet" || (variant === "auto" && isMobile);

  /*
    Radix points `aria-describedby` at a generated id whether or not anything
    renders a Description, and warns when nothing claims it. Clearing the
    attribute is the documented fix, and it is also the correct markup — a
    dialog with no description should not advertise one.

    Spread conditionally rather than written as
    `aria-describedby={description ? undefined : undefined}`: the key must be
    ABSENT when there IS a description, because a present key with an undefined
    value still wins the spread and would delete the id Radix set.
  */
  const noDescription = description ? {} : { "aria-describedby": undefined };

  if (useSheet) {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
        <DrawerPrimitive.Portal container={container}>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-island-ink/40 backdrop-blur-[2px]" />
          <DrawerPrimitive.Content
            {...noDescription}
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92dvh] flex-col rounded-t-frame",
              "border-t-4 border-island-wood bg-island-cream text-island-ink",
              // `dvh` above and the safe-area inset below are what keep the
              // sheet clear of an iOS home indicator and of a browser toolbar
              // that appears mid-scroll.
              "pb-[max(1rem,env(safe-area-inset-bottom))] shadow-cozy-frame",
              className,
            )}
          >
            {/* The drag handle: decoration for the gesture vaul already provides. */}
            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-island-wood/30" />
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              <div className="shrink-0">
                <DrawerPrimitive.Title asChild>
                  {hideTitle ? (
                    <span className="sr-only">{title}</span>
                  ) : (
                    <PlaqueTitle>{title}</PlaqueTitle>
                  )}
                </DrawerPrimitive.Title>
                {description ? (
                  <DrawerPrimitive.Description className={plaqueDescriptionClass(hideTitle)}>
                    {description}
                  </DrawerPrimitive.Description>
                ) : null}
              </div>
              <div className="flex-1">{children}</div>
              {footer ? <div className="flex flex-col gap-2">{footer}</div> : null}
            </div>
            {!hideClose && (
              <DrawerPrimitive.Close className={closeButtonClass()}>
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DrawerPrimitive.Close>
            )}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container}
        hideDefaultClose
        {...noDescription}
        className={cn(
          "w-[min(92vw,32rem)] max-h-[90dvh] overflow-y-auto",
          "rounded-frame border-4 border-island-wood bg-island-cream p-6 text-island-ink shadow-cozy-frame",
          "sm:rounded-frame",
          className,
        )}
      >
        <div>
          <DialogTitle asChild>
            {hideTitle ? (
              <span className="sr-only">{title}</span>
            ) : (
              <PlaqueTitle>{title}</PlaqueTitle>
            )}
          </DialogTitle>
          {description ? (
            <DialogDescription className={plaqueDescriptionClass(hideTitle)}>
              {description}
            </DialogDescription>
          ) : null}
        </div>
        <div>{children}</div>
        {footer ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        ) : null}
        {!hideClose && (
          <DialogPrimitive.Close className={closeButtonClass()}>
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogContent>
    </Dialog>
  );
}
