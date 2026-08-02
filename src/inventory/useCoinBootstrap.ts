/**
 * The one-time legacy Coin bootstrap: kind:11125 `coins` → official Blobbi
 * Coin quantity in kind:31633.
 *
 * ## Semantics
 *
 * - **Idempotent.** The migration is a wallet operation with the FIXED op id
 *   {@link LEGACY_BOOTSTRAP_OP_ID}; the durable Coin op ledger makes a second
 *   application impossible in this browser profile, across refreshes.
 * - **Fresh reads only.** Both the legacy profile and the current inventory
 *   are read from the relay inside the wallet's lock — never a cache.
 * - **Existing inventory wins.** If the inventory already holds Coins and no
 *   local record exists, the migration is recorded as inferred-complete (the
 *   only way Coins enter the inventory is through the wallet, whose first
 *   mount on any device runs this bootstrap first — so a populated inventory
 *   means another device already migrated). The legacy amount is NOT added
 *   again. This is the honest cross-device guard the per-browser ledger
 *   cannot provide by itself.
 * - **Uncertainty is explicit.** A timed-out migration publish is `ambiguous`
 *   and surfaces; it reconciles read-only and never re-publishes blindly.
 *
 * ## The legacy tag afterwards
 *
 * The old `coins` tag stays on kind:11125 as a historical, deprecated value:
 * profile republishes carry it through verbatim (it is no longer a managed
 * tag), production never reads it as a balance again, and nothing displays
 * legacy + inventory summed. See `docs/blobbi-coin-cutover.md`.
 *
 * ## New players
 *
 * A freshly adopted profile writes NO `coins` tag; the initial allocation is
 * a wallet grant with the fixed op id {@link INITIAL_GRANT_OP_ID}, applied
 * exactly once by the same ledger — see `useFirstEggAdoption`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  parseOwnerProfile,
  validateOwnerProfileEvent,
} from '@/lib/blobbi-parsers';
import { BLOBBONAUT_PROFILE_KINDS } from '@/lib/blobbi-kinds';
import { persistCoinOp, readCoinOp } from '@/lib/coin-op-ledger';

import { MAX_COIN_BALANCE } from './coin';
import { createCoinWallet, type CoinWallet, type CoinWalletNostr } from './coin-wallet';
import { inventoryQueryKey } from './useIslandInventory';

export const LEGACY_BOOTSTRAP_OP_ID = 'legacy-coin-bootstrap';
export const INITIAL_GRANT_OP_ID = 'initial-coin-grant';

export type CoinBootstrapStatus =
  /** Not attempted yet (no user, or still running). */
  | 'checking'
  /** Migration applied (this run or a previous one). */
  | 'applied'
  /** Nothing to migrate (no legacy value, or inventory already populated). */
  | 'not-needed'
  /** A migration publish may or may not have landed. Surfaced, not retried. */
  | 'ambiguous'
  /** A provably-unsent failure. Retryable. */
  | 'failed';

export interface CoinBootstrapResult {
  readonly status: Exclude<CoinBootstrapStatus, 'checking'>;
  /** Coins migrated by this or an earlier run (0 when nothing migrated). */
  readonly migratedAmount: number;
  readonly note?: string;
}

interface BootstrapDeps {
  readonly nostr: CoinWalletNostr & {
    query: (
      filters: object[],
      options: { signal: AbortSignal },
    ) => Promise<import('@nostrify/nostrify').NostrEvent[]>;
  };
  readonly pubkey: string;
  readonly wallet: CoinWallet;
  readonly now?: () => number;
}

/** Read the freshest legacy profile `coins` value, validated. */
async function readLegacyCoins(deps: BootstrapDeps): Promise<{ value: number; note?: string }> {
  const events = await deps.nostr.query(
    [{ kinds: [...BLOBBONAUT_PROFILE_KINDS], authors: [deps.pubkey], limit: 1 }],
    { signal: AbortSignal.timeout(3000) },
  );
  const latest = events
    .filter(validateOwnerProfileEvent)
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest) return { value: 0, note: 'no-legacy-profile' };
  const profile = parseOwnerProfile(latest);
  if (!profile) return { value: 0, note: 'unparseable-legacy-profile' };
  const raw = profile.coins;
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX_COIN_BALANCE) {
    return { value: 0, note: `invalid-legacy-value:${raw}` };
  }
  return { value: raw };
}

/**
 * Run the bootstrap once. Safe to call repeatedly — the ledger short-circuits.
 * Exported for tests; production goes through {@link useCoinBootstrap}.
 */
