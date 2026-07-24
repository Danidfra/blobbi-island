/**
 * Blobbi Island — Inventory protocol constants.
 *
 * These are Island-level constants for the clean kind:31632 / kind:31633
 * inventory architecture built on top of `@nostr-games/inventory`.
 *
 * NOTHING here is a re-implementation of the package. The package remains the
 * single source of truth for parsing, validation, building, addressing,
 * quantities, and duplicate handling. This file only holds Island-specific
 * facts: the official issuer, the official relays, and the canonical inventory
 * `d` value.
 */

/**
 * Official Blobbi item issuer.
 *
 * All canonical kind:31632 Game Item Definitions for Blobbi are signed by this
 * pubkey. Definitions from any other author MUST be rejected by the catalog.
 *
 * npub: npub1nmac6vz9hf6n7dny65pnpz6f0qe4dvn2d405h9ztltzz8xh7vw5sg0wu5e
 */
export const OFFICIAL_ITEM_ISSUER_PUBKEY =
  '9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9';

/**
 * Relays that are known to carry the official Blobbi item definitions.
 *
 * The catalog query connects to these directly (in addition to the app's
 * currently-configured relay) so definitions resolve even if the user's
 * selected relay does not carry them. This is a relay-orchestration concern
 * that the framework-free package intentionally does not handle.
 */
export const OFFICIAL_ITEM_RELAYS: readonly string[] = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
];

/**
 * Canonical Blobbi Island inventory identity (the kind:31633 `d` tag value).
 *
 * Rationale for a single, stable, per-user inventory `d`:
 * - The `@nostr-games/inventory` spec models kind:31633 as an addressable event
 *   `31633:<owner>:<d>`; the `d` scopes the inventory. The package does not
 *   mandate a specific value.
 * - Blobbi Island is a single game context. Players have exactly one Island
 *   consumable inventory, so a single fixed `d` keeps every mutation targeting
 *   the same replaceable event (newest-wins), which is the simplest correct
 *   model and avoids fragmenting quantities across multiple `d` values.
 * - The value uses the recommended `namespace:context` shape and the `blobbi`
 *   namespace already used by the official item `d` tags (`blobbi:food:apple`),
 *   keeping Island data clearly namespaced on relays.
 *
 * If a future feature needs multiple inventories (e.g. per-island or bank), it
 * should introduce additional explicit `d` values rather than overloading this
 * one.
 */
export const ISLAND_INVENTORY_D = 'blobbi:island';

/** Optional human-readable `name` tag written on the Island inventory event. */
export const ISLAND_INVENTORY_NAME = 'Blobbi Island Inventory';

/**
 * NIP-31 style alt text for the inventory event, for generic clients.
 */
export const ISLAND_INVENTORY_ALT =
  'Blobbi Island player inventory (kind:31633)';
