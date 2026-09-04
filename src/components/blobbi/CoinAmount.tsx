/**
 * CoinAmount: the one way a Blobbi Coin balance/amount is rendered.
 *
 * Uses the OFFICIAL published Coin artwork resolved from the registry
 * constants, degrading to the published `symbol` emoji when the image cannot
 * load. `amount === null` renders an explicit unavailable state, a balance
 * that could not be read must never look like a real zero.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BLOBBI_COIN_IMAGE_URL,
  BLOBBI_COIN_NAME,
  BLOBBI_COIN_SYMBOL,
} from '@/inventory/coin';

interface CoinAmountProps {
  /** Coins to display, or `null` when the balance is unknown. */
  amount: number | null;
  /** Show a loading skeleton instead of the unavailable state. */
  loading?: boolean;
  className?: string;
  iconClassName?: string;
}

export function CoinIcon({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span aria-hidden className={className} data-coin-icon-fallback>
        {BLOBBI_COIN_SYMBOL}
      </span>
    );
  }
  return (
    <img
      src={BLOBBI_COIN_IMAGE_URL}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('inline-block h-[1.2em] w-[1.2em] object-contain align-text-bottom', className)}
      onError={() => setFailed(true)}
      data-coin-icon
    />
  );
}

export function CoinAmount({ amount, loading, className, iconClassName }: CoinAmountProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      data-coin-amount={amount ?? 'unknown'}
    >
      <CoinIcon className={iconClassName} />
      {loading ? (
        <Skeleton className="inline-block h-4 w-10 align-middle" />
      ) : amount === null ? (
        <span className="text-sm blobbi-text-muted" role="status">
          Balance unavailable
        </span>
      ) : (
        <>
          <span>{amount}</span>
          <span className="sr-only">{BLOBBI_COIN_NAME}s</span>
        </>
      )}
    </span>
  );
}
