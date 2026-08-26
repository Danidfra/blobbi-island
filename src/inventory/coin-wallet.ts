/**
 * The canonical Blobbi Coin wallet — the ONLY production interface that moves
 * the Coin balance.
 *
 * A generalization of the arcade ticket writer's currency-grade guarantees
 * into one reusable mutator, so the Beach, the Mine, the shops, the Arcade
 * Pass and the economy-entry allocation all move Coins through identical
 * machinery instead of five slightly-different ones (the exact defect the
 * Coin audit mapped in the kind:11125 era).
 *
 * ## What every mutation gets
 *
 * ```
 *   validate amount (integer, positive, ≤ MAX_COIN_BALANCE; zero REJECTED)
 *   ┌ runInventoryTransaction ────────────────────────────────────────────┐
 *   │ queued cross-tab lock + shared per-tab write chain                  │
 *   │ (the SAME lock every other kind:31633 writer takes)                 │
 *   │ → durable op-ledger check (applied → idempotent; in-flight → block) │
 *   │ → AUTHORITATIVE base read: newest kind:31633, and a resolved-EMPTY  │
 *   │   answer confirmed by a second read before it may be built on       │
 *   │ → balance validation (insufficient funds / cap, never silent clamps)│
 *   │ → the mutation is always a DELTA on that base, never an absolute    │
 *   │ → ledger `publishing` record                    ← no record, no publish
 *   │ → replacement event; created_at = max(now, previous.created_at + 1) │
 *   │ → sign; STRICT publish (a timeout is NOT success)                   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   → read-back verification against the expected balance
 *   → ledger `applied` / `ambiguous`
 * ```
 *
 * Unrelated inventory entries ride through the canonical builder untouched,
 * exactly as every other inventory write.
 *
 * The empty-base confirmation is not a nicety: kind:31633 is REPLACEABLE, so a
 * grant built on a relay's spurious "no events" answer does not lose a delta —
 * it replaces the player's whole inventory with the reward amount. That is the
 * defect behind "my Mine reward replaced my balance instead of adding to it".
 *
 * ## Trust model, stated plainly
 *
 * The official Coin ITEM is real (issuer-signed kind:31632). The BALANCE is
 * the player's own kind:31633, and this client computes and publishes the
 * mutations. The ledger, locks, fresh reads and read-backs protect
 * operational correctness — exactly-once application, no stale clobbering,
 * no accidental duplicates. They do NOT prove the player earned anything: a
 * modified client can publish any balance. This is a PROVISIONAL,
 * client-trusted issuance path; a future issuer-grant mechanism replaces the
 * authorization layer above this wallet, not the wallet itself.
 *
 * ## Honest limits
 *
 * Cross-device: nothing (ledger and locks are per browser profile). Ambiguity
 * is resolved by read-only reconciliation comparing against the recorded
 * pre-publish balance; if OTHER operations landed in between, the comparison
 * cannot prove anything and the operation stays `ambiguous` for the UI to
 * surface — never silently retried.
 */

import type { NUser } from '@nostrify/react/login';

import {
  coinOpBlocksPublish,
  persistCoinOp,
  readCoinOp,
  type CoinOpKind,
  type CoinOpRecord,
} from '@/lib/coin-op-ledger';

import {
  BLOBBI_COIN_ADDRESS,
  MAX_COIN_BALANCE,
  coinAmountProblem,
  isValidCoinBalance,
} from './coin';
import { applyMutation, getQuantity } from './useInventoryMutation';
import { type GameInventory } from './package';
import {
  InventoryTransactionError,
  fetchInventoryWithMeta,
  readAuthoritativeInventoryBase,
  runInventoryTransaction,
  type InventoryTransactionNostr,
  type InventoryWithMeta,
} from './inventory-transaction';

/**
 * The narrow relay surface the wallet needs; trivial to fake in tests.
 *
 * Structurally the shared transaction surface — the wallet is one writer among
 * several on the same kind:31633 event, not a protocol of its own.
 */
export type CoinWalletNostr = InventoryTransactionNostr;

