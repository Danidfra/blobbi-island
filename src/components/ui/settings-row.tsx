import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * SettingsRow: the island's list row.
 *
 * `[icon] Label / description ……………… [value] [control or chevron]`
 *
 * Ditto's settings rows are the clearest thing in its UI, and the shape
 * transfers directly: a fixed-size icon, a two-line text block that truncates,
 * and a trailing slot that is either a value, a control, or a chevron meaning
 * "this opens something". What does not transfer is the flat grey; here the row
 * lives on the island's panel colours and presses like a game button.
 *
 * Despite the name it is not only for settings. Any list where the player picks
 * one of several labelled things, the account menu, the elevator's floors, a
 * list of relays, is this row. The alternative is what the game had: five
 * hand-written `flex items-center gap-2 rounded-md p-2 hover:bg-…` strings that
 * had already drifted apart on padding, radius and hover colour.
 *
 * ## Interactive or not
 *
 * Pass `onClick` (or `href`) and it renders a real `<button>`/`<a>` with hover,
 * press and focus states. Omit it and it renders a `<div>`: for a row whose
 * trailing slot holds the control, like a Switch, where making the whole row a
 * button would nest an interactive element inside another one.
 */

export interface SettingsRowProps {
  /** Decorative mark: an emoji, a lucide icon, a small image. Never announced. */
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** Secondary line. Truncates to one line; keep it short. */
  description?: React.ReactNode;
  /**
   * Trailing content: a value, a Switch, a Badge. A row with a control here
   * should NOT also be clickable, put the interaction on the control.
   */
  trailing?: React.ReactNode;
  /** Makes the row a button. Adds a chevron unless `trailing` is given. */
  onClick?: () => void;
  /** Makes the row a link. Adds a chevron unless `trailing` is given. */
  href?: string;
  /** Renders in the danger colour, log out, delete, leave. */
  tone?: "default" | "danger";
  /**
   * Marks the row as the current one in a list.
   *
   * Emits `aria-current` as well as the tint, so the state is not colour-only.
   * `aria-current` is the right attribute for a list of destinations or
   * settings; a list of mutually exclusive OPTIONS wants radio semantics
   * instead, which is a different control; see ThemePicker.
   */
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  /** Escape hatch for the rare row that needs its own body. Replaces label/description. */
  children?: React.ReactNode;
}

export function SettingsRow({
  icon,
  label,
  description,
  trailing,
  onClick,
  href,
  tone = "default",
  selected = false,
  disabled = false,
  className,
  children,
}: SettingsRowProps) {
  const interactive = Boolean(onClick || href) && !disabled;
  const danger = tone === "danger";

  const body = children ?? (
    <span className="min-w-0 flex-1 text-left">
      <span
        className={cn(
          "block truncate text-sm font-semibold",
          danger ? "text-island-danger" : "text-island-ink",
        )}
      >
        {label}
      </span>
      {description ? (
        <span className="mt-0.5 block truncate text-xs text-island-ink-soft">{description}</span>
      ) : null}
    </span>
  );

  const content = (
    <>
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border text-base leading-none",
            "[&_svg]:size-[1.05rem]",
            danger
              ? "border-island-danger/30 bg-island-danger/10 text-island-danger"
              : selected
                ? "border-island-purple/40 bg-island-purple/15 text-island-purple"
                : "border-island-wood/25 bg-island-cream text-island-wood-dark",
          )}
        >
          {icon}
        </span>
      ) : null}

      {body}

      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-sm text-island-ink-soft">
          {trailing}
        </span>
      ) : interactive ? (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-island-ink-soft/70" />
      ) : null}
    </>
  );

  const shell = cn(
    // 44px minimum height is the touch target, and it is the reason the row
    // sets `min-h` rather than relying on its content: a row with no
    // description would otherwise come out at 36px.
    "flex w-full min-h-[44px] items-center gap-3 rounded-xl px-2.5 py-2 text-left",
    selected
      ? "bg-island-purple/10 ring-1 ring-inset ring-island-purple/35"
      : "ring-1 ring-inset ring-transparent",
    interactive && [
      "cursor-pointer transition-[background-color,transform] duration-150 ease-cozy",
      danger ? "hover:bg-island-danger/10" : "hover:bg-island-cream-2",
      "active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-island-cream",
    ],
    disabled && "cursor-not-allowed opacity-55",
    className,
  );

  if (href && !disabled) {
    return (
      <a href={href} aria-current={selected || undefined} className={shell}>
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={selected || undefined}
        className={shell}
      >
        {content}
      </button>
    );
  }

  return <div className={shell}>{content}</div>;
}

/**
 * A titled group of rows.
 *
 * The rows sit on the panel with a hairline between them rather than each
 * carrying its own border; one line between two rows, not two stacked. The
 * label is outside the group, in the small-caps style Ditto uses for settings
 * sections, so the group itself stays quiet.
 */
export function SettingsSection({
  label,
  icon,
  children,
  className,
}: {
  label?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {label ? (
        <h3 className="island-display flex items-center gap-1.5 px-1 text-[0.6875rem] font-bold uppercase tracking-wider text-island-ink-soft">
          {icon ? (
            <span aria-hidden className="[&_svg]:size-3.5">
              {icon}
            </span>
          ) : null}
          {label}
        </h3>
      ) : null}
      <div className="rounded-panel border border-island-wood/20 bg-island-cream p-1 shadow-cozy-soft">
        {children}
      </div>
    </section>
  );
}
