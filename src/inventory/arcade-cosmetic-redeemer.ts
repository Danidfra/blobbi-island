/**
 * ATOMIC redemption for a kind:31633 cosmetic Prize Counter reward.
 *
 * ## The problem this module exists to remove
 *
 * The Arcade Pass redemption pays first and delivers second, because the two
 * halves live in different stores: Arcade Tickets are quantities in kind:31633,
 * an expiring Pass is not. Between those two writes there is a real gap, and
 * `useArcadePrizeRedemption` spends a lot of its machinery keeping that gap
 * survivable: the `spent`/`delivering` states, the durable ledger record, the
 * idempotent-per-redemption-id retry.
 *
 * A cosmetic prize has no such gap to survive, because BOTH halves are
 * quantities in the SAME replaceable event:
 *
 * ```
 *   before:  { …, 🎟️ Arcade Ticket: 500 }
 *   after:   { …, 🎟️ Arcade Ticket: 100, 🧢 Block Builder Cap: 1 }
 *            └──────────────── ONE kind:31633 replacement event ─────────┘
 * ```
 *
 * So this module does the debit and the grant as a single `set-many` mutation
 * inside a single {@link runInventoryTransaction}. One event lands or none
 * does. There is no ordering to get wrong, no second write racing the first,
 * no window in which tickets are gone and the prize is missing, and exactly one
 * confirmed-inventory reconciliation for the UI to render.
 *
 * The two-stage lifecycle is not discarded; it is what the Pass still needs,
 * and it is what makes an AMBIGUOUS publish recoverable for either kind of
 * prize. This module simply collapses the delivery half into a VERIFICATION:
 * {@link ArcadePrizeOwnership.grantPrize} here writes nothing at all, because
 * the grant already rode on the spend's own event.
 *
 * ## Reading, and why verification folds in the confirmed event
 *
 * A relay does not serve a replaceable event the instant it accepts it, so a
 * read-back taken microseconds after a successful publish routinely answers
 * with the event that was just replaced. Balance arithmetic on that answer
 * would declare a definitively-landed spend "unresolved" and send the player to
 * a Check-status button for nothing.
 *
 * {@link readNewestKnownInventory} therefore reads the relay authoritatively
 * (with the empty-confirmed rule, so a cold read is never fabricated as an
 * empty inventory) and then folds in this tab's confirmed event, the exact
 * event a relay accepted, exactly as `useIslandInventory` already does for
 * display. The fold can only ever appear after a DEFINITE accept, so the
 * ambiguous path it matters for reads pure relay state and nothing is laundered:
 * `recordConfirmedInventory` is not called on a timeout.
 *
 * Publish bases are unaffected. `runInventoryTransaction` still reads its base
 * authoritatively from the relay inside the lock; nothing here is ever a base.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import type { ArcadePrize } from '@/arcade/prizes/prize-catalogue';
import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import type {
  ArcadePrizeOwnership,
  OwnedPrizeRecord,
} from '@/lib/arcade-prize-ownership';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

import { confirmedInventoryEvent } from './confirmed-inventory';
import {
  ArcadePrizeSpendError,
  type ArcadePrizeSpendWriter,
} from './arcade-prize-spend-writer';
import {
  InventoryTransactionError,
  readAuthoritativeInventoryBase,
  runInventoryTransaction,
  unwrapInventoryTransactionError,
  type InventoryTransactionNostr,
} from './inventory-transaction';
import { parseInventoryEvent } from './protocol-adapter';
import { applyMutation, getQuantity } from './useInventoryMutation';
import type { GameInventory } from './package';

/** Canonical Arcade Ticket address, derived, never a literal. */
const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/** The relay surface an atomic redemption needs: the shared read + publish. */
export type ArcadeCosmeticRedeemerNostr = InventoryTransactionNostr;

/**
 * The pair the redemption hook holds for one cosmetic prize.
 *
 * They are built together and share one prize, one address and one read
 * helper, because the spend and the "delivery" are two views of a single
 * event. Handing them out separately would invite a writer for one prize to be
 * paired with the ownership check for another.
 */
export interface ArcadeCosmeticRedeemer {
  readonly writer: ArcadePrizeSpendWriter;
  readonly ownership: ArcadePrizeOwnership;
  /** The canonical `31632:<issuer>:<d>` this redemption grants. */
  readonly itemAddress: string;
}

