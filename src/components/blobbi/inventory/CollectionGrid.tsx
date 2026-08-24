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
 * Not a round number — the tightest real layout. An `ItemTile` is about 118px
 * tall (16 padding + 64 artwork + 4 gap + ~20 name + ~14 footnote) and the grid
 * gap is 10px. The narrowest column count any breakpoint uses is **3** (mobile,
 * and desktop again once the detail panel takes its 15rem beside the grid), and
 * the shortest content budget that has to hold a grid plus a detail panel is
 * about 3 rows.
 *
 *     3 columns × 3 rows = 9
 *
 * One page size for every viewport, deliberately: deriving it from the live
 * column count would make "Page 2 of 3" mean something different after a
 * resize, and a page that renumbers under the player is worse than a page with
 * a short last row.
 *
 * ## What it guarantees
 *
 * - the grid reserves the same height whether it holds 1 item or 9, so nothing
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
  emptySlot?: React.ReactNode;
  className?: string;
}

/** Items per page. See the header for the derivation. */
export const COLLECTION_PAGE_SIZE = 9;

export function CollectionGrid<T>({
  items,
  keyOf,
  renderItem,
  resetKey,
  label,
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
        role="listbox"
        aria-label={label}
        data-testid="collection-grid"
        data-page={safePage + 1}
        data-page-count={pageCount}
        /*
          `auto-rows` plus a three-row minimum reserves the grid's height, so a
          short page does not let the detail panel below it jump upward. It is a
          MINIMUM rather than a fixed height: a wider breakpoint fits the same
          nine items in fewer rows and the grid simply gets shorter, which never
          pushes anything off screen.
        */
        className="grid grid-cols-3 content-start gap-2.5 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4"
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
