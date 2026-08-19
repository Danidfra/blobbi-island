/**
 * Blobbi Island — canonical kind:31633 inventory write API (Phases 5 & 6).
 *
 * This is the SINGLE mutation layer for the Island inventory. All quantity math
 * is delegated to `@nostr-games/inventory` helpers (add/remove/set/get); this
 * module only orchestrates relay reads, signing, publication, cache updates,
 * optimistic UI, and rollback.
 *
 * Concurrency model
 * -----------------
 * Every mutation reads a FRESH inventory from the relay immediately before
 * building the next event (read-modify-write against the authoritative newest
 * event), rather than trusting a possibly-stale or empty cache snapshot. This
 * prevents a missing/empty cache from clobbering an existing relay inventory
 * with an empty event, and prevents stale full-replacement.
 *
 * Mutations are serialized per-user via an in-module promise chain so two rapid
 * actions (e.g. double-consuming the final unit) cannot both read the same
 * starting quantity and both succeed. The Coin wallet and the Arcade Ticket
 * writers ride the SAME chain (see `inventory-transaction.ts`), so no two
 * kind:31633 writers in this tab can interleave their read-modify-write
 * windows.
 *
 * Optimistic UI updates the canonical inventory cache immediately and rolls back
 * on signing/publication failure. There is NO relay rollback after a successful
 * publish (replaceable events cannot be un-published); a post-settlement
 * invalidation reconciles with the relay.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

import {
  type GameInventory,
  type DuplicateStrategy,
  ISLAND_INVENTORY_D,
  ISLAND_INVENTORY_NAME,
  ISLAND_INVENTORY_ALT,
  KIND_GAME_INVENTORY,
  GRANT_MARKER,
  addInventoryItemQuantity,
  removeInventoryItemQuantity,
  setInventoryItemQuantity,
  getInventoryItemQuantity,
  buildGameInventoryEvent,
  parseGameItemAddress,
} from './package';
import { getInventoryItems } from './protocol-adapter';
import {
  inventoryQueryKey,
  buildEmptyInventory,
  readAuthoritativeInventoryBase,
} from './useIslandInventory';

// --- Per-user serialization ------------------------------------------------

const mutationChains = new Map<string, Promise<unknown>>();

/**
 * Serialize an inventory write on the shared per-user chain. Exported so the
 * Coin wallet's strict writes ride the SAME chain as ordinary inventory
 * mutations — a coin grant and a shop purchase in one tab can never
 * interleave their read-modify-write windows.
 */
export function serializeInventoryWrite<T>(
  pubkey: string,
  task: () => Promise<T>,
): Promise<T> {
  return serialize(pubkey, task);
}

function serialize<T>(pubkey: string, task: () => Promise<T>): Promise<T> {
  const prev = mutationChains.get(pubkey) ?? Promise.resolve();
  const next = prev.then(task, task);
  // Keep the chain alive but swallow errors so one failure doesn't block later
  // mutations.
  mutationChains.set(
    pubkey,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

// --- Pure inventory transforms (delegating to the package) -----------------

/** Read quantity for an address (0 when absent). */
export function getQuantity(inventory: GameInventory, address: string): number {
  return getInventoryItemQuantity(inventory, address);
}

/** Do we hold at least `amount` of `address`? */
export function hasQuantity(
  inventory: GameInventory,
  address: string,
  amount: number,
): boolean {
  return getInventoryItemQuantity(inventory, address) >= amount;
}

function assertValidAmount(amount: number, label: string): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`${label} must be an integer (got ${amount})`);
  }
  if (amount < 0) {
    throw new Error(`${label} must not be negative (got ${amount})`);
  }
}

function assertValidAddress(address: string): void {
  if (!parseGameItemAddress(address)) {
    throw new Error(`Invalid kind:31632 item address: ${address}`);
  }
}

// --- Lossless template building --------------------------------------------

/**
 * Tag names the canonical builder OWNS on every Island write. `d`, `context`,
 * `name` and `alt` are rebuilt from the parsed inventory / Island constants;
 * every `a` tag is the item representation; `e` tags carrying the `grant`
 * marker are rebuilt from `inventory.grants`. Reproducing any of these through
 * the foreign-tag passthrough would emit duplicates (the package builder
 * rejects them from `extraTags` for exactly that reason).
 *
 * `client` is also excluded: every Island publish path re-adds its own
 * `['client', 'blobbi']` when absent, so passing the previous event's tag
 * through would either duplicate it or pin a foreign client's attribution.
 */
function isForeignInventoryTag(tag: readonly string[]): boolean {
  const name = tag[0];
  if (!name) return false;
  if (name === 'd' || name === 'context' || name === 'name' || name === 'alt') {
    return false;
  }
  if (name === 'a') return false;
  if (name === 'e' && tag[3] === GRANT_MARKER) return false;
  if (name === 'client') return false;
  return true;
}

