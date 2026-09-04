/**
 * Blobbi Island: batch (multi-item) purchase flow.
 *
 * A single shop confirmation may include multiple DIFFERENT item types, each
 * with its own quantity. Since the Coin cutover the whole purchase is ONE
 * canonical wallet operation:
 *
 *   1. validate every line (positive integer quantity) and RESOLVE its price
 *      from the canonical catalog; see the pricing boundary below;
 *   2. normalize + merge duplicate addresses into a single line each;
 *   3. compute the TOTAL cost (overflow-protected);
 *   4. `spendCoins({ amount: total, grantLines })`: the wallet reads the
 *      FRESH inventory, validates the real balance (a stale HUD number is
 *      never spendable truth), and publishes EXACTLY ONE kind:31633 event
 *      carrying BOTH the coin deduction and every item grant.
 *
 * That single event is what retires the old, documented non-atomicity
 * ("items granted but coins not charged"): with the Coin in the same
 * inventory, either the purchase happens or nothing does. The wallet's
 * durable operation ledger makes a retried confirmation exactly-once, its
 * strict publish never treats a timeout as success, and an `ambiguous`
 * outcome is surfaced to the caller instead of being retried blindly.
 *
 * ## The pricing boundary
 *
 * A price is derived from the item's IDENTITY, here, and is never accepted
 * from the caller. The hook used to take a `unitPrice` per line and charge
 * whatever it was handed; the shop happened to pass canonical values, so
 * nothing was ever mispriced in production, but the money-taking hook was
 * trusting presentation-layer input. That is the wrong trust boundary twice
 * over, because since the spend-intent work the TOTAL is also part of the
 * durable purchase identity, a wrong price would move both the charge and
 * the opId that makes a retry idempotent.
 *
 * So the contract is now `{ address, quantity }` and nothing else:
 *
 * ```
 *   listed item     → canonical price from `priceForAddress`
 *   free listed item→ canonical 0: no coin movement, still one shared
 *                     inventory transaction
 *   anything else   → REJECTED before a spend intent, a ledger record, a
 *                     wallet call or an inventory grant. Unknown is not free.
 * ```
 *
 * Displayed prices remain the shop's own concern; it reads the same catalog,
 * so the number on screen matches, but a rendered total is presentation and
 * this module never treats it as spendable truth.
 *
 * kind:11125 is never touched.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { GameInventory } from './package';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { closeSpendIntent, openSpendIntent } from '@/lib/coin-spend-intent';

import { isAmbiguousInventoryPublish } from './inventory-transaction';
import { getQuantity, useInventoryMutation } from './useInventoryMutation';
import { useCoinWallet } from './useCoinWallet';
import { mintCoinOpId } from './coin-wallet';
import { priceForAddress, stackLimitForAddress } from './shop-catalog';
import { inventoryQueryKey } from './useIslandInventory';

/**
 * One requested purchase line in the cart.
 *
 * Deliberately carries NO price: what a unit costs is a fact about the item,
 * resolved here from the canonical catalog. See "The pricing boundary" above.
 */
export interface PurchaseLine {
  /** Canonical kind:31632 address of the item. */
  address: string;
  /** Units to buy (positive integer). */
  quantity: number;
}

export interface BatchPurchaseInput {
  lines: PurchaseLine[];
}

export interface BatchPurchaseResultLine {
  address: string;
  quantity: number;
  /** The CANONICAL unit price that was charged, for display and receipts. */
  unitPrice: number;
  lineCost: number;
}

