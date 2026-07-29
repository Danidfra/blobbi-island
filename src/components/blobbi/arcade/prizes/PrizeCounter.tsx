import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { getQuantity, useIslandInventory } from '@/inventory';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';
import type { ArcadePrize, ArcadePrizeCategory } from '@/arcade/prizes/prize-catalogue';
import {
  ARCADE_PRIZE_CATALOGUE,
  ARCADE_PRIZE_CATEGORY_LABELS,
  orderedArcadePrizes,
  presentPrizeCategories,
} from '@/arcade/prizes/prize-catalogue';
import { evaluatePrizeEligibility } from '@/arcade/prizes/prize-redemption';
import {
  useArcadePrizeRedemption,
  type UseArcadePrizeRedemptionOptions,
} from '@/hooks/useArcadePrizeRedemption';

import { PrizeCard } from './PrizeCard';
import { PrizeDetail } from './PrizeDetail';

/**
 * The Prize Counter — where Arcade Tickets become things.
 *
 * Rendered inside the arcade's one contained dialog (`ArcadeGameShell`,
 * `surface="notice"`), reached by walking the Blobbi to the prizes counter in
 * the room. It is a destination, not a settings modal: a lit sign, a shelf of
 * prizes, a visible ticket balance, and a detail panel where the actual
 * decision happens.
 *
 * ## The two compositions
 *
 * - **Desktop (`md:` up)** — the shelf and the detail panel side by side. The
 *   shelf scrolls; the detail column stays put with the confirm button always
 *   visible at its bottom.
 * - **Mobile** — one surface at a time: the shelf, or (after selecting) the
 *   detail as a full-height state with its own back control and a sticky
 *   action bar above the safe-area inset. This is a deliberate composition,
 *   not a squeezed grid: one/two card columns, horizontally scrollable
 *   category tabs, and no nested scroll traps — the shell's own scroll is
 *   disabled (`contentClassName="overflow-hidden p-0"`) so exactly one region
 *   scrolls at a time.
 *
 * ## Trust model, stated once
 *
 * The balance is the real kind:31633 inventory; the spend goes through the
 * one approved spend writer with strict publish and verify; prize OWNERSHIP is
 * the clearly-temporary local store. This is the client-trusted Arcade V1 —
 * see `docs/arcade-prize-counter.md`.
 */

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

type CategoryFilter = 'all' | ArcadePrizeCategory;

export interface PrizeCounterProps {
  /** Substitute catalogue, for the DEV harness and tests. */
  readonly catalogue?: readonly ArcadePrize[];
  /** Substitute writer / ownership / attempt minting. Production passes nothing. */
  readonly redemptionOptions?: UseArcadePrizeRedemptionOptions;
}

