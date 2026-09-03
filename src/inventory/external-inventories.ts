/**
 * Blobbi Island — AUTHOR-WIDE kind:31633 discovery, and the read model for the
 * inventories this game does not own.
 *
 * ## The shape of the problem
 *
 * kind:31633 is addressable: `31633:<owner>:<d>`. The `d` scopes the inventory,
 * and the protocol deliberately declines to name a canonical one — a player has
 * as many inventories as the games they play give them, each one written by the
 * game that owns it. Blobbi Island owns and writes exactly one, `blobbi:island`
 * (`ISLAND_INVENTORY_D`). A harvest in another game credits THAT game's
 * inventory under the same player key.
 *
 * So the only way to find a player's other inventories is to stop asking about
 * a `d` you already know:
 *
 * ```
 *   { kinds: [31633], authors: [playerPubkey] }        ← this module
 *   { kinds: [31633], authors: [...], '#d': ['blobbi:island'] }
 *                                                      ← useIslandInventory
 * ```
 *
 * There is no list of expected contexts here, no `farm:main`, and no assumption
 * about how many answers come back. Whatever the player has authored is what
 * they have.
 *
 * ## READ ONLY, and structurally so
 *
 * This module imports nothing from the write layer — not `useInventoryMutation`,
 * not `inventory-transaction`, not the event builder — and exposes no way to
 * turn a `DiscoveredInventory` back into a publishable event. That is not a
 * convention; `inventory-write-topology.contract.test.ts` asserts it against
 * the real source tree.
 *
 * The reason is that kind:31633 is REPLACEABLE. A write does not patch an
 * inventory, it replaces the whole event. Two applications performing
 * read-modify-write on the same coordinate from different origins have no
 * shared lock (a Web Lock is same-origin), no compare-and-swap, and no revision
 * protocol they both honour — so the second writer silently discards the
 * first's work. Reading is safe and needs no coordination; writing needs
 * coordination semantics that do not exist yet.
 *
 * ## Foreign tags are not ours to read
 *
 * A discovered inventory may carry tags this client does not model — a
 * `revision` counter, `e` markers another game uses for harvest idempotency,
 * anything else. This module surfaces the item references and the inventory's
 * own identity and contexts, and interprets nothing else. Unmanaged tags are
 * another application's private bookkeeping; guessing at their meaning is how
 * two clients end up disagreeing about state neither of them owns.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { readRelayEventsOrThrow, type RelayReader } from '@/lib/relay-read';

import {
  ISLAND_INVENTORY_D,
  KIND_GAME_INVENTORY,
  type GameInventory,
  type GameInventoryFoldReference,
} from './package';
import { getInventoryItems, parseInventoryEvent } from './protocol-adapter';

/** One item reference inside a discovered inventory. */
export interface DiscoveredInventoryItem {
  /** The FULL kind:31632 address `31632:<issuer>:<d>`. The only identity. */
  address: string;
  /** The `a` tag's relay hint, or `''`. Advisory; never an authorization. */
  relay: string;
  /** Positive integer quantity, as the package resolved it. */
  quantity: number;
}

/**
 * A kind:31633 inventory owned by the player and written by somebody else.
 *
 * Carries its PROVENANCE — which inventory context it is — because that is
 * what lets the UI show where an item lives without merging anything, and what
 * makes "Blobbi does not write this one" expressible at all.
 */
export interface DiscoveredInventory {
  /** The `d` tag value: the inventory context id, e.g. `farm:main`. */
  id: string;
  /** The full addressable coordinate `31633:<owner>:<d>`. */
  address: string;
  /** The event author, who is also the owner. */
  owner: string;
  /** Every `context` tag value, verbatim. Display/diagnostics only. */
  contexts: readonly string[];
  /** `created_at` of the event this was selected from. */
  createdAt: number;
  /**
   * Item references AS THE SNAPSHOT DECLARES THEM, in the event's own tag
   * order. These are the owner's last consolidated quantities, not the
   * effective balance: kind:1416 spends other games published may already
   * have debited them. `external-inventory-state.ts` derives the effective
   * quantities; nothing should treat these as spendable.
   */
  items: readonly DiscoveredInventoryItem[];
  /**
   * The snapshot's kind:1417 fold reference, when it carries one. A snapshot
   * without one has folded nothing: every valid spend against it is pending.
   */
  fold?: GameInventoryFoldReference;
  /**
   * The parsed package inventory the fields above were read from — the exact
   * object `resolveGameInventoryState` needs. Exposed so the derivation can be
   * handed the snapshot without re-parsing the event.
   */
  snapshot: GameInventory;
}