export async function runCoinBootstrap(deps: BootstrapDeps): Promise<CoinBootstrapResult> {
  const { pubkey, wallet } = deps;
  const now = deps.now ?? Date.now;

  const recordNoop = (note: string): CoinBootstrapResult => {
    const timestamp = now();
    persistCoinOp(pubkey, {
      opId: LEGACY_BOOTSTRAP_OP_ID,
      kind: 'grant',
      amount: 0,
      status: 'applied',
      label: 'legacy-bootstrap',
      balanceBefore: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      note,
    });
    return { status: 'not-needed', migratedAmount: 0, note };
  };

  // Durable short-circuit first: applied stays applied, in-flight reconciles.
  const existing = readCoinOp(pubkey, LEGACY_BOOTSTRAP_OP_ID);
  if (existing?.status === 'applied') {
    return { status: 'applied', migratedAmount: existing.amount, note: existing.note };
  }
  if (existing?.status === 'publishing' || existing?.status === 'ambiguous') {
    const reconciled = await wallet.reconcileOp(LEGACY_BOOTSTRAP_OP_ID);
    if (reconciled?.status === 'applied') {
      return { status: 'applied', migratedAmount: reconciled.amount };
    }
    return {
      status: 'ambiguous',
      migratedAmount: 0,
      note: 'a previous migration may have published; reconciliation could not confirm it',
    };
  }

  // Fresh authoritative reads of BOTH sides.
  const legacy = await readLegacyCoins(deps);
  const inventoryBalance = await wallet.readBalance();

  if (legacy.value === 0) {
    return recordNoop(legacy.note ?? 'legacy-balance-zero');
  }
  if (inventoryBalance > 0) {
    // See the module doc: a populated inventory with no local record means
    // the migration already happened elsewhere. Never double-credit.
    return recordNoop('inventory-already-populated');
  }

  const outcome = await wallet.grantCoins({
    opId: LEGACY_BOOTSTRAP_OP_ID,
    amount: legacy.value,
    label: 'legacy-bootstrap',
  });
  switch (outcome.status) {
    case 'applied':
      return { status: 'applied', migratedAmount: legacy.value };
    case 'already-applied':
      return { status: 'applied', migratedAmount: legacy.value };
    case 'ambiguous':
      return { status: 'ambiguous', migratedAmount: 0, note: outcome.reason };
    case 'blocked':
      return { status: 'ambiguous', migratedAmount: 0, note: `blocked:${outcome.blockedBy}` };
  }
}

// One in-flight/settled bootstrap per pubkey per session — every consumer of
// the hook shares the same promise instead of racing five migrations.
const bootstrapRuns = new Map<string, Promise<CoinBootstrapResult>>();

/** Tests only. */
export function resetCoinBootstrapRuns(): void {
  bootstrapRuns.clear();
}

export interface CoinBootstrapView {
  status: CoinBootstrapStatus;
  migratedAmount: number;
  note?: string;
  /** Re-run after a provably-unsent failure. No-op in other states. */
  retry: () => void;
}

/**
 * Run the legacy bootstrap for the signed-in user (once per session) and
 * expose its state for the HUD.
 */
export function useCoinBootstrap(): CoinBootstrapView {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CoinBootstrapResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  const pubkey = user?.pubkey;
  const wallet = useMemo(
    () => (user?.pubkey ? createCoinWallet({ nostr, user }) : null),
    [nostr, user],
  );

  useEffect(() => {
    if (!pubkey || !wallet) return;
    let cancelled = false;

    let run = bootstrapRuns.get(pubkey);
    if (!run) {
      run = runCoinBootstrap({ nostr, pubkey, wallet }).catch((error): CoinBootstrapResult => {
        // A thrown error is a provably-unsent failure (read/sign/ledger); the
        // cached run is dropped so a retry can attempt again.
        bootstrapRuns.delete(pubkey);
        return {
          status: 'failed',
          migratedAmount: 0,
          note: error instanceof Error ? error.message : String(error),
        };
      });
      bootstrapRuns.set(pubkey, run);
    }

    run.then((outcome) => {
      if (cancelled) return;
      setResult(outcome);
      if (outcome.status === 'applied' && outcome.migratedAmount > 0) {
        queryClient.invalidateQueries({ queryKey: inventoryQueryKey(pubkey) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pubkey, wallet, nostr, queryClient, attempt]);

  const retry = useCallback(() => {
    if (!pubkey) return;
    if (result?.status === 'failed') {
      bootstrapRuns.delete(pubkey);
      setResult(null);
      setAttempt((n) => n + 1);
    }
  }, [pubkey, result]);

  return {
    status: result?.status ?? 'checking',
    migratedAmount: result?.migratedAmount ?? 0,
    note: result?.note,
    retry,
  };
}
