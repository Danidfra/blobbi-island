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
 *   → durable op-ledger check (applied → idempotent success; in-flight → block)
 *   → queued cross-tab lock + shared per-tab write chain
 *   → FRESH newest kind:31633 read (raw event, for created_at)
 *   → balance validation (insufficient funds / cap, never silent clamps)
 *   → ledger `publishing` record, read-back verified   ← no record, no publish
 *   → replacement event; created_at = max(now, previous.created_at + 1)
 *   → sign; STRICT publish (a timeout is NOT success)
 *   → read-back verification against the expected balance
 *   → ledger `applied` / `ambiguous`
 * ```
 *
 * Unrelated inventory entries ride through the canonical builder untouched,
 * exactly as every other inventory write.
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

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import {
  coinOpBlocksPublish,
  persistCoinOp,
  readCoinOp,
  type CoinOpKind,
  type CoinOpRecord,
} from '@/lib/coin-op-ledger';
import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';

import {
  BLOBBI_COIN_ADDRESS,
  MAX_COIN_BALANCE,
  coinAmountProblem,
  isValidCoinBalance,
} from './coin';
import {
  applyMutation,
  buildInventoryTemplate,
  getQuantity,
  serializeInventoryWrite,
} from './useInventoryMutation';
import {
  ISLAND_INVENTORY_D,
  KIND_GAME_INVENTORY,
  type GameInventory,
} from './package';
import { buildEmptyInventory } from './useIslandInventory';
import { parseInventoryEvent } from './protocol-adapter';

const READ_TIMEOUT_MS = 3000;
const PUBLISH_TIMEOUT_MS = 5000;

/** The narrow relay surface the wallet needs; trivial to fake in tests. */
export interface CoinWalletNostr {
  query: (
    filters: {
      kinds: number[];
      authors: string[];
      '#d': string[];
      limit?: number;
    }[],
    options: { signal: AbortSignal },
  ) => Promise<NostrEvent[]>;
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface CoinWalletDeps {
  readonly nostr: CoinWalletNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

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

export interface InventoryWithMeta {
  readonly inventory: GameInventory;
  /** `created_at` of the newest valid event, or 0 when none exists. */
  readonly createdAt: number;
}

/**
 * Fetch the newest valid kind:31633 with its `created_at`.
 *
 * A RESOLVED call is as authoritative as Nostr allows: the pool's `query`
 * resolves only after the configured relay answered the REQ (EOSE) or the
 * filter limit was satisfied, so a resolved-but-empty result means "the relay
 * says there is no event", not "the relay never answered" — that case rejects
 * (timeout/abort) and MUST be treated as unknown, never as empty. Exported for
 * the economy-entry service, whose eligibility depends on exactly this
 * distinction.
 */
export async function fetchInventoryWithMeta(
  nostr: CoinWalletNostr,
  pubkey: string,
): Promise<InventoryWithMeta> {
  const events = await nostr.query(
    [
      {
        kinds: [KIND_GAME_INVENTORY],
        authors: [pubkey],
        '#d': [ISLAND_INVENTORY_D],
        limit: 1,
      },
    ],
    { signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
  );
  const valid = events
    .map((event) => ({ event, parsed: parseInventoryEvent(event) }))
    .filter((x): x is { event: NostrEvent; parsed: GameInventory } => Boolean(x.parsed))
    .sort((a, b) => b.event.created_at - a.event.created_at);
  if (valid.length === 0) {
    return { inventory: buildEmptyInventory(pubkey), createdAt: 0 };
  }
  return { inventory: valid[0].parsed, createdAt: valid[0].event.created_at };
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
      return await fetchInventoryWithMeta(nostr, requireUser());
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
    if (existing.balanceBefore === null) return existing;
    const meta = await readMeta();
    const balance = getQuantity(meta.inventory, BLOBBI_COIN_ADDRESS);
    const expected =
      existing.kind === 'grant'
        ? existing.balanceBefore + existing.amount
        : existing.balanceBefore - existing.amount;
    if (balance === expected) {
      const applied = record({
        ...existing,
        status: 'applied',
        note: 'reconciled-by-read-back',
        createdAt: existing.createdAt,
      });
      persistCoinOp(pubkey, applied);
      return applied;
    }
    // The balance neither matches "landed" nor can prove "did not land"
    // (other operations may have moved it). Stays ambiguous; surfaced, never
    // silently retried.
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

    const { value } = await withQueuedCrossTabLock(
      `blobbi-coin-wallet:${pubkey}`,
      () =>
        serializeInventoryWrite(pubkey, async (): Promise<CoinMutationOutcome> => {
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

          const meta = await readMeta();

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
          });
          if (!persistCoinOp(pubkey, publishing)) {
            throw new CoinWalletError(
              'Could not durably record the operation; refusing to publish',
              'ledger-unavailable',
            );
          }

          const template = buildInventoryTemplate(next, {
            extraTags: op.extraTags,
          });
          const tags = [...template.tags];
          if (!tags.some(([name]) => name === 'client')) tags.push(['client', 'blobbi']);

          // Monotonic created_at: two wallet writes inside one wall-clock
          // second must not tie (NIP-01 breaks ties by lowest id — a write
          // could silently lose).
          const createdAt = Math.max(Math.floor(now() / 1000), meta.createdAt + 1);

          let signed: NostrEvent;
          try {
            signed = await user.signer.signEvent({
              kind: template.kind,
              content: template.content ?? '',
              tags,
              created_at: createdAt,
            });
          } catch (error) {
            persistCoinOp(
              pubkey,
              record({ ...publishing, status: 'failed', note: 'sign-failed' }),
            );
            throw new CoinWalletError(
              error instanceof Error ? error.message : 'The signer refused',
              'sign-failed',
            );
          }

          // STRICT publish: resolving means at least one relay accepted the
          // event. A timeout or an unclassifiable error is recorded as
          // AMBIGUOUS — possibly published — never resolved through as
          // success and never blindly retried.
          try {
            await nostr.event(signed, {
              signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
            });
          } catch (error) {
            const isTimeout =
              error instanceof Error &&
              (error.name === 'AbortError' || error.name === 'TimeoutError');
            persistCoinOp(
              pubkey,
              record({
                ...publishing,
                status: 'ambiguous',
                note: isTimeout ? 'publish-timeout' : 'publish-unknown',
              }),
            );
            return {
              status: 'ambiguous',
              reason: isTimeout ? 'publish-timeout' : 'publish-unknown',
            };
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
            }),
          );
          return { status: 'applied', balance: expected, verified };
        }),
    );
    return value;
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
