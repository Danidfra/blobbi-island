/**
 * React bindings for the canonical Coin wallet.
 *
 * - {@link useCoinBalance}, the ONE production balance reader. Derives the
 *   Blobbi Coin quantity from the canonical kind:31633 inventory query, so
 *   the HUD, the shops and the pass all render the same number from the same
 *   cache. `balance` is `null` while unknown, an unavailable balance must
 *   never look like a real zero.
 * - {@link useCoinWallet}, the wallet factory bound to the session, with
 *   cache invalidation after any outcome that may have changed the relay
 *   state. Optimistic presentation is the CALLER's concern; the wallet's
 *   returned outcome is the truth to render.
 *
 * kind:11125 `coins` is not read anywhere here, after the bootstrap, the
 * inventory quantity is the only canonical balance.
 */

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import { BLOBBI_COIN_ADDRESS } from './coin';
import {
  createCoinWallet,
  type CoinMutationOutcome,
  type CoinOperation,
  type CoinWallet,
} from './coin-wallet';
import { getQuantity } from './useInventoryMutation';
import { inventoryQueryKey, useIslandInventory } from './useIslandInventory';

export interface CoinBalanceView {
  /** Coins held, or `null` while loading/unavailable. Never a fake zero. */
  balance: number | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** The canonical Coin balance for the signed-in player. */
export function useCoinBalance(): CoinBalanceView {
  const inventory = useIslandInventory();
  return {
    balance: inventory.data ? getQuantity(inventory.data, BLOBBI_COIN_ADDRESS) : null,
    isLoading: inventory.isLoading,
    isError: inventory.isError,
    refetch: () => void inventory.refetch(),
  };
}

export interface CoinWalletApi {
  /** Wallet bound to the current session, or `null` when logged out. */
  wallet: CoinWallet | null;
  /** Grant with cache reconciliation. See {@link CoinWallet.grantCoins}. */
  grantCoins: (op: CoinOperation) => Promise<CoinMutationOutcome>;
  /** Spend with cache reconciliation. See {@link CoinWallet.spendCoins}. */
  spendCoins: (op: CoinOperation) => Promise<CoinMutationOutcome>;
}

export function useCoinWallet(): CoinWalletApi {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMemo(() => {
    if (!user?.pubkey) {
      const refuse = async (): Promise<CoinMutationOutcome> => {
        throw new Error('User not logged in');
      };
      return { wallet: null, grantCoins: refuse, spendCoins: refuse };
    }
    const wallet = createCoinWallet({ nostr, user });
    const withInvalidation =
      (run: (op: CoinOperation) => Promise<CoinMutationOutcome>) =>
      async (op: CoinOperation): Promise<CoinMutationOutcome> => {
        try {
          return await run(op);
        } finally {
          // Whatever happened: applied, ambiguous, or a pre-publish throw,
          // the cache re-reads the authoritative state rather than guessing.
          queryClient.invalidateQueries({ queryKey: inventoryQueryKey(user.pubkey) });
        }
      };
    return {
      wallet,
      grantCoins: withInvalidation((op) => wallet.grantCoins(op)),
      spendCoins: withInvalidation((op) => wallet.spendCoins(op)),
    };
  }, [nostr, user, queryClient]);
}
