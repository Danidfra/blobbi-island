/**
 * Reading and buying Arcade Tokens.
 *
 * The balance is the Token quantity in the canonical kind:31633 inventory —
 * the same query every other balance reads, so a confirmed write refreshes it
 * with no extra plumbing.
 *
 * The purchase is ONE canonical wallet operation: the Coin deduction and the
 * Token grant land in the SAME replacement event, so either the player pays
 * and receives, or nothing happens. It reuses the shop's machinery wholesale —
 * `spendCoins` with `grantLines`, a durable spend intent for retry identity,
 * and the wallet's fresh authoritative balance read — because a Token purchase
 * is a shop purchase in every respect that matters.
 */

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { closeSpendIntent, openSpendIntent } from '@/lib/coin-spend-intent';
import { mintCoinOpId } from '@/inventory/coin-wallet';
import { useCoinWallet } from '@/inventory/useCoinWallet';
import { getQuantity } from '@/inventory/useInventoryMutation';
import { inventoryQueryKey, useIslandInventory } from '@/inventory/useIslandInventory';

import { ARCADE_TOKEN_ADDRESS } from './arcade-token';
import { arcadeTokenCoinCost } from './token-store';

export interface ArcadeTokenBalanceView {
  /** Tokens held, or `null` while unknown. Never a fake zero. */
  balance: number | null;
  isLoading: boolean;
  isError: boolean;
}

/** The canonical Arcade Token balance for the signed-in player. */
export function useArcadeTokenBalance(): ArcadeTokenBalanceView {
  const inventory = useIslandInventory();
  return {
    balance: inventory.data ? getQuantity(inventory.data, ARCADE_TOKEN_ADDRESS) : null,
    isLoading: inventory.isLoading,
    isError: inventory.isError,
  };
}

export interface TokenPurchaseResult {
  quantity: number;
  totalCost: number;
  /**
   * `applied`   — Coins spent and Tokens granted, in one event.
   * `ambiguous` — the publish MAY have landed; the intent is kept so buying
   *               the same quantity again reconciles rather than charging.
   * `blocked`   — a previous attempt is still unresolved; nothing new charged.
   */
  outcome: 'applied' | 'ambiguous' | 'blocked';
}

/** Buy `quantity` Arcade Tokens with Blobbi Coins. */
export function useBuyArcadeTokens() {
  const { user } = useCurrentUser();
  const { spendCoins } = useCoinWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ quantity }: { quantity: number }): Promise<TokenPurchaseResult> => {
      if (!user?.pubkey) throw new Error('User not logged in');
      // The price is resolved here, from the one policy module — never taken
      // from the caller. Same boundary the shop enforces.
      const totalCost = arcadeTokenCoinCost(quantity);

      const grantLines = [{ address: ARCADE_TOKEN_ADDRESS, amount: quantity }];
      const opened = openSpendIntent(
        user.pubkey,
        { surface: 'shop-purchase', amount: totalCost, lines: grantLines },
        () => mintCoinOpId('arcade-token'),
      );
      if (!opened) {
        throw new Error(
          'This browser is blocking site data, so the purchase cannot be tracked safely. Nothing was charged.',
        );
      }

      const outcome = await spendCoins({
        opId: opened.intent.intentId,
        amount: totalCost,
        label: 'arcade-token',
        grantLines,
      });

      if (outcome.status === 'applied' || outcome.status === 'already-applied') {
        closeSpendIntent(user.pubkey, 'shop-purchase', opened.intent.intentId);
        return { quantity, totalCost, outcome: 'applied' };
      }
      if (outcome.status === 'blocked') return { quantity, totalCost, outcome: 'blocked' };
      if (outcome.status === 'ambiguous') return { quantity, totalCost, outcome: 'ambiguous' };
      throw new Error(`Unexpected wallet outcome: ${outcome.status}`);
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      queryClient.invalidateQueries({ queryKey: inventoryQueryKey(user.pubkey) });
    },
  });
}

/** Convenience: can this player afford `quantity` Tokens right now? */
export function useCanAffordTokens(coinBalance: number | null) {
  return useMemo(
    () => (quantity: number) =>
      coinBalance !== null && coinBalance >= arcadeTokenCoinCost(quantity),
    [coinBalance],
  );
}