export interface CoinWalletDeps {
  readonly nostr: CoinWalletNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export type { InventoryWithMeta };

/**
 * Re-exported so existing consumers (the economy-entry service) keep one
 * import site. The implementation is the shared transaction module's.
 */
export { fetchInventoryWithMeta };

/** A value-bearing Coin operation. `opId` is its exactly-once identity. */
export interface CoinOperation {
  /** Globally unique per logical operation (mint once, reuse on retry). */
  readonly opId: string;
  /** Positive integer Coins. */
  readonly amount: number;
  /** Short context for the ledger: 'beach-reward', 'shop-spend', … */
  readonly label: string;
  /**
   * Item grants applied in the SAME replacement event as the coin movement.
   *
   * This is what makes a shop purchase atomic: the pre-cutover flow published
   * the item grant (kind:31633) and the charge (kind:11125) as two events and
   * had to document the "items granted but coins not charged" leak. With the
   * Coin in the same inventory, one event carries both sides — either the
   * purchase happens or nothing does.
   */
  readonly grantLines?: readonly { address: string; amount: number }[];
  /**
   * Forward-compatible tags published in the SAME replacement event as the
   * coin movement (e.g. the economy-entry allocation marker). Deduplicated
   * against tags already preserved from the previous event, so re-adding an
   * existing tag never duplicates it.
   */
  readonly extraTags?: readonly (readonly string[])[];
  /**
   * Evaluated on the FRESH in-lock inventory read that the replacement event
   * is built from. Returning `false` aborts the mutation with a `skipped`
   * outcome — nothing is published and no ledger record is written. This is
   * how a caller makes eligibility and publication atomic: the economy-entry
   * allocation checks "marker still absent" on the exact base it would extend,
   * so a concurrent tab that already published the marker turns this attempt
   * into a no-op instead of a duplicate grant.
   */
  readonly precondition?: (inventory: GameInventory) => boolean;
}

export type CoinMutationOutcome =
  /** Published (≥1 relay accepted). `verified` = the read-back matched. */
  | { readonly status: 'applied'; readonly balance: number; readonly verified: boolean }
  /** This opId was already applied earlier — idempotent success, no publish. */
  | { readonly status: 'already-applied' }
  /** The op's `precondition` returned false on the fresh in-lock base. */
  | { readonly status: 'skipped' }
  /** The publish MAY have landed. Recorded; reconcile, never blind-retry. */
  | { readonly status: 'ambiguous'; readonly reason: 'publish-timeout' | 'publish-unknown' }
  /** A durable in-flight/ambiguous record for this opId blocks a new publish. */
  | { readonly status: 'blocked'; readonly blockedBy: 'publishing' | 'ambiguous' };

/** Provably-pre-publish failures. Everything here means nothing was sent. */
export class CoinWalletError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'invalid-amount'
      | 'insufficient-funds'
      | 'balance-cap'
      | 'invalid-balance'
      | 'ledger-unavailable'
      | 'read-failed'
      | 'sign-failed',
  ) {
    super(message);
    this.name = 'CoinWalletError';
  }
}

export interface CoinWallet {
  /** Fresh authoritative balance. Throws `read-failed` when unreachable. */
  readBalance(): Promise<number>;
  /** Add `op.amount` Coins, exactly once per `op.opId`. */
  grantCoins(op: CoinOperation): Promise<CoinMutationOutcome>;
  /** Subtract `op.amount` Coins, exactly once per `op.opId`. */
  spendCoins(op: CoinOperation): Promise<CoinMutationOutcome>;
  /**
   * Read-only reconciliation of a publishing/ambiguous operation: the balance
   * is re-read and compared with the recorded pre-publish balance. Returns
   * the operation's (possibly advanced) status. Never publishes.
   */
  reconcileOp(opId: string): Promise<CoinOpRecord | null>;
}

