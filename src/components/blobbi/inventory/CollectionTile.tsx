import { cn } from '@/lib/utils';
import { ItemTile, type ItemTileProps } from '@/components/ui/item-tile';

/**
 * THE collection tile contract: one geometry for every tile on a page.
 *
 * ## The problem this fixes
 *
 * Tiles on the same page had different heights. The generic `ItemTile` derives
 * its height from its content — a `footnote` line for "Worn", a price row for
 * the shop — which is right for the shop (every shop tile has the same content
 * shape) and wrong for a collection, where a worn hat grew a line the hat next
 * to it did not have. A game inventory page must read as a uniform grid of
 * slots.
 *
 * ## The contract
 *
 * ```
 *   ┌────────────┐
 *   │    ART     │   fixed-height art box (the ItemTile constant, h-16)
 *   ├────────────┤
 *   │ item name  │   exactly one line, truncated
 *   └────────────┘
 *        ×3           quantity badge — OVERLAY, top-right corner
 *      [Worn]         state — OVERLAY pill over the art, never in flow
 * ```
 *
 * Height is therefore a constant of the grid, not of any tile's content: a
 * long name truncates, a quantity overlays, and worn/active/previewing state
 * is a pill floating over the artwork the way games mark equipped gear —
 * not a text row that changes the card's size.
 *
 * What this deliberately does NOT accept: `footnote`, `price`, or flow
 * `children`. A surface that needs those (the shop) uses `ItemTile` directly
 * and owns its own uniformity.
 */

export interface CollectionTileProps
  extends Omit<ItemTileProps, 'footnote' | 'price' | 'affordable' | 'children'> {
  /**
   * A short state word — "Worn", "Active", "Previewing" — rendered as an
   * overlay pill anchored to the bottom of the art box. Text, not colour
   * alone, and zero effect on the tile's height.
   */
  stateLabel?: string;
  /** Tone of the state pill. */
  stateTone?: 'positive' | 'accent';
}

export function CollectionTile({
  stateLabel,
  stateTone = 'positive',
  className,
  ...tile
}: CollectionTileProps) {
  return (
    <ItemTile {...tile} className={cn('h-full', className)}>
      {stateLabel ? (
        <span
          data-tile-state={stateLabel}
          className={cn(
            'pointer-events-none absolute left-1/2 top-[3.25rem] z-10 -translate-x-1/2',
            'rounded-full border border-island-cream px-1.5 py-px',
            'text-[0.625rem] font-bold leading-tight text-island-cream shadow-cozy-soft',
            stateTone === 'positive' ? 'bg-island-grass-dark' : 'bg-island-purple',
          )}
        >
          {stateLabel}
        </span>
      ) : null}
    </ItemTile>
  );
}
