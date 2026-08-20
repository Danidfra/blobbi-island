/**
 * The ONE low-level transaction primitive every kind:31633 writer runs through.
 *
 * kind:31633 is a REPLACEABLE event: a publish does not patch the inventory, it
 * REPLACES it. Every writer therefore has to build its event from the newest
 * authoritative state, and any two writers that build concurrently from the
 * same base will silently destroy each other's work — whichever lands last
 * wins, whole.
 *
 * Before this module the Coin wallet had the full discipline (cross-tab lock,
 * shared per-tab chain, monotonic `created_at`) while the two Arcade Ticket
 * writers had none of it, and *nobody* defended against the worst base of all:
 * a read that RESOLVED EMPTY while the player's inventory actually exists.
 *
 * ## The empty-base defect this module exists to close
 *
 * ```
 *   relay answers "no events"  →  buildEmptyInventory()  →  base = {}
 *   grant +20 Coins            →  next = { Coin: 20 }
 *   publish                    →  the ENTIRE inventory is now "20 Coins"
 * ```
 *
 * The player's 100 Coins, their Arcade Tickets and every consumable are gone,
 * and the write even verifies: the read-back genuinely matches the (wrong)
 * expectation. This produced the reported Mine bug — a 20-Coin reward
 * REPLACING a 100-Coin balance instead of adding to it.
 *
 * A resolved-empty read is not proof of an empty inventory. It is ambiguous:
 * either a genuinely new account, or a relay that does not carry (or has not
 * caught up with) the event. {@link readAuthoritativeInventoryBase} resolves
 * that ambiguity with a confirming re-read before an empty base is ever used
 * to build a replacement event — the same rule `economy-entry.ts` already
 * applied to the initial allocation, promoted to the shared layer so it
 * protects every write instead of one.
 *
 * ## What a transaction guarantees
 *
 * ```
 *   queued cross-tab Web Lock (ONE name for ALL 31633 writers)
 *   → shared per-tab write chain (serializeInventoryWrite)
 *   → authoritative read, empty base confirmed by a second read
 *   → caller mutates that ONE snapshot
 *   → canonical lossless builder (unrelated entries + unknown tags ride through)
 *   → created_at = max(now, previous + 1)   ← no same-second ties
 *   → sign
 *   → STRICT publish (a timeout is NOT success)
 * ```
 *
 * Idempotency, balance policy, optimistic UI and reconciliation are
 * deliberately NOT here — they differ per writer and live with their callers
 * (the Coin op ledger, the arcade claim ledger). This module only guarantees
 * that no writer can build on a snapshot another writer is concurrently
 * replacing, and that no writer can replace a real inventory with an empty one.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import { withQueuedCrossTabLock } from '@/lib/cross-tab-op-lock';
import { nextReplaceableCreatedAt } from '@/lib/replaceable-write';

import {
  buildInventoryTemplate,
  serializeInventoryWrite,
  type BuildInventoryTemplateOptions,
} from './useInventoryMutation';
import {
  fetchInventoryWithMeta,
  readAuthoritativeInventoryBase,
  type InventoryReadNostr,
  type InventoryWithMeta,
} from './useIslandInventory';
import { type GameInventory } from './package';

const PUBLISH_TIMEOUT_MS = 5000;

/**
 * The relay surface a transaction needs: the shared READ surface plus publish.
 * Re-exported read helpers keep ONE definition of "the authoritative base" for
 * every writer — the transaction primitive and `useInventoryMutation` alike.
 */
export interface InventoryTransactionNostr extends InventoryReadNostr {
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

export { fetchInventoryWithMeta, readAuthoritativeInventoryBase };
export type { InventoryWithMeta };

/**
 * The ONE cross-tab lock name shared by every kind:31633 writer.
 *
 * Coin grants, Coin spends, Arcade Ticket grants and Ticket spends all contend
 * for THIS name. Two writers on two different lock names are not mutually
 * exclusive at all, which is precisely how a ticket write used to be able to
 * land on top of a concurrent coin write.
 */
export function inventoryWriteLockName(pubkey: string): string {
  return `blobbi-inventory:${pubkey}`;
}

/**
 * `created_at` for the next replacement event.
 *
 * Nostr timestamps are second-resolution and NIP-01 breaks a tie between two
 * replaceable events by lowest id — so two writes inside one wall-clock second
 * must not tie, or one silently loses. Strictly greater than the event being
 * replaced, always.
 */
export function nextInventoryCreatedAt(
  nowMs: number,
  previousCreatedAt: number,
): number {
  return nextReplaceableCreatedAt(nowMs, previousCreatedAt);
}

/**
 * Provably-pre-publish, or explicitly-ambiguous, transaction failures.
 *
 * `originalError` is the error the relay/signer actually threw, when there was
 * one. Callers whose contract is to let a failure through RAW — the arcade
 * claim and redemption boundaries classify the thrown value themselves —
 * rethrow it instead of this wrapper, so wrapping here never changes what a
 * caller's own error vocabulary means.
 */
export class InventoryTransactionError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'read-failed'
      | 'sign-failed'
      | 'publish-timeout'
      | 'publish-unknown',
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'InventoryTransactionError';
  }
}

