/**
 * The approved-media shelf — what a curated theater offers instead of a URL box.
 *
 * ## Why a shelf rather than a disabled input
 *
 * An input the player can fill in and then be refused is a worse experience than
 * one that was never offered, and a greyed-out box invites the explanation
 * nobody should have to write. A shelf is the affirmative version of the same
 * restriction: here is what you can watch together.
 *
 * ## Titles come from the catalog
 *
 * Every word on this shelf is written in `src/theater-media/catalog.ts`. Nothing
 * here is supplied by a host, by a session, or by YouTube — which is what makes
 * an approved video id safe to show a name for at all.
 *
 * ## The empty state is honest
 *
 * The production catalog ships empty on purpose: deciding which videos are
 * appropriate for children is editorial work that needs someone to watch them
 * and sign off, not something to invent alongside the code. Until entries exist
 * the shelf says so plainly rather than implying a library that is not there.
 */

import { Film } from 'lucide-react';

import { StateCard } from '@/components/ui/state-card';
import { cn } from '@/lib/utils';
import { approvedMediaShelf, type ApprovedMedia } from '@/theater-media';

interface TheaterMediaShelfProps {
  /** Called with the provider media id, matching the open input's contract. */
  onSelect: (providerMediaId: string) => void;
  /** Injectable so a test can supply fixtures without mocking a module. */
  catalog?: readonly ApprovedMedia[];
  disabled?: boolean;
}

export function TheaterMediaShelf({ onSelect, catalog, disabled }: TheaterMediaShelfProps) {
  const shelf = approvedMediaShelf(catalog);

  if (shelf.length === 0) {
    return (
      <StateCard
        kind="empty"
        compact
        title="No films yet"
        message="There is nothing on the shelf right now. Check back soon."
      />
    );
  }

  return (
    <div data-theater-media-shelf className="flex w-full flex-col gap-1.5">
      <p className="px-1 text-[11px] text-white/60">Pick something to watch</p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shelf.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(entry.providerMediaId)}
              className={cn(
                'flex min-h-[2.75rem] w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm',
                'border border-white/20 bg-black/40 text-white/90',
                'transition-colors duration-150 hover:bg-black/60 active:scale-[0.99]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Film className="size-4 shrink-0 text-white/60" aria-hidden="true" />
              <span className="min-w-0 truncate">{entry.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
