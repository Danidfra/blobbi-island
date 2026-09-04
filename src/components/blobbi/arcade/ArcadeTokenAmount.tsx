/**
 * The one way an Arcade Token amount is rendered.
 *
 * Uses the OFFICIAL published Token artwork resolved through the item catalog,
 * degrading to the published `symbol` emoji when the definition cannot be
 * fetched: the same rule `CoinAmount` follows, so the three currencies look
 * like three currencies rather than three ad-hoc glyphs.
 *
 * `amount === null` renders an explicit unavailable state: a balance that
 * could not be read must never look like a real zero.
 */

import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useItemCatalog } from '@/inventory/useItemCatalog';
import { primaryItemImageUrl } from '@/inventory/item-image-resolution';
import {
  ARCADE_TOKEN_ADDRESS,
  ARCADE_TOKEN_NAME,
  ARCADE_TOKEN_SYMBOL,
} from '@/arcade/tokens/arcade-token';

export function ArcadeTokenIcon({ className }: { className?: string }) {
  const { data: catalog } = useItemCatalog();
  const [failed, setFailed] = useState(false);
  const src = primaryItemImageUrl(catalog?.byAddress.get(ARCADE_TOKEN_ADDRESS));

  if (!src || failed) {
    return (
      <span aria-hidden className={className} data-token-icon-fallback>
        {ARCADE_TOKEN_SYMBOL}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        'inline-block h-[1.2em] w-[1.2em] object-contain align-text-bottom',
        className,
      )}
      onError={() => setFailed(true)}
      data-token-icon
    />
  );
}

interface ArcadeTokenAmountProps {
  /** Tokens to display, or `null` when the balance is unknown. */
  amount: number | null;
  loading?: boolean;
  className?: string;
}

export function ArcadeTokenAmount({ amount, loading, className }: ArcadeTokenAmountProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 font-bold tabular-nums', className)}
      data-token-amount={amount ?? 'unknown'}
    >
      <ArcadeTokenIcon />
      {loading ? (
        <Skeleton className="inline-block h-4 w-8 align-middle" />
      ) : amount === null ? (
        <span className="text-sm font-normal blobbi-text-muted" role="status">
          Balance unavailable
        </span>
      ) : (
        <>
          <span>{amount}</span>
          <span className="sr-only">{ARCADE_TOKEN_NAME}s</span>
        </>
      )}
    </span>
  );
}
