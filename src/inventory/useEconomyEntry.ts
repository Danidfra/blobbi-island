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
 *
 * ## Why a settled failure must not poison the session
 *
 * The allocation itself is safe by construction (marker-based eligibility, one
 * stable operation id, an in-lock re-check). What used to strand a player was
 * this binding: the run map recorded a promise and never distinguished
 * "running" from "finished badly", so ONE relay hiccup at sign-in left
 * `runs.has(pubkey)` permanently true and every later automatic attempt
 * short-circuited. A new player sat at 0 Coins until they reloaded the page —
 * even a sign-out and sign-in could not re-open it.
 *
 * The guard now answers three questions separately:
 *
 * ```
 *   record.active            → a run is IN FLIGHT      → never start a second
 *   snapshot.phase==='applied' → the allocation is done → never run again
 *   record.generation        → which sign-in it belonged to
 * ```
 *
 * A settled failure is therefore re-runnable by an explicit `retry()` (which
 * the Coins surfaces expose) and, after a sign-out, by the next automatic
 * attempt — while an in-flight run and a completed allocation both stay
 * closed. None of this is the safety boundary: the marker and the shared
 * wallet transaction remain that, so even a duplicated attempt cannot grant
 * twice.
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
const listeners = new Set<() => void>();

/**
 * What is known about the most recent run for a pubkey.
 *
 * `active` is the concurrency boundary — an in-flight run blocks every new
 * attempt, explicit retries included. `generation` records which sign-in the
 * run belonged to, so signing out and back in re-opens a settled failure
 * without a page reload. The promise is kept so a caller (today: tests) can
 * await the attempt rather than polling.
 */
interface RunRecord {
  promise: Promise<void> | null;
  readonly generation: number;
  active: boolean;
}

const runs = new Map<string, RunRecord>();

/**
 * Bumped whenever the app observes a SIGNED-OUT state.
 *
 * Signing back in as the same pubkey is the same ALLOCATION — the durable
 * marker still decides, and a re-grant is impossible once it exists — but a
 * fresh ATTEMPT. Comparing generations is what lets that attempt happen while
 * still refusing an automatic repeat inside one sign-in.
 */
let signInGeneration = 0;

function setSnapshot(pubkey: string, snapshot: EconomyEntrySnapshot): void {
  snapshots.set(pubkey, snapshot);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only — forget every run, snapshot and sign-in generation. */
export function resetEconomyEntryRuns(): void {
  snapshots.clear();
  runs.clear();
  signInGeneration = 0;
  currentDeps = null;
  for (const listener of listeners) listener();
}

// ── Runner ─────────────────────────────────────────────────────────────────

interface RunnerDeps extends CoinWalletDeps {
  queryClient: QueryClient;
}

/**
 * Which settled results a surface may offer a retry for.
 *
 * ```
 *   check-failed      relay unreachable, or a stored balance outside the valid
 *                     range  → retry: every attempt re-reads, so a later read
 *                     can genuinely differ
 *   sign-failed       the signer refused → retry: it may approve next time
 *   ledger-unavailable durable storage refused the record → retry: storage can
 *                     become writable
 *   ambiguous         the publish MAY have landed → retry: the re-run
 *                     reconciles by MARKER and only publishes after a fresh
 *                     read confirms the marker is absent
 *   not-logged-in     flagged retryable but unreachable — `retry()` requires
 *                     a signed-in pubkey matching the snapshot
 *   balance-cap       NO retry: +200 would exceed the ceiling, and the wallet
 *                     throws before building anything. Nothing a button press
 *                     can do changes that; the balance has to move first.
 * ```
 *
 * That is the whole audit — no state here offers a retry that cannot
 * realistically recover, so the result vocabulary needs no further refinement.
 */
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

/**
 * May a new attempt start for this pubkey right now?
 *
 * Ordered by strength: an in-flight run and a completed allocation are
 * absolute (an explicit retry does NOT bypass either), and only then does the
 * automatic-vs-explicit distinction matter.
 */
function canStartRun(pubkey: string, force: boolean): boolean {
  const record = runs.get(pubkey);
  // Concurrency: one attempt at a time, always. Two overlapping runs would
  // both read the marker before either published it.
  if (record?.active) return false;

  const settled = snapshots.get(pubkey);
  // The allocation is done for this account, forever.
  if (settled?.phase === 'applied') return false;

  // An explicit retry may re-run anything else — every remaining state is one
  // the service re-checks against the authoritative marker before granting.
  if (force) return true;

  // Automatic: the first attempt of this sign-in...
  if (!record) return true;
  if (record.generation === signInGeneration) return false;
  // ...or the first attempt after a sign-out, and only for a state a retry
  // could safely advance (a terminal failure is not re-attempted on a loop).
  return settled === undefined || settled.canRetry;
}

function ensureRun(deps: RunnerDeps, options?: { force?: boolean }): void {
  const pubkey = deps.user?.pubkey;
  if (!pubkey) return;
  if (!canStartRun(pubkey, options?.force === true)) return;

  // Recorded BEFORE the attempt starts, so a re-entrant call (a listener that
  // renders a surface which calls `retry`) already sees an active run.
  const record: RunRecord = { promise: null, generation: signInGeneration, active: true };
  runs.set(pubkey, record);

  const service = createEconomyEntry(deps);
  record.promise = (async () => {
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
    } finally {
      // Settled: the snapshot now decides whether another attempt is allowed.
      record.active = false;
    }
  })();
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
    if (!user?.pubkey) {
      // Signed out. The next sign-in is a fresh ATTEMPT at the same
      // allocation, so a failure settled under this generation stops blocking
      // the automatic run — which is how "log out and back in" recovers
      // without a page reload. `applied` is unaffected: it is checked first
      // and is terminal.
      signInGeneration += 1;
      currentDeps = null;
      return;
    }
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

  /**
   * Re-run the allocation check for the CURRENT account.
   *
   * Reads the live store rather than the rendered snapshot, so two clicks in
   * one tick cannot both pass: the first flips the stored phase to `checking`
   * (canRetry `false`) synchronously. `canStartRun` refuses an in-flight run
   * as well, so the guarantee does not depend on render timing.
   */
  const retry = useCallback(() => {
    if (!pubkey || !currentDeps || currentDeps.user.pubkey !== pubkey) return;
    const current = snapshots.get(pubkey);
    if (!current?.canRetry) return;
    ensureRun(currentDeps, { force: true });
  }, [pubkey]);

  return { ...snapshot, retry };
}
