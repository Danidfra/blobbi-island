import * as React from "react";

import { cn } from "@/lib/utils";
import { CoinIcon } from "@/components/blobbi/CoinAmount";

/**
 * The island's economy vocabulary: an item tile, a price, a count.
 *
 * ## Why these three and no more
 *
 * Four surfaces were drawing the same thing four ways. The shop built it from
 * `Card` + `CardHeader` + `CardFooter`; the item bag built it twice in the same
 * file, once as a `<div>` and once as a `<Button>`, with the quantity badge
 * `bg-amber-500` in one and `bg-blue-500` in the other, the same concept in
 * two colours, neither of them a token. The prize counter built a third.
 *
 * So: one tile, one price, one count. Nothing beyond that is abstracted here.
 * There is no `ItemGrid`, because a grid is one Tailwind class and every
 * surface wants different columns; and no `InventorySection`, because the
 * sections differ in more than presentation.
 *
 * ## What a tile is NOT responsible for
 *
 * Ownership, affordability, stack limits and what a click does are the
 * caller's. The tile renders `selected`, `disabled` and `affordable` as
 * appearance and nothing else; it never decides them. Keeping that line sharp
 * is what makes it safe to drop into economy surfaces without touching
 * economy rules.
 */

export interface ItemTileProps extends React.HTMLAttributes<HTMLElement> {
  /** The artwork: an `<img>`, an emoji, a renderer. Always decorative. */
  art: React.ReactNode;
  name: string;
  /** Coin price. Renders a PriceTag under the name. */
  price?: number;
  /** Whether the player can afford `price`. Appearance only. */
  affordable?: boolean;
  /** Owned count. Renders the corner badge. Omit or pass 0 for none. */
  quantity?: number;
  /** Marks the tile as chosen, the equipped item, the selected prize. */
  selected?: boolean;
  disabled?: boolean;
  /** Makes the tile a button. Without it the tile is a static `<div>`. */
  onClick?: () => void;
  /** Small text under the price, "Equipped", "Sold out", a rarity. */
  footnote?: React.ReactNode;
  /** Controls in the tile's own footer, e.g. the shop's − / + stepper. */
  children?: React.ReactNode;
  className?: string;
  /**
   * Anything else lands on the root element, `data-*` hooks, `aria-*`,
   * `title`. Extending `HTMLAttributes` rather than enumerating them keeps the
   * tile usable as a drop-in for the hand-written tiles it replaces, which
   * carried their own data attributes.
   */
}

export function ItemTile({
  art,
  name,
  price,
  affordable = true,
  quantity,
  selected = false,
  disabled = false,
  onClick,
  footnote,
  children,
  className,
  ...rest
}: ItemTileProps) {
  const interactive = Boolean(onClick) && !disabled;

  const shell = cn(
    "relative flex flex-col items-center gap-1 rounded-panel border p-2 text-center",
    selected
      ? "border-island-purple/50 bg-island-purple/10 shadow-cozy-soft"
      : "border-island-wood/20 bg-island-cream shadow-cozy-soft",
    interactive && [
      "cursor-pointer transition-[transform,border-color] duration-150 ease-cozy",
      "hover:-translate-y-0.5 hover:border-island-wood/40 active:scale-[0.98]",
      "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream",
    ],
    disabled && "opacity-55",
    className,
  );

  const body = (
    <>
      {/*
        The artwork is `aria-hidden` because the name is rendered as text
        directly beneath it: an `alt` here would have a screen reader announce
        the item twice. `data-item-art` exists so a test can still find the
        image it used to find by `alt`, without the markup having to be wrong
        for the sake of the locator.
      */}
      <span
        aria-hidden
        data-item-art
        className="flex h-16 w-full items-center justify-center overflow-hidden text-4xl [&_img]:max-h-full [&_img]:w-auto [&_img]:object-contain"
      >
        {art}
      </span>

      <span className="w-full truncate text-xs font-semibold text-island-ink sm:text-sm">
        {name}
      </span>

      {price !== undefined ? <PriceTag amount={price} affordable={affordable} /> : null}

      {footnote ? (
        <span className="text-[0.6875rem] leading-tight text-island-ink-soft">{footnote}</span>
      ) : null}

      {quantity !== undefined && quantity > 0 ? <QuantityBadge count={quantity} /> : null}

      {children}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={shell}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={cn(shell, disabled && "cursor-not-allowed")}
      aria-disabled={disabled || undefined}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      {body}
    </div>
  );
}

/**
 * A coin price.
 *
 * `affordable={false}` renders in the danger colour, which is a REDUNDANT
 * signal: the surface that sets it also disables the buy action and says why.
 * A price that is only red is a price a colour-blind player reads as normal.
 */
export function PriceTag({
  amount,
  affordable = true,
  className,
}: {
  amount: number;
  affordable?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-bold tabular-nums",
        affordable ? "text-island-warn" : "text-island-danger",
        className,
      )}
    >
      <CoinIcon className="size-3.5" />
      {amount}
      <span className="sr-only"> coins{affordable ? "" : " (not enough)"}</span>
    </span>
  );
}

/**
 * The owned-count badge in a tile's corner.
 *
 * One colour, from the palette. It used to be `bg-amber-500` on one tile and
 * `bg-blue-500` on another, ten lines apart in the same file.
 */
export function QuantityBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center",
        "rounded-full border border-island-cream bg-island-purple px-1",
        "text-[0.6875rem] font-bold tabular-nums text-island-cream shadow-cozy-soft",
        className,
      )}
    >
      {count}
      <span className="sr-only"> owned</span>
    </span>
  );
}