export interface ArcadeCosmeticRedeemerDeps {
  readonly nostr: ArcadeCosmeticRedeemerNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /**
   * The prize. Its `delivery` MUST be `{ type: 'inventory', itemAddress }`,
   * that address is the single source of what gets granted.
   */
  readonly prize: ArcadePrize;
  /** Injectable clock for tests (monotonic `created_at`). */
  readonly now?: () => number;
}

/** The canonical item address a prize grants, or `null` if it grants no item. */
export function inventoryPrizeAddress(prize: ArcadePrize): string | null {
  return prize.delivery.type === 'inventory' ? prize.delivery.itemAddress : null;
}

/**
 * The newest kind:31633 state this tab can justify believing.
 *
 * Authoritative relay read (which throws rather than reporting an unusable
 * read as "no inventory"), folded with an event a relay has definitely
 * accepted. Throws whatever the read threw, a failed READ is never an empty
 * inventory.
 */
async function readNewestKnownInventory(
  nostr: ArcadeCosmeticRedeemerNostr,
  pubkey: string,
): Promise<GameInventory> {
  const { inventory, createdAt } = await readAuthoritativeInventoryBase(nostr, pubkey);
  const local: NostrEvent | null = confirmedInventoryEvent(pubkey);
  if (!local || local.created_at <= createdAt) return inventory;
  return parseInventoryEvent(local) ?? inventory;
}

/**
 * Build the atomic redeemer for one prize and one signed-in user.
 *
 * A factory, not a hook, so the tests and the DEV harness can substitute a
 * relay that never exists, and so the redemption hook stays free of any
 * knowledge of how a cosmetic is actually delivered.
 */
