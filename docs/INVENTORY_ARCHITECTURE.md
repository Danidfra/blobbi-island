# Blobbi Island — Inventory Architecture (kind:31632 / kind:31633)

Status: clean implementation on top of `@nostr-games/inventory@0.1.0`.
This document describes the new inventory foundation. It replaces the legacy
kind:11125 `storage` consumable inventory. It is **not** a migration: no legacy
inventory data is copied, and no dual-read / dual-write exists.

## Sources of truth

- **Item catalog:** official **kind:31632** Game Item Definitions signed by the
  official issuer.
- **Player inventory:** **kind:31633** Game Inventory events owned by the user.
- **Protocol logic:** `@nostr-games/inventory` owns all parsing, validation,
  building, addressing, quantities, duplicate handling, parse modes, and
  result/error types. Island never re-implements these.
- **Island code** owns UI, relay orchestration, gameplay, optimistic updates,
  shops, item effects, and interaction flows.
- **kind:11125** remains valid for non-inventory profile data only (coins,
  owned pets, current companion, achievements, profile metadata, Ditto tags).
  **Inventory is never written into 11125.**

## Official issuer

- npub: `npub1nmac6vz9hf6n7dny65pnpz6f0qe4dvn2d405h9ztltzz8xh7vw5sg0wu5e`
- hex: `9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9`

Definitions from any other author are rejected by the catalog
(`parseOfficialItemDefinition`).

## Official item relays

