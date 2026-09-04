/**
 * The Arcade Pass as a Prize Counter entry.
 *
 * ## Why it is an `ArcadePrize` and not a new kind of thing
 *
 * Because a Pass redemption has exactly the failure modes a prize redemption
 * has, and those were already solved. Spending Arcade Tickets is a strict
 * publish against a replaceable event: it can time out having landed, it can
 * land and then fail to deliver, and a naive retry turns one debit into two.
 * `useArcadePrizeRedemption` and the durable redemption ledger were built
 * around exactly that, hardened and tested, and dormant only because no prize
 * was redeemable yet.
 *
 * Making the Pass the first live entry reuses all of it rather than growing a
 * second, thinner copy beside it:
 *
 * ```
 *   reserved → spending (+ baseline) → strict publish → verify
 *            → delivering → grantPrize(redemptionId) → hasDelivery → confirmed
 * ```
 *
 * ## The one thing that is Pass-specific
 *
 * Delivery. Every other prize is granted into the temporary local ownership
 * store; a Pass is granted into the entitlement store instead, because an
 * expiring allowance is not ownership. {@link createArcadePassOwnership} is
 * that substitution and nothing else; it satisfies the same four-method
 * contract, with the same per-redemption-id idempotency the delivery retry
 * depends on.
 *
 * ## Repeatable, but not stackable
 *
 * `repeatable: true` so a confirmed redemption never permanently blocks the
 * next one: a Pass is a consumable and buying another later is the point.
 * What stops two Passes running at once is the entitlement itself
 * (`canRedeemArcadePass`), which is where the rule belongs: the ledger tracks
 * REDEMPTIONS, and "is a pass currently running" is a question about the
 * entitlement, not about payment history.
 */

import type { ArcadePrize } from './prize-catalogue';
import type {
  ArcadePrizeOwnership,
  OwnedPrizeRecord,
} from '@/lib/arcade-prize-ownership';

import {
  ARCADE_PASS_FREE_PLAYS,
  ARCADE_PASS_TICKET_PRICE,
} from '../pass/arcade-pass-terms';
import {
  grantArcadePass,
  hasUsableArcadePass,
  readArcadePass,
} from '../pass/arcade-pass-entitlement';

/** Stable id. Recorded in every redemption record, so it must never change. */
export const ARCADE_PASS_PRIZE_ID = 'arcade-pass-24h';

/**
 * The Pass on the shelf.
 *
 * The description carries BOTH limits on purpose. "24 hours" alone reads as
 * unlimited play for a day, which is what this Pass deliberately is not.
 */
export const ARCADE_PASS_PRIZE: ArcadePrize = Object.freeze({
  id: ARCADE_PASS_PRIZE_ID,
  title: 'Arcade Pass',
  description: `${ARCADE_PASS_FREE_PLAYS} free plays, to use within 24 hours. Games start free until the plays run out.`,
  category: 'consumable',
  price: ARCADE_PASS_TICKET_PRICE,
  emojiFallback: '🎟️',
  availability: 'available',
  rarity: 'premium',
  repeatable: true,
  delivery: { type: 'mock-ownership' } as const,
});

/**
 * Deliver a redeemed Pass into the entitlement store.
 *
 * Satisfies `ArcadePrizeOwnership` so the hardened redemption flow can drive
 * it unchanged. The contract's guarantees map cleanly:
 *
 * - `grantPrize` is idempotent per redemption id, so the delivery retry after
 *   a paid-but-undelivered redemption cannot grant twice, and cannot reset an
 *   allowance the player has already started spending.
 * - `hasDelivery` is the VERIFICATION the flow runs after every grant, and it
 *   asks the store, never the caller's optimism.
 * - A refused grant throws, which keeps the redemption in `delivering`: paid,
 *   recoverable, and never respent.
 */
export function createArcadePassOwnership(
  now: () => number = Date.now,
): ArcadePrizeOwnership {
  return {
    async hasPrize(pubkey: string, prizeId: string): Promise<boolean> {
      if (prizeId !== ARCADE_PASS_PRIZE_ID) return false;
      // "Owned" means a pass is RUNNING. An expired or spent one is not a
      // holding, and must not make the counter look sold out.
      return hasUsableArcadePass(pubkey, now());
    },

    async hasDelivery(
      pubkey: string,
      prizeId: string,
      redemptionId: string,
    ): Promise<boolean> {
      if (prizeId !== ARCADE_PASS_PRIZE_ID) return false;
      return readArcadePass(pubkey)?.redemptionId === redemptionId;
    },

    async grantPrize(pubkey: string, prize: ArcadePrize, redemptionId: string): Promise<void> {
      if (prize.id !== ARCADE_PASS_PRIZE_ID) {
        throw new Error(`Not an Arcade Pass redemption: ${prize.id}`);
      }
      const granted = grantArcadePass(pubkey, { redemptionId, nowMs: now() });
      if (!granted) {
        // Deferred, not lost. The tickets are spent and the ledger keeps the
        // redemption open; the message says which of the two reasons it was.
        throw new Error(
          hasUsableArcadePass(pubkey, now())
            ? 'A pass is already running; this one will be delivered once it is used up or expires.'
            : 'This browser would not store the pass. Free some storage and finish the delivery.',
        );
      }
    },

    async listOwnedPrizes(pubkey: string): Promise<readonly OwnedPrizeRecord[]> {
      const record = readArcadePass(pubkey);
      if (!record) return [];
      return [
        {
          prizeId: ARCADE_PASS_PRIZE_ID,
          count: 1,
          firstGrantedAt: record.redeemedAt,
          deliveredRedemptionIds: [record.redemptionId],
        },
      ];
    },
  };
}
