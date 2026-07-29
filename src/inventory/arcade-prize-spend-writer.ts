/**
 * The Prize Counter's ONE write into the player's inventory: spending Arcade
 * Tickets.
 *
 * The mirror image of `arcade-reward-writer.ts`, built to the same rules for
 * the same reasons — a spend is a grant with the sign flipped, and it inherits
 * every failure mode the reward boundary was rebuilt around:
 *
 * ```
 *   read the FRESHEST kind:31633 from the relay      ← never the React cache
 *   → refuse when held < price                        ← no negative balances, ever
 *   → applyMutation({ type: 'remove', … })            ← the canonical helper
 *   → buildInventoryTemplate(next)                    ← the canonical builder
 *   → sign
 *   → nostr.event(…) with a 5 s timeout, STRICTLY     ← a timeout is NOT success
 * ```
 *
 * Every step is the same code path `useInventoryMutation` uses, so a spend
 * preserves every unrelated item, rejects negative and non-integer amounts,
 * and omits zero-quantity entries exactly as every other inventory write does.
 * There is no optimistic update here: the caller must not show a spent balance
 * until the read-back confirms it.
 *
 * ## What is deliberately NOT here
 *
 * Prize ownership. Spending tickets and delivering a prize are different
 * writes to different stores with different trust levels, and this module only
 * knows how to turn a price into a smaller balance. kind:11125 (coins, legacy
 * storage) is never read or written.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { NUser } from '@nostrify/react/login';

import type { ArcadePrizeRedemption } from '@/arcade/prizes/prize-redemption';
import { ARCADE_TICKET_D, officialItemAddress } from '@/protocol/event-registry';

import { applyMutation, buildInventoryTemplate, getQuantity } from './useInventoryMutation';
import { fetchInventory } from './useIslandInventory';
import type { GameInventory } from './package';

/** Canonical Arcade Ticket address — derived, never a literal. */
const TICKET_ADDRESS = officialItemAddress(ARCADE_TICKET_D);

const RELAY_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 3000;

/** The slice of `useNostr()` this module needs. Narrow, so a fake is trivial. */
export interface PrizeSpendNostr {
  query: (
    filters: { kinds: number[]; authors: string[]; '#d': string[]; limit?: number }[],
    options: { signal: AbortSignal },
  ) => Promise<NostrEvent[]>;
  event: (event: NostrEvent, options?: { signal?: AbortSignal }) => Promise<void>;
}

/**
 * The spend capability the redemption hook holds — an interface, so the DEV
 * harness and the tests can substitute one that never touches a relay, and so
 * a future grant/redemption protocol can replace the implementation behind the
 * same boundary.
 */
export interface ArcadePrizeSpendWriter {
  /**
   * Publish the ticket spend STRICTLY — a timeout or abort MUST reject.
   * Resolving on timeout is the exact defect this boundary exists to forbid.
   */
  spendTickets(redemption: ArcadePrizeRedemption): Promise<void>;
  /** Re-read the canonical inventory. `null` means the READ failed. */
  readTicketQuantity(): Promise<number | null>;
}

/**
 * Thrown for problems whose timing is PROVABLE — every reason here means
 * "this happened before the event could reach a relay", which is what lets
 * the redemption machine mark the attempt retryable instead of unresolved.
 * A failure that cannot prove its timing is thrown raw and classified as
 * possibly-published.
 */
export class ArcadePrizeSpendError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'not-logged-in'
      | 'invalid-price'
      | 'insufficient-tickets'
      | 'sign-failed'
      | 'publish-rejected',
  ) {
    super(message);
    this.name = 'ArcadePrizeSpendError';
  }
}

export interface ArcadePrizeSpendWriterDeps {
  readonly nostr: PrizeSpendNostr;
  readonly user: Pick<NUser, 'pubkey' | 'signer'>;
}

/** Build the spend writer for one signed-in user. A factory, not a hook. */
export function createArcadePrizeSpendWriter(
  deps: ArcadePrizeSpendWriterDeps,
): ArcadePrizeSpendWriter {
  const { nostr, user } = deps;

  const readInventory = (): Promise<GameInventory> =>
    fetchInventory(
      nostr as unknown as Parameters<typeof fetchInventory>[0],
      user.pubkey,
      AbortSignal.timeout(READ_TIMEOUT_MS),
    );

  return {
    async spendTickets(redemption: ArcadePrizeRedemption): Promise<void> {
      if (!user?.pubkey || !user.signer) {
        throw new ArcadePrizeSpendError('User is not logged in', 'not-logged-in');
      }
      if (!Number.isInteger(redemption.price) || redemption.price <= 0) {
        throw new ArcadePrizeSpendError(
          `Refusing to spend ${redemption.price} tickets`,
          'invalid-price',
        );
      }

      // Read-modify-write against the authoritative newest event. A stale
      // React cache as the write base is how an inventory gets clobbered.
      const base = await readInventory();
      const held = getQuantity(base, TICKET_ADDRESS);
      if (held < redemption.price) {
        // Provably pre-publish: nothing was sent, and no balance may ever go
        // negative — the freshest read is the last word.
        throw new ArcadePrizeSpendError(
          `Holding ${held} tickets; ${redemption.price} needed`,
          'insufficient-tickets',
        );
      }
      const next = applyMutation(base, {
        type: 'remove',
        address: TICKET_ADDRESS,
        amount: redemption.price,
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
        throw new ArcadePrizeSpendError(
          error instanceof Error ? error.message : 'The signer refused',
          'sign-failed',
        );
      }

      // STRICT: `NPool.event` rejects only when every relay fails, so resolving
      // means at least one relay accepted it. A timeout is NOT resolved through
      // as "probably fine".
      await nostr.event(signed, { signal: AbortSignal.timeout(RELAY_TIMEOUT_MS) });
    },

    async readTicketQuantity(): Promise<number | null> {
      try {
        const inventory = await readInventory();
        return getQuantity(inventory, TICKET_ADDRESS);
      } catch {
        // A failed READ is not a failed write.
        return null;
      }
    },
  };
}
