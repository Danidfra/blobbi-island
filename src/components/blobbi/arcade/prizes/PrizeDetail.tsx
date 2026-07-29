import { useState } from 'react';

import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';
import { ARCADE_PRIZE_CATEGORY_LABELS } from '@/arcade/prizes/prize-catalogue';
import type { PrizeEligibility } from '@/arcade/prizes/prize-redemption';
import type { PrizeRedemptionUiState } from '@/hooks/useArcadePrizeRedemption';

/**
 * The detail-and-confirmation surface for one prize.
 *
 * Selecting a card never spends; THIS panel is where the explicit decision
 * happens, with everything a decision needs on screen: the artwork, the
 * price, the balance now, the balance after, ownership, availability, and —
 * for future-facing prizes like the Mini Arcade Cabinet — what the thing will
 * actually do one day. On mobile the action bar is sticky at the bottom of
 * the panel so the confirm button is never below the fold.
 *
 * ## The action area tells the redemption's truth
 *
 * One slot, driven by eligibility plus the redemption phase, with the same
 * honesty rules the ticket-claim panel established: a pending spend disables
 * everything, an UNRESOLVED spend gets exactly one read-only "check status"
 * action (never a retry — `-40` retried after a publish that landed is
 * `-80`), a paid-but-undelivered prize gets "Finish delivery" (which never
 * spends), and success is only shown after the verified read-back.
 */

interface PrizeDetailProps {
  readonly prize: ArcadePrize;
  readonly balance: number | null;
  readonly balanceUnavailable: boolean;
  /** Grants recorded by the TEMPORARY store. */
  readonly ownedCount: number;
  readonly eligibility: PrizeEligibility;
  readonly redemption: PrizeRedemptionUiState;
  readonly isLoggedIn: boolean;
  readonly onRedeem: () => void;
  readonly onCheckStatus: () => void;
  readonly onFinishDelivery: () => void;
  /** Mobile only: return to the shelf. */
  readonly onBack: () => void;
}

const PHASE_CHIP: Readonly<
  Partial<Record<PrizeRedemptionUiState['phase'], { label: string; className: string }>>
> = {
  reserving: { label: 'Checking…', className: 'bg-island-wood/15 text-island-wood-dark' },
  spending: { label: 'Spending…', className: 'bg-island-wood/15 text-island-wood-dark' },
  'spend-unresolved': { label: 'Not confirmed', className: 'bg-amber-500/15 text-amber-800' },
  checking: { label: 'Checking…', className: 'bg-island-wood/15 text-island-wood-dark' },
  delivering: { label: 'Delivering…', className: 'bg-island-wood/15 text-island-wood-dark' },
  'delivery-recovery': { label: 'Delivery pending', className: 'bg-amber-500/15 text-amber-800' },
  confirmed: { label: 'Yours!', className: 'bg-emerald-500/15 text-emerald-800' },
  failed: { label: 'Not spent', className: 'bg-rose-500/15 text-rose-800' },
};

