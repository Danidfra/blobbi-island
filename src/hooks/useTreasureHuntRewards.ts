/**
 * useTreasureHuntRewards — the Beach reward service the Treasure Hunt modal
 * consumes.
 *
 * One object bundles everything reward-shaped so the modal's view layer can
 * also be driven by a MOCK service (the dev harness and the component tests
 * pass one in): window status, slot reservation, participation tracking, the
 * provisional authorization call, abandonment, and startup recovery.
 *
 * Logged out (or in an environment without a session) the service reports
 * `windowStatus: null` and every hunt is a practice hunt — rewards simply
 * never engage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { createCoinWallet, mintCoinOpId } from '@/inventory/coin-wallet';
import { inventoryQueryKey } from '@/inventory/useIslandInventory';
import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';
import {
  abandonBeachReward,
  beachRewardedCount,
  effectiveBeachWindowKey,
  readBeachRewardOp,
  reserveBeachReward,
  resolveBeachReward,
  unresolvedBeachRewardOps,
  updateBeachRewardParticipation,
  type BeachRewardOp,
} from '@/lib/beach-reward-ledger';
import type { TreasureHuntResult } from '@/beach/treasure-hunt';
import {
  BEACH_REWARD_POLICY,
  beachRewardWindowKey,
  beachRewardWindowResetAt,
  type BeachRewardPolicy,
} from '@/beach/rewards/policy';
import {
  createProvisionalTreasureHuntAuthorizer,
  type AuthorizeOutcome,
} from '@/beach/rewards/provisional-authorization';

export interface BeachWindowStatus {
  readonly limit: number;
  readonly remaining: number;
  readonly windowKey: string;
  /** Epoch ms of the next reset, for display. */
  readonly resetsAt: number;
}

export type ReserveHuntOutcome =
  | { readonly ok: true; readonly opId: string }
  | { readonly ok: false; readonly reason: 'limit-reached' | 'unavailable' };

/** The surface the modal consumes. Mockable as plain data + functions. */
export interface TreasureHuntRewardsService {
  /** `null` when rewards are unavailable (logged out): practice only. */
  readonly windowStatus: BeachWindowStatus | null;
  readonly policy: BeachRewardPolicy;
  /** Reserve one rewarded slot at hunt START. */
  reserveRewardedHunt(roundKey: string): Promise<ReserveHuntOutcome>;
  /** Refresh-safe participation tracking while the round runs. */
  reportParticipation(opId: string, participation: { digs: number; activeSeconds: number }): void;
  /** Authorize + grant for a finalized result (provisional, client-trusted). */
  authorizeReward(result: TreasureHuntResult, opId: string): Promise<AuthorizeOutcome>;
  /** Abandon a reserved hunt (Leave/close/unmount mid-round). */
  abandonHunt(opId: string, participation: { digs: number; activeSeconds: number }): void;
  /** Unresolved operations found on entry (finalized/ambiguous/stale-reserved). */
  readonly pendingOps: readonly BeachRewardOp[];
  /** Re-scan the ledger (after recovery actions). */
  refreshPending(): void;
  /**
   * Resume/reconcile one unresolved operation:
   * - `finalized` (amount fixed, grant never confirmed) → run the wallet
   *   grant under the SAME opId (the wallet's ledger keeps it exactly-once);
   * - `ambiguous` → read-only reconciliation; never a blind re-publish.
   */
  recoverPendingReward(opId: string): Promise<'applied' | 'ambiguous' | 'failed'>;
}

/** A reserved hunt older than this with no live round is stale (recovery). */
const STALE_RESERVATION_MS = 10 * 60 * 1000;