export function createCoinWallet(deps: CoinWalletDeps): CoinWallet {
  const { nostr, user } = deps;
  const now = deps.now ?? Date.now;

  const requireUser = () => {
    if (!user?.pubkey || !user.signer) {
      throw new CoinWalletError('User is not logged in', 'not-logged-in');
    }
    return user.pubkey;
  };

  const readMeta = async (): Promise<InventoryWithMeta> => {
    try {
      // Empty-confirming: a balance of "0" read from a relay that simply does
      // not carry the event must never be mistaken for a real zero.
      return await readAuthoritativeInventoryBase(nostr, requireUser());
    } catch (error) {
      if (error instanceof CoinWalletError) throw error;
      throw new CoinWalletError(
        error instanceof Error ? error.message : 'Inventory read failed',
        'read-failed',
      );
    }
  };

  const record = (
    partial: Omit<CoinOpRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number },
  ): CoinOpRecord => {
    const timestamp = now();
    return {
      createdAt: partial.createdAt ?? timestamp,
      ...partial,
      updatedAt: timestamp,
    };
  };

  const reconcileAgainstRecord = async (
    pubkey: string,
    existing: CoinOpRecord,
  ): Promise<CoinOpRecord> => {
    if (existing.balanceBefore === null && !existing.publishedEventId) {
      return existing;
    }
    const meta = await readMeta();

    // Definitive proof first: the authoritative newest kind:31633 event IS
    // the event this operation signed — the current state is the operation's
    // own replacement event, so it applied. This survives cases the balance
    // heuristic cannot decide (and read-back-failed `applied` verification).
    const newestEventId = meta.inventory.event?.id ?? null;
    if (existing.publishedEventId && newestEventId === existing.publishedEventId) {
      const applied = record({
        ...existing,
        status: 'applied',
        note: 'reconciled-by-event-id',
        createdAt: existing.createdAt,
      });
      persistCoinOp(pubkey, applied);
      return applied;
    }

    if (existing.balanceBefore === null) return existing;
    const balance = getQuantity(meta.inventory, BLOBBI_COIN_ADDRESS);
    const expected =
      existing.kind === 'grant'
        ? existing.balanceBefore + existing.amount
        : existing.balanceBefore - existing.amount;
    if (balance === expected) {
      // HEURISTIC proof: the balance moved by exactly this operation's delta.
      // A later unrelated Coin movement defeats it (and could in principle
      // fake it), which is why the event-id check above is preferred when the
      // record carries one.
      const applied = record({
        ...existing,
        status: 'applied',
        note: 'reconciled-by-read-back',
        createdAt: existing.createdAt,
      });
      persistCoinOp(pubkey, applied);
      return applied;
    }
    // The state neither matches "landed" nor can prove "did not land" —
    // nothing short of marker-grade proof can establish non-publication (see
    // `resolveCoinOpByAuthoritativeProof`), and a spend carries no marker.
    // Stays ambiguous; surfaced, never silently retried.
    return existing;
  };

  const mutate = async (
    kind: CoinOpKind,
    op: CoinOperation,
  ): Promise<CoinMutationOutcome> => {
    const pubkey = requireUser();

    const problem = coinAmountProblem(op.amount);
    if (problem) {
      throw new CoinWalletError(
        `Refusing coin ${kind} of ${op.amount}: ${problem}`,
        'invalid-amount',
      );
    }

    return runInventoryTransaction(
      { nostr, user, now },
      async (ctx): Promise<CoinMutationOutcome> => {
        // Exactly-once: the durable ledger is consulted INSIDE the lock.
        const existing = readCoinOp(pubkey, op.opId);
        if (existing?.status === 'applied') return { status: 'already-applied' };
        if (existing && coinOpBlocksPublish(existing)) {
          const reconciled = await reconcileAgainstRecord(pubkey, existing);
          if (reconciled.status === 'applied') return { status: 'already-applied' };
          return {
            status: 'blocked',
            blockedBy: existing.status as 'publishing' | 'ambiguous',
          };
        }

        // The AUTHORITATIVE base: an empty answer is confirmed by a second
        // read before it may become a publish base, so a relay that does not
        // carry the inventory can never turn a +N grant into a total of N.
        // A read that cannot be completed is `read-failed`, which callers
        // (economy entry) branch on — keep the wallet's error vocabulary.
        let meta: InventoryWithMeta;
        try {
          meta = await ctx.readBase();
        } catch (error) {
          throw new CoinWalletError(
            error instanceof Error ? error.message : 'Inventory read failed',
            'read-failed',
          );
        }

        // Atomic eligibility: the precondition sees the exact base the
        // replacement event would be built from, inside the lock. A false
        // result publishes nothing and records nothing.
        if (op.precondition && !op.precondition(meta.inventory)) {
          return { status: 'skipped' };
        }

        const balance = getQuantity(meta.inventory, BLOBBI_COIN_ADDRESS);
        if (!isValidCoinBalance(balance)) {
          throw new CoinWalletError(
            `Stored coin balance ${balance} is outside the valid range`,
            'invalid-balance',
          );
        }
        if (kind === 'spend' && balance < op.amount) {
          throw new CoinWalletError(
            `Insufficient coins: have ${balance}, need ${op.amount}`,
            'insufficient-funds',
          );
        }
        if (kind === 'grant' && balance + op.amount > MAX_COIN_BALANCE) {
          throw new CoinWalletError(
            `Grant would exceed the coin balance ceiling`,
            'balance-cap',
          );
        }

        // THE DELTA INVARIANT: the mutation is always applied to the
        // authoritative base, never a value written absolutely. `expected`
        // below is derived from that same base for read-back verification.
        let next = applyMutation(meta.inventory, {
          type: kind === 'grant' ? 'add' : 'remove',
          address: BLOBBI_COIN_ADDRESS,
          amount: op.amount,
        });
        if (op.grantLines && op.grantLines.length > 0) {
          next = applyMutation(next, {
            type: 'batch',
            lines: op.grantLines.map((line) => ({
              address: line.address,
              amount: line.amount,
            })),
          });
        }
        const expected = kind === 'grant' ? balance + op.amount : balance - op.amount;

        // No durable record, no publish — the rule the arcade learned.
        const publishing = record({
          opId: op.opId,
          kind,
          amount: op.amount,
          status: 'publishing',
          label: op.label,
          balanceBefore: balance,
          publishedEventId: null,
        });
        if (!persistCoinOp(pubkey, publishing)) {
          throw new CoinWalletError(
            'Could not durably record the operation; refusing to publish',
            'ledger-unavailable',
          );
        }

        // Build + monotonic created_at + sign + STRICT publish, all owned by
        // the shared transaction. A timeout is AMBIGUOUS, never success.
        // `onSigned` records WHICH event may land before the send happens, so
        // an ambiguous outcome (or a crash in the send window) can later be
        // reconciled by event id, not just by the balance heuristic.
        let signedEventId: string | null = null;
        try {
          await ctx.publish(next, {
            extraTags: op.extraTags,
            onSigned: (event) => {
              signedEventId = event.id;
              // Same status, same `updatedAt`: passes the one-way doors as an
              // in-place enrichment of the in-flight record.
              persistCoinOp(pubkey, { ...publishing, publishedEventId: event.id });
            },
          });
        } catch (error) {
          if (error instanceof InventoryTransactionError) {
            if (error.reason === 'sign-failed') {
              persistCoinOp(
                pubkey,
                record({ ...publishing, status: 'failed', note: 'sign-failed' }),
              );
              throw new CoinWalletError(error.message, 'sign-failed');
            }
            if (
              error.reason === 'publish-timeout' ||
              error.reason === 'publish-unknown'
            ) {
              persistCoinOp(
                pubkey,
                record({
                  ...publishing,
                  status: 'ambiguous',
                  note: error.reason,
                  publishedEventId: signedEventId,
                }),
              );
              return { status: 'ambiguous', reason: error.reason };
            }
          }
          throw error;
        }

        // Read-back verification. A mismatch does not un-publish anything —
        // the publish provably reached a relay — so the outcome stays
        // `applied` with `verified: false` for the caller to surface.
        let verified = false;
        try {
          const after = await fetchInventoryWithMeta(nostr, pubkey);
          verified = getQuantity(after.inventory, BLOBBI_COIN_ADDRESS) === expected;
        } catch {
          verified = false;
        }

        persistCoinOp(
          pubkey,
          record({
            ...publishing,
            status: 'applied',
            note: verified ? 'read-back-verified' : 'read-back-unverified',
            publishedEventId: signedEventId,
          }),
        );
        return { status: 'applied', balance: expected, verified };
      },
    );
  };

  return {
    async readBalance(): Promise<number> {
      const meta = await readMeta();
      const balance = getQuantity(meta.inventory, BLOBBI_COIN_ADDRESS);
      if (!isValidCoinBalance(balance)) {
        throw new CoinWalletError(
          `Stored coin balance ${balance} is outside the valid range`,
          'invalid-balance',
        );
      }
      return balance;
    },
    grantCoins: (op) => mutate('grant', op),
    spendCoins: (op) => mutate('spend', op),
    async reconcileOp(opId: string): Promise<CoinOpRecord | null> {
      const pubkey = requireUser();
      const existing = readCoinOp(pubkey, opId);
      if (!existing) return null;
      if (existing.status !== 'publishing' && existing.status !== 'ambiguous') {
        return existing;
      }
      return reconcileAgainstRecord(pubkey, existing);
    },
  };
}

/** Mint an operation id: unique, unguessable enough, never security. */
export function mintCoinOpId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const tail =
    uuid ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${prefix}:${tail}`;
}
