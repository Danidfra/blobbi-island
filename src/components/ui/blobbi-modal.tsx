import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStageOverlayHost } from "@/contexts/StageOverlayContext";
import { useFullscreenPortalContainer } from "@/contexts/FullscreenPortalContext";

/**
 * BlobbiModal: the island's game window.
 *
 * One frame, one header, one footer, three presentations. Every modal surface
 * in the game should be built from this rather than hand-rolling an overlay,
 * and the reason is not tidiness: the hand-rolled `absolute inset-0` overlays
 * it replaces have no focus trap, no restore-focus, no ESC, no `aria-modal`,
 * no scroll lock and no mobile presentation, and each one reinvented its own
 * backdrop, close button and header.
 *
 * ## The three presentations
 *
 * The distinction is about **what the surface belongs to**, and it is the one
 * decision a caller genuinely has to make:
 *
 * - `dialog`: **app chrome**. Settings, auth, sharing. Belongs to the
 *   application, floats over the viewport, portals into the fullscreen root so
 *   it still appears when the shell is fullscreened.
 *
 * - `in-frame`: **a thing in the world**. A shop counter, a chest, an arcade
 *   cabinet's screen. Portals into the stage host and covers the game window
 *   ONLY: on desktop the wood frame, the shell header and footer and the page
 *   behind them all stay visible. Blacking out the browser would read as "the
 *   website opened a dialog" rather than "you are standing at a machine".
 *
 * - `sheet`: a **presentation**, not a category: the mobile form of either of
 *   the above. Anchored to the bottom edge, thumb-reachable, safe-area aware.
 *
 * `presentation="auto"` (the default) resolves to `sheet` on a phone and
 * `dialog` otherwise. A caller that wants an in-world surface asks for
 * `in-frame` and gets the sheet automatically on a narrow screen, because a
 * stage a few hundred pixels wide cannot host a centered window either.
 *
 * ## What every presentation guarantees
 *
 * Focus trap, ESC, backdrop dismiss, restore-focus-on-close, scroll lock and
 * `aria-modal` come from Radix / vaul. On top of that this file guarantees a
 * consistent header (icon, title, description, close), a consistent footer
 * that stacks on mobile, a scrolling body that cannot overflow its container,
 * safe-area padding, and a themed surface with no hardcoded colour anywhere.
 */

export type BlobbiModalPresentation = "auto" | "dialog" | "sheet" | "in-frame";
export type BlobbiModalSize = "sm" | "md" | "lg" | "xl" | "full";

/**
 * Width per size for the viewport presentations.
 *
 * `min()` against a viewport unit rather than a bare `max-w-*`, so the value is
 * a genuine cap AND the window still gets side margins on a narrow screen
 * instead of touching both edges.
 */
const DIALOG_WIDTH: Record<BlobbiModalSize, string> = {
  sm: "w-[min(92vw,24rem)]",
  md: "w-[min(92vw,32rem)]",
  lg: "w-[min(94vw,42rem)]",
  xl: "w-[min(95vw,56rem)]",
  full: "w-[min(96vw,72rem)] h-[min(92dvh,56rem)]",
};

/**
 * Width per size for the in-frame presentation.
 *
 * Percentages of the STAGE, not of the viewport: `vw` would measure the browser
 * window, which is precisely the thing a contained surface is no longer sized
 * by. The margins keep a rim of the game visible around the window, which is
 * what makes it read as sitting inside the world.
 */
const IN_FRAME_WIDTH: Record<BlobbiModalSize, string> = {
  sm: "w-[min(88%,22rem)]",
  md: "w-[min(92%,30rem)]",
  lg: "w-[min(94%,38rem)]",
  xl: "w-[min(96%,48rem)]",
  full: "w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)]",
};

/* ── The shared frame language ──────────────────────────────────────────────
 *
 * A cozy window rather than a flat card, and Ditto-restrained rather than
 * heavy: one warm 2px edge, the surfaces this replaces used a 4px solid wood
 * border, which at modal scale reads as a picture frame around a form, a
 * generous radius, and the panel colour.
 *
 * The header and footer are separate BANDS in the muted panel colour, divided
 * by hairlines. That is what gives the window a title bar and an action area
 * instead of one undifferentiated box, and it is the single change that makes
 * the redesign legible at a glance.
 */
const FRAME =
  "flex flex-col overflow-hidden bg-island-cream text-island-ink " +
  "border-2 border-island-wood/35 shadow-cozy-frame";

const BAND = "shrink-0 bg-island-cream-2/70";

/** Backdrop. The scrim is the theme's own ink, never black. */
const SCRIM = "bg-island-ink/45 backdrop-blur-[2px]";

