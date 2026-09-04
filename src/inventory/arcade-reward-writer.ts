/**
 * The arcade's ONE write into the player's inventory.
 *
 * This is the implementation of `ArcadeRewardWriter`, the interface Phase 2
 * defined and deliberately left unimplemented. It lives in `src/inventory/`
 * rather than in `src/arcade/` for a structural reason, not a stylistic one:
 * `src/arcade/boundaries.test.ts` proves against the real import graph that no
 * module under `src/arcade/` can reach a relay or an inventory, and that
 * property is worth more than the convenience of keeping the arcade's files
 * together. The game computes a number; this module is the only thing that can
 * turn a number into a balance.
 *
 * ## What it does, in order
 *
 * The whole read-modify-write runs inside {@link runInventoryTransaction},
 * the SAME primitive the Coin wallet uses, on the SAME cross-tab lock name:
 *
 * ```
 *   queued cross-tab lock + shared per-tab chain     ← no writer runs alone
 *   → authoritative read, empty base CONFIRMED        ← never the React cache
 *   → applyMutation({ type: 'add', address, amount }) ← the canonical helper
 *   → buildInventoryTemplate(next)                    ← the canonical builder
 *   → created_at = max(now, previous + 1)             ← no same-second ties
 *   → sign
 *   → nostr.event(…) with a 5 s timeout, STRICTLY     ← a timeout is a FAILURE
 * ```
 *
 * Sharing the lock is not tidiness: Coins and Arcade Tickets live in the SAME
 * replaceable kind:31633 event, so a ticket grant built from a base that a
 * concurrent coin grant is already replacing would silently roll the Coin
 * balance back: and a ticket grant built from an unconfirmed empty read would
 * erase the balance outright.
 *
 * Every step after the read is the same code path `useInventoryMutation` uses,
 * so a ticket grant preserves unrelated item balances, rejects negative and
 * non-integer amounts, and omits zero-quantity entries exactly as every other
 * inventory write does. The two deliberate differences from
 * `useInventoryMutation` are both about honesty:
 *
 *  - **strict publish.** `useNostrPublish` swallows a 5-second timeout and
 *    resolves (correct for presence heartbeats, wrong for a one-shot grant of a
 *    scarce resource), so this signs and publishes locally instead, the same
 *    local-`strictPublish` pattern `useFirstEggAdoption` already established in
 *    this codebase.
 *  - **no optimistic update.** An optimistic balance is honest only when it is
 *    backed by a rollback, and here the caller must not show a number until the
 *    read-back confirms it.
 *
 * ## kind:11125 is never touched
 *
 * Since the Coin cutover the canonical Coin balance is the official Blobbi
 * Coin quantity in kind:31633, the same event this writer replaces, and a
 * historic kind:11125 `coins` tag is obsolete data nothing here reads or
 * writes. The Arcade **Pass** (temporary `sessionStorage` floor access) is not
 * an item at all and has no address, so it cannot be confused with the Arcade
 * **Ticket** by construction.
 */

import type { NUser } from '@nostrify/react/login';

import type { ArcadeRewardClaim, ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

import { applyMutation, getQuantity } from './useInventoryMutation';
import {
  InventoryTransactionError,
  readAuthoritativeInventoryBase,
  runInventoryTransaction,
  unwrapInventoryTransactionError,
  type InventoryTransactionNostr,
} from './inventory-transaction';

/**
 * The canonical Arcade Ticket address, derived from the official issuer and the
 * canonical `d`: never written out as a literal.
 *
 * `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket`
 */
export const ARCADE_TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/**
 * The slice of `useNostr()` this module needs, structurally the shared
 * inventory-transaction surface, because that is what this writer now is.
 */
export type RewardWriterNostr = InventoryTransactionNostr;

export interface ArcadeRewardWriterDeps {
  readonly nostr: RewardWriterNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Overridable so a test can grant a different item without faking the registry. */
  readonly itemAddress?: string;
  /** Injectable clock for tests (monotonic `created_at`). */
  readonly now?: () => number;
}

/**
 * Thrown for problems whose timing is PROVABLE.
 *
 * Every reason here means "this happened before the event could reach a relay",
 * which is what lets the claim boundary mark the attempt retryable instead of
 * unresolved. A failure that cannot prove its own timing must NOT be wrapped in
 * this class: it is thrown raw and classified as possibly-published.
 *
 * `publish-rejected` is the one reason the real writer never throws: proving
 * that no relay stored the event would need a per-relay OK/failure breakdown
 * that `NPool.event` does not surface (see the classifier in
 * `useArcadeReward.ts`). It exists so a writer that CAN prove it, the DEV
 * harness's fake, or a future client with a richer contract, has a way to say
 * so.
 */
export class ArcadeRewardWriterError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'invalid-quantity'
      | 'sign-failed'
      | 'publish-rejected',
  ) {
    super(message);
    this.name = 'ArcadeRewardWriterError';
  }
}

/**
 * Build the writer for one signed-in user.
 *
 * Deliberately a factory over explicit dependencies rather than a hook: the
 * publish/verify sequence is the part most worth testing, and testing it should
 * not require rendering anything.
 */
export function createArcadeTicketWriter(deps: ArcadeRewardWriterDeps): ArcadeRewardWriter {
  const { nostr, user, now } = deps;
  const itemAddress = deps.itemAddress ?? ARCADE_TICKET_ADDRESS;

  return {
    async publishTicketGrant(claim: ArcadeRewardClaim): Promise<void> {
      if (!user?.pubkey || !user.signer) {
        throw new ArcadeRewardWriterError('User is not logged in', 'not-logged-in');
      }
      if (!Number.isInteger(claim.tickets) || claim.tickets <= 0) {
        throw new ArcadeRewardWriterError(
          `Refusing to grant ${claim.tickets} tickets`,
          'invalid-quantity',
        );
      }

      try {
        await runInventoryTransaction({ nostr, user, now }, async (ctx) => {
          // Read-modify-write against the authoritative newest event, on the
          // SHARED lock so a concurrent Coin write cannot be built over. The
          // base's empty answer is confirmed before it is ever used, so this
          // grant can never replace a real inventory with "tickets only".
          const { inventory } = await ctx.readBase();
          const next = applyMutation(inventory, {
            type: 'add',
            address: itemAddress,
            amount: claim.tickets,
          });
          // STRICT publish: resolving means at least one relay accepted it. A
          // timeout is NOT resolved through as "probably fine": that is the
          // defect this whole boundary exists for.
          await ctx.publish(next);
        });
      } catch (error) {
        // Only a provable pre-publish failure may be wrapped: the claim
        // boundary treats a wrapped error as retryable and a raw one as
        // possibly-published. A read failure and a signer refusal are provable;
        // a publish timeout is exactly what must stay raw.
        if (error instanceof InventoryTransactionError && error.reason === 'sign-failed') {
          throw new ArcadeRewardWriterError(error.message, 'sign-failed');
        }
        // Read and publish failures keep their ORIGINAL identity: this
        // boundary's contract is that the claim machine classifies the thrown
        // value, and a wrapper would be a new, unrecognised type.
        throw unwrapInventoryTransactionError(error);
      }
    },

    async readTicketQuantity(): Promise<number | null> {
      try {
        const { inventory } = await readAuthoritativeInventoryBase(nostr, user.pubkey);
        return getQuantity(inventory, itemAddress);
      } catch {
        // A failed READ is not a failed write. Returning null lets the caller say
        // "we could not check" rather than "it did not happen".
        return null;
      }
    },
  };
}
