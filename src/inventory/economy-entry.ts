/**
 * Economy entry: the exactly-once initial Coin allocation for Blobbi Island
 * economy version 1.
 *
 * ## Product contract (economy reset)
 *
 * Every authenticated pubkey receives `INITIAL_ISLAND_COIN_ALLOCATION` (200)
 * official Blobbi Coins exactly once, at its first authenticated entry into
 * the Island's new economy. Eligibility is independent of: profile existence,
 * Blobbi ownership, adoption, the legacy kind:11125 `coins` value, the current
 * Coin balance, unrelated inventory items, localStorage, and the device.
 * Legacy profile Coins are NEVER read here, or anywhere, for economic
 * decisions.
 *
 * ## The durable marker is the proof
 *
 * ```
 *   ["allocation", "island-economy:v1"]
 * ```
 *
 * published ATOMICALLY in the same canonical kind:31633 replacement event as
 * the 200-Coin increase. Marker present ⇒ allocation processed; marker absent
 * on an authoritative read ⇒ not processed. The current balance is never
 * proof (it legitimately returns to zero after spending); the local Coin-op
 * ledger is an operational journal only (it does not survive a second device
 * or cleared storage, the marker does, because it lives on the relay-hosted
 * event).
 *
 * Because marker and quantity travel in one replaceable event, a retry after
 * failure or ambiguity is safe by construction: re-read → marker present ⇒
 * done; marker absent ⇒ granting again republishes marker + quantity together
 * and cannot double-apply.
 *
 * ## Cross-tab / cross-device convergence (honest limits)
 *
 * Two tabs are serialized by the wallet's queued Web Lock (where Web Locks
 * exist: without them there is NO cross-tab lock, see
 * `src/lib/cross-tab-op-lock.ts`) and the in-lock `precondition` re-checks the
 * marker on the exact base the event is built from. Two DEVICES are not
 * serialized at all: convergence relies on kind:31633 being addressable
 * (newest event wins), on each device building `own fresh base + 200 + marker`,
 * and on marker reconciliation afterwards. A tested two-device race settles on
 * ONE event carrying one marker and one +200, never a stable 400, but a
 * concurrent UNRELATED mutation from the other device inside the race window
 * can be lost to newest-wins, the same pre-existing lost-update class every
 * inventory write has. Nothing here is server-authoritative exactly-once.
 *
 * ## Authoritative reads
 *
 * A RESOLVED inventory query is as authoritative as Nostr allows (the relay
 * answered the REQ; see `fetchInventoryWithMeta`). A read that rejects
 * (timeout/abort/error) proves nothing: the service then stays in a
 * checking/failed state and PUBLISHES NOTHING; it never fabricates an empty
 * base from an unanswered read. Residual limitation, stated honestly: Nostr
 * cannot distinguish "the relay holds no event" from "the relay lost the
 * event"; if the relay lost it, a re-grant republishes marker + 200 as the
 * new current state, which is also the only state the relay still knows.
 * Before this account's FIRST-ever publish (empty base) the service performs
 * one confirming re-read, so a single flaky-but-resolved empty answer cannot
 * mint a duplicate on its own.
 */

import {
  readCoinOp,
  resolveCoinOpByAuthoritativeProof,
} from '@/lib/coin-op-ledger';

import {
  createCoinWallet,
  fetchInventoryWithMeta,
  CoinWalletError,
  type CoinMutationOutcome,
  type CoinWalletDeps,
  type InventoryWithMeta,
} from './coin-wallet';
import type { GameInventory } from './package';

// ── Allocation policy (the ONLY definition of these values) ────────────────

/** Coins granted once per account for Island economy v1. */
export const INITIAL_ISLAND_COIN_ALLOCATION = 200;

/** The economy/allocation version identity. A future v2 is a NEW id. */
export const ISLAND_ECONOMY_ALLOCATION_ID = 'island-economy:v1';

/** Tag name carrying allocation markers on kind:31633. */
export const ALLOCATION_TAG_NAME = 'allocation';

/** The exact marker tag: `["allocation", "island-economy:v1"]`. */
export const ISLAND_ALLOCATION_MARKER: readonly [string, string] = [
  ALLOCATION_TAG_NAME,
  ISLAND_ECONOMY_ALLOCATION_ID,
];