export function createArcadeCosmeticRedeemer(
  deps: ArcadeCosmeticRedeemerDeps,
): ArcadeCosmeticRedeemer {
  const { nostr, user, prize, now } = deps;
  const itemAddress = inventoryPrizeAddress(prize);
  if (!itemAddress) {
    throw new Error(`Prize "${prize.id}" does not deliver into the inventory`);
  }

  const readInventory = async (): Promise<GameInventory | null> => {
    if (!user?.pubkey) return null;
    try {
      return await readNewestKnownInventory(nostr, user.pubkey);
    } catch {
      // A failed READ is not a failed write, and it is emphatically not an
      // empty inventory. `null` means "unknown" everywhere below.
      return null;
    }
  };

  const ownedQuantity = async (): Promise<number | null> => {
    const inventory = await readInventory();
    return inventory ? getQuantity(inventory, itemAddress) : null;
  };

  const writer: ArcadePrizeSpendWriter = {
    /**
     * The whole redemption, as ONE replacement event.
     *
     * Order inside the lock is deliberate: the ownership refusal comes before
     * the balance refusal, so a player who already holds the prize is told
     * that rather than being told about tickets they were never going to spend.
     * Both are captured and rethrown OUTSIDE the transaction, because a
     * pre-publish refusal must not be mistaken for a publish that failed.
     */
    async spendTickets(redemption: ArcadePrizeRedemption): Promise<void> {
      if (!user?.pubkey || !user.signer) {
        throw new ArcadePrizeSpendError('User is not logged in', 'not-logged-in');
      }
      if (redemption.prizeId !== prize.id) {
        throw new ArcadePrizeSpendError(
          `Redemption is for "${redemption.prizeId}", this redeemer grants "${prize.id}"`,
          'invalid-price',
        );
      }
      if (!Number.isInteger(redemption.price) || redemption.price <= 0) {
        throw new ArcadePrizeSpendError(
          `Refusing to spend ${redemption.price} tickets`,
          'invalid-price',
        );
      }

      let refusal: ArcadePrizeSpendError | null = null;
      try {
        await runInventoryTransaction({ nostr, user, now }, async (ctx) => {
          // THE authoritative precondition. The rendered inventory may be
          // seconds stale and another tab may have redeemed in between; this
          // read is the newest event, taken inside the lock that every
          // kind:31633 writer shares, and it is the last word on both
          // questions.
          const { inventory } = await ctx.readBase();
          const held = getQuantity(inventory, TICKET_ADDRESS);
          const owned = getQuantity(inventory, itemAddress);

          if (owned >= 1) {
            refusal = new ArcadePrizeSpendError(
              `Already holding ${prize.title}`,
              'already-owned',
            );
            return;
          }
          if (held < redemption.price) {
            refusal = new ArcadePrizeSpendError(
              `Holding ${held} tickets; ${redemption.price} needed`,
              'insufficient-tickets',
            );
            return;
          }

          // ONE mutation, two absolute quantities. `set-many` is the canonical
          // helper for exactly this: only the listed addresses move, every
          // unrelated entry and unknown tag rides through the package builder
          // untouched, and a zeroed ticket entry is omitted rather than
          // written as `0`.
          const next = applyMutation(inventory, {
            type: 'set-many',
            targets: [
              { address: TICKET_ADDRESS, quantity: held - redemption.price },
              { address: itemAddress, quantity: 1 },
            ],
          });
          // STRICT: resolving means at least one relay accepted this exact
          // event: debit and grant together. A timeout is NOT resolved
          // through as "probably fine".
          await ctx.publish(next);
        });
      } catch (error) {
        if (error instanceof InventoryTransactionError && error.reason === 'sign-failed') {
          throw new ArcadePrizeSpendError(error.message, 'sign-failed');
        }
        // Read and publish failures keep their ORIGINAL identity: the
        // redemption machine classifies the thrown value, not this writer.
        throw unwrapInventoryTransactionError(error);
      }
      if (refusal) throw refusal;
    },

    async readTicketQuantity(): Promise<number | null> {
      const inventory = await readInventory();
      return inventory ? getQuantity(inventory, TICKET_ADDRESS) : null;
    },
  };

  const ownership: ArcadePrizeOwnership = {
    /**
     * ATOMIC: this delivery rides on the spend's own event. The redemption
     * hook uses the flag to reconcile an ambiguous spend against the PRIZE
     * rather than against a balance other writers also move.
     */
    atomicWithSpend: true,

    async hasPrize(pubkey: string, prizeId: string): Promise<boolean> {
      if (!pubkey || prizeId !== prize.id) return false;
      return ((await ownedQuantity()) ?? 0) >= 1;
    },

    /**
     * Was THIS redemption delivered?
     *
     * The honest answer for an atomic redemption is "is the prize here", and
     * the redemption id deliberately plays no part: kind:31633 records
     * quantities, not the operation that produced them, and inventing a
     * delivery identity it does not carry would be a fiction the recovery path
     * then trusted. It does not need one, the grant cannot exist without the
     * debit that shares its event, so presence is the whole proof.
     */
    async hasDelivery(pubkey: string, prizeId: string): Promise<boolean> {
      if (!pubkey || prizeId !== prize.id) return false;
      return ((await ownedQuantity()) ?? 0) >= 1;
    },

    /**
     * WRITES NOTHING.
     *
     * The prize was granted by the spend event. This is the verification the
     * redemption flow demands before it will call a redemption confirmed, and
     * it fails loudly rather than quietly when the prize is not there: an
     * absent prize after a "confirmed" spend means the spend event did not
     * actually land, and the redemption must stay recoverable instead of
     * closing over a purchase that never happened.
     */
    async grantPrize(pubkey: string, granted: ArcadePrize): Promise<void> {
      if (!pubkey) throw new Error('Cannot deliver a prize without an owner');
      if (granted.id !== prize.id) {
        throw new Error(`Not a ${prize.id} redemption: ${granted.id}`);
      }
      const quantity = await ownedQuantity();
      if (quantity === null) {
        throw new Error('Your inventory could not be read to confirm the prize.');
      }
      if (quantity < 1) {
        throw new Error('The prize is not in your inventory yet.');
      }
    },

    async listOwnedPrizes(pubkey: string): Promise<readonly OwnedPrizeRecord[]> {
      if (!pubkey) return [];
      const quantity = await ownedQuantity();
      if (!quantity || quantity < 1) return [];
      return [
        {
          prizeId: prize.id,
          count: quantity,
          // kind:31633 records quantities, not when they arrived. `0` says
          // "unknown" rather than inventing a plausible timestamp.
          firstGrantedAt: 0,
          deliveredRedemptionIds: [],
        },
      ];
    },
  };

  return { writer, ownership, itemAddress };
}