export function useTreasureHuntRewards(): TreasureHuntRewardsService {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(0);

  const pubkey = user?.pubkey;
  const wallet = useMemo(
    () => (user?.pubkey ? createCoinWallet({ nostr, user }) : null),
    [nostr, user],
  );
  const authorizer = useMemo(
    () =>
      pubkey && wallet
        ? createProvisionalTreasureHuntAuthorizer({
            pubkey,
            wallet,
            policy: BEACH_REWARD_POLICY,
          })
        : null,
    [pubkey, wallet],
  );

  const refreshPending = useCallback(() => setVersion((n) => n + 1), []);

  // Startup recovery, part 1: stale `reserved` ops (a refresh killed the
  // round). Apply the documented abandonment rule using the participation
  // the ledger tracked while the round ran.
  useEffect(() => {
    if (!pubkey) return;
    const now = Date.now();
    for (const op of unresolvedBeachRewardOps(pubkey)) {
      if (op.status !== 'reserved') continue;
      if (now - op.createdAt < STALE_RESERVATION_MS) continue;
      const crossed =
        op.digs >= BEACH_REWARD_POLICY.minDigs &&
        op.activeSeconds >= BEACH_REWARD_POLICY.minActiveSeconds;
      abandonBeachReward(pubkey, op.opId, crossed, now);
    }
    refreshPending();
  }, [pubkey, refreshPending]);

  const windowStatus = useMemo<BeachWindowStatus | null>(() => {
    if (!pubkey) return null;
    void version; // ledger mutations re-derive the window through this dep
    const nowMs = Date.now();
    const windowKey = effectiveBeachWindowKey(pubkey, beachRewardWindowKey(nowMs));
    const used = beachRewardedCount(pubkey, windowKey);
    return {
      limit: BEACH_REWARD_POLICY.rewardedHuntsPerWindow,
      remaining: Math.max(0, BEACH_REWARD_POLICY.rewardedHuntsPerWindow - used),
      windowKey,
      resetsAt: beachRewardWindowResetAt(nowMs),
    };
  }, [pubkey, version]);

  const pendingOps = useMemo<readonly BeachRewardOp[]>(() => {
    if (!pubkey) return [];
    void version;
    return unresolvedBeachRewardOps(pubkey).filter((op) => op.status !== 'reserved');
  }, [pubkey, version]);

  const reserveRewardedHunt = useCallback(
    async (roundKey: string): Promise<ReserveHuntOutcome> => {
      if (!pubkey) return { ok: false, reason: 'unavailable' };
      const nowMs = Date.now();
      const windowKey = effectiveBeachWindowKey(pubkey, beachRewardWindowKey(nowMs));
      // The queued cross-tab lock makes count+insert atomic across tabs.
      const { value } = await withQueuedCrossTabLock(
        `blobbi-beach-reserve:${pubkey}`,
        async () =>
          reserveBeachReward({
            pubkey,
            opId: mintCoinOpId('beach-reward'),
            roundKey,
            windowKey,
            limit: BEACH_REWARD_POLICY.rewardedHuntsPerWindow,
            now: nowMs,
          }),
      );
      refreshPending();
      if (!value.ok) {
        return {
          ok: false,
          reason: value.reason === 'limit-reached' ? 'limit-reached' : 'unavailable',
        };
      }
      return { ok: true, opId: value.op.opId };
    },
    [pubkey, refreshPending],
  );

  const reportParticipation = useCallback(
    (opId: string, participation: { digs: number; activeSeconds: number }) => {
      if (!pubkey) return;
      updateBeachRewardParticipation(pubkey, opId, participation, Date.now());
    },
    [pubkey],
  );

  const authorizeReward = useCallback(
    async (result: TreasureHuntResult, opId: string): Promise<AuthorizeOutcome> => {
      if (!pubkey || !authorizer) return { status: 'no-reservation' };
      try {
        return await authorizer.authorize(result, opId);
      } finally {
        refreshPending();
        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
      }
    },
    [pubkey, authorizer, refreshPending, queryClient],
  );

  const recoverPendingReward = useCallback(
    async (opId: string): Promise<'applied' | 'ambiguous' | 'failed'> => {
      if (!pubkey || !wallet) return 'failed';
      const op = readBeachRewardOp(pubkey, opId);
      try {
        if (!op) return 'failed';
        if (op.status === 'applied') return 'applied';
        if (op.status === 'ambiguous') {
          const record = await wallet.reconcileOp(opId);
          if (record?.status === 'applied') {
            resolveBeachReward(pubkey, opId, 'applied', Date.now());
            return 'applied';
          }
          return 'ambiguous';
        }
        if (op.status === 'finalized' && op.amount !== null && op.amount > 0) {
          const outcome = await wallet.grantCoins({
            opId,
            amount: op.amount,
            label: 'beach-reward',
          });
          if (outcome.status === 'applied' || outcome.status === 'already-applied') {
            resolveBeachReward(pubkey, opId, 'applied', Date.now());
            return 'applied';
          }
          resolveBeachReward(pubkey, opId, 'ambiguous', Date.now());
          return 'ambiguous';
        }
        return 'failed';
      } finally {
        refreshPending();
        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
      }
    },
    [pubkey, wallet, refreshPending, queryClient],
  );

  const abandonHunt = useCallback(
    (opId: string, participation: { digs: number; activeSeconds: number }) => {
      if (!pubkey) return;
      const op = readBeachRewardOp(pubkey, opId);
      if (!op) return;
      const crossed =
        participation.digs >= BEACH_REWARD_POLICY.minDigs &&
        participation.activeSeconds >= BEACH_REWARD_POLICY.minActiveSeconds;
      abandonBeachReward(pubkey, opId, crossed, Date.now());
      refreshPending();
    },
    [pubkey, refreshPending],
  );

  return useMemo(
    () => ({
      windowStatus,
      policy: BEACH_REWARD_POLICY,
      reserveRewardedHunt,
      reportParticipation,
      authorizeReward,
      abandonHunt,
      pendingOps,
      refreshPending,
      recoverPendingReward,
    }),
    [
      windowStatus,
      reserveRewardedHunt,
      reportParticipation,
      authorizeReward,
      abandonHunt,
      pendingOps,
      refreshPending,
      recoverPendingReward,
    ],
  );
}