const CLOSE_BUTTON = cn(
  // 36px: comfortably over the WCAG 2.2 target minimum, and in family with the
  // 44px the game's other touch controls use.
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
  "border border-island-wood/30 bg-island-cream text-island-ink-soft",
  "shadow-cozy-soft transition-[transform,color] duration-150 ease-cozy",
  "hover:text-island-ink hover:brightness-105 active:scale-95",
  "motion-reduce:transition-none motion-reduce:active:scale-100",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream-2",
);

export interface BlobbiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The window's title, and its accessible name.
   *
   * Typed `string` rather than `ReactNode` deliberately: an unnamed dialog is
   * announced as nothing at all, and letting callers pass markup here is how a
   * title stops working as an accessible name. Put anything richer in
   * `children`.
   */
  title: string;
  /** One line under the title. Becomes the window's accessible description. */
  description?: string;
  /**
   * A decorative mark in the header, an emoji, a lucide icon, a small image.
   * Always `aria-hidden`: the title already says what this is.
   */
  icon?: React.ReactNode;
  /**
   * Hide the header's text while keeping the accessible name, for a window
   * whose own content carries the heading (an artwork board, a full-bleed
   * minigame). The close button stays.
   */
  hideHeader?: boolean;
  children?: React.ReactNode;
  /** Action area. Stacks full-width on mobile, right-aligns on desktop. */
  footer?: React.ReactNode;
  presentation?: BlobbiModalPresentation;
  size?: BlobbiModalSize;
  /** Extra classes for the window frame. */
  className?: string;
  /** Extra classes for the scrolling body; use to override its padding. */
  bodyClassName?: string;
  /** Hide the close button, for a flow the player must resolve. */
  hideClose?: boolean;
  /**
   * Portal target override. Left alone, each presentation picks the right one:
   * the fullscreen root for `dialog` and `sheet`, the stage host for
   * `in-frame`.
   */
  container?: HTMLElement;
}

/** The header band: icon, title, description, close. */
function Header({
  title,
  description,
  icon,
  hideHeader,
  hideClose,
  CloseSlot,
  TitleSlot,
  DescriptionSlot,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  hideHeader: boolean;
  hideClose: boolean;
  CloseSlot: React.ElementType;
  TitleSlot: React.ElementType;
  DescriptionSlot: React.ElementType;
}) {
  const closeButton = hideClose ? null : (
    <CloseSlot className={CLOSE_BUTTON}>
      <X className="size-4" />
      <span className="sr-only">Close</span>
    </CloseSlot>
  );

  if (hideHeader) {
    return (
      <>
        <TitleSlot asChild>
          <span className="sr-only">{title}</span>
        </TitleSlot>
        {description ? <DescriptionSlot className="sr-only">{description}</DescriptionSlot> : null}
        {closeButton ? <div className="absolute right-3 top-3 z-10">{closeButton}</div> : null}
      </>
    );
  }

  return (
    <div
      className={cn(
        BAND,
        "flex items-center gap-3 border-b border-island-wood/20 px-4 py-3 sm:px-5",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-island-wood/25 bg-island-sand text-xl leading-none shadow-cozy-soft [&_svg]:size-5 [&_svg]:text-island-wood-dark"
        >
          {icon}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        {/* `island-display` is the opt-in for a theme's TITLE font (Ditto's
            `titleFont`). A game window's title is display typography, the one
            place in the frame where a decorative face belongs. The description
            below it stays in the body font so it remains readable. */}
        <TitleSlot className="island-display truncate text-base font-bold leading-tight text-island-ink sm:text-lg">
          {title}
        </TitleSlot>
        {description ? (
          // A SIBLING of the title, never nested inside it. Nesting makes the
          // description part of the accessible NAME, so a screen reader reads
          // the whole paragraph every time focus enters the window instead of
          // announcing the title and offering the description separately.
          <DescriptionSlot className="mt-0.5 line-clamp-2 text-xs leading-snug text-island-ink-soft sm:text-sm">
            {description}
          </DescriptionSlot>
        ) : null}
      </div>

      {closeButton}
    </div>
  );
}

/** The action band. Stacked and full-width on mobile, inline and right on desktop. */
function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        BAND,
        // `flex-col-reverse` so the primary action, written last, as it reads
        // in source: ends up on TOP of the stack on a phone, nearest the
        // thumb, while still sitting on the RIGHT on desktop.
        "flex flex-col-reverse gap-2 border-t border-island-wood/20 px-4 py-3 sm:flex-row sm:justify-end sm:px-5",
        // WRAP rather than squeeze. Flex items shrink by default, so a row of
        // actions too wide for the window used to be compressed until the
        // labels no longer fit their pills, worst on the narrow in-frame
        // widths, which are a percentage of the stage rather than of the
        // browser. `shrink-0` makes the label the minimum and `flex-wrap` gives
        // the overflow somewhere to go: a second right-aligned line.
        "sm:flex-wrap sm:[&>*]:shrink-0",
        "[&>*]:w-full sm:[&>*]:w-auto",
      )}
    >
      {children}
    </div>
  );
}

