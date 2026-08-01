import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { ResolvedArcadePrize } from './useOfficialArcadePrizes';
import { PrizePreviewStage } from './PrizePreviewStage';

/**
 * The detail panel for one official prize — up close, with a live preview and
 * an HONEST redemption state.
 *
 * There is deliberately NO redeem button in this phase. The durable Arcade
 * grant/spending flow is a later, separately audited phase; until it exists,
 * showing a button that "works" by mutating local state would be a fake
 * purchase. The panel says exactly what is true:
 *
 *   "Prize redemption is being prepared. You can preview rewards now."
 *
 * The preview goes through the real renderer path and writes nothing — see
 * `PrizePreviewStage`.
 */

const SLOT_LABELS: Record<string, string> = {
  headwear: 'Headwear',
  eyewear: 'Eyewear',
  neckwear: 'Neckwear',
  back: 'Back',
  handheld: 'Handheld',
  'face-mark': 'Face mark',
  'color-overlay': 'Color overlay',
  aura: 'Aura',
  'ambient-particles': 'Ambient particles',
  'body-overlay': 'Body overlay',
  'ground-local': 'Ground effect',
};

interface PrizeDetailProps {
  readonly resolved: ResolvedArcadePrize;
  /** Ticket balance, or `null` while unknown. */
  readonly balance: number | null;
  readonly onBack: () => void;
}

export function PrizeDetail({ resolved, balance, onBack }: PrizeDetailProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const { prize } = resolved;
  const showImage = Boolean(resolved.image) && !imageFailed;
  const shortBy =
    balance !== null && balance < prize.tickets ? prize.tickets - balance : 0;

  return (
    <div data-prize-detail={prize.d} className="flex min-h-0 flex-1 flex-col">
      {/* Mobile back control; the desktop panel has the shelf beside it. */}
      <button
        type="button"
        data-prize-detail-back
        onClick={onBack}
        className="mb-1 self-start rounded-full px-2 py-1 text-xs font-bold text-island-purple md:hidden"
      >
        ← All prizes
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-island-cream-2 text-3xl"
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
          <div className="min-w-0">
            <h3 className="text-base font-black text-island-ink">{resolved.name}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-island-purple/10 px-1.5 py-0.5 font-bold uppercase tracking-wide text-island-purple">
                {prize.kind === 'accessory' ? 'Accessory' : 'Effect'}
              </span>
              {resolved.rarity && (
                <span className="rounded-full bg-island-wood/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-island-wood-dark">
                  {resolved.rarity}
                </span>
              )}
              {resolved.slot && (
                <span
                  data-prize-detail-slot={resolved.slot}
                  className="rounded-full bg-island-wood/10 px-1.5 py-0.5 font-bold text-island-wood-dark"
                >
                  {SLOT_LABELS[resolved.slot] ?? resolved.slot}
                </span>
              )}
            </p>
          </div>
        </div>

        {resolved.description && (
          <p className="mt-2 text-sm text-island-ink/90">{resolved.description}</p>
        )}

        {/* Ownership and price — the facts, in words. */}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="blobbi-text-muted">Price</dt>
          <dd className="text-right font-mono font-black text-island-purple">
            🎟️ {prize.tickets}
          </dd>
          <dt className="blobbi-text-muted">You own</dt>
          <dd
            data-prize-detail-owned={resolved.ownedQuantity}
            className="text-right font-bold text-island-ink"
          >
            {resolved.ownedQuantity > 0 ? `×${resolved.ownedQuantity}` : 'Not yet'}
            {resolved.equipped ? ' · equipped' : ''}
          </dd>
          {shortBy > 0 && !resolved.owned && (
            <>
              <dt className="blobbi-text-muted">Tickets needed</dt>
              <dd className="text-right font-bold text-amber-800">
                {shortBy} more
              </dd>
            </>
          )}
        </dl>

        <div className="mt-3">
          <PrizePreviewStage resolved={resolved} />
        </div>
      </div>

      {/* The honest state, where a redeem button would be. Always visible. */}
      <p
        data-prize-redemption-disabled
        role="status"
        className={cn(
          'mt-2 shrink-0 rounded-xl border-2 border-dashed border-island-purple/40',
          'bg-island-purple/5 px-3 py-2 text-center text-xs font-bold text-island-purple',
        )}
      >
        Prize redemption is being prepared. You can preview rewards now.
      </p>
    </div>
  );
}
