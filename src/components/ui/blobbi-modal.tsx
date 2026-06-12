import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * BlobbiModal — the single cozy modal base for Blobbi Island.
 *
 * - Desktop: a centered Radix Dialog with a cream/wood cozy frame.
 * - Mobile: a vaul bottom-sheet (Drawer), better for thumb reach.
 * Both share one consistent close button, focus trap (free via the
 * underlying primitives), ESC-to-close and backdrop dismiss.
 *
 * This replaces the 8 hand-rolled overlays + assorted Dialog usages.
 * Migrating existing modals onto it happens in a later phase; this file
 * only introduces the primitive.
 */

interface BlobbiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Plaque-style title shown in the header. Omit to render no header. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Footer area (action buttons). */
  footer?: React.ReactNode;
  className?: string;
  /** Hide the close button (e.g. for forced flows). Default false. */
  hideClose?: boolean;
  /** Force a presentation regardless of viewport. Default: auto by screen. */
  variant?: "auto" | "dialog" | "sheet";
}

function CloseButton({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full",
        "bg-island-cream-2 text-island-ink border border-island-wood/30",
        "shadow-cozy-soft transition-transform duration-150 ease-cozy",
        "hover:brightness-105 active:scale-95",
        className
      )}
      aria-hidden
    >
      <X className="size-4" />
    </span>
  );
}

function Plaque({ title, description }: { title?: React.ReactNode; description?: React.ReactNode }) {
  if (!title && !description) return null;
  return (
    <div className="text-center space-y-1">
      {title ? (
        <div className="inline-flex items-center justify-center rounded-full bg-island-sand px-4 py-1 text-island-wood-dark font-semibold shadow-cozy-soft">
          {title}
        </div>
      ) : null}
      {description ? (
        <p className="text-sm text-island-ink-soft px-2">{description}</p>
      ) : null}
    </div>
  );
}

export function BlobbiModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  hideClose = false,
  variant = "auto",
}: BlobbiModalProps) {
  const isMobile = useIsMobile();
  const useSheet = variant === "sheet" || (variant === "auto" && isMobile);

  if (useSheet) {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-island-ink/40 backdrop-blur-[2px]" />
          <DrawerPrimitive.Content
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92dvh] flex-col rounded-t-[1.5rem]",
              "border-t-4 border-island-wood bg-island-cream",
              "pb-[max(1rem,env(safe-area-inset-bottom))] shadow-cozy-frame",
              className
            )}
          >
            <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-island-wood/30" />
            <div className="flex flex-col gap-4 overflow-y-auto p-5">
              {(title || description) && (
                <DrawerPrimitive.Title asChild>
                  <div>
                    <Plaque title={title} description={description} />
                  </div>
                </DrawerPrimitive.Title>
              )}
              <div className="flex-1">{children}</div>
              {footer ? <div className="flex flex-col gap-2">{footer}</div> : null}
            </div>
            {!hideClose && (
              <DrawerPrimitive.Close className="absolute right-4 top-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
                <CloseButton />
                <span className="sr-only">Close</span>
              </DrawerPrimitive.Close>
            )}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-island-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,32rem)] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto",
            "rounded-[1.5rem] border-4 border-island-wood bg-island-cream p-6 shadow-cozy-frame",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className
          )}
        >
          {(title || description) && (
            <DialogPrimitive.Title asChild>
              <div>
                <Plaque title={title} description={description} />
              </div>
            </DialogPrimitive.Title>
          )}
          <div>{children}</div>
          {footer ? <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
          {!hideClose && (
            <DialogPrimitive.Close className="absolute right-4 top-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
              <CloseButton />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