/** The error a caller should propagate when it must preserve raw identity. */
export function unwrapInventoryTransactionError(error: unknown): unknown {
  return error instanceof InventoryTransactionError && error.originalError !== undefined
    ? error.originalError
    : error;
}

export interface InventoryTransactionDeps {
  readonly nostr: InventoryTransactionNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

/** What the transaction body is handed inside the lock. */
export interface InventoryTransactionContext {
  readonly pubkey: string;
  /**
   * The authoritative, empty-confirmed base. Throws
   * `InventoryTransactionError('read-failed')` when no answer can be obtained.
   * Cached per transaction: calling twice does not re-read.
   */
  readBase(): Promise<InventoryWithMeta>;
  /**
   * Build, sign and STRICTLY publish `next` as the replacement event.
   *
   * `created_at` is monotonic against the base this transaction read, so a
   * second write in the same second cannot tie. Resolving means at least one
   * relay accepted the event; a timeout or unclassifiable error throws an
   * `InventoryTransactionError` whose reason says the publish is AMBIGUOUS,
   * never success.
   */
  publish(
    next: GameInventory,
    options?: BuildInventoryTemplateOptions,
  ): Promise<NostrEvent>;
}

/**
 * Run `body` as the only kind:31633 writer for this user, in this tab and
 * (where Web Locks exist) across tabs.
 *
 * The body decides what the transaction means; this function guarantees only
 * exclusivity, an authoritative base, lossless building, monotonic ordering
 * and strict publication.
 */
export async function runInventoryTransaction<T>(
  deps: InventoryTransactionDeps,
  body: (ctx: InventoryTransactionContext) => Promise<T>,
): Promise<T> {
  const { nostr, user } = deps;
  const now = deps.now ?? Date.now;
  if (!user?.pubkey || !user.signer) {
    throw new InventoryTransactionError('User is not logged in', 'not-logged-in');
  }
  const pubkey = user.pubkey;

  const { value } = await withQueuedCrossTabLock(
    inventoryWriteLockName(pubkey),
    () =>
      serializeInventoryWrite(pubkey, async (): Promise<T> => {
        let base: InventoryWithMeta | null = null;

        const readBase = async (): Promise<InventoryWithMeta> => {
          if (base) return base;
          try {
            base = await readAuthoritativeInventoryBase(nostr, pubkey);
          } catch (error) {
            throw new InventoryTransactionError(
              error instanceof Error ? error.message : 'Inventory read failed',
              'read-failed',
              error,
            );
          }
          return base;
        };

        const publish = async (
          next: GameInventory,
          options?: BuildInventoryTemplateOptions,
        ): Promise<NostrEvent> => {
          // Publishing without having read the base would be exactly the
          // stale-replacement defect this primitive exists to prevent.
          const meta = await readBase();
          const template = buildInventoryTemplate(next, options);
          const tags = [...template.tags];
          if (!tags.some(([name]) => name === 'client')) tags.push(['client', 'blobbi']);

          let signed: NostrEvent;
          try {
            signed = await user.signer.signEvent({
              kind: template.kind,
              content: template.content ?? '',
              tags,
              created_at: nextInventoryCreatedAt(now(), meta.createdAt),
            });
          } catch (error) {
            throw new InventoryTransactionError(
              error instanceof Error ? error.message : 'The signer refused',
              'sign-failed',
              error,
            );
          }

          try {
            await nostr.event(signed, {
              signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
            });
          } catch (error) {
            const isTimeout =
              error instanceof Error &&
              (error.name === 'AbortError' || error.name === 'TimeoutError');
            throw new InventoryTransactionError(
              error instanceof Error ? error.message : 'The publish failed',
              isTimeout ? 'publish-timeout' : 'publish-unknown',
              error,
            );
          }
          return signed;
        };

        return body({ pubkey, readBase, publish });
      }),
  );
  return value;
}
