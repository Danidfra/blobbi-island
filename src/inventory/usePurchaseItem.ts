/**
 * Blobbi Island — purchase flow (Phase 7).
 *
 * A purchase is TWO independent replaceable-event writes:
 *   1. grant N units of the item to kind:31633 (inventory);
 *   2. deduct coins in kind:11125 (profile).
 *
 * These are separate events on different kinds, so the operation is NOT atomic.
 * We document and choose the ordering deliberately:
 *
 *   Chosen order: GRANT ITEM FIRST, then deduct coins.
 *
 *   Rationale: Blobbi Island has very limited usage and user trust matters more
 *   than a negligible economy leak. If the second write (coin deduction) fails,
 *   the less-harmful outcome is that the player keeps BOTH the item and the
 *   coins (a small favor-the-user leak) rather than losing coins and receiving
 *   nothing. The alternative (coins first) risks charging a player who then
 *   never receives the item — the worse failure for trust. We surface a clear
 *   warning on partial failure so the player and logs know coins were not
 *   charged.
 *
 * There is no relay rollback after a successful publish; a failed coin
 * deduction leaves the granted item in place and reports partial success.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { useInventoryMutation } from './useInventoryMutation';
import { useCoinsMutation } from './useCoinsMutation';
import { priceForAddress } from './shop-catalog';
import { inventoryQueryKey } from './useIslandInventory';

export interface PurchaseInput {
  /** Canonical kind:31632 address of the item to buy. */
  address: string;
  /** Number of units. */
  units: number;
}

export interface PurchaseResult {
  address: string;
  units: number;
  totalCost: number;
  /** True when both writes succeeded. */
  coinsCharged: boolean;
  /** Present when coin deduction failed after the item was granted. */
  warning?: string;
}

/**
 * Buy `units` of an item.
 *
 * 1. validate the price and that the player can afford it (against current
 *    coins passed in by the caller);
 * 2. grant the item to kind:31633;
 * 3. deduct coins in kind:11125;
 * 4. report partial failure explicitly.
 */
export function usePurchaseItem() {
  const { user } = useCurrentUser();
  const { mutateAsync: mutateInventory } = useInventoryMutation();
  const { mutateAsync: mutateCoins } = useCoinsMutation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      address,
      units,
      currentCoins,
    }: PurchaseInput & { currentCoins: number }): Promise<PurchaseResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');
      if (!Number.isInteger(units) || units < 1) {
        throw new Error('Purchase units must be a positive integer');
      }
      const price = priceForAddress(address);
      if (price == null) {
        throw new Error(`Item is not for sale: ${address}`);
      }
      const totalCost = price * units;

      // Validate affordability up-front (best-effort; coins mutation also guards
      // against a negative balance using a fresh profile read).
      if (currentCoins < totalCost) {
        throw new Error('Insufficient coins');
      }

      // 1. Grant item first (favor-the-user ordering — see file header).
      await mutateInventory({ type: 'purchase', address, units });

      // 2. Deduct coins. If this fails, the item is already granted; report a
      //    partial-success warning rather than throwing away the grant.
      try {
        await mutateCoins(-totalCost);
      } catch (err) {
        return {
          address,
          units,
          totalCost,
          coinsCharged: false,
          warning:
            err instanceof Error
              ? `Item granted but coins were not charged: ${err.message}`
              : 'Item granted but coins were not charged.',
        };
      }

      return { address, units, totalCost, coinsCharged: true };
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
    },
  });
}
