/**
 * Blobbi Island — batch (multi-item) purchase flow.
 *
 * A single shop confirmation may include multiple DIFFERENT item types, each
 * with its own quantity. This hook performs ONE true multi-item purchase:
 *
 *   1. validate every line (positive integer quantity, integer unit price);
 *   2. normalize + merge duplicate addresses into a single line each;
 *   3. validate the TOTAL cost against the coin balance passed by the caller
 *      (with overflow protection);
 *   4. read the current kind:31633 inventory ONCE (inside the inventory
 *      mutation's read-modify-write) and apply ALL additions to that single
 *      snapshot via the package quantity helpers;
 *   5. publish EXACTLY ONE kind:31633 event with the complete resulting
 *      inventory (via the `batch` inventory mutation);
 *   6. publish EXACTLY ONE kind:11125 event deducting the TOTAL coin cost.
 *
 * This is NOT implemented by looping the single-item purchase mutation: it
 * folds every line into one inventory snapshot and charges coins once.
 *
 * Ordering + atomicity (SAME decision as the single-item flow — see
 * usePurchaseItem.ts): GRANT ALL ITEMS FIRST (one 31633), then deduct the total
 * (one 11125). The operation is explicitly NON-ATOMIC across the two kinds:
 *
 *   - inventory publish fails  → no items granted, no coins charged (we throw
 *     before touching coins);
 *   - inventory succeeds but coin publish fails → ALL cart items remain granted,
 *     coins are NOT confirmed charged, and a partial-completion warning is
 *     returned for the whole cart (favor-the-user; no relay rollback).
 *
 * Never writes kind:11125.storage (coins go through `useCoinsMutation`, which
 * routes via `mergeOwnerProfileTags` and drops legacy consumable storage).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  useInventoryMutation,
  type InventoryBatchLine,
} from './useInventoryMutation';
import { useCoinsMutation } from './useCoinsMutation';
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
  /** Latest known coin balance to validate the total against. */
  currentCoins: number;
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
  /** True when BOTH the inventory grant and the coin deduction succeeded. */
  coinsCharged: boolean;
  /** Present when the coin deduction failed after items were granted. */
  warning?: string;
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
 * Buy multiple item types in one confirmation as a single 31633 + single 11125.
 */
export function useBatchPurchase() {
  const { user } = useCurrentUser();
  const { mutateAsync: mutateInventory } = useInventoryMutation();
  const { mutateAsync: mutateCoins } = useCoinsMutation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lines,
      currentCoins,
    }: BatchPurchaseInput): Promise<BatchPurchaseResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');

      // 1 + 2. Validate + merge duplicates into one line per address.
      const normalized = normalizePurchaseLines(lines);

      // 3. Validate the TOTAL cost against the balance (overflow-protected).
      const totalCost = totalCostForLines(normalized);
      if (currentCoins < totalCost) {
        throw new Error('Insufficient coins');
      }

      const resultLines: BatchPurchaseResultLine[] = normalized.map((l) => ({
        ...l,
        lineCost: l.quantity * l.unitPrice,
      }));

      // 4 + 5. ONE fresh read + apply all additions to that single snapshot,
      //        then publish EXACTLY ONE kind:31633 event. The `batch` inventory
      //        mutation folds every line through the package add helper and
      //        drives a single optimistic cache update + rollback.
      const batchLines: InventoryBatchLine[] = normalized.map((l) => ({
        address: l.address,
        amount: l.quantity,
      }));
      await mutateInventory({ type: 'batch', lines: batchLines });

      // 6. Deduct the TOTAL cost with EXACTLY ONE kind:11125 event. If this
      //    fails, all items are already granted; return a whole-cart warning
      //    rather than throwing away the grant.
      try {
        await mutateCoins(-totalCost);
      } catch (err) {
        return {
          lines: resultLines,
          totalCost,
          coinsCharged: false,
          warning:
            err instanceof Error
              ? `Items granted but coins were not charged: ${err.message}`
              : 'Items granted but coins were not charged.',
        };
      }

      return { lines: resultLines, totalCost, coinsCharged: true };
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      // Reconcile BOTH canonical caches after settlement.
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
      queryClient.invalidateQueries({
        queryKey: ['blobbonaut-profile', user.pubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['owner-profile', user.pubkey],
      });
    },
  });
}
