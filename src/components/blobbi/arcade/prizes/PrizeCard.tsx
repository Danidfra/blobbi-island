import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';

/**
 * One prize on the shelf.
 *
 * A single BUTTON — selecting is the only thing a card does. Redemption lives
 * in the detail panel behind an explicit confirmation, so a stray tap on the
 * shelf can never spend anything.
 *
 * ## State is words, not colour
 *
 * Owned, Coming soon, Premium and "affordable" all get text (or a text chip),
 * so the card reads correctly in greyscale and to a screen reader. The
 * unaffordable treatment dims the card but ALSO says "Need N more" — the dim
 * is the redundant signal, not the message.
 */

interface PrizeCardProps {
  readonly prize: ArcadePrize;
  readonly selected: boolean;
  /** Grants recorded by the TEMPORARY store. Drives Owned / ×N labelling. */
  readonly ownedCount: number;
  /** Null while the balance is unknown — affordability is then not claimed. */
  readonly balance: number | null;
  readonly onSelect: (prizeId: string) => void;
}

export function PrizeCard({ prize, selected, ownedCount, balance, onSelect }: PrizeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(prize.image) && !imageFailed;
  const comingSoon = prize.availability === 'coming-soon';
  // Owning a NON-repeatable prize retires it; a repeatable one stays on sale,
  // so its card keeps the ordinary states and adds an ×N label instead.
  const owned = ownedCount > 0 && !prize.repeatable;
  const unaffordable =
    !owned && !comingSoon && balance !== null && balance < prize.price;
  const shortBy = unaffordable ? prize.price - (balance ?? 0) : 0;

  return (
    <button
      type="button"
      data-prize-card={prize.id}
      data-prize-state={owned ? 'owned' : comingSoon ? 'coming-soon' : unaffordable ? 'unaffordable' : 'available'}
      aria-pressed={selected}
      onClick={() => onSelect(prize.id)}
      className={cn(
        'group flex min-h-[44px] w-full flex-col items-stretch gap-1.5 rounded-2xl border-2 p-2.5 text-left',
        'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-purple',
        selected
          ? 'border-island-purple bg-island-purple/10'
          : 'border-island-wood/25 bg-island-cream/70 hover:border-island-purple/50',
        prize.rarity === 'premium' && !selected && 'border-amber-400/60 bg-amber-50/60',
      )}
    >
      {/* The artwork shelf. Emoji is the guaranteed fallback. */}
      <span
        aria-hidden
        className={cn(
          'flex h-16 items-center justify-center rounded-xl text-4xl sm:h-20',
          prize.rarity === 'premium'
            ? 'bg-gradient-to-b from-amber-100 to-island-cream-2'
            : 'bg-island-cream-2',
          comingSoon && 'opacity-60 grayscale',
          unaffordable && 'opacity-70',
        )}
      >
        {showImage ? (
          <img
            src={prize.image}
            alt=""
            className="h-full w-full rounded-xl object-contain p-1"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{prize.emojiFallback}</span>
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-island-ink">{prize.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'font-mono text-sm font-black',
              unaffordable ? 'blobbi-text-muted' : 'text-island-purple',
            )}
          >
            <span aria-hidden>🎟️ </span>
            <span className="sr-only">Price: </span>
            {prize.price}
          </span>
          {owned && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
              Owned
            </span>
          )}
          {prize.repeatable && ownedCount > 0 && (
            <span
              data-prize-owned-count={ownedCount}
              className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800"
            >
              Owned ×{ownedCount}
            </span>
          )}
          {comingSoon && (
            <span className="rounded-full bg-island-wood/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-wood-dark">
              Coming soon
            </span>
          )}
          {prize.rarity === 'premium' && !owned && !comingSoon && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
              Premium
            </span>
          )}
        </span>
        {unaffordable && (
          <span className="mt-0.5 block text-[11px] blobbi-text-muted">
            Need {shortBy} more ticket{shortBy === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </button>
  );
}