export function PrizeDetail({
  prize,
  balance,
  balanceUnavailable,
  ownedCount,
  eligibility,
  redemption,
  isLoggedIn,
  onRedeem,
  onCheckStatus,
  onFinishDelivery,
  onBack,
}: PrizeDetailProps) {
  const owned = ownedCount > 0;
  const reducedMotion = useReducedMotion();
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(prize.image) && !imageFailed;

  const active = redemption.prizeId === prize.id ? redemption : null;
  const phase = active?.phase ?? 'idle';
  const busy = phase === 'reserving' || phase === 'spending' || phase === 'delivering';
  const checking = phase === 'checking';
  const unresolved = phase === 'spend-unresolved';
  const recovery = phase === 'delivery-recovery';
  const confirmed = phase === 'confirmed';
  const failed = phase === 'failed';
  const chip = PHASE_CHIP[phase];

  const comingSoon = prize.availability === 'coming-soon';
  const after = balance !== null ? balance - prize.price : null;
  const futureHome = prize.delivery.type === 'home-furniture';

  return (
    <div
      data-prize-detail={prize.id}
      data-prize-detail-phase={phase}
      className="flex h-full min-h-0 flex-col"
    >
      {/* Mobile: the way back to the shelf. Desktop keeps the shelf visible. */}
      <button
        type="button"
        data-prize-detail-back
        onClick={onBack}
        className="mb-2 inline-flex min-h-[44px] items-center gap-1 self-start rounded-full px-2 text-sm font-bold text-island-ink md:hidden"
      >
        <span aria-hidden>←</span> All prizes
      </button>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2 pr-0.5">
        {/* The prize, celebrated a little even before it is owned. */}
        <div
          className={cn(
            'relative flex h-32 items-center justify-center overflow-hidden rounded-2xl border-2 text-6xl sm:h-40',
            prize.rarity === 'premium'
              ? 'border-amber-400/60 bg-gradient-to-b from-amber-100 to-island-cream-2'
              : 'border-island-wood/25 bg-island-cream-2',
            comingSoon && 'opacity-70 grayscale',
          )}
          aria-hidden
        >
          {showImage ? (
            <img
              src={prize.image}
              alt=""
              className="h-full w-full object-contain p-2"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className={cn(confirmed && !reducedMotion && 'animate-bounce')}>
              {prize.emojiFallback}
            </span>
          )}
          {/* Restrained success burst — a stamp, not a takeover. */}
          {confirmed && (
            <span
              data-prize-success-stamp
              className={cn(
                'absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-1 text-xs font-black uppercase tracking-wide text-white shadow',
                !reducedMotion && 'animate-in zoom-in-50 duration-300',
              )}
            >
              Yours!
            </span>
          )}
          {confirmed && !reducedMotion && (
            <span aria-hidden className="pointer-events-none absolute inset-0">
              <span className="absolute left-[20%] top-[15%] animate-ping text-lg">🎊</span>
              <span className="absolute right-[25%] top-[30%] animate-ping text-sm [animation-delay:150ms]">
                ✨
              </span>
              <span className="absolute left-[40%] bottom-[15%] animate-ping text-sm [animation-delay:300ms]">
                🎉
              </span>
            </span>
          )}
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-black leading-tight text-island-ink">{prize.title}</h3>
            <p className="text-xs font-bold uppercase tracking-widest blobbi-text-muted">
              {ARCADE_PRIZE_CATEGORY_LABELS[prize.category]}
              {prize.rarity === 'premium' ? ' · Premium' : ''}
              {prize.repeatable ? ' · Repeatable' : ''}
              {prize.repeatable && ownedCount > 0 ? ` · Redeemed ×${ownedCount}` : ''}
            </p>
          </div>
          {chip && (
            <span
              data-prize-detail-chip={phase}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                chip.className,
              )}
            >
              {chip.label}
            </span>
          )}
        </div>

        <p className="text-sm text-island-ink/90">{prize.description}</p>

        {/* Future-use copy for Home furniture — product-facing and concise. */}
        {futureHome && (
          <div
            data-prize-future-home
            className="space-y-1 rounded-2xl border-2 border-island-purple/25 bg-island-purple/[0.06] p-3 text-xs text-island-ink/90"
          >
            <p className="font-bold text-island-ink">
              <span aria-hidden>🏠 </span>Future Home furniture
            </p>
            <p>
              One day you will place this in your Home and play arcade games right there. Home
              cabinet games are just for fun — they will not award Arcade Tickets.
            </p>
          </div>
        )}

        {/* The numbers a decision needs, all three of them. */}
        <dl className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-xl border border-island-wood/25 bg-island-cream/60 p-2">
            <dt className="text-[10px] font-bold uppercase tracking-wide blobbi-text-muted">
              Price
            </dt>
            <dd className="font-mono text-base font-black text-island-purple">
              <span aria-hidden>🎟️ </span>
              {prize.price}
            </dd>
          </div>
          <div className="rounded-xl border border-island-wood/25 bg-island-cream/60 p-2">
            <dt className="text-[10px] font-bold uppercase tracking-wide blobbi-text-muted">
              You have
            </dt>
            <dd
              className="font-mono text-base font-black text-island-ink"
              aria-label={
                balance === null
                  ? balanceUnavailable
                    ? 'Your ticket balance is unavailable'
                    : 'Loading your ticket balance'
                  : `You have ${balance} Arcade Tickets`
              }
            >
              {balance === null ? (balanceUnavailable ? '–' : '…') : balance}
            </dd>
          </div>
          <div className="rounded-xl border border-island-wood/25 bg-island-cream/60 p-2">
            <dt className="text-[10px] font-bold uppercase tracking-wide blobbi-text-muted">
              After
            </dt>
            <dd className="font-mono text-base font-black text-island-ink">
              {owned && !prize.repeatable ? '—' : after === null || after < 0 ? '—' : after}
            </dd>
          </div>
        </dl>

        {active?.message && (
          <p
            role="status"
            data-prize-detail-message
            className={cn(
              'rounded-lg px-2 py-1.5 text-xs',
              confirmed && 'bg-emerald-500/10 text-emerald-800',
              failed && 'bg-rose-500/10 text-rose-800',
              (unresolved || recovery) && 'bg-amber-500/10 text-amber-800',
              (busy || checking) && 'bg-island-wood/10',
            )}
          >
            {active.message}
          </p>
        )}
      </div>

      {/* The decision. Sticky at the panel's bottom so mobile never hides it. */}
      <div className="shrink-0 border-t border-island-wood/20 pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <ActionArea
          prize={prize}
          owned={owned}
          eligibility={eligibility}
          phase={phase}
          busy={busy}
          checking={checking}
          unresolved={unresolved}
          recovery={recovery}
          confirmed={confirmed}
          failed={failed}
          isLoggedIn={isLoggedIn}
          onRedeem={onRedeem}
          onCheckStatus={onCheckStatus}
          onFinishDelivery={onFinishDelivery}
        />
      </div>
    </div>
  );
}

