/**
 * Startup reconciliation of unresolved Coin operations.
 *
 * The wallet records every value-bearing mutation durably and classifies a
 * publish timeout as AMBIGUOUS — but before this hook, nothing in production
 * ever swept those records again: an ambiguous shop or pass spend whose user
 * never retried stayed unresolved forever. This is the bounded production
 * consumer of {@link unresolvedCoinOps}.
 *
 * What a sweep does — and pointedly does not do:
 *
 * - runs ONCE per signed-in pubkey per app session, off the render path;
 * - reconciles each unresolved (`publishing`/`ambiguous`) operation through
 *   the wallet's READ-ONLY `reconcileOp`: authoritative reads, event-id or
 *   balance-delta proof, never a publish, never a blind retry;
 * - a relay failure leaves the record exactly as it was — ambiguity is never
 *   converted into success or failure by an unreachable relay;
 * - work is bounded ({@link MAX_RECOVERY_OPS} per sweep, sequential) so a
 *   pathological ledger cannot stall the app;
 * - spend INTENTS are not touched: an intent closes only through its own
 *   purchase flow, where delivery (items in-event, or the pass actually
 *   stored) can be confirmed. Recovery advancing a record to `applied` is
 *   exactly what later lets that flow resolve as `already-applied` without a
 *   second charge.
 *
 * Beach and Mine rewards have their own recovery orchestration (their ledgers
 * re-derive stable opIds and drive the wallet themselves); this sweep only
 * ever performs read-only reconciliation, so overlapping with them is safe —
 * the ledger's one-way doors make `applied` sticky no matter who proves it.
 */

import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { unresolvedCoinOps } from '@/lib/coin-op-ledger';

import { createCoinWallet } from './coin-wallet';

/** Upper bound on records reconciled in one sweep. */
export const MAX_RECOVERY_OPS = 25;

/** One sweep per pubkey per app session; keyed promises double as run guards. */
const sweeps = new Map<string, Promise<void>>();

/** Tests only — forget every sweep so the next mount runs again. */
export function resetCoinOpRecoveryRuns(): void {
  sweeps.clear();
}

/**
 * Mount ONCE at the authenticated app root (see
 * `src/components/CoinOpRecoveryController.tsx`). Renders nothing and never
 * blocks rendering; feature flows do not wait for it — a retried purchase
 * reconciles its own operation in-lock regardless.
 */
export function useCoinOpRecovery(): void {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  useEffect(() => {
    const pubkey = user?.pubkey;
    if (!pubkey || !user?.signer || sweeps.has(pubkey)) return;

    const wallet = createCoinWallet({ nostr, user });
    const sweep = (async () => {
      const unresolved = unresolvedCoinOps(pubkey)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, MAX_RECOVERY_OPS);
      for (const record of unresolved) {
        try {
          await wallet.reconcileOp(record.opId);
        } catch {
          // Unreachable relay or unusable read: the record stays exactly as
          // it was. A future session (or the purchase flow itself) retries.
        }
      }
    })();
    sweeps.set(pubkey, sweep);
  }, [nostr, user]);
}