export interface BatchPurchaseResult {
  /** Merged/normalized lines actually applied. */
  lines: BatchPurchaseResultLine[];
  totalCost: number;
  /**
   * `applied`: the purchase definitively completed (grant + charge in one
   *               event), now or on a previous attempt of the same cart.
   * `stock-limit`: a line would have pushed a holding past the item's published
   *               `max_stack`, judged against the FRESH authoritative inventory
   *               inside the wallet's lock. Nothing was charged and nothing was
   *               granted. This is what makes a unique wearable un-rebuyable
   *               even if the button that started it was stale.
   * `ambiguous`: the publish MAY have landed; the spend intent is kept, so
   *               confirming the SAME cart again reconciles the original
   *               operation instead of debiting independently. The UI must
   *               not claim success.
   * `blocked`: a previous attempt of this cart is still unresolved and
   *               could not yet be proven either way; nothing new was charged.
   */
  outcome: 'applied' | 'ambiguous' | 'blocked' | 'stock-limit';
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Validate every line, price it from the canonical catalog, and merge
 * duplicate addresses into a single line each with their quantities summed.
 *
 * Rejects an empty cart, a missing address, an item that is not for sale, and
 * zero/negative/non-integer/overflowing quantities. Every rejection happens
 * BEFORE the caller opens a spend intent or touches the wallet, so an invalid
 * cart leaves no durable trace at all.
 *
 * Because the price comes from the address rather than the line, two lines for
 * the same item can no longer disagree about what it costs, the merge just
 * adds quantities and re-multiplies by the one canonical price.
 */
export function normalizePurchaseLines(
  lines: PurchaseLine[],
): BatchPurchaseResultLine[] {
  if (lines.length === 0) {
    throw new Error('Cannot purchase an empty cart');
  }

  const merged = new Map<string, BatchPurchaseResultLine>();

  for (const line of lines) {
    if (!line.address) {
      throw new Error('Purchase line is missing an item address');
    }
    if (!Number.isInteger(line.quantity)) {
      throw new Error(
        `Purchase quantity must be an integer (got ${line.quantity})`,
      );
    }
    if (line.quantity < 1) {
      throw new Error(
        `Purchase quantity must be a positive integer (got ${line.quantity})`,
      );
    }
    if (line.quantity > MAX_SAFE) {
      throw new Error('Purchase quantity is too large');
    }

    // THE PRICING BOUNDARY. `priceForAddress` answers `null` for anything the
    // catalog does not list, an unknown item, a malformed address, or an
    // official item that is simply not for sale (the Arcade Ticket). Unknown
    // is NOT free: this is a commerce contract, not a generic grant API.
    const unitPrice = priceForAddress(line.address);
    if (unitPrice === null) {
      throw new Error(`Item is not for sale: ${line.address}`);
    }

    const existing = merged.get(line.address);
    if (existing) {
      const sum = existing.quantity + line.quantity;
      if (sum > MAX_SAFE) {
        throw new Error('Merged purchase quantity overflows');
      }
      existing.quantity = sum;
      existing.lineCost = existing.quantity * existing.unitPrice;
    } else {
      merged.set(line.address, {
        address: line.address,
        quantity: line.quantity,
        unitPrice,
        lineCost: line.quantity * unitPrice,
      });
    }
  }

  return [...merged.values()];
}

/** Sum line costs with overflow protection. */
export function totalCostForLines(lines: BatchPurchaseResultLine[]): number {
  let total = 0;
  for (const line of lines) {
    const lineCost = line.quantity * line.unitPrice;
    if (lineCost > MAX_SAFE) {
      throw new Error('Purchase line cost overflows');
    }
    total += lineCost;
    if (total > MAX_SAFE) {
      throw new Error('Total purchase cost overflows');
    }
  }
  return total;
}

/** Compile-time proof that every wallet outcome is accounted for. */
function assertNoUnhandledOutcome(outcome: never): never {
  throw new Error(
    `Unexpected wallet outcome: ${(outcome as { status?: string }).status}`,
  );
}

/**
 * The stack-ceiling guard, as a wallet PRECONDITION rather than a UI check.
 *
 * A shop can render "Owned" from a cached inventory and still be wrong: the
 * cache can lag, two tabs can race, and a stale button can be clicked. So the
 * question "would this push me past `max_stack`?" is asked where it can be
 * answered truthfully: inside the wallet's lock, against the exact base the
 * replacement event would be built from. A false answer publishes nothing,
 * records nothing and charges nothing.
 *
 * Returns `undefined` when no line has a ceiling, so an ordinary consumable
 * cart carries no precondition at all and its behaviour is unchanged.
 */
function stackPrecondition(
  lines: readonly BatchPurchaseResultLine[],
): ((inventory: GameInventory) => boolean) | undefined {
  const limited = lines.flatMap((line) => {
    const limit = stackLimitForAddress(line.address);
    return limit === null ? [] : [{ address: line.address, limit, want: line.quantity }];
  });
  if (limited.length === 0) return undefined;
  return (inventory) =>
    limited.every(
      ({ address, limit, want }) => getQuantity(inventory, address) + want <= limit,
    );
}

/**
 * Buy multiple item types in one confirmation as ONE canonical inventory
 * event (coins spent + items granted together).
 */
export function useBatchPurchase() {
  const { user } = useCurrentUser();
  const { mutateAsync: mutateInventory } = useInventoryMutation();
  const { spendCoins } = useCoinWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lines }: BatchPurchaseInput): Promise<BatchPurchaseResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');

      const normalized = normalizePurchaseLines(lines);
      const totalCost = totalCostForLines(normalized);
      const resultLines: BatchPurchaseResultLine[] = normalized.map((l) => ({
        ...l,
        lineCost: l.quantity * l.unitPrice,
      }));
      const grantLines = normalized.map((l) => ({
        address: l.address,
        amount: l.quantity,
      }));

      // A zero-cost cart (every line CANONICALLY free) has no coin movement,
      // so it goes through the ordinary inventory mutation, the same shared
      // transaction, so the F-03 guarantees hold, instead of a wallet no-op.
      // An ambiguous publish is surfaced as `ambiguous`, never as success or
      // a definite failure.
      //
      // Unreachable through the shipped catalog: `validateCoinPrices` requires
      // every listed price to be a POSITIVE integer, so nothing is free today.
      // The branch stays because it is the correct behaviour if that rule ever
      // relaxes: and note it can only ever be reached by a canonical zero,
      // never by an unpriced item, which is rejected during normalization.
      if (totalCost === 0) {
        try {
          await mutateInventory({ type: 'batch', lines: grantLines });
        } catch (error) {
          if (isAmbiguousInventoryPublish(error)) {
            return { lines: resultLines, totalCost, outcome: 'ambiguous' };
          }
          throw error;
        }
        return { lines: resultLines, totalCost, outcome: 'applied' };
      }

      // The durable identity of THIS logical purchase: confirming the same
      // cart again reuses the same intent (and so the same wallet opId), so a
      // retry after an ambiguous outcome reconciles the original operation
      // instead of debiting independently.
      const opened = openSpendIntent(
        user.pubkey,
        { surface: 'shop-purchase', amount: totalCost, lines: grantLines },
        () => mintCoinOpId('shop-purchase'),
      );
      if (!opened) {
        throw new Error(
          'This browser is blocking site data, so the purchase cannot be tracked safely. Nothing was charged.',
        );
      }

      // The wallet performs the fresh balance read and rejects insufficient
      // funds; the caller's rendered balance is presentation, never truth.
      // A reused opId is reconciled in-lock: `already-applied` means the
      // EARLIER attempt landed, and nothing was charged again.
      const outcome = await spendCoins({
        opId: opened.intent.intentId,
        amount: totalCost,
        label: 'shop-purchase',
        grantLines,
        precondition: stackPrecondition(normalized),
      });

      if (outcome.status === 'applied' || outcome.status === 'already-applied') {
        // Definitively complete and delivered: close the intent so a future
        // purchase of the same cart is a genuinely new operation.
        closeSpendIntent(user.pubkey, 'shop-purchase', opened.intent.intentId);
        return { lines: resultLines, totalCost, outcome: 'applied' };
      }
      if (outcome.status === 'blocked') {
        return { lines: resultLines, totalCost, outcome: 'blocked' };
      }
      if (outcome.status === 'ambiguous') {
        return { lines: resultLines, totalCost, outcome: 'ambiguous' };
      }
      if (outcome.status === 'skipped') {
        // The stack precondition refused on the fresh in-lock base: nothing was
        // published and nothing recorded. The intent is closed because this
        // cart is finished, retrying it would only be refused again.
        closeSpendIntent(user.pubkey, 'shop-purchase', opened.intent.intentId);
        return { lines: resultLines, totalCost, outcome: 'stock-limit' };
      }
      // Exhaustive: every `CoinMutationOutcome` is handled above. A new
      // variant added to the wallet fails the typecheck here rather than
      // silently falling through to a wrong purchase state.
      return assertNoUnhandledOutcome(outcome);
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
    },
  });
}