export interface SelectInventoriesOptions {
  /**
   * Inventory ids to leave out. Defaults to `[ISLAND_INVENTORY_D]`: Blobbi's
   * own inventory has a canonical reader (`useIslandInventory`) with its own
   * confirmed-empty rule, publish-base semantics and cache, and a second
   * opinion about it would be a regression, not a feature.
   */
  exclude?: readonly string[];
  /** When set, only events authored by this pubkey are considered. */
  owner?: string;
}

/**
 * Choose the newest VALID event for EACH inventory context.
 *
 * Three properties, each of which has a test:
 *
 * 1. **Per context, independently.** One `d` answering badly must not affect
 *    another. A malformed `farm:main` cannot hide a good `guild:chest`.
 * 2. **Parse before compare.** An event that does not parse is not an
 *    inventory at any age, so it is discarded before the recency comparison
 *    rather than winning it — otherwise a newer broken event would shadow an
 *    older good one and the player's items would vanish.
 * 3. **Deterministic ties.** Equal `created_at` resolves to the lexicographically
 *    lowest event id, which is NIP-01's own rule for replaceable events, so two
 *    clients reading the same relay agree on the same answer.
 */
export function selectNewestInventoryPerContext(
  events: readonly NostrEvent[],
  options: SelectInventoriesOptions = {},
): DiscoveredInventory[] {
  const exclude = new Set(options.exclude ?? [ISLAND_INVENTORY_D]);

  const best = new Map<string, { event: NostrEvent; inventory: DiscoveredInventory }>();

  for (const event of events) {
    if (event.kind !== KIND_GAME_INVENTORY) continue;
    if (options.owner !== undefined && event.pubkey !== options.owner) continue;

    // Parse FIRST. `parseInventoryEvent` is the package's permissive parser
    // with the recommended `last` duplicate strategy — the same one the Island
    // inventory uses, so both readers agree about what an inventory is.
    const parsed = parseInventoryEvent(event);
    if (!parsed) continue;
    if (exclude.has(parsed.id)) continue;

    const previous = best.get(parsed.id);
    if (previous && !isNewer(event, previous.event)) continue;

    best.set(parsed.id, {
      event,
      inventory: {
        id: parsed.id,
        address: parsed.address,
        owner: parsed.owner,
        contexts: [...parsed.contexts],
        createdAt: event.created_at,
        items: getInventoryItems(parsed).map((item) => ({
          address: item.address,
          relay: item.relay,
          quantity: item.quantity,
        })),
        ...(parsed.fold ? { fold: parsed.fold } : {}),
        snapshot: parsed,
      },
    });
  }

  // Stable order by context id, so a render never reshuffles because two
  // relays answered in a different order.
  return [...best.values()]
    .map((entry) => entry.inventory)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** NIP-01 replaceable-event precedence: newer wins; on a tie, the lower id. */
function isNewer(candidate: NostrEvent, incumbent: NostrEvent): boolean {
  if (candidate.created_at !== incumbent.created_at) {
    return candidate.created_at > incumbent.created_at;
  }
  return candidate.id < incumbent.id;
}

/** Every kind:31632 address referenced across the given inventories, deduped. */
export function referencedItemAddresses(
  inventories: readonly DiscoveredInventory[],
): DiscoveredInventoryItem[] {
  const seen = new Map<string, DiscoveredInventoryItem>();
  for (const inventory of inventories) {
    for (const item of inventory.items) {
      const existing = seen.get(item.address);
      // Keep the first relay hint seen; a later blank one must not erase it.
      if (existing && (existing.relay !== '' || item.relay === '')) continue;
      seen.set(item.address, item);
    }
  }
  return [...seen.values()];
}

const DISCOVERY_READ_TIMEOUT_MS = 3000;

/**
 * Fetch every kind:31633 inventory the player has authored, minus Blobbi's own.
 *
 * Uses the single-read primitive rather than the confirmed-empty one: nothing
 * is ever PUBLISHED from this answer, so an empty result is only ever a missing
 * row in a grid, never a replacement event built on a false premise. An
 * unusable read still throws `RelayReadUnknownError`, which leaves React
 * Query's last good answer on screen instead of blanking the player's items.
 */
export async function fetchExternalInventories(
  nostr: RelayReader,
  pubkey: string,
  options: { signal?: AbortSignal } = {},
): Promise<DiscoveredInventory[]> {
  const events = await readRelayEventsOrThrow(
    nostr,
    [{ kinds: [KIND_GAME_INVENTORY], authors: [pubkey] }],
    { signal: options.signal, timeoutMs: DISCOVERY_READ_TIMEOUT_MS },
  );
  return selectNewestInventoryPerContext(events, { owner: pubkey });
}