/**
 * The ONE stable logical operation identity for this allocation (per pubkey,
 * the ledger namespaces by pubkey; per economy version, the id embeds it).
 * Never minted randomly: every retry is the SAME logical operation.
 */
export const ISLAND_ALLOCATION_OP_ID = `initial-allocation:${ISLAND_ECONOMY_ALLOCATION_ID}`;

/** Ledger label for allocation operations. */
export const ISLAND_ALLOCATION_LABEL = 'island-allocation';

// ── Pure marker helpers ────────────────────────────────────────────────────

/**
 * Is this tag EXACTLY the v1 allocation marker? Exact matching only: correct
 * name, correct id, arity 2. A tag with extra elements, a different version,
 * or different casing is NOT proof; it is somebody else's (or malformed)
 * data, preserved opaquely by the lossless builder but never acted on.
 */
export function isIslandAllocationMarker(tag: readonly string[]): boolean {
  return (
    tag.length === 2 &&
    tag[0] === ALLOCATION_TAG_NAME &&
    tag[1] === ISLAND_ECONOMY_ALLOCATION_ID
  );
}

/** Does the inventory's source event carry the exact v1 marker? */
export function hasIslandAllocationMarker(inventory: GameInventory): boolean {
  return (inventory.event?.tags ?? []).some(isIslandAllocationMarker);
}

// ── Service ────────────────────────────────────────────────────────────────

export type EconomyEntryResult =
  /**
   * The allocation is the current authoritative state (marker present).
   * `alreadyApplied` distinguishes "found done" from "applied just now";
   * `verified` reports whether a post-publish read confirmed the marker
   * (balance verification is the wallet's separate read-back concern, a
   * mismatched balance because another legitimate mutation landed later never
   * strands the operation).
   */
  | { status: 'applied'; alreadyApplied: boolean; verified: boolean }
  /** No authoritative read could be completed. Nothing published. Retryable. */
  | { status: 'check-failed' }
  /**
   * A publish MAY have landed but could not be confirmed either way. Safe to
   * re-run: the next run reconciles by marker and only re-publishes after a
   * fresh authoritative read confirms the marker is absent.
   */
  | { status: 'ambiguous' }
  /** Provably-unsent failure. Retryable unless `terminal`. */
  | {
      status: 'failed';
      reason: 'not-logged-in' | 'balance-cap' | 'sign-failed' | 'ledger-unavailable';
      terminal: boolean;
    };

export interface EconomyEntry {
  /**
   * Ensure this account's initial allocation for economy v1: check the marker
   * authoritatively, reconcile any journal leftovers, and apply the atomic
   * grant if: and only if, the marker is absent. Safe to call repeatedly;
   * `onPhase` reports the transition from checking to actually publishing.
   */
  checkAndApply(onPhase?: (phase: 'checking' | 'applying') => void): Promise<EconomyEntryResult>;
}

