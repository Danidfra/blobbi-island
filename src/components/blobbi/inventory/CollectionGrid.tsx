import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A BOUNDED, paged collection grid — the game-panel answer to a long scroll.
 *
 * ## Why paging and not scrolling
 *
 * The window is a character card, not a document. Owning more hats should not
 * make the window taller, and reading a Blobbi's mood should not require
 * scrolling past its wardrobe. A scrolling grid makes the window's height a
 * function of the player's inventory; a paged grid makes it a constant.
 *
 * ## Where the page size comes from
 *
 * Recalculated after the tile contract became explicit (every tile is now the
 * same fixed geometry: padded 64px art box + one clamped name line ≈ 104px,
 * with a 10px grid gap). The grids run at **four columns** from `sm` up — the
 * Items surface keeps four all the way, the Wardrobe drops to three only while
 * its detail sidebar is beside it — and at three columns on a phone.
 *
 *     4 columns × 2 rows = 8       ← two FULL rows in the four-column grids
 *     3 columns → 3 rows (3/3/2)   ← ~330px, bounded on a phone
 *
 * Eight, not nine: nine fills three ragged rows of a four-column grid and
 * leaves the most common view (Items, full width) permanently ragged. Eight
 * fills it exactly. The number stays viewport-independent, deliberately:
 * deriving it from the live column count would make "9–16 of 20" renumber
 * itself when the window is resized, and a page that renumbers under the
 * player is worse than a short last row.
 *
 * ## What it guarantees
 *
 * - the grid reserves the same height whether it holds 1 item or 8, so nothing
 *   below it moves when the page changes;
 * - the controls disappear entirely for a single-page collection — a player
 *   with four items never sees pagination chrome;
 * - the page index is CLAMPED to the collection, so using up the last item on
 *   the last page lands on a real page rather than an empty one.
 */

export interface CollectionGridProps<T> {
  items: readonly T[];
  /** Stable identity per item — also the React key. */
  keyOf: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  /**
   * Resets the page to 1 when it changes.
   *
   * A category switch or a wardrobe-section switch is a new collection, and
   * landing on page 3 of something you just opened is disorienting.
   */
  resetKey?: string;
  /** Announced to screen readers, and used to label the controls. */
  label: string;
  /**
   * Container semantics. The Wardrobe and Effects grids are selection lists
   * (`listbox`, with `option` tiles); the Items grid is a row of plain action
   * buttons, where a listbox would promise a selection model that does not
   * exist.
   */
  role?: 'listbox' | 'group';
  /**
   * Column classes. The default matches a grid with a detail sidebar from
   * `lg` (which is why it drops back to three columns there); a full-width
   * surface passes its own.
   */
  gridClassName?: string;
  emptySlot?: React.ReactNode;
  className?: string;
}

/** Items per page. See the header for the derivation. */
export const COLLECTION_PAGE_SIZE = 8;

export function CollectionGrid<T>({
  items,
  keyOf,
  renderItem,
  resetKey,
  label,
  role = 'listbox',
  gridClassName = 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4',
  className,
}: CollectionGridProps<T>) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / COLLECTION_PAGE_SIZE));

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  /*
    Clamp rather than trust.

    The collection shrinks under this component — the last apple is eaten, a
    cosmetic stops fitting after a life-stage change — and a page index left
    pointing past the end would render an empty grid with working arrows.
  */
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * COLLECTION_PAGE_SIZE;
  const visible = useMemo(
    () => items.slice(start, start + COLLECTION_PAGE_SIZE),
    [items, start],
  );

  const go = useCallback(
    (delta: number) => setPage((p) => Math.min(pageCount - 1, Math.max(0, p + delta))),
    [pageCount],
  );

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div
        role={role}
        aria-label={label}
        data-testid="collection-grid"
        data-page={safePage + 1}
        data-page-count={pageCount}
        /*
          `content-start` keeps a short page packed to the top rather than
          spreading its rows, so page 3-of-3 with two tiles reads as a partial
          page of the same grid instead of a different layout.
        */
        className={cn('grid content-start gap-2.5', gridClassName)}
      >
        {visible.map((item) => (
          <div key={keyOf(item)}>{renderItem(item)}</div>
        ))}
      </div>

      {pageCount > 1 && (
        <PageControls
          page={safePage}
          pageCount={pageCount}
          total={items.length}
          label={label}
          onGo={go}
        />
      )}
    </div>
  );
}

/**
 * Page controls, shaped like a game's rather than a data table's.
 *
 * Two arrows and a readout. The readout is `aria-live="polite"` so a page
 * change is announced — the grid contents change without focus moving, which a
 * screen reader would otherwise not mention. The arrows carry real labels and
 * disable at the ends rather than wrapping, because silently looping a
 * collection is disorienting when you cannot see its size.
 */
function PageControls({
  page,
  pageCount,
  total,
  label,
  onGo,
}: {
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onGo: (delta: number) => void;
}) {
  const first = page * COLLECTION_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * COLLECTION_PAGE_SIZE);

  return (
    <div className="flex shrink-0 items-center justify-center gap-2" data-testid="page-controls">
      <PageArrow
        direction="previous"
        label={`Previous page of ${label}`}
        disabled={page === 0}
        onClick={() => onGo(-1)}
      />

      <span
        aria-live="polite"
        data-testid="page-status"
        className="min-w-[7.5rem] text-center text-[0.6875rem] font-semibold tabular-nums text-island-ink-soft"
      >
        {first}–{last} of {total}
      </span>

      <PageArrow
        direction="next"
        label={`Next page of ${label}`}
        disabled={page >= pageCount - 1}
        onClick={() => onGo(1)}
      />
    </div>
  );
}

function PageArrow({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: 'previous' | 'next';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={`page-${direction}`}
      className={cn(
        // 32px: a comfortable thumb target next to a small readout.
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full border',
        'border-island-wood/25 bg-island-cream text-island-ink shadow-cozy-soft',
        'transition-transform duration-150 ease-cozy',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:brightness-105 active:scale-95',
      )}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
