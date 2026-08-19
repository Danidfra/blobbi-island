/**
 * The Prize Counter's ONE write into the player's inventory: spending Arcade
 * Tickets.
 *
 * The mirror image of `arcade-reward-writer.ts`, built to the same rules for
 * the same reasons — a spend is a grant with the sign flipped, and it inherits
 * every failure mode the reward boundary was rebuilt around:
 *
 * ```
 *   queued cross-tab lock + shared per-tab chain     ← no writer runs alone
 *   → authoritative read, empty base CONFIRMED        ← never the React cache
 *   → refuse when held < price                        ← no negative balances, ever
 *   → applyMutation({ type: 'remove', … })            ← the canonical helper
 *   → buildInventoryTemplate(next)                    ← the canonical builder
 *   → created_at = max(now, previous + 1)             ← no same-second ties
 *   → sign
 *   → nostr.event(…) with a 5 s timeout, STRICTLY     ← a timeout is NOT success
 * ```
 *
 * The lock is shared with the Coin wallet on purpose: Coins and Tickets are
 * quantities in the SAME replaceable kind:31633 event, so a spend built from a
 * base a concurrent coin write is replacing would roll that coin write back.
 *
 * Every step is the same code path `useInventoryMutation` uses, so a spend
 * preserves every unrelated item, rejects negative and non-integer amounts,
 * and omits zero-quantity entries exactly as every other inventory write does.
 * There is no optimistic update here: the caller must not show a spent balance
 * until the read-back confirms it.
 *
 * ## What is deliberately NOT here
 *
 * Prize ownership. Spending tickets and delivering a prize are different
 * writes to different stores with different trust levels, and this module only
 * knows how to turn a price into a smaller balance. kind:11125 (coins, legacy
 * storage) is never read or written.
 */

import type { NUser } from '@nostrify/react/login';

import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

import { applyMutation, getQuantity } from './useInventoryMutation';
import {
  InventoryTransactionError,
  readAuthoritativeInventoryBase,
  runInventoryTransaction,
  unwrapInventoryTransactionError,
  type InventoryTransactionNostr,
} from './inventory-transaction';

/** Canonical Arcade Ticket address — derived, never a literal. */
const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/**
 * The slice of `useNostr()` this module needs — structurally the shared
 * inventory-transaction surface, because that is what this writer now is.
 */
export type PrizeSpendNostr = InventoryTransactionNostr;

/**
 * The spend capability the redemption hook holds — an interface, so the DEV
 * harness and the tests can substitute one that never touches a relay, and so
 * a future grant/redemption protocol can replace the implementation behind the
 * same boundary.
 */
export interface ArcadePrizeSpendWriter {
  /**
   * Publish the ticket spend STRICTLY — a timeout or abort MUST reject.
   * Resolving on timeout is the exact defect this boundary exists to forbid.
   */
  spendTickets(redemption: ArcadePrizeRedemption): Promise<void>;
  /** Re-read the canonical inventory. `null` means the READ failed. */
  readTicketQuantity(): Promise<number | null>;
}

/**
 * Thrown for problems whose timing is PROVABLE — every reason here means
 * "this happened before the event could reach a relay", which is what lets
 * the redemption machine mark the attempt retryable instead of unresolved.
 * A failure that cannot prove its timing is thrown raw and classified as
 * possibly-published.
 */
export class ArcadePrizeSpendError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'invalid-price'
      | 'insufficient-tickets'
      | 'sign-failed'
      | 'publish-rejected',
  ) {
    super(message);
    this.name = 'ArcadePrizeSpendError';
  }
}

export interface ArcadePrizeSpendWriterDeps {
  readonly nostr: PrizeSpendNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Injectable clock for tests (monotonic `created_at`). */
  readonly now?: () => number;
}

/** Build the spend writer for one signed-in user. A factory, not a hook. */
export function createArcadePrizeSpendWriter(
  deps: ArcadePrizeSpendWriterDeps,
): ArcadePrizeSpendWriter {
  const { nostr, user, now } = deps;

  return {
    async spendTickets(redemption: ArcadePrizeRedemption): Promise<void> {
      if (!user?.pubkey || !user.signer) {
        throw new ArcadePrizeSpendError('User is not logged in', 'not-logged-in');
      }
      if (!Number.isInteger(redemption.price) || redemption.price <= 0) {
        throw new ArcadePrizeSpendError(
          `Refusing to spend ${redemption.price} tickets`,
          'invalid-price',
        );
      }

      // `insufficient-tickets` must stay PROVABLY pre-publish, so it is
      // captured inside the transaction and rethrown outside it.
      let insufficient: ArcadePrizeSpendError | null = null;
      try {
        await runInventoryTransaction({ nostr, user, now }, async (ctx) => {
          // Read-modify-write against the authoritative newest event, on the
          // SHARED lock. The empty base is confirmed before use, so a spend
          // can never replace a real inventory with a ticket-only one.
          const { inventory } = await ctx.readBase();
          const held = getQuantity(inventory, TICKET_ADDRESS);
          if (held < redemption.price) {
            // Nothing sent, and no balance may ever go negative — the freshest
            // read is the last word.
            insufficient = new ArcadePrizeSpendError(
              `Holding ${held} tickets; ${redemption.price} needed`,
              'insufficient-tickets',
            );
            return;
          }
          const next = applyMutation(inventory, {
            type: 'remove',
            address: TICKET_ADDRESS,
            amount: redemption.price,
          });
          // STRICT: resolving means at least one relay accepted it. A timeout
          // is NOT resolved through as "probably fine".
          await ctx.publish(next);
        });
      } catch (error) {
        // Only provable pre-publish failures may be wrapped; a publish timeout
        // must stay raw so the redemption machine classifies it as unresolved.
        if (error instanceof InventoryTransactionError && error.reason === 'sign-failed') {
          throw new ArcadePrizeSpendError(error.message, 'sign-failed');
        }
        // Read and publish failures keep their ORIGINAL identity — the
        // redemption machine classifies the thrown value, not this writer.
        throw unwrapInventoryTransactionError(error);
      }
      if (insufficient) throw insufficient;
    },

    async readTicketQuantity(): Promise<number | null> {
      try {
        const { inventory } = await readAuthoritativeInventoryBase(nostr, user.pubkey);
        return getQuantity(inventory, TICKET_ADDRESS);
      } catch {
        // A failed READ is not a failed write.
        return null;
      }
    },
  };
}