function ActionArea({
  prize,
  owned,
  eligibility,
  phase,
  busy,
  checking,
  unresolved,
  recovery,
  confirmed,
  failed,
  isLoggedIn,
  onRedeem,
  onCheckStatus,
  onFinishDelivery,
}: {
  readonly prize: ArcadePrize;
  readonly owned: boolean;
  readonly eligibility: PrizeEligibility;
  readonly phase: PrizeRedemptionUiState['phase'];
  readonly busy: boolean;
  readonly checking: boolean;
  readonly unresolved: boolean;
  readonly recovery: boolean;
  readonly confirmed: boolean;
  readonly failed: boolean;
  readonly isLoggedIn: boolean;
  readonly onRedeem: () => void;
  readonly onCheckStatus: () => void;
  readonly onFinishDelivery: () => void;
}) {
  const primaryClass = cn(
    'min-h-[48px] w-full rounded-full border-2 px-4 py-2 text-sm font-bold',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    'border-island-purple bg-island-purple text-white disabled:opacity-50',
  );
  const quietClass = cn(
    'min-h-[48px] w-full rounded-full border-2 border-island-wood/40 px-4 py-2 text-sm font-bold',
    'bg-island-cream text-island-ink disabled:opacity-50',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
  );

  // A NON-repeatable prize retires once confirmed or owned. A repeatable one
  // never retires: its confirmed attempt celebrates above, and the action
  // returns to a redeemable state (see below).
  if (!prize.repeatable && (confirmed || (owned && phase === 'idle'))) {
    return (
      <p
        data-prize-action="owned"
        className="rounded-full bg-emerald-500/15 px-4 py-3 text-center text-sm font-bold text-emerald-800"
      >
        <span aria-hidden>✅ </span>Owned
      </p>
    );
  }

  if (unresolved || checking) {
    return (
      <button
        type="button"
        data-prize-check-status
        onClick={onCheckStatus}
        disabled={checking || !isLoggedIn}
        className={quietClass}
      >
        {checking ? 'Checking…' : 'Check spend status'}
      </button>
    );
  }

  if (recovery) {
    return (
      <button
        type="button"
        data-prize-finish-delivery
        onClick={onFinishDelivery}
        disabled={!isLoggedIn}
        className={primaryClass}
      >
        Finish delivery — already paid
      </button>
    );
  }

  if (!eligibility.eligible && !failed) {
    const label =
      eligibility.reason === 'coming-soon'
        ? 'Coming soon'
        : eligibility.reason === 'insufficient-tickets'
          ? 'Not enough Tickets'
          : eligibility.reason === 'logged-out'
            ? 'Log in to redeem'
            : eligibility.reason === 'balance-unavailable'
              ? 'Balance unavailable'
              : 'Not available';
    return (
      <button
        type="button"
        data-prize-redeem="ineligible"
        data-prize-ineligible-reason={eligibility.reason}
        disabled
        className={quietClass}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-prize-redeem="ready"
      onClick={onRedeem}
      disabled={busy || !isLoggedIn || (!eligibility.eligible && !failed)}
      className={primaryClass}
    >
      {busy
        ? phase === 'delivering'
          ? 'Delivering…'
          : 'Spending your tickets…'
        : failed
          ? 'Try again'
          : confirmed
            ? `Redeem again for ${prize.price} Tickets`
            : `Redeem for ${prize.price} Tickets`}
    </button>
  );
}