export function createEconomyEntry(deps: CoinWalletDeps): EconomyEntry {
  const wallet = createCoinWallet(deps);

  const readAuthoritative = async (): Promise<InventoryWithMeta | null> => {
    try {
      return await fetchInventoryWithMeta(deps.nostr, deps.user.pubkey);
    } catch {
      // Rejected read: unknown, NOT empty. Never a publish base.
      return null;
    }
  };

  const appliedResult = (pubkey: string): EconomyEntryResult => {
    // Journal tidy-up only, the marker is already the proof.
    const existing = readCoinOp(pubkey, ISLAND_ALLOCATION_OP_ID);
    if (existing && existing.status !== 'applied') {
      resolveCoinOpByAuthoritativeProof(
        pubkey,
        ISLAND_ALLOCATION_OP_ID,
        'applied',
        'reconciled-by-marker',
      );
    }
    return { status: 'applied', alreadyApplied: true, verified: true };
  };

  return {
    async checkAndApply(onPhase): Promise<EconomyEntryResult> {
      const pubkey = deps.user?.pubkey;
      if (!pubkey || !deps.user.signer) {
        return { status: 'failed', reason: 'not-logged-in', terminal: false };
      }

      onPhase?.('checking');

      // 1. Authoritative marker check.
      const first = await readAuthoritative();
      if (!first) return { status: 'check-failed' };
      if (hasIslandAllocationMarker(first.inventory)) return appliedResult(pubkey);

      // 2. Journal leftovers. A possibly-published (or even `applied`) record
      //    with an authoritatively-absent marker is superseded BY THE MARKER,
      //    the journal never determines eligibility. Require a second
      //    confirming read before overriding a record that claims the publish
      //    may have landed.
      const existing = readCoinOp(pubkey, ISLAND_ALLOCATION_OP_ID);
      if (
        existing &&
        (existing.status === 'publishing' ||
          existing.status === 'ambiguous' ||
          existing.status === 'applied')
      ) {
        const confirm = await readAuthoritative();
        if (!confirm) {
          // Cannot confirm either way, surface the uncertainty, publish
          // nothing, never blind-retry.
          return { status: 'ambiguous' };
        }
        if (hasIslandAllocationMarker(confirm.inventory)) return appliedResult(pubkey);
        if (
          !resolveCoinOpByAuthoritativeProof(
            pubkey,
            ISLAND_ALLOCATION_OP_ID,
            'not-published',
            'marker-absent-on-authoritative-read',
          )
        ) {
          return { status: 'failed', reason: 'ledger-unavailable', terminal: false };
        }
      } else if (first.createdAt === 0) {
        // 3. Empty base: this would be the account's FIRST-ever inventory
        //    publish. One confirming re-read so a single flaky empty answer
        //    cannot mint a duplicate (the wallet re-reads a third time inside
        //    the lock).
        const confirm = await readAuthoritative();
        if (!confirm) return { status: 'check-failed' };
        if (hasIslandAllocationMarker(confirm.inventory)) return appliedResult(pubkey);
      }

      // 4. Atomic grant: current inventory + 200 Coins + marker, one event,
      //    through the canonical wallet (ledger record, cross-tab lock, fresh
      //    in-lock read, strict publish, read-back). The precondition re-checks
      //    the marker on the exact base the event extends, so a concurrent
      //    winner turns this into a no-op instead of a duplicate.
      onPhase?.('applying');
      let outcome: CoinMutationOutcome;
      try {
        outcome = await wallet.grantCoins({
          opId: ISLAND_ALLOCATION_OP_ID,
          amount: INITIAL_ISLAND_COIN_ALLOCATION,
          label: ISLAND_ALLOCATION_LABEL,
          extraTags: [ISLAND_ALLOCATION_MARKER],
          precondition: (inventory) => !hasIslandAllocationMarker(inventory),
        });
      } catch (error) {
        if (error instanceof CoinWalletError) {
          if (error.reason === 'read-failed' || error.reason === 'invalid-balance') {
            return { status: 'check-failed' };
          }
          if (error.reason === 'balance-cap') {
            // Granting 200 would exceed MAX_COIN_BALANCE. Never clamped, never
            // a partial marker-only event (the wallet throws before building
            // anything). Terminal until the balance changes.
            return { status: 'failed', reason: 'balance-cap', terminal: true };
          }
          if (error.reason === 'sign-failed' || error.reason === 'not-logged-in') {
            return {
              status: 'failed',
              reason: error.reason === 'sign-failed' ? 'sign-failed' : 'not-logged-in',
              terminal: false,
            };
          }
          return { status: 'failed', reason: 'ledger-unavailable', terminal: false };
        }
        throw error;
      }

      switch (outcome.status) {
        case 'applied': {
          // The wallet's read-back verified the BALANCE; the allocation's
          // authoritative proof is the MARKER. Verify it separately so a
          // balance moved by a later legitimate mutation cannot strand us.
          const post = await readAuthoritative();
          const verified = post ? hasIslandAllocationMarker(post.inventory) : false;
          return { status: 'applied', alreadyApplied: false, verified };
        }
        case 'skipped':
          // The in-lock base already carried the marker (a concurrent tab won).
          return { status: 'applied', alreadyApplied: true, verified: true };
        case 'already-applied':
          // Ledger short-circuit (a concurrent same-tab run applied it first).
          return { status: 'applied', alreadyApplied: true, verified: true };
        case 'ambiguous':
        case 'blocked':
          return { status: 'ambiguous' };
        default: {
          const _exhaustive: never = outcome;
          throw new Error(`Unknown wallet outcome ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
  };
}