/**
 * Extract every tag on the inventory's source event that the canonical builder
 * does not own — unknown/forward-compatible tags (including the economy
 * allocation marker and non-grant `e` tags). These MUST ride through every
 * rewrite verbatim: kind:31633 is a replaceable event, so a write that drops
 * them destroys other clients' (and our own markers') data permanently.
 */
export function extractForeignInventoryTags(
  inventory: GameInventory,
): string[][] {
  const tags = inventory.event?.tags ?? [];
  return tags.filter(isForeignInventoryTag).map((tag) => [...tag]);
}

/**
 * Deduplicate exactly-equal tag tuples, keeping first occurrence order. Two
 * byte-identical unknown tags carry no more information than one, and this is
 * what keeps repeated rewrites (and a preserved marker plus a freshly-added
 * one) from accumulating copies.
 */
function dedupeExactTags(tags: readonly (readonly string[])[]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const tag of tags) {
    const key = JSON.stringify(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([...tag]);
  }
  return out;
}

export interface BuildInventoryTemplateOptions {
  duplicateStrategy?: DuplicateStrategy;
  /**
   * Additional forward-compatible tags for THIS write (e.g. the economy
   * allocation marker). Merged with the preserved foreign tags and deduplicated
   * exactly, so adding a tag that is already present is a no-op.
   */
  extraTags?: readonly (readonly string[])[];
}

/**
 * Build a signed-and-publishable kind:31633 event template from a
 * `GameInventory`, using the package builder (which emits zero-quantity
 * omission, deterministic ordering, and duplicate resolution).
 *
 * The build is LOSSLESS for everything this client does not own: `content`,
 * `context` tags, grant references, and unknown/forward-compatible tags from
 * the parsed source event all ride through unchanged. Only items (from the
 * mutated inventory), the Island's own `name`/`alt`, and the caller's
 * `extraTags` are (re)written.
 */
export function buildInventoryTemplate(
  inventory: GameInventory,
  options: BuildInventoryTemplateOptions = {},
) {
  return buildGameInventoryEvent({
    id: ISLAND_INVENTORY_D,
    name: ISLAND_INVENTORY_NAME,
    alt: ISLAND_INVENTORY_ALT,
    contexts: inventory.contexts,
    grants: inventory.grants.map((grant) => ({
      eventId: grant.eventId,
      relay: grant.relay || undefined,
    })),
    // Raw content string passes through `serializeContent` verbatim.
    content: inventory.content,
    items: getInventoryItems(inventory).map((i) => ({
      address: i.address,
      relay: i.relay || undefined,
      quantity: i.quantity,
    })),
    extraTags: dedupeExactTags([
      ...extractForeignInventoryTags(inventory),
      ...(options.extraTags ?? []),
    ]),
    duplicateStrategy: options.duplicateStrategy ?? 'last',
  });
}

// --- Mutation kinds --------------------------------------------------------

/** A single grant line within a batch inventory mutation. */
export interface InventoryBatchLine {
  address: string;
  /** Positive integer units to add. */
  amount: number;
  relay?: string;
}

/** One absolute-quantity target within a `set-many` mutation. */
export interface InventorySetTarget {
  address: string;
  /** Non-negative integer. Zero removes the entry (package-canonical). */
  quantity: number;
  relay?: string;
}

export type InventoryMutation =
  | { type: 'add'; address: string; amount: number; relay?: string }
  | { type: 'remove'; address: string; amount: number }
  | { type: 'set'; address: string; quantity: number; relay?: string }
  | { type: 'consume'; address: string }
  | { type: 'purchase'; address: string; units: number; relay?: string }
  | { type: 'batch'; lines: InventoryBatchLine[] }
  /**
   * Set SEVERAL absolute quantities in ONE canonical publish.
   *
   * The Inventory & Equipment Lab's bulk actions ("add all official effects",
   * "remove all official wearables") fold their targets through this so a
   * sixteen-item change is one replaceable-event write, never sixteen racing
   * ones. Only the listed addresses move; every unrelated entry and unknown
   * field rides through the package builder untouched.
   */
  | { type: 'set-many'; targets: InventorySetTarget[] }
  | { type: 'replace'; inventory: GameInventory };

/**
 * Apply a mutation to a base inventory purely (no I/O). All quantity math is
 * performed by the package helpers.
 */