export function PrizeCounter({ catalogue, redemptionOptions }: PrizeCounterProps) {
  const entries = useMemo(
    () => orderedArcadePrizes(catalogue ?? ARCADE_PRIZE_CATALOGUE),
    [catalogue],
  );
  const categories = useMemo(
    () => presentPrizeCategories(catalogue ?? ARCADE_PRIZE_CATALOGUE),
    [catalogue],
  );

  const { data: inventory, isLoading: balanceLoading, isError: balanceError } =
    useIslandInventory();
  const balance = inventory ? getQuantity(inventory, TICKET_ADDRESS) : null;

  const redemption = useArcadePrizeRedemption(redemptionOptions ?? {});
  const { hydrateForPrize, listPendingDeliveries, finishDelivery } = redemption;

  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter((p) => p.category === filter)),
    [entries, filter],
  );
  const selected = useMemo(
    () => entries.find((p) => p.id === selectedId) ?? null,
    [entries, selectedId],
  );

  /** Adopt durable redemption state whenever the selection changes. */
  useEffect(() => {
    hydrateForPrize(selected);
  }, [selected, hydrateForPrize]);

  /** A refresh mid-delivery must surface the recovery, not forget it. */
  const redemptionPhase = redemption.state.phase;
  const pending = useMemo(() => {
    // The ledger is the truth; the phase is only the signal to re-read it.
    void redemptionPhase;
    return listPendingDeliveries();
  }, [listPendingDeliveries, redemptionPhase]);
  const pendingPrize = useMemo(
    () => (pending.length > 0 ? (entries.find((p) => p.id === pending[0].prizeId) ?? null) : null),
    [pending, entries],
  );

  const handleSelect = useCallback((prizeId: string) => {
    setSelectedId(prizeId);
  }, []);

  const handleBack = useCallback(() => setSelectedId(null), []);

  const handleRedeem = useCallback(() => {
    if (selected) void redemption.redeem(selected);
  }, [selected, redemption]);

  const handleCheckStatus = useCallback(() => {
    if (selected) void redemption.checkSpendStatus(selected);
  }, [selected, redemption]);

  const handleFinishDelivery = useCallback(() => {
    if (!selected) return;
    const record = listPendingDeliveries().find((r) => r.prizeId === selected.id);
    if (record) void finishDelivery(selected, record);
  }, [selected, listPendingDeliveries, finishDelivery]);

  const eligibility = useMemo(
    () =>
      selected
        ? evaluatePrizeEligibility({
            prize: selected,
            balance,
            owned: (redemption.ownedCounts.get(selected.id) ?? 0) > 0,
            loggedIn: redemption.isLoggedIn,
          })
        : null,
    [selected, balance, redemption.ownedCounts, redemption.isLoggedIn],
  );

  return (
    /*
      `h-full` fills the shell's content box, and the inner shelf/detail
      scrollers do all the scrolling. The `min-h-[320px]` is the degenerate-box
      escape hatch: in a very short non-immersive stage (a squat desktop
      window) the counter keeps a usable height and the SHELL's content scroll
      takes over, instead of the sticky action being clipped out of reach.
    */
    <div data-prize-counter className="flex h-full min-h-[320px] flex-col">
      {/* ── The sign and the balance — always visible, on every width. ── */}
      <div className="shrink-0 border-b border-island-wood/20 bg-gradient-to-b from-island-purple/15 to-transparent px-3 pb-2 pt-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            aria-hidden
            className="rounded-xl border-2 border-island-purple/40 bg-island-purple/10 px-3 py-1 text-sm font-black uppercase tracking-[0.2em] text-island-purple shadow-[0_2px_0_rgba(109,74,166,0.25)]"
          >
            <span className="mr-1">🎁</span>Prizes
          </p>
          <p
            data-prize-counter-balance={
              inventory ? 'ready' : balanceError ? 'unavailable' : 'loading'
            }
            className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 shadow"
            aria-label={
              inventory
                ? `You have ${balance} Arcade Ticket${balance === 1 ? '' : 's'}`
                : balanceError
                  ? 'Your ticket balance is unavailable'
                  : 'Loading your ticket balance'
            }
          >
            <span aria-hidden className="text-lg leading-none">
              🎟️
            </span>
            <span className="font-mono text-sm font-black tabular-nums text-island-ink">
              {inventory ? balance : balanceError ? '–' : '…'}
            </span>
          </p>
        </div>
        {!redemption.isLoggedIn && (
          <p data-prize-counter-logged-out role="status" className="mt-1 text-xs blobbi-text-muted">
            Log in to spend your Arcade Tickets — browsing is free.
          </p>
        )}
        {balanceError && (
          <p role="status" className="mt-1 text-xs text-amber-800">
            Your ticket balance could not be loaded, so redeeming is paused. Browsing still works.
          </p>
        )}
      </div>

      {/* ── Paid-but-undelivered recovery, surfaced before anything else. ── */}
      {pendingPrize && redemption.state.phase !== 'delivering' && redemption.state.phase !== 'confirmed' && (
        <div
          data-prize-pending-delivery
          role="status"
          className="mx-3 mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-900 sm:mx-4"
        >
          <span className="font-bold">
            {pendingPrize.title} is paid for but not delivered yet.
          </span>
          <button
            type="button"
            data-prize-pending-delivery-action
            onClick={() => {
              setSelectedId(pendingPrize.id);
              void finishDelivery(pendingPrize, pending[0]);
            }}
            className="min-h-[44px] rounded-full border-2 border-amber-600/40 bg-white/70 px-3 font-bold text-amber-900"
          >
            Finish delivery
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_310px] md:gap-3 md:px-4 md:pb-3 md:pt-2">
        {/* ── The shelf: tabs + grid. Hidden on mobile while a detail is open. ── */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            selected ? 'hidden md:flex' : 'flex',
          )}
        >
          <div
            role="radiogroup"
            aria-label="Prize category"
            className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 sm:px-4 md:px-0 [scrollbar-width:thin]"
          >
            {(['all', ...categories] as CategoryFilter[]).map((category) => (
              <button
                key={category}
                type="button"
                role="radio"
                aria-checked={filter === category}
                data-prize-filter={category}
                onClick={() => setFilter(category)}
                className={cn(
                  'min-h-[44px] shrink-0 rounded-full border-2 px-3 text-xs font-bold',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  filter === category
                    ? 'border-island-purple bg-island-purple text-white'
                    : 'border-island-wood/30 bg-island-cream/70 text-island-ink',
                )}
              >
                {category === 'all' ? 'All' : ARCADE_PRIZE_CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-4 md:px-0">
            {entries.length === 0 ? (
              <p
                data-prize-empty="catalogue"
                className="rounded-2xl border-2 border-dashed border-island-wood/30 p-6 text-center text-sm blobbi-text-muted"
              >
                The shelves are being restocked. Come back soon!
              </p>
            ) : visible.length === 0 ? (
              <p
                data-prize-empty="filter"
                className="rounded-2xl border-2 border-dashed border-island-wood/30 p-6 text-center text-sm blobbi-text-muted"
              >
                Nothing in this category yet — try another shelf.
              </p>
            ) : (
              <ul
                data-prize-grid
                className="grid list-none grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-3"
              >
                {visible.map((prize) => (
                  <li key={prize.id} className="min-w-0">
                    <PrizeCard
                      prize={prize}
                      selected={prize.id === selectedId}
                      ownedCount={redemption.ownedCounts.get(prize.id) ?? 0}
                      balance={balance}
                      onSelect={handleSelect}
                    />
                  </li>
                ))}
              </ul>
            )}
            {balanceLoading && !inventory && (
              <p role="status" className="mt-2 text-center text-xs blobbi-text-muted">
                Counting your tickets…
              </p>
            )}
          </div>
        </div>

        {/* ── The detail column. Mobile: a full state; desktop: a fixed panel. ── */}
        <div
          className={cn(
            'min-h-0 flex-1 px-3 pb-1 sm:px-4 md:flex md:flex-col md:rounded-2xl md:border-2 md:border-island-wood/25 md:bg-island-cream/50 md:px-3 md:py-3',
            selected ? 'flex flex-col' : 'hidden md:flex',
          )}
        >
          {selected && eligibility ? (
            <PrizeDetail
              prize={selected}
              balance={balance}
              balanceUnavailable={balanceError}
              ownedCount={redemption.ownedCounts.get(selected.id) ?? 0}
              eligibility={eligibility}
              redemption={redemption.state}
              isLoggedIn={redemption.isLoggedIn}
              onRedeem={handleRedeem}
              onCheckStatus={handleCheckStatus}
              onFinishDelivery={handleFinishDelivery}
              onBack={handleBack}
            />
          ) : (
            <p
              data-prize-detail-placeholder
              className="m-auto max-w-[22ch] text-center text-sm blobbi-text-muted"
            >
              <span aria-hidden className="mb-1 block text-3xl">
                🧸
              </span>
              Pick a prize from the shelf to see it up close.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
