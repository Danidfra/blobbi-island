/**
 * Blobbi Island — single-item purchase flow.
 *
 * A paid purchase is ONE canonical wallet operation: the Coin deduction and
 * the item grant land in the SAME kind:31633 replacement event
 * (`spendCoins` + `grantLines`), so the purchase is atomic — either the
 * charge and the items both happen or nothing does. The historical two-event
 * model (item to kind:31633, coins to kind:11125) and its favor-the-user
 * partial-grant leak no longer exist; kind:11125 is never touched.
 *
 * Outcomes: `applied` (published, exactly once per operation id) or
 * `ambiguous` (the publish MAY have landed — recorded durably by the wallet
 * ledger, reconciled read-only, never blindly retried). Insufficient funds
 * reject before anything is published; free items skip the wallet (no coin
 * movement, no op ledger) but still write through the shared inventory
 * transaction, and an unconfirmed publish reports `ambiguous` exactly like
 * the paid path.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { isAmbiguousInventoryPublish } from './inventory-transaction';
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
 * 1. validate the units and resolve the catalog price;
 * 2. free items: plain inventory grant, no coin movement;
 * 3. paid items: one atomic wallet spend carrying the item grant lines —
 *    affordability is enforced by the wallet against a fresh canonical
 *    balance read, never against a rendered number.
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

      // Free items have no coin movement: a plain inventory grant through the
      // shared transaction. An ambiguous publish (timeout — it MAY have
      // landed) is surfaced as `ambiguous`, never as success or as a definite
      // failure; the settled-state invalidation reconciles from the relay.
      if (totalCost === 0) {
        try {
          await mutateInventory({ type: 'purchase', address, units });
        } catch (error) {
          if (isAmbiguousInventoryPublish(error)) {
            return { address, units, totalCost, outcome: 'ambiguous' };
          }
          throw error;
        }
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