export function BlobbiModal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  hideHeader = false,
  children,
  footer,
  presentation = "auto",
  size = "md",
  className,
  bodyClassName,
  hideClose = false,
  container,
}: BlobbiModalProps) {
  const isMobile = useIsMobile();
  const stageHost = useStageOverlayHost();
  const fullscreenHost = useFullscreenPortalContainer();

  /*
    Resolve the presentation.

    A phone gets the sheet whatever was asked for, `in-frame` included: a stage
    a few hundred pixels wide cannot host a centered window either, and the
    sheet is the correct mobile form of both categories.

    `in-frame` also falls back to `dialog` when there is no stage host, a unit
    test rendering a room on its own, or a surface used outside the shell. Its
    positioning is `absolute` within the host, so without one it would resolve
    against the document and land somewhere arbitrary.
  */
  const requested = presentation === "auto" ? (isMobile ? "sheet" : "dialog") : presentation;
  const resolved =
    isMobile && requested === "in-frame"
      ? "sheet"
      : requested === "in-frame" && !stageHost
        ? "dialog"
        : requested;

  const portal = container ?? (resolved === "in-frame" ? stageHost : fullscreenHost);

  /*
    Radix points `aria-describedby` at a generated id whether or not anything
    renders a Description, and warns when nothing claims it. Clearing the
    attribute is the documented fix and the correct markup, a window with no
    description should not advertise one.

    Spread conditionally rather than written inline: the key must be ABSENT
    when there IS a description, because a present key holding `undefined`
    still wins the spread and would delete the id Radix set.
  */
  const noDescription = description ? {} : { "aria-describedby": undefined };

  if (resolved === "sheet") {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
        <DrawerPrimitive.Portal container={portal}>
          <DrawerPrimitive.Overlay className={cn("fixed inset-0 z-50", SCRIM)} />
          <DrawerPrimitive.Content
            {...noDescription}
            data-block-move
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 mt-16",
              FRAME,
              "rounded-b-none rounded-t-frame border-x-0 border-b-0 border-t-2",
              // `dvh`, not `vh`: a mobile browser's toolbar appears and
              // disappears mid-scroll, and `vh` measures the tallest state, so
              // the footer would sit under the toolbar exactly when the player
              // reached for it.
              size === "full" ? "h-[92dvh]" : "max-h-[92dvh]",
              className,
            )}
          >
            {/* Drag handle: an affordance for the gesture vaul already provides. */}
            <div className="mx-auto mb-1 mt-3 h-1.5 w-12 shrink-0 rounded-full bg-island-wood/30" />
            <Header
              title={title}
              description={description}
              icon={icon}
              hideHeader={hideHeader}
              hideClose={hideClose}
              CloseSlot={DrawerPrimitive.Close}
              TitleSlot={DrawerPrimitive.Title}
              DescriptionSlot={DrawerPrimitive.Description}
            />
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5",
                bodyClassName,
              )}
            >
              {children}
            </div>
            {footer ? <Footer>{footer}</Footer> : null}
            {/* The home indicator sits below the footer band, so the inset goes
                on the frame's last child rather than on the scrolling body. */}
            <div className="h-[env(safe-area-inset-bottom)] shrink-0 bg-island-cream-2/70" />
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  const inFrame = resolved === "in-frame";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portal}
        inFrame={inFrame}
        hideDefaultClose
        {...noDescription}
        data-block-move
        className={cn(
          FRAME,
          // `gap-0` and `max-w-none` undo two things DialogContent's own base
          // classes supply for a padded card: a 1rem gap between children,
          // which would separate the header band from the body, and a `max-w-lg`
          // cap that would silently clamp the `lg`, `xl` and `full` sizes to
          // 32rem. Both branches need the cap removed, the in-frame widths are
          // percentages of the stage, and a 32rem ceiling on top of them is a
          // second, invisible width rule. tailwind-merge resolves the rest
          // (display, padding, radius, background, shadow) in favour of the frame.
          "max-w-none gap-0 rounded-frame p-0 sm:rounded-frame",
          inFrame ? IN_FRAME_WIDTH[size] : DIALOG_WIDTH[size],
          inFrame ? "max-h-[calc(100%-1.5rem)]" : "max-h-[90dvh]",
          className,
        )}
      >
        <Header
          title={title}
          description={description}
          icon={icon}
          hideHeader={hideHeader}
          hideClose={hideClose}
          CloseSlot={DialogPrimitive.Close}
          TitleSlot={DialogTitle}
          DescriptionSlot={DialogDescription}
        />
        <div
          className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5", bodyClassName)}
        >
          {children}
        </div>
        {footer ? <Footer>{footer}</Footer> : null}
      </DialogContent>
    </Dialog>
  );
}
