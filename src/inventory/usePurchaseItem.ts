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
 *   Since the Coin cutover the whole purchase is ONE canonical wallet
 *   operation: the coin deduction and the item grant land in the SAME
 *   kind:31633 replacement event, so the old partial-failure mode ("item
 *   granted but coins not charged") no longer exists.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { useInventoryMutation } from './useInventoryMutation';
import { useCoinWallet } from './useCoinWallet';
import { mintCoinOpId } from './coin-wallet';
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
  /**
   * `applied` — the single purchase event published (grant + charge
   * together). `ambiguous` — the publish MAY have landed; recorded durably
   * and reconciled later, never blindly retried.
   */
  outcome: 'applied' | 'ambiguous';
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
  const { spendCoins } = useCoinWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      address,
      units,
    }: PurchaseInput): Promise<PurchaseResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');
      if (!Number.isInteger(units) || units < 1) {
        throw new Error('Purchase units must be a positive integer');
      }
      const price = priceForAddress(address);
      if (price == null) {
        throw new Error(`Item is not for sale: ${address}`);
      }
      const totalCost = price * units;

      // Free items have no coin movement: plain inventory grant.
      if (totalCost === 0) {
        await mutateInventory({ type: 'purchase', address, units });
        return { address, units, totalCost, outcome: 'applied' };
      }

      // ONE canonical wallet operation: the coin deduction and the item grant
      // in the same replacement event. The wallet performs the fresh balance
      // read and rejects insufficient funds — a rendered HUD number is never
      // spendable truth.
      const outcome = await spendCoins({
        opId: mintCoinOpId('shop-purchase'),
        amount: totalCost,
        label: 'shop-purchase',
        grantLines: [{ address, amount: units }],
      });
      if (outcome.status === 'applied' || outcome.status === 'already-applied') {
        return { address, units, totalCost, outcome: 'applied' };
      }
      return { address, units, totalCost, outcome: 'ambiguous' };
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
    },
  });
}
