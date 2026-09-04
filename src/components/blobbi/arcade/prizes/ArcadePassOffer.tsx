/**
 * The Arcade Pass on the Prize Counter, the first LIVE redemption.
 *
 * ## Why this is its own component and not part of the shelf
 *
 * `PrizeCounter` is provably write-free: `prize-counter-boundaries.test.ts`
 * walks its whole transitive import graph and fails if a spend writer, a
 * mutation hook or the ownership store appears anywhere in it. That guarantee
 * covers the six cosmetic prizes, which remain preview-only pending their own
 * audited grant phase, and it is worth keeping exactly as it is.
 *
 * So the Pass arrives as a `ReactNode` the counter renders in a slot. A slot
 * carries no imports, the shelf's guarantee survives intact, and the one place
 * that can spend Arcade Tickets is this file.
 *
 * ## Everything financial happens in the hook
 *
 * `useArcadePrizeRedemption` owns the durable ledger, the same-tick lock, the
 * strict publish, the verify read-back and the paid-but-undelivered recovery.
 * This component contributes exactly two things it could not know:
 *
 *  1. the entitlement's own no-stacking rule (`canRedeemArcadePass`), checked
 *     BEFORE any spend, because "a pass is already running" is a question
 *     about the entitlement rather than about payment history;
 *  2. delivery into the entitlement store instead of the ownership store
 *     (`createArcadePassOwnership`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIslandInventory } from '@/inventory/useIslandInventory';
import { getInventoryItemQuantity } from '@/inventory/package';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';
import { useArcadePrizeRedemption } from '@/hooks/useArcadePrizeRedemption';
import {
  ARCADE_PASS_PRIZE,
  createArcadePassOwnership,
} from '@/arcade/prizes/arcade-pass-prize';
import { ARCADE_PASS_FREE_PLAYS } from '@/arcade/pass/arcade-pass-terms';
import { canRedeemArcadePass } from '@/arcade/pass/arcade-pass-entitlement';
import {
  formatFreePlays,
  formatPassRemaining,
  useArcadePass,
} from '@/hooks/useArcadePass';

const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/** Phases where a retry would be a SECOND debit. The button must never offer one. */
const NEVER_RETRY = new Set(['spending', 'spend-unresolved', 'checking']);

export function ArcadePassOffer() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const inventory = useIslandInventory();
  const { isActive, isUsable, remainingMs, remainingFreePlays } = useArcadePass();

  const ownership = useMemo(() => createArcadePassOwnership(), []);
  const { state, redeem, checkSpendStatus, finishDelivery, hydrateForPrize } =
    useArcadePrizeRedemption({ ownership });

  /*
    Recover an interrupted redemption from a PREVIOUS session.

    Tickets are spent before the pass is stored, so a tab closed in between
    leaves a paid-but-undelivered record in the durable ledger. Hydrating on
    mount is what turns that into a visible "Finish delivery" instead of a
    silent loss the player would have to notice on their own.
  */
  useEffect(() => {
    hydrateForPrize(ARCADE_PASS_PRIZE);
  }, [hydrateForPrize]);

  const [blocked, setBlocked] = useState<string | null>(null);

  const balance = inventory.data
    ? getInventoryItemQuantity(inventory.data, TICKET_ADDRESS)
    : null;
  const price = ARCADE_PASS_PRIZE.price;
  const affordable = balance !== null && balance >= price;

  const busy =
    state.prizeId === ARCADE_PASS_PRIZE.id &&
    ['reserving', 'spending', 'delivering', 'checking'].includes(state.phase);
  const unresolved = state.prizeId === ARCADE_PASS_PRIZE.id && state.phase === 'spend-unresolved';
  const recovery =
    state.prizeId === ARCADE_PASS_PRIZE.id && state.phase === 'delivery-recovery';

  const onRedeem = useCallback(async () => {
    setBlocked(null);
    // The stacking rule, checked before anything is spent. Refusing here is
    // free; refusing after the publish would mean tickets held against an
    // undeliverable pass.
    if (!canRedeemArcadePass(pubkey, Date.now())) {
      setBlocked('Your current Arcade Pass still has free plays. Use them before redeeming another.');
      return;
    }
    await redeem(ARCADE_PASS_PRIZE);
  }, [pubkey, redeem]);

  const message = blocked ?? (state.prizeId === ARCADE_PASS_PRIZE.id ? state.message : '');

  return (
    <section
      data-arcade-pass-offer
      className="mx-3 mb-2 mt-3 rounded-panel border-2 border-island-purple/40 bg-gradient-to-b from-island-purple/12 to-transparent p-3 sm:mx-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wide text-island-purple">
            <span aria-hidden>{ARCADE_PASS_PRIZE.emojiFallback}</span>
            {ARCADE_PASS_PRIZE.title}
          </h3>
          {/*
            Both limits, in the order they bind. "24 hours" on its own is the
            sentence that made the old unlimited pass unpriceable, and it must
            never appear here without the play count beside it.
          */}
          <p className="mt-0.5 text-sm text-island-ink">
            <strong>{ARCADE_PASS_FREE_PLAYS} free plays</strong>, to use within{' '}
            <strong>24 hours</strong>.
          </p>
          <p className="mt-0.5 text-xs text-island-ink-soft">
            Games start free until the plays run out. After that they cost Arcade Tokens again.
          </p>
        </div>
        <p
          className={cn(
            'shrink-0 rounded-full border px-2 py-1 text-sm font-bold tabular-nums',
            affordable
              ? 'border-island-purple/40 bg-island-purple/10 text-island-purple'
              : 'border-island-wood/30 bg-island-cream-2/60 text-island-ink-soft',
          )}
        >
          {price} 🎟️
        </p>
      </div>

      {isActive && (
        <p className="mt-2 text-xs text-island-ink-soft" data-pass-status>
          {isUsable
            ? `Active: ${formatFreePlays(remainingFreePlays)}, ${formatPassRemaining(remainingMs)} left.`
            : `Free plays used. This pass expires in ${formatPassRemaining(remainingMs)}.`}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {unresolved ? (
          // Reconcile-only. The spend may have landed, so the ONE safe action
          // is a read, never a second publish.
          <Button
            variant="soft"
            className="min-h-[44px]"
            onClick={() => void checkSpendStatus(ARCADE_PASS_PRIZE)}
            data-pass-check-status
          >
            Check status
          </Button>
        ) : recovery ? (
          // Already paid. Finishing delivery spends nothing.
          <Button
            variant="accent"
            className="min-h-[44px]"
            onClick={() => {
              if (state.redemption) void finishDelivery(ARCADE_PASS_PRIZE, state.redemption);
            }}
            data-pass-finish-delivery
          >
            Finish delivery
          </Button>
        ) : (
          <Button
            variant="accent"
            className="min-h-[44px]"
            disabled={
              busy ||
              !user ||
              balance === null ||
              !affordable ||
              isUsable ||
              NEVER_RETRY.has(state.phase)
            }
            onClick={() => void onRedeem()}
            data-pass-redeem
          >
            {busy ? 'Redeeming…' : 'Redeem'}
          </Button>
        )}

        {!user && <span className="text-xs text-island-ink-soft">Log in to redeem.</span>}
        {user && balance !== null && !affordable && !isUsable && (
          <span className="text-xs text-island-ink-soft">
            You have {balance} of {price} tickets.
          </span>
        )}
      </div>

      {message && (
        <p role="alert" className="mt-2 text-xs text-island-danger" data-pass-message>
          {message}
        </p>
      )}
    </section>
  );
}
