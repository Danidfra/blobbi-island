import { cn } from '@/lib/utils';
import { QuantityBadge } from '@/components/ui/item-tile';

/**
 * THE collection tile: one EXPLICIT geometry for every tile on a page.
 *
 * ## Why this stopped delegating to `ItemTile`
 *
 * The first version wrapped `ItemTile` and removed the content that had made
 * heights differ (footnotes, prices). That fixed the content SHAPE and left the
 * geometry implicit: every zone was still sized by its content, and the tile's
 * `height: 100%` had to resolve through a class-less block wrapper against a
 * height the wrapper only acquired by grid stretching — the classic circular
 * percentage-resolution case that engines settle differently. Identical class
 * strings, and "Ball" still rendered a visibly smaller card than "Calcium
 * Supplement" on a real screen.
 *
 * So the tile now owns its geometry outright, and every dimension is pinned:
 *
 * ```
 *   ┌───────────────────┐
 *   │                   │
 *   │   ART   h-16      │   fixed. image → object-contain, emoji → centered,
 *   │                   │   overflow-hidden. Content cannot change it.
 *   ├───────────────────┤
 *   │ title    h-8      │   fixed TWO-LINE zone: line-clamp-2 at leading-4.
 *   │ (2 lines held)    │   "Ball" reserves both lines; "Calcium Supplement"
 *   └───────────────────┘   wraps into them; nothing gets a third.
 *        ×3                 quantity — absolute overlay, top-right corner
 *      [Worn]               state — absolute overlay pill, never in flow
 * ```
 *
 * Total: 2px border + p-2 + 64 + mt-1 + 32 + p-2 = **118px, at every
 * breakpoint, for every item**. Both zones are `shrink-0 grow-0`, so even a
 * stretched cell cannot redistribute them. `ItemTile` stays the shop's
 * primitive, where content-derived height is correct because every shop tile
 * shares one content shape.
 *
 * `data-item-art` is kept so the tests that located artwork through it keep
 * working; `data-tile-title` marks the reserved title zone for the same
 * reason.
 */

export interface CollectionTileProps extends React.HTMLAttributes<HTMLElement> {
  /** The artwork: an `<img>`, an emoji, a renderer. Always decorative. */
  art: React.ReactNode;
  name: string;
  /** Owned count. Renders the corner badge overlay. Omit or 0 for none. */
  quantity?: number;
  selected?: boolean;
  disabled?: boolean;
  /** Makes the tile a button. Without it the tile is a static `<div>`. */
  onClick?: () => void;
  /**
   * A short state word — "Worn", "Active", "Previewing" — rendered as an
   * overlay pill over the art zone. Text, not colour alone, and zero effect
   * on the tile's height.
   */
  stateLabel?: string;
  /** Tone of the state pill. */
  stateTone?: 'positive' | 'accent';
  className?: string;
}

export function CollectionTile({
  art,
  name,
  quantity,
  selected = false,
  disabled = false,
  onClick,
  stateLabel,
  stateTone = 'positive',
  className,
  ...rest
}: CollectionTileProps) {
  const interactive = Boolean(onClick) && !disabled;

  const shell = cn(
    'relative flex w-full flex-col items-center rounded-panel border p-2 text-center',
    selected
      ? 'border-island-purple/50 bg-island-purple/10 shadow-cozy-soft'
      : 'border-island-wood/20 bg-island-cream shadow-cozy-soft',
    interactive && [
      'cursor-pointer transition-[transform,border-color] duration-150 ease-cozy',
      'hover:-translate-y-0.5 hover:border-island-wood/40 active:scale-[0.98]',
      'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-island-cream',
    ],
    disabled && 'opacity-55',
    className,
  );

  const body = (
    <>
      {/* FIXED art zone. `aria-hidden` because the title below carries the
          name; `overflow-hidden` so no artwork can leak past the zone. */}
      <span
        aria-hidden
        data-item-art
        className="flex h-16 w-full shrink-0 grow-0 items-center justify-center overflow-hidden text-4xl [&_img]:max-h-full [&_img]:w-auto [&_img]:object-contain"
      >
        {art}
      </span>

      {/* FIXED two-line title zone. The OUTER span reserves exactly two lines
          of height whether the name uses one or two; the inner span clamps so
          a third line cannot exist. A one-word name does not collapse the
          zone, and a long name cannot grow it. */}
      <span data-tile-title className="mt-1 block h-8 w-full shrink-0 grow-0 overflow-hidden">
        <span className="line-clamp-2 break-words text-xs font-semibold leading-4 text-island-ink">
          {name}
        </span>
      </span>

      {quantity !== undefined && quantity > 0 ? <QuantityBadge count={quantity} /> : null}

      {stateLabel ? (
        <span
          data-tile-state={stateLabel}
          className={cn(
            'pointer-events-none absolute left-1/2 top-[3.4rem] z-10 -translate-x-1/2',
            'rounded-full border border-island-cream px-1.5 py-px',
            'text-[0.625rem] font-bold leading-tight text-island-cream shadow-cozy-soft',
            stateTone === 'positive' ? 'bg-island-grass-dark' : 'bg-island-purple',
          )}
        >
          {stateLabel}
        </span>
      ) : null}
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
      className={cn(shell, disabled && 'cursor-not-allowed')}
      aria-disabled={disabled || undefined}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      {body}
    </div>
  );
}