export function applyMutation(
  base: GameInventory,
  mutation: InventoryMutation,
): GameInventory {
  switch (mutation.type) {
    case 'add':
      assertValidAddress(mutation.address);
      assertValidAmount(mutation.amount, 'add amount');
      return addInventoryItemQuantity(
        base,
        mutation.address,
        mutation.amount,
        mutation.relay,
      );
    case 'purchase':
      assertValidAddress(mutation.address);
      assertValidAmount(mutation.units, 'purchase units');
      if (mutation.units < 1) {
        throw new Error('purchase units must be at least 1');
      }
      return addInventoryItemQuantity(
        base,
        mutation.address,
        mutation.units,
        mutation.relay,
      );
    case 'remove':
      assertValidAddress(mutation.address);
      assertValidAmount(mutation.amount, 'remove amount');
      return removeInventoryItemQuantity(base, mutation.address, mutation.amount);
    case 'consume': {
      assertValidAddress(mutation.address);
      const held = getInventoryItemQuantity(base, mutation.address);
      if (held < 1) {
        throw new Error('Cannot consume: item quantity is zero');
      }
      return removeInventoryItemQuantity(base, mutation.address, 1);
    }
    case 'set':
      assertValidAddress(mutation.address);
      assertValidAmount(mutation.quantity, 'set quantity');
      return setInventoryItemQuantity(
        base,
        mutation.address,
        mutation.quantity,
        mutation.relay,
      );
    case 'batch': {
      // Apply EVERY line to a single snapshot, folding through the package's
      // add helper (which enforces integer/non-negative and overflows past
      // Number.MAX_SAFE_INTEGER). Lines must be pre-normalized/merged by the
      // caller, but folding is safe either way because add is additive.
      if (mutation.lines.length === 0) {
        throw new Error('batch mutation requires at least one line');
      }
      return mutation.lines.reduce((acc, line) => {
        assertValidAddress(line.address);
        assertValidAmount(line.amount, 'batch line amount');
        if (line.amount < 1) {
          throw new Error('batch line amount must be at least 1');
        }
        return addInventoryItemQuantity(
          acc,
          line.address,
          line.amount,
          line.relay,
        );
      }, base);
    }
    case 'set-many': {
      if (mutation.targets.length === 0) {
        throw new Error('set-many mutation requires at least one target');
      }
      const seen = new Set<string>();
      return mutation.targets.reduce((acc, target) => {
        assertValidAddress(target.address);
        assertValidAmount(target.quantity, 'set-many quantity');
        if (seen.has(target.address)) {
          // Two targets for one address is a caller bug, not a fold order to
          // silently resolve.
          throw new Error(`set-many has a duplicate target: ${target.address}`);
        }
        seen.add(target.address);
        return setInventoryItemQuantity(
          acc,
          target.address,
          target.quantity,
          target.relay,
        );
      }, base);
    }
    case 'replace':
      return mutation.inventory;
    default: {
      const _exhaustive: never = mutation;
      throw new Error(`Unknown mutation ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * The canonical inventory mutation hook.
 *
 * Returns a mutation that:
 * - snapshots + optimistically updates the canonical inventory cache;
 * - serializes per-user to avoid double-spend / stale clobbering;
 * - reads the FRESH relay inventory as the base (never a stale/empty cache);
 * - validates quantities via the package (rejects negative/non-integer/overflow);
 * - builds + signs + publishes a kind:31633 event through existing infra;
 * - rolls back the cache on failure;
 * - invalidates only the canonical inventory key after settlement.
 *
 * It does NOT publish kind:11125.
 */
export function useInventoryMutation() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mutation: InventoryMutation): Promise<GameInventory> => {
      if (!user?.pubkey) {
        throw new Error('User not logged in');
      }
      const pubkey = user.pubkey;

      return serialize(pubkey, async () => {
        // Read-modify-write against the authoritative newest relay event.
        // The AUTHORITATIVE base. kind:31633 is REPLACEABLE, so building on a
        // resolved-empty answer from a relay that simply does not carry the
        // event would not lose one item — it would erase the player's whole
        // inventory, Coins and Arcade Tickets included. The empty answer is
        // confirmed by a second read before it may be used.
        const { inventory: base } = await readAuthoritativeInventoryBase(
          nostr,
          pubkey,
        );

        const next = applyMutation(base, mutation);
        const template = buildInventoryTemplate(next);

        await publish(template);

        // Return a client-side representation with the owner set, so callers
        // and the cache reflect the just-published state.
        return next;
      });
    },
    onMutate: async (mutation): Promise<{ previous?: GameInventory }> => {
      if (!user?.pubkey) return {};
      const key = inventoryQueryKey(user.pubkey);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<GameInventory>(key);

      // Optimistically apply to the current cache snapshot (or an empty base).
      const base = previous ?? buildEmptyInventory(user.pubkey);
      try {
        const optimistic = applyMutation(base, mutation);
        queryClient.setQueryData<GameInventory>(key, optimistic);
      } catch {
        // Invalid mutation (e.g. consume with zero) — leave cache untouched;
        // the mutationFn will throw and surface the error.
      }
      return { previous };
    },
    onError: (_err, _mutation, context) => {
      if (!user?.pubkey) return;
      // Roll back the optimistic cache update. No relay rollback is possible or
      // attempted.
      if (context && 'previous' in context) {
        queryClient.setQueryData(
          inventoryQueryKey(user.pubkey),
          context.previous,
        );
      }
    },
    onSettled: () => {
      if (!user?.pubkey) return;
      // Reconcile with the relay after the write settles.
      queryClient.invalidateQueries({
        queryKey: inventoryQueryKey(user.pubkey),
      });
    },
  });
}

/** Convenience: is the given address a valid kind:31632 coordinate? */
export function isItemAddress(address: string): boolean {
  return Boolean(parseGameItemAddress(address));
}

export { KIND_GAME_INVENTORY };
