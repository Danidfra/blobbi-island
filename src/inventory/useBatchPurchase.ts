/**
 * Blobbi Island — batch (multi-item) purchase flow.
 *
 * A single shop confirmation may include multiple DIFFERENT item types, each
 * with its own quantity. Since the Coin cutover the whole purchase is ONE
 * canonical wallet operation:
 *
 *   1. validate every line (positive integer quantity, integer unit price);
 *   2. normalize + merge duplicate addresses into a single line each;
 *   3. compute the TOTAL cost (overflow-protected);
 *   4. `spendCoins({ amount: total, grantLines })` — the wallet reads the
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
 * kind:11125 is never touched.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { closeSpendIntent, openSpendIntent } from '@/lib/coin-spend-intent';

import { isAmbiguousInventoryPublish } from './inventory-transaction';
import { useInventoryMutation } from './useInventoryMutation';
import { useCoinWallet } from './useCoinWallet';
import { mintCoinOpId } from './coin-wallet';
import { inventoryQueryKey } from './useIslandInventory';

/** One requested purchase line in the cart. */
export interface PurchaseLine {
  /** Canonical kind:31632 address of the item. */
  address: string;
  /** Units to buy (positive integer). */
  quantity: number;
  /** Price per unit in coins (non-negative integer). */
  unitPrice: number;
}

export interface BatchPurchaseInput {
  lines: PurchaseLine[];
}

export interface BatchPurchaseResultLine {
  address: string;
  quantity: number;
  unitPrice: number;
  lineCost: number;
}

export interface BatchPurchaseResult {
  /** Merged/normalized lines actually applied. */
  lines: BatchPurchaseResultLine[];
  totalCost: number;
  /**
   * `applied`   — the purchase definitively completed (grant + charge in one
   *               event), now or on a previous attempt of the same cart.
   * `ambiguous` — the publish MAY have landed; the spend intent is kept, so
   *               confirming the SAME cart again reconciles the original
   *               operation instead of debiting independently. The UI must
   *               not claim success.
   * `blocked`   — a previous attempt of this cart is still unresolved and
   *               could not yet be proven either way; nothing new was charged.
   */
  outcome: 'applied' | 'ambiguous' | 'blocked';
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Validate + merge duplicate addresses into a single line each, summing
 * quantities. Rejects zero/negative/non-integer/overflowing quantities and
 * non-integer/negative unit prices.
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
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
      throw new Error(
        `Unit price must be a non-negative integer (got ${line.unitPrice})`,
      );
    }

    const existing = merged.get(line.address);
    if (existing) {
      const sum = existing.quantity + line.quantity;
      if (sum > MAX_SAFE) {
        throw new Error('Merged purchase quantity overflows');
      }
      existing.quantity = sum;
      // Keep the last-seen unit price for the address (they should match; the
      // shop supplies a single canonical price per address).
      existing.unitPrice = line.unitPrice;
      existing.lineCost = existing.quantity * existing.unitPrice;
    } else {
      merged.set(line.address, {
        address: line.address,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineCost: line.quantity * line.unitPrice,
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

      // A zero-cost cart (free items) has no coin movement, so it goes
      // through the ordinary inventory mutation (the same shared transaction)
      // instead of a wallet no-op. An ambiguous publish is surfaced as
      // `ambiguous`, never as success or a definite failure.
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
      // 'skipped' cannot happen (no precondition is passed) — surface loudly
      // rather than misreporting it as a purchase state.
      throw new Error(`Unexpected wallet outcome: ${outcome.status}`);
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
    },
  });
}
