import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { ResolvedArcadePrize } from './useOfficialArcadePrizes';

/**
 * One official prize on the shelf.
 *
 * A single BUTTON, selecting is the only thing a card does; everything else
 * (preview, the redemption-disabled notice) lives in the detail panel, so a
 * stray tap on the shelf can never do anything at all.
 *
 * ## State is words, not colour
 *
 * Owned, Equipped, the Accessory/Effect type, the rarity and "Need N more"
 * all get text chips, so the card reads correctly in greyscale and to a
 * screen reader. Dimming is the redundant signal, never the message.
 */

interface PrizeCardProps {
  readonly resolved: ResolvedArcadePrize;
  readonly selected: boolean;
  readonly onSelect: (itemAddress: string) => void;
}

export function PrizeCard({ resolved, selected, onSelect }: PrizeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const { prize } = resolved;
  const showImage = Boolean(resolved.image) && !imageFailed;
  const unaffordable = !resolved.owned && resolved.affordable === false;

  return (
    <button
      type="button"
      data-prize-card={prize.d}
      data-prize-kind={prize.kind}
      data-prize-state={
        resolved.owned ? 'owned' : unaffordable ? 'unaffordable' : 'preview'
      }
      aria-pressed={selected}
      onClick={() => onSelect(prize.itemAddress)}
      className={cn(
        'group flex min-h-[44px] w-full flex-col items-stretch gap-1.5 rounded-2xl border-2 p-2.5 text-left',
        'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-island-purple',
        selected
          ? 'border-island-purple bg-island-purple/10'
          : 'border-island-wood/25 bg-island-cream/70 hover:border-island-purple/50',
        prize.featured && !selected && 'border-island-warn/50 bg-island-warn/10',
      )}
    >
      {/* The artwork shelf. Emoji is the guaranteed fallback. */}
      <span
        aria-hidden
        className={cn(
          'flex h-16 items-center justify-center rounded-xl text-4xl sm:h-20',
          prize.featured
            ? 'bg-gradient-to-b from-amber-100 to-island-cream-2'
            : 'bg-island-cream-2',
          unaffordable && 'opacity-70',
        )}
      >
        {showImage ? (
          <img
            src={resolved.image}
            alt=""
            className="h-full w-full rounded-xl object-contain p-1"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>{resolved.emoji}</span>
        )}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-island-ink">
          {resolved.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'font-mono text-sm font-black',
              unaffordable ? 'blobbi-text-muted' : 'text-island-purple',
            )}
          >
            <span aria-hidden>🎟️ </span>
            <span className="sr-only">Price: </span>
            {prize.tickets}
          </span>
          <span className="rounded-full bg-island-purple/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-purple">
            {prize.kind === 'accessory' ? 'Accessory' : 'Effect'}
          </span>
          {resolved.rarity && (
            <span className="rounded-full bg-island-wood/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-wood-dark">
              {resolved.rarity}
            </span>
          )}
          {resolved.owned && (
            <span
              data-prize-owned-quantity={resolved.ownedQuantity}
              className="rounded-full bg-island-grass/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-island-grass-dark"
            >
              Owned{resolved.ownedQuantity > 1 ? ` ×${resolved.ownedQuantity}` : ''}
            </span>
          )}
          {resolved.equipped && (
            <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
              Equipped
            </span>
          )}
        </span>
        {unaffordable && resolved.affordable === false && (
          <span className="mt-0.5 block text-[11px] blobbi-text-muted">
            Need more tickets
          </span>
        )}
      </span>
    </button>
  );
}
