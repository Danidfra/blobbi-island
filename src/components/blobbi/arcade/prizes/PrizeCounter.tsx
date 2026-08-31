import { useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { OfficialArcadePrize } from '@/arcade/prizes/official-prize-catalog';
import { PrizeCard } from './PrizeCard';
import { PrizeDetail } from './PrizeDetail';
import {
  useOfficialArcadePrizes,
  type ResolvedArcadePrize,
} from './useOfficialArcadePrizes';

/**
 * The Prize Counter — the six real official prizes, browsable and previewable.
 *
 * Since Phase 9.5 the shelf shows the INITIAL OFFICIAL CATALOG (three
 * accessories, three visual effects — `official-prize-catalog.ts`), with every
 * card resolved from the real kind:31632 definitions, the player's real
 * kind:31633 inventory and the real kind:31634 equipment state.
 *
 * ## Redemption is not wired HERE, deliberately
 *
 * This component imports NO spend writer, NO redemption hook, NO ownership
 * store and NO mutation of any kind — the reward-flow boundary test proves it
 * against the import graph. The temporary V1 redemption flow (local ownership
 * + real ticket spend) was retired from this surface; the durable grant flow
 * for the six COSMETIC prizes is a later, separately audited phase. Until then
 * the detail panel shows an honest "redemption is being prepared" state, and
 * the only interactive things on the shelf are selection and the write-free
 * preview.
 *
 * The Arcade Pass is redeemable today, and it arrives through {@link
 * PrizeCounterProps.featureSlot} rather than through the shelf. A `ReactNode`
 * carries no imports, so the guarantee above survives one live redemption
 * sitting on the same counter — see `ArcadePassOffer`, which is where the
 * ticket spend actually lives.
 *
 * ## The two compositions
 *
 * Unchanged from the previous counter: desktop shows shelf and detail side by
 * side; mobile shows one surface at a time with its own back control. Rendered
 * inside the arcade's contained dialog (`ArcadeGameShell`, `surface="notice"`).
 */

type KindFilter = 'all' | 'accessory' | 'effect';

const FILTER_LABELS: Record<KindFilter, string> = {
  all: 'All',
  accessory: 'Accessories',
  effect: 'Effects',
};

export interface PrizeCounterProps {
  /** Substitute catalog, for tests and the dev harness. */
  readonly catalog?: readonly OfficialArcadePrize[];
  /**
   * Rendered above the shelf, for counter items that redeem for real.
   *
   * A node rather than a flag or a catalog entry: whatever goes here brings
   * its own writes, and passing it as content keeps every one of them out of
   * this module's import graph.
   */
  readonly featureSlot?: ReactNode;
}

export function PrizeCounter({ catalog, featureSlot }: PrizeCounterProps) {
  const { prizes, balance, balanceError, isLoggedIn, isLoading } =
    useOfficialArcadePrizes(catalog);

  const [filter, setFilter] = useState<KindFilter>('all');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? prizes
        : prizes.filter((p) => p.prize.kind === filter),
    [prizes, filter],
  );
  const selected: ResolvedArcadePrize | null = useMemo(
    () => prizes.find((p) => p.prize.itemAddress === selectedAddress) ?? null,
    [prizes, selectedAddress],
  );

  return (
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
              balance !== null ? 'ready' : balanceError ? 'unavailable' : 'loading'
            }
            className="flex items-center gap-1 rounded-full bg-island-cream/85 px-3 py-1.5 shadow"
            aria-label={
              balance !== null
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
              {balance !== null ? balance : balanceError ? '–' : '…'}
            </span>
          </p>
        </div>
        {!isLoggedIn && (
          <p data-prize-counter-logged-out role="status" className="mt-1 text-xs blobbi-text-muted">
            Log in to see your tickets and what you own — browsing is free.
          </p>
        )}
        {/*
          The standing truth of this phase, stated on the shelf itself — and
          scoped to the SHELF, because the feature slot below it may hold
          something that redeems for real.
        */}
        <p
          data-prize-counter-preview-notice
          role="status"
          className="mt-1 text-xs blobbi-text-muted"
        >
          Prize redemption is being prepared. You can preview the rewards below now.
        </p>
      </div>

      {featureSlot}

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_310px] md:gap-3 md:px-4 md:pb-3 md:pt-2">
        {/* ── The shelf: type tabs + grid. Hidden on mobile while a detail is open. ── */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            selected ? 'hidden md:flex' : 'flex',
          )}
        >
          <div
            role="radiogroup"
            aria-label="Prize type"
            className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 sm:px-4 md:px-0 [scrollbar-width:thin]"
          >
            {(['all', 'accessory', 'effect'] as KindFilter[]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={filter === kind}
                data-prize-filter={kind}
                onClick={() => setFilter(kind)}
                className={cn(
                  'min-h-[44px] shrink-0 rounded-full border-2 px-3 text-xs font-bold',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  filter === kind
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-island-wood/30 bg-island-cream/70 text-island-ink',
                )}
              >
                {FILTER_LABELS[kind]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-4 md:px-0">
            {visible.length === 0 ? (
              <p
                data-prize-empty="filter"
                className="rounded-2xl border-2 border-dashed border-island-wood/30 p-6 text-center text-sm blobbi-text-muted"
              >
                Nothing on this shelf yet — try another one.
              </p>
            ) : (
              <ul
                data-prize-grid
                className="grid list-none grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-3"
              >
                {visible.map((resolved) => (
                  <li key={resolved.prize.itemAddress} className="min-w-0">
                    <PrizeCard
                      resolved={resolved}
                      selected={resolved.prize.itemAddress === selectedAddress}
                      onSelect={setSelectedAddress}
                    />
                  </li>
                ))}
              </ul>
            )}
            {isLoading && (
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
          {selected ? (
            <PrizeDetail
              resolved={selected}
              balance={balance}
              onBack={() => setSelectedAddress(null)}
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
