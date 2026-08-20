/**
 * React binding for Mine session settlement.
 *
 * Thin on purpose: the lifecycle lives in `src/mine/mine-settlement.ts` so it
 * can be tested without rendering anything. This hook only binds it to the
 * session (wallet + signer) and refreshes the caches a settlement touched.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { createCoinWallet } from '@/inventory/coin-wallet';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import { createEnergySettler } from '@/mine/energy-settlement';
import {
  createMineSettlement,
  type MineSettlement,
  type MineSettlementResult,
} from '@/mine/mine-settlement';
import { pruneMineSessions } from '@/mine/mine-session-ledger';

export interface MineSettlementApi {
  /** `null` when logged out — the Mine then runs as an unrewarded practice run. */
  readonly settlement: MineSettlement | null;
  /** Settle (or resume) a session and refresh the caches it moved. */
  settle(sessionId: string): Promise<MineSettlementResult>;
}

export function useMineSettlement(): MineSettlementApi {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const pubkey = user?.pubkey;

  const settlement = useMemo(() => {
    if (!user?.pubkey || !user.signer) return null;
    const wallet = createCoinWallet({ nostr, user });
    const settler = createEnergySettler({ nostr, user });
    return createMineSettlement({ pubkey: user.pubkey, wallet, settler });
  }, [nostr, user]);

  const refreshAfterSettlement = useCallback(() => {
    if (!pubkey) return;
    // The Coin balance and the Blobbi's energy both moved; let the resilient
    // readers re-establish them. A failed refetch keeps the known-good data.
    queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
    queryClient.invalidateQueries({ queryKey: ['pet-states', pubkey] });
    queryClient.invalidateQueries({ queryKey: ['blobbis', pubkey] });
  }, [pubkey, queryClient]);

  const settle = useCallback(
    async (sessionId: string): Promise<MineSettlementResult> => {
      if (!settlement) {
        return { phase: 'unresolved', coinReward: 0, coinApplied: false };
      }
      try {
        return await settlement.settleSession(sessionId);
      } finally {
        refreshAfterSettlement();
      }
    },
    [settlement, refreshAfterSettlement],
  );

  // Startup recovery: finish or reconcile anything a previous run left owing,
  // and abandon runs that never finalized. Runs once per signed-in session.
  const recoveredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!settlement || !pubkey) return;
    if (recoveredFor.current === pubkey) return;
    recoveredFor.current = pubkey;
    let cancelled = false;
    void (async () => {
      try {
        const results = await settlement.recoverSessions();
        if (!cancelled && results.length > 0) refreshAfterSettlement();
      } catch {
        // Recovery is best-effort; the records stay for the next attempt.
      } finally {
        pruneMineSessions(pubkey, Date.now());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settlement, pubkey, refreshAfterSettlement]);

  return { settlement, settle };
}
