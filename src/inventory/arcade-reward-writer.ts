/**
 * The arcade's ONE write into the player's inventory.
 *
 * This is the implementation of `ArcadeRewardWriter`, the interface Phase 2
 * defined and deliberately left unimplemented. It lives in `src/inventory/`
 * rather than in `src/arcade/` for a structural reason, not a stylistic one:
 * `src/arcade/boundaries.test.ts` proves against the real import graph that no
 * module under `src/arcade/` can reach a relay or an inventory, and that
 * property is worth more than the convenience of keeping the arcade's files
 * together. The game computes a number; this module is the only thing that can
 * turn a number into a balance.
 *
 * ## What it does, in order
 *
 * ```
 *   read the FRESHEST kind:31633 from the relay      ← never the React cache
 *   → applyMutation({ type: 'add', address, amount })  ← the canonical helper
 *   → buildInventoryTemplate(next)                     ← the canonical builder
 *   → sign
 *   → nostr.event(…) with a 5 s timeout, STRICTLY      ← a timeout is a FAILURE
 * ```
 *
 * Every step after the read is the same code path `useInventoryMutation` uses,
 * so a ticket grant preserves unrelated item balances, rejects negative and
 * non-integer amounts, and omits zero-quantity entries exactly as every other
 * inventory write does. The two deliberate differences from
 * `useInventoryMutation` are both about honesty:
 *
 *  - **strict publish.** `useNostrPublish` swallows a 5-second timeout and
 *    resolves (correct for presence heartbeats, wrong for a one-shot grant of a
 *    scarce resource), so this signs and publishes locally instead — the same
 *    local-`strictPublish` pattern `useFirstEggAdoption` already established in
 *    this codebase.
 *  - **no optimistic update.** An optimistic balance is honest only when it is
 *    backed by a rollback, and here the caller must not show a number until the
 *    read-back confirms it.
 *
 * ## kind:11125 is never touched
 *
 * Coins live in the Blobbonaut profile and are a different currency with a
 * different lifecycle. Nothing here reads or writes them. The Arcade **Pass**
 * (temporary `sessionStorage` floor access) is not an item at all and has no
 * address, so it cannot be confused with the Arcade **Ticket** by construction.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import type { ArcadeRewardClaim, ArcadeRewardWriter } from '@/arcade/arcade-reward-boundary';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { fetchInventory } from './useIslandInventory';
import type { GameInventory } from './package';

/**
 * The canonical Arcade Ticket address, derived from the official issuer and the
 * canonical `d` — never written out as a literal.
 *
 * `31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:blobbi:currency:arcade-ticket`
 */
export const ARCADE_TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

/** Timeout for both the publish and the reads, in milliseconds. */
const RELAY_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 3000;

/** The slice of `useNostr()` this module needs. Narrow, so a fake is trivial. */
export interface RewardWriterNostr {
  query: (
    filters: { kinds: number[]; authors: string[]; '#d': string[]; limit?: number }[],
    options: { signal: AbortSignal },
  ) => Promise<NostrEvent[]>;
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface ArcadeRewardWriterDeps {
  readonly nostr: RewardWriterNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
  /** Overridable so a test can grant a different item without faking the registry. */
  readonly itemAddress?: string;
}

/**
 * Thrown for problems whose timing is PROVABLE.
 *
 * Every reason here means "this happened before the event could reach a relay",
 * which is what lets the claim boundary mark the attempt retryable instead of
 * unresolved. A failure that cannot prove its own timing must NOT be wrapped in
 * this class — it is thrown raw and classified as possibly-published.
 *
 * `publish-rejected` is the one reason the real writer never throws: proving
 * that no relay stored the event would need a per-relay OK/failure breakdown
 * that `NPool.event` does not surface (see the classifier in
 * `useArcadeReward.ts`). It exists so a writer that CAN prove it — the DEV
 * harness's fake, or a future client with a richer contract — has a way to say
 * so.
 */
export class ArcadeRewardWriterError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'invalid-quantity'
      | 'sign-failed'
      | 'publish-rejected',
  ) {
    super(message);
    this.name = 'ArcadeRewardWriterError';
  }
}

/**
 * Build the writer for one signed-in user.
 *
 * Deliberately a factory over explicit dependencies rather than a hook: the
 * publish/verify sequence is the part most worth testing, and testing it should
 * not require rendering anything.
 */
export function createArcadeTicketWriter(deps: ArcadeRewardWriterDeps): ArcadeRewardWriter {
  const { nostr, user } = deps;
  const itemAddress = deps.itemAddress ?? ARCADE_TICKET_ADDRESS;

  const readInventory = (): Promise<GameInventory> =>
    fetchInventory(
      // `fetchInventory` only calls `.query`, and typing this parameter as the
      // full Nostrify pool would force every test to construct one.
      nostr as unknown as Parameters<typeof fetchInventory>[0],
      user.pubkey,
      AbortSignal.timeout(READ_TIMEOUT_MS),
    );

  return {
    async publishTicketGrant(claim: ArcadeRewardClaim): Promise<void> {
      if (!user?.pubkey || !user.signer) {
        throw new ArcadeRewardWriterError('User is not logged in', 'not-logged-in');
      }
      if (!Number.isInteger(claim.tickets) || claim.tickets <= 0) {
        throw new ArcadeRewardWriterError(
          `Refusing to grant ${claim.tickets} tickets`,
          'invalid-quantity',
        );
      }

      // Read-modify-write against the authoritative newest event, exactly as the
      // canonical mutation layer does. A stale React cache as the write base is
      // how an inventory gets clobbered back to an older state.
      const base = await readInventory();
      const next = applyMutation(base, {
        type: 'add',
        address: itemAddress,
        amount: claim.tickets,
      });
      const template = buildInventoryTemplate(next);

      const tags = [...template.tags];
      if (!tags.some(([name]) => name === 'client')) tags.push(['client', 'blobbi']);

      let signed: NostrEvent;
      try {
        signed = await user.signer.signEvent({
          kind: template.kind,
          content: template.content ?? '',
          tags,
          created_at: Math.floor(Date.now() / 1000),
        });
      } catch (error) {
        throw new ArcadeRewardWriterError(
          error instanceof Error ? error.message : 'The signer refused',
          'sign-failed',
        );
      }

      // STRICT: `NPool.event` rejects only when every relay fails, so resolving
      // means at least one relay accepted it. A timeout is NOT resolved through
      // as "probably fine" — that is the defect this whole boundary exists for.
      await nostr.event(signed, { signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    },

    async readTicketQuantity(): Promise<number | null> {
      try {
        const inventory = await readInventory();
        return getQuantity(inventory, itemAddress);
      } catch {
        // A failed READ is not a failed write. Returning null lets the caller say
        // "we could not check" rather than "it did not happen".
        return null;
      }
    },
  };
}