The catalog queries these directly (in addition to the app's configured relay):

- `wss://relay.ditto.pub`
- `wss://relay.dreamith.to`

Relay orchestration note: the shared `NPool` routes every query to a single
configured relay, so the catalog hook opens short-lived direct `NRelay1`
connections to the official relays to fetch definitions. This is intentional
orchestration the framework-free package does not handle.

## Item-address registry

The canonical identity of an item is its full kind:31632 address
`31632:<issuer>:<d>`. The legacy `itemId` (e.g. `food_apple`) is a
compatibility/UI identifier only; the item `name` is never identity.

- Canonical source: **`src/protocol/event-registry.ts`** — the single
  machine-readable registry of every application event kind and every official
  item. `src/inventory/registry.ts`, `catalog-fallback.ts`, `shop-catalog.ts` and
  the generated `docs/protocol/blobbi-island-event-registry.md` are all
  projections of it, so they cannot drift apart.
- Registry projection: `src/inventory/registry.ts` (addresses + id maps for the
  19 published consumables plus the reserved `blobbi:currency:arcade-ticket`).
- **Prices are NOT in the protocol registry.** A coin price is Island-local
  economy configuration with its own lifecycle (balancing, promotions, a future
  ticket currency), not a kind:31632 definition fact. `src/inventory/shop-catalog.ts`
  owns the coin price table and **validates it against the canonical registry at
  module load**: a duplicate entry, a price for an unregistered item, a price for
  a non-consumable category, or a non-positive-integer price all throw. A
  separate domain, not a drifting duplicate.
- Purchasability is separate from recognition: an official item with no price
  entry is not for sale, and `priceForAddress` returns `null` (never `0`), so
  `usePurchaseItem` rejects it.
- Deterministic maps: `itemIdToAddress`, `addressToItemId`, `dTagToAddress`.
- Addresses are built with the package's `buildGameItemAddress`, so they cannot
  drift from the issuer constant.

## 31632 resolution and fallback

Resolution order per address (`resolveItemDefinition`):

1. valid fetched kind:31632 definition (issuer-enforced, package-parsed);
2. bundled canonical fallback (`src/inventory/catalog-fallback.ts`) by address —
   the EXACT currently-published effects/action/stages/emoji/category/topics;
3. generic unknown-item model.

Visual resolution order: definition `image` tag → definition JSON `emoji` →
bundled itemId→emoji fallback → generic `📦`.

A definition may carry several `image` tags — an unmarked primary plus
pose-specific views (`front`, `back`, `side-*`, `diagonal-*`). The resolved model
keeps the whole ordered collection in `images`, and `image` remains the primary.
Which one a given context shows — compact UI always takes the primary, a posed
Blobbi takes its `front`/`back` view — is specified in
[docs/game-item-image-views.md](./game-item-image-views.md).

The bundled fallback keeps the game fully playable when relays are unavailable;
the catalog query always resolves (never blocks on a fetch). No automatic
republication is performed and no private key is bundled.

## 31633 inventory identity

- **`d` value: `blobbi:island`** (`ISLAND_INVENTORY_D`).
- **Rationale:** one stable, per-user inventory. Blobbi Island is a single game
  context; a fixed `d` keeps every mutation targeting the same replaceable event
  (newest-wins) and avoids fragmenting quantities across multiple `d` values.
  The value uses the `blobbi` namespace already used by the item `d` tags. The
  package spec does not mandate a value; a single `d` is the simplest correct
  model. Future multi-inventory features should add new explicit `d` values.

The protocol inventory representation stays **address-based**
(`GameInventory` with `31632:<issuer>:<d>` item addresses). The Island view
model (`IslandInventoryEntry`) joins each address to its resolved definition and
legacy itemId for the UI.

## Ownership boundaries

- `@nostr-games/inventory` — protocol.
- `src/inventory/*` — Island adapter, catalog, read/write hooks, shop, flows.
- `src/inventory/package.ts` — the single import surface for the package.
- kind:11125 profile parsing/writing (`src/lib/blobbi-parsers.ts`) — retained
  for non-inventory fields only.

## Mutation flow

Single canonical mutation layer: `useInventoryMutation` (`add`, `remove`, `set`,
`consume`, `purchase`, `replace`). All quantity math is delegated to the package
helpers (`add/remove/set/getInventoryItemQuantity`), which reject negative /
non-integer quantities and guard overflow, omit zero-quantity entries, and
preserve unrelated items.

Concurrency model:

- Mutations are **serialized per-user** via an in-module promise chain, so two
  rapid actions (e.g. double-consuming the final unit) cannot both read the same
  starting quantity.
- Each mutation performs a **fresh relay read** as its write base
  (read-modify-write against the newest event), never trusting a possibly-stale
  or empty cache. This prevents a missing cache snapshot from clobbering an
  existing relay inventory with an empty event.

## Optimistic behavior

- `onMutate` snapshots the canonical inventory cache and applies the mutation
  optimistically to a single cache key (`['blobbi-inventory-31633', pubkey]`).
- `onError` rolls back the cache to the snapshot. There is **no relay rollback**
  after a successful publish (replaceable events cannot be un-published).
- `onSettled` invalidates the single canonical key to reconcile with the relay.

## Legacy inventory removal

- Removed: `useBlobbiFeedAction`, `useBlobbiPlayAction`, `useBlobbonautInventory`,
  the hardcoded `ITEM_DATA` effects table, and the modals' dependence on the
  legacy consumable inventory. The feed/play/shop no longer write inventory to
  11125.
- Retained (non-inventory): kind:11125 profile parsing/writing including
  `mergeOwnerProfileTags`, coins, `has[]`, achievements, current companion,
  unknown Ditto-tag passthrough, and legacy 31125 dual-read for the profile.
- Legacy `storage` WRITE removed at the source: `mergeOwnerProfileTags` and
  `createOwnerProfileTags` no longer emit the `storage` tag. `storage` remains in
  `MANAGED_OWNER_PROFILE_TAG_NAMES`, so any pre-existing legacy `storage` tags are
  dropped on the next profile republish rather than reconstructed. A coin update
  therefore never converts legacy inventory into a new write.
- Dead/inert legacy consumable parsing code RETAINED (not removed this pass):
  `parseInventoryItems` (`blobbi-parsers.ts:67`), the `storage`→`inventory`
  sub-branch inside `parseOwnerProfile` (`blobbi-parsers.ts:94-95,111`), the
  `OwnerProfile.inventory` field + `InventoryItem` type, and the `inventory`
  carry-through in `useUpdateOwnerProfile` (`useBlobbiEvents.ts:158`). These are
  parsed but NEVER serialized (`mergeOwnerProfileTags` omits `storage`) and are
  NOT read by any reachable production flow. The only reader of
  `OwnerProfile.inventory` is `OptimizedStatusExample.tsx:157-161`, a dev-only
  example component that is not imported anywhere in `src` (not routed, never
  rendered). `parseOwnerProfile` itself is NOT dead — it is the production
  profile reader for coins / current companion / owned pets — only its
  consumable sub-branch is inert. This compatibility code is retained so a
  pre-existing legacy `storage` tag can still be read without error; it can be
  removed once 11125 `storage` is confirmed retired. It is intentionally kept in
  this pass to avoid expanding the diff.

## Item catalog: content shape and cache key

- The official kind:31632 content JSON uses the shape
  `{ "effects": { "game:blobbi": { <stat>: n } }, "metadata": { itemId, action,
  stages, emoji, stackable } }`. The adapter reads exactly these paths (with a
  flat-shape fallback for forward compatibility). The bundled fallbacks for the
  19 `active` items mirror the exact published `name`, `type` (`consumable`),
  `category`, `effects`, `action`, `stages`, `emoji`, and `topics`.
- **Item categories** are `food`, `toy`, `medicine`, `hygiene`, `energy` and
  `currency`. The first five are consumable care items. `currency` items carry
  `action: null` and no effects, so `useUseItem` rejects them
  (`Item has no usable action`) and they are rendered read-only in the Item Bag.
  All three validation points — `ItemCategory`, the adapter's `VALID_CATEGORIES`
  and the bag's sections — derive from `ITEM_CATEGORIES` in the canonical
  registry, so a category can never be accepted by one and dropped by another.
- **Reserved items:** an item whose identity is claimed but whose issuer-signed
  kind:31632 event is not published yet (today: the Arcade Ticket) resolves from
  the bundled fallback and switches to the published definition automatically.
  See `docs/protocol/arcade-ticket-publication.md`.
- The catalog uses a single canonical query key `['blobbi-item-catalog']`. The
  configured relay is an internal query input only, NOT part of the key (the
  official addresses are the identity). `NostrProvider` resets queries on relay
  change.

## Concurrency model (single instance vs multi-device)

- Inventory mutations are serialized per-user via an in-module promise chain
  (`serialize` in `useInventoryMutation.ts`). The chain is `prev.then(task,
  task)`, so mutation B's `task` (including B's fresh relay read) does not start
  until mutation A's `task` promise has settled, and A's `task` only settles
  after `await publish(template)` returns. Each `task` performs a FRESH relay
  read (`fetchInventory`) immediately before building the event, so a second
  queued mutation reads the newest event rather than A's pre-mutation snapshot.
