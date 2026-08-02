/**
 * React binding for the economy-entry service.
 *
 * One CONTROLLER (mounted once at the authenticated app root, see
 * `src/components/EconomyEntryController.tsx`) runs the service; any number of
 * STATUS readers (`useEconomyEntryStatus`) observe it through a tiny
 * module-level store keyed by pubkey. Feature components never trigger runs —
 * mounting a modal cannot cause a publish.
 *
 * Account switching: state, runs and results are all pubkey-keyed. An
 * in-flight run keeps writing to ITS pubkey's slot only; the new account
 * starts its own marker check; switching back reuses the settled state.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useNostr } from '@/hooks/useNostr';
import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  createEconomyEntry,
  type EconomyEntryResult,
} from './economy-entry';
import type { CoinWalletDeps } from './coin-wallet';
import { inventoryQueryKey } from './useIslandInventory';

export type EconomyEntryPhase =
  | 'idle'
  | 'checking'
  | 'applying'
  | 'applied'
  | 'ambiguous'
  | 'failed';

export interface EconomyEntrySnapshot {
  phase: EconomyEntryPhase;
  /** Only meaningful for `applied`: found done vs applied by this run. */
  alreadyApplied?: boolean;
  /** Only for `failed`. */
  failureReason?: 'check-failed' | 'not-logged-in' | 'balance-cap' | 'sign-failed' | 'ledger-unavailable';
  /**
   * A retry is exposed only for SAFE states: provably-unsent failures and
   * ambiguity (a re-run reconciles by marker and never blind-publishes).
   */
  canRetry: boolean;
}

const IDLE: EconomyEntrySnapshot = { phase: 'idle', canRetry: false };

// ── Store ──────────────────────────────────────────────────────────────────

const snapshots = new Map<string, EconomyEntrySnapshot>();
const runs = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function setSnapshot(pubkey: string, snapshot: EconomyEntrySnapshot): void {
  snapshots.set(pubkey, snapshot);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only — forget every run and snapshot. */
export function resetEconomyEntryRuns(): void {
  snapshots.clear();
  runs.clear();
  for (const listener of listeners) listener();
}

// ── Runner ─────────────────────────────────────────────────────────────────

interface RunnerDeps extends CoinWalletDeps {
  queryClient: QueryClient;
}

function toSnapshot(result: EconomyEntryResult): EconomyEntrySnapshot {
  switch (result.status) {
    case 'applied':
      return { phase: 'applied', alreadyApplied: result.alreadyApplied, canRetry: false };
    case 'check-failed':
      return { phase: 'failed', failureReason: 'check-failed', canRetry: true };
    case 'ambiguous':
      return { phase: 'ambiguous', canRetry: true };
    case 'failed':
      return { phase: 'failed', failureReason: result.reason, canRetry: !result.terminal };
  }
}

function ensureRun(deps: RunnerDeps, options?: { force?: boolean }): void {
  const pubkey = deps.user?.pubkey;
  if (!pubkey) return;
  if (runs.has(pubkey) && !options?.force) return;
  const settled = snapshots.get(pubkey);
  if (settled?.phase === 'applied') return;

  const service = createEconomyEntry(deps);
  const run = (async () => {
    setSnapshot(pubkey, { phase: 'checking', canRetry: false });
    try {
      const result = await service.checkAndApply((phase) =>
        setSnapshot(pubkey, { phase, canRetry: false }),
      );
      setSnapshot(pubkey, toSnapshot(result));
      if (result.status === 'applied' && !result.alreadyApplied) {
        // A publish happened — reconcile the canonical inventory/Coin caches.
        deps.queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
      }
    } catch (error) {
      console.error('[economy-entry] unexpected failure', error);
      setSnapshot(pubkey, { phase: 'failed', failureReason: 'check-failed', canRetry: true });
    }
  })();
  runs.set(pubkey, run);
}

/** Latest controller-provided deps, so `retry()` can re-run for the CURRENT account. */
let currentDeps: RunnerDeps | null = null;

// ── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Mount ONCE at the authenticated app root (outside the `playing` gate): runs
 * the marker check / allocation for every signed-in pubkey — with or without
 * a profile, a Blobbi, or any prior Island visit. Non-blocking: rendering
 * never waits on it.
 */
export function useEconomyEntryController(): void {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.pubkey) return;
    const deps: RunnerDeps = { nostr, user, queryClient };
    currentDeps = deps;
    ensureRun(deps);
  }, [nostr, user, queryClient]);
}

/** Observe the current account's economy-entry state; `retry` is safe-only. */
export function useEconomyEntryStatus(): EconomyEntrySnapshot & { retry: () => void } {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const snapshot = useSyncExternalStore(
    subscribe,
    () => (pubkey ? (snapshots.get(pubkey) ?? IDLE) : IDLE),
    () => IDLE,
  );

  const retry = useCallback(() => {
    if (!pubkey || !currentDeps || currentDeps.user.pubkey !== pubkey) return;
    const current = snapshots.get(pubkey);
    if (!current?.canRetry) return;
    ensureRun(currentDeps, { force: true });
  }, [pubkey]);

  return { ...snapshot, retry };
}