- Freshness caveat (relay read-after-write): the guarantee that B's fresh read
  reflects A's just-published event depends on the relay returning A's event on
  the immediately-following query. Nostr does NOT define read-after-write
  consistency, and `useNostrPublish` treats a publish timeout as partial
  success, so `publish` may resolve before the relay has durably indexed the
  event. If the relay has not yet reflected A's write, B rebuilds from the
  pre-A state and the two writes can still collide (newest-wins). The
  single-instance guarantee is therefore proven ONLY under a read-your-write
  relay; the concurrency test (`concurrency.test.tsx`) mocks exactly such a
  fast, immediately-consistent relay ("best case for read-your-write") and
  proves B's event is built from A's result (seed 2 → two consumes → final 0).
  Ordering and fresh-read are guaranteed by the code; immediate relay visibility
  is not.
- `useUseItem` additionally performs a fresh ownership read before applying an
  effect, so an effect is never applied for an unowned item and the final unit
  cannot be double-consumed locally (subject to the same read-after-write
  caveat).
- LIMITATION: in-memory serialization does NOT coordinate across separate app
  instances — two browser tabs, two devices, another Nostr client, relay
  propagation delay, or simultaneous replaceable-event writes are all
  uncoordinated. Two instances can each read the same remote snapshot before
  either publishes. Because kind:31633 is a replaceable event (newest-wins),
  near-simultaneous cross-instance writes can overwrite each other. There is no
  relay-side locking; this is inherent to Nostr and is not worked around.
- Cross-instance final-unit consumption race: because `useUseItem` publishes the
  Blobbi effect (1124 + 31124) BEFORE the 31633 decrement, two clients that both
  observe the final unit can BOTH pass their fresh ownership read, BOTH apply the
  Blobbi effect, and BOTH publish a 31633 decrement. Their 31633 events race and
  newest-wins resolves the quantity, but that does NOT make the operation atomic:
  the effect was already applied twice. This is an accepted, documented
  limitation; no locking or relay rollback is invented here.

## Known non-atomic multi-event limitations

- **Purchase** = two independent events (grant item to 31633, deduct coins in
  11125). Ordering: **grant item first, then deduct coins**. On coin-deduction
  failure the player keeps both item and coins (favor-the-user leak) and a
  warning is surfaced; this is less harmful than charging with no item.
- **Consumption** = interaction (1124) + Blobbi state (31124) + inventory
  decrement (31633). A fresh ownership read gates the flow first (unowned →
  rejected before any publish). Ordering: **apply Blobbi effect first, then
  decrement**. On decrement failure the effect is applied but the item is not
  consumed (small favor-the-user leak), which is less harmful than losing an
  item with no effect. A warning is surfaced and the UI does not claim clean
  success. The 31124 update preserves non-inventory gameplay state (stats, XP,
  `careStreak`, care timestamps, equipped accessories).

These are inherent to separate replaceable events; the operations are NOT atomic
and there is no relay rollback after a partial success.

## Future work

- **Image updates:** when definitions add an `image` tag, `resolveFromDefinition`
  already prefers it over the emoji fallback.
- **Accessory migration:** accessories still live on kind:11125 `inv` +
  kind:31124 `equip`. They are NOT migrated here. The coins write preserves
  existing `inv` tags verbatim to avoid regressing accessory ownership. Moving
  accessories to 31632/31633 is future work; no official accessory definitions
  were invented.
- **Bunker / republication service:** signing and publishing official
  definitions (and any republication) is out of scope; no private issuer key is
  present and no automatic republication exists.
- **Dedicated furniture UI** for medicine / hygiene / energy categories does not
  exist (only fridge=food and chest=toys). Those items are reachable via the
  generic **Item Bag** (`ItemBagModal`, opened from the 🎒 button in
  `PlayingView`), which lists all owned inventory grouped by category and uses
  the shared consume modal. The shop lists all five categories.
