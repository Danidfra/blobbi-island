# Blobbi Island — Inventory Architecture (kind:31632 / kind:31633)

Status: clean implementation on top of `@nostr-games/inventory@0.4.0` at
commit `c3e777e` (the kind:1416 / kind:1417 spend model), consumed as a local
`file:../nostr-games-inventory` link until that commit is released to npm
(see [Dependency](#dependency)).
This document describes the new inventory foundation. It replaces the legacy
kind:11125 `storage` consumable inventory. It is **not** a migration: no legacy
inventory data is copied, and no dual-read / dual-write exists.

## Sources of truth

- **Item catalog:** official **kind:31632** Game Item Definitions signed by the
  official issuer.
- **Player inventory:** **kind:31633** Game Inventory events owned by the user.
  Island WRITES exactly one (`blobbi:island`) and READS the others the player
  has authored — see [Cross-game inventories](#cross-game-inventories).
- **Protocol logic:** `@nostr-games/inventory` owns all parsing, validation,
  building, addressing, quantities, duplicate handling, parse modes, and
  result/error types. Island never re-implements these.
- **Island code** owns UI, relay orchestration, gameplay, optimistic updates,
  shops, item effects, and interaction flows.
- **kind:11125** remains valid for non-inventory profile data only (owned
  pets, current companion, achievements, profile metadata, Ditto tags).
  **Inventory is never written into 11125.** A historic `coins` tag is
  obsolete data since the economy reset: preserved opaquely on republish,
  never read for economic decisions — the canonical balance is the official
  Blobbi Coin quantity in kind:31633.

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
  `normalizePurchaseLines` rejects it before any spend intent or wallet call.
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
- **This is the identity Island WRITES.** A player may own several kind:31633
  inventories, written by other games under the same key; Island discovers and
  reads those but never writes them. See [Cross-game inventories](#cross-game-inventories).

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

---

# Cross-game inventories

Blobbi Island is not the only game a player's key is used in, and kind:31633 is
not a single global inventory. A player may hold several, one per game context,
each written by the game that owns it. Island reads the others; it writes only
its own.

The Farm is the first interoperability partner and appears below as the worked
example, but nothing in the architecture is about the Farm — every mechanism is
generic and a second partner needs one table entry and no code.

## Author-wide discovery

`src/inventory/external-inventories.ts` asks a deliberately open question:

```
{ kinds: [31633], authors: [playerPubkey] }
```

No `#d`. No expected list of contexts. No assumption about how many answers come
back. Whatever the player has authored is what they have — which is the only
model under which a game Island has never heard of can credit that player and be
noticed.

Discovery is the first step of the ONE external store's authoritative fetch
(see [The live external store](#the-live-external-store)); the same filter is
also the first filter of the live tail, so a new game's inventory is
discovered live as well.

**`blobbi:island` is excluded from the result.** It already has a canonical
reader (`useIslandInventory`) with its own confirmed-empty rule, publish-base
semantics and cache; a second opinion about it would be a regression.

## Newest-per-context selection

`selectNewestInventoryPerContext` resolves each `d` **independently**:

1. **Parse before compare.** An event that does not parse is not an inventory at
   any age, so it is discarded before the recency comparison rather than winning
   it. A newer malformed `farm:main` cannot hide an older good one.
2. **Per context.** One context answering badly cannot affect another.
3. **Deterministic ties.** Equal `created_at` resolves to the lexicographically
   lowest event id — NIP-01's own rule — so two clients agree.

The read model exposes the inventory id, its `context` tags, and each item's
full address, relay hint and quantity. **Unmanaged tags are not interpreted.** A
partner's `revision` counter or its own `e` idempotency markers are another
application's private bookkeeping; guessing at their meaning is how two clients
end up disagreeing about state neither of them owns.

## Trusted issuer policy

`src/inventory/trusted-issuers.ts` holds a small hand-maintained table of
issuers: pubkey, player-facing label, role (`blobbi` | `partner`) and known
relays. `isTrustedItemIssuer` / `getTrustedItemIssuer` are the whole API.

- **Trust is the issuer, never the `d`.** kind:31632 is addressable, so anyone
  may publish `farm:produce:strawberry` and relays will serve it. Only
  `31632:<issuer>:<d>` identifies an item, and only the issuer half is a trust
  input. The table records **no item ids for any issuer** — Island learns what a
  partner's items are by reading their published definitions, which is what lets
  a partner add or re-art an item without a Blobbi release.
- **Being trusted grants exactly one thing:** a definition signed by that key may
  be parsed and displayed as the item a discovered inventory refers to. It does
  not make an item official, purchasable, equippable, effect-bearing or
  consumable.
- **`parseOfficialItemDefinition` was not widened.** It still means "an official
  Blobbi item", and still gates the catalog, the shop and gameplay.
  `parseTrustedItemDefinition` is a sibling with a narrower purpose. Widening the
  official parser would have made every partner item official everywhere at once.
  A contract test asserts that no gameplay gate — the catalog, the registry, the
  shop and store catalogs, placement policy, visual-effect trust, the prize
  catalog, `useUseItem` — imports the trust table or the trusted parser.

## Full-address definition resolution

`useExternalItemCatalog` takes the item references found in discovered
inventories and:

1. parses each **full address**, dropping malformed ones;
2. groups by issuer, dropping every issuer that is not a trusted **partner**
   (this game's own issuer is left to `useItemCatalog`, so nothing is fetched
   twice) — the untrusted ones are dropped **before a query is built**, so they
   cost no connection and produce no cache entry;
3. issues **one filter per issuer** (`authors` + `#d`) over the existing
   `queryRelays` fan-out. One combined filter across two issuers would also match
   issuer A publishing issuer B's `d`, which is the identity confusion full
   addresses exist to prevent;
4. re-checks the issuer on every returned event (`parseTrustedItemDefinition`)
   and admits only addresses this fetch actually requested, so a relay serving
   extra events cannot inject a definition;
5. keeps the newest valid definition per address — parse first, compare second.

Relay preference per issuer: the issuer's known relays, then the relay hints
carried by the referencing `a` tags, then `OFFICIAL_ITEM_RELAYS`, then the
configured relay. **Hints are collected only after the issuer has passed the
trust gate**, must be `ws://`/`wss://`, and are capped (2 per issuer, 6 relays
total) so a hint can never widen the fan-out beyond what a catalog load is worth.

There is **no bundled fallback** for a partner item and there must not be:
Island cannot ship metadata for an item it does not know, and inventing some
would be the second-authoritative-catalog failure this architecture avoids. An
address that does not resolve simply produces no entry — the path **fails
closed** at every step.

## Generic normalization

No new parsing was added to understand a partner's item. `resolveFromDefinition`
already reads `name`, `type`, `category`, `t` topics, `rarity`, `content.description`
and the whole `image` collection straight off the published definition, and
`category: food` was already a registry category. The Blobbi-specific fields it
looks for (`content.metadata`, `content.effects`) are simply absent from a
partner definition, which resolves honestly to `action: null`, `effects: {}` and
`itemId: null`.

`src/inventory/partner-item-event-fixtures.ts` holds the real signed Farm
Strawberry event so this claim is proved against the wire and not against an
imagined shape. A contract test asserts production never imports it.

## Source-preserving display aggregation

The collection view (`useInventoryCollection`) reads several inventories and
**merges none of them**:

- one `CollectionEntry` per `(sourceInventoryId, fullAddress)`;
- quantities are **not summed** across contexts — a single number would belong to
  neither context — and, for external rows, are the EFFECTIVE quantities of the
  spend-aware derivation below, never the raw snapshot alone;
- each entry carries `sourceInventoryId`, `source` (`island` | `external`) and,
  for external items, the issuer's player-facing `sourceLabel`;
- the React and selection key is the composite `<sourceInventoryId>|<address>`.
  The address alone is no longer unique, and keying on it would collide two real
  rows into one.

The UI shows an external item in the existing grid under its generic category,
with its real name, artwork and quantity, and a short source pill ("Farm"). No
raw Nostr identifier — address, `d` or pubkey — reaches the player.

## The live external store

Everything Island knows about the inventories other games write for the
signed-in player lives in ONE value, owned by ONE TanStack query
(`['blobbi-external-inventory-events', pubkey]`, `useExternalInventoryEvents`):

```
external inventory event store  (src/inventory/external-inventory-events.ts)
  ├── latest valid kind:31633 per context   (canonical newest-valid selection on merge)
  ├── immutable kind:1416 spends            (deduplicated by id)
  └── immutable kind:1417 folds             (deduplicated by id)
         ↓ deriveExternalInventoryStates  (+ this tab's established spends)
  per-inventory state: ready | unresolved   (resolveGameInventoryState)
         ↓ useExternalInventoryView
  collection / UI
```

The store is an immutable value; `mergeExternalInventoryEvent` is the ONE pure
function through which any event — fetched or live — enters it, and it
returns the same object when nothing changed. The UI never learns what a relay
is. There is no per-inventory query, no separate discovery query and no
derived-state cache: a live event replaces the store in place and the
derivation re-runs. That is what removed the "Syncing…" flash a live snapshot
used to cause, and what gives an orphan kind:1417 somewhere to wait.

### What enters the store

Admission is identical for fetched and live events, and it is the package's
structural rules and nothing else:

- the author is the store's owner;
- kind:31633 parses as an inventory, is not `blobbi:island`, and wins the
  canonical newest-valid selection for its `d` against the snapshot held;
- kind:1416 parses as a spend (`parseGameInventorySpend`: full inventory and
  item addresses, canonical quantity, author = inventory owner);
- kind:1417 parses as a fold manifest (`parseGameInventoryFold`);
- duplicates by id are dropped.

A same-author event that does not parse is not stored: it could never move a
balance, and keeping it would only let malformed events grow memory. What is
deliberately NOT checked is relevance to a known context — a valid spend or
fold naming an inventory this client has not discovered yet is kept, because
the context may be discovered a moment later; the derivation ignores it until
then. Nothing is identified by a bare `d`; no game-specific rule lives here.

### Knowledge is monotonic — every cache write reconciles, none replaces

The relay network is eventually consistent. A relay answering a refetch may
not yet hold the spend another relay streamed a second ago, or the snapshot
the owner just published. So the reconciliation lives at the ONE point where
TanStack writes the cache — the query's `structuralSharing` function, which
TanStack calls as `structuralSharing(state.data, newData)` inside
`Query.setData` for a completed fetch and for every `setQueryData` alike,
with the cache AS IT IS AT COMMIT TIME. A live event that lands after the
query function returned and before its result is committed is therefore
still reconciled (pinned by a test that injects a live event at the commit
point). The query function returns only what the relays taught; the store
merges it through the same admission rule:

```
held:    rev18, S1, S2, S3      (S3 and rev18 arrived live)
fetched: rev17, S1, S2          (a relay that has not caught up)
result:  rev18, S1, S2, S3      — nothing forgotten; effective unchanged

held:    rev18   fetched: valid rev19      → rev19 (a newer valid snapshot advances)
held:    rev18   fetched: malformed rev20  → rev18 (never shadowed)
```

- **kind:1416 / kind:1417**: known valid events are a union by id. A read
  that does not return one cannot delete it.
- **kind:31633**: the canonical newest-valid selection, so a stale read
  cannot regress the winner and a genuinely newer valid one still wins;
  equal `created_at` still breaks on the lower id.
- **Scope**: one owner's ACTIVE store. Stores of different players are never
  merged (the query key is the pubkey; the reconcile refuses another owner).
  Logout, a different player, or cache removal after `gcTime` are real
  resets — monotonic knowledge is not "forever", it is "for as long as this
  player's store exists". Pinned against the real query lifecycle in
  `useExternalInventoryEvents.test.tsx`.

### Initial fetch + live tail + recovery

```
1. authoritative fetch (fetchExternalInventoryEvents)
     discovery { kinds:[31633], authors:[player] }               → newest-valid per d
     one round  { kinds:[1416], authors:[player], #a:[addr…] }   ┐ every discovered
                { kinds:[1417], authors:[player], #a:[addr…] }   ┘ address, no `since`
     derive; for every unresolved inventory fetch its missing manifests BY ID
     (configured relays + the chain's relay hints), derive again; ≤ 8 rounds
2. live tail (useExternalInventoryLiveTail), once the store exists
     ONE REQ per relay in the cross-game policy, carrying the same three filters
     every EVENT → mergeExternalInventoryEvent → setQueryData → re-derive
3. recovery
     NRelay1 reconnects with backoff and re-sends the REQ; the relay replays and
     sends a FRESH EOSE → every EOSE after the first invalidates the query
     a dropped iterator → 2 s → resubscribe + invalidate
     `online`, refetchOnReconnect, remount after staleTime → refetch
```

Nothing is missed between mount and subscription: the REQ carries no `since`,
so attaching the tail replays every stored match (harmless — every merge
deduplicates). Nothing is polled. `NRelay1` verifies every event's signature
before it is yielded; the merge then checks the author against the store's
owner, the package parsers decide validity, and the derivation decides the
balance — a live event has exactly the same path as a fetched one.

### Arrival order never changes the answer

| Arrives | Effect on the store | Effect on the balance |
| --- | --- | --- |
| newer valid kind:31633 for a known context | replaces that context's snapshot (parse before compare; equal `created_at` → lower id) | re-derived against the chain it references |
| malformed newer kind:31633 | not stored | none — the valid snapshot is not shadowed |
| kind:31633 for a NEW context | stored; an authoritative refetch is triggered so its spends/folds load; the tail is re-scoped | its rows appear once derived |
| kind:1416 (owner-signed) | stored once, whatever relay delivered it | applied/rejected at its deterministic position — `raw 4, live S1 → 3`, raw untouched |
| kind:1416 for another inventory | stored (a context discovered later may need it) | none for this inventory |
| kind:1417 nobody references yet | stored, INERT | none: an orphan settles nothing |
| kind:31633 referencing a fold not yet seen | stored | **unresolved**: no balance, never the raw number; the missing id is fetched by id (see below), and a later live kind:1417 resolves it just as well |
| the fold for such a snapshot | stored | resolves — the same derivation, no special case |
| a duplicate of anything | ignored | none |

The Farm's live sequence — a kind:1417 settling four spends, then a
kind:31633 (revision 17) referencing it — therefore lands as: fold stored and
inert → snapshot replaces the old one, its chain reaches the fold → the four
spends are folded, the new raw quantities stand, nothing is subtracted twice.
No refresh.

### Scale — and what does NOT scale yet

Subscription count is O(relays), not O(inventories) and not O(items):

| external inventories | relay connections | REQ subscriptions | filters per REQ |
| --- | --- | --- | --- |
| 1 | 2 (Farm's set + configured, deduped) | 1 per relay | 3 |
| 10 | 2 | 1 per relay | 3 (`#a` lists 10 addresses) |
| 50 | 2 | 1 per relay | 3 (`#a` lists 50 addresses) |

A new partner game adds its relays to the policy (through its trusted-issuer
entry), which may add a connection; it never adds a subscription per
inventory, and nothing ever subscribes per item. A change in the address set
closes the tail and opens a new one with the new scope.

**Historical growth is a V1 protocol limitation, and it is not solved here.**
The store keeps every valid kind:1416 and kind:1417 it has learned, and the
authoritative reads deliberately carry no `since`: the protocol allows a late
spend with an old `created_at` to still be pending, settlement is by explicit
id through the fold chain, and there is no timestamp watermark. So over
months of play, bandwidth per fetch, memory per store and derivation cost
grow with the total immutable ledger history of the player's inventories —
per player, not per relay or per subscription. Island MUST NOT "fix" this
locally: no `since`, no timestamp cut-off, no "keep the last N spends/folds",
no pruning that changes accounting, no assumption that anything older than
the snapshot is settled — each of those breaks the derivation the spec
guarantees. The remedy belongs to the protocol and the library: a verifiable
checkpoint / compaction / epoch mechanism (an owner-published, chain-verified
point before which readers need nothing) — future work, tracked in
`@nostr-games/inventory`, deliberately not designed or shipped in Island.

### Missing-fold recovery

A snapshot whose chain names a manifest the store does not hold derives as
unresolved. `useExternalInventoryView` then asks for the missing ids by id on
the policy relays plus every usable relay hint the chain carries. Retries are
paced by `foldRetryPolicy` and happen on RECOVERY TRIGGERS — a completed
authoritative refetch (reconnect EOSE, `online`, new context, remount) or the
view changing — or, so that a quiet tab is not stuck once the network is
healthy again, at the nearest deadline through ONE one-shot wake-up timer.
That is not polling: with nothing missing, or nothing waiting on a deadline,
no timer exists; the timer fires once, the read happens once, and a failure
computes the next, longer deadline (and arms the next single timer). A
manifest that arrives live before its deadline clears the pending wake-up
without a read; unmount, logout and a player change cancel it.

| by-id outcome | meaning | next eligible |
| --- | --- | --- |
| obtained | the manifest is in the store; resolved | — |
| unanswered (`answered: false`: timeout, offline, every relay failed) | the manifest MAY exist | after 5 s, doubling per attempt, capped at 5 min |
| answered but absent | no answering relay has it (yet) | after 30 s, doubling, capped at 5 min |
| in flight | — | never concurrently |
| cancelled by this client (the view changed, the effect re-ran, unmount) | not a network verdict | at once — the trigger that cancelled it retries; it does not count as a try |

A live kind:1417 resolves the inventory immediately, retry table or not.
Unresolved never falls back to raw quantities.

### Lifecycle

The tail is keyed on the player, the relay policy and the discovered address
set. Logout aborts the REQs and closes every relay and derives nothing;
another player signing in gets their own store (keyed by pubkey) and their own
tail; the filters carry `authors:[player]` and the merge re-checks the author,
so the previous player's events can never enter the new store. Unmount closes
everything. Tests: `useExternalInventoryEvents.test.tsx`.

## Spend-aware derivation (kind:1416 / kind:1417)

A discovered snapshot is the owner's **last consolidated statement**, not the
current balance. Any application — Island included — may have published a
player-signed **kind:1416 Game Inventory Spend** against it that the owner has
not yet folded. Island therefore never displays a raw external quantity as
definitive. For every discovered inventory it fetches

- every kind:1416 by the owner naming the **full** inventory address
  (`kinds:[1416]`, `authors:[owner]`, `#a:[31633:<owner>:<d>]`) — **never with
  `since`**: a spend older than the snapshot that is not in its chain is still
  pending, and a timestamp cut-off would lose it;
- when the snapshot carries a `["e", <manifest>, <relay>, "fold"]` reference,
  every kind:1417 for the inventory, then any still-missing manifest **by id**
  on the cross-game relays plus each relay hint the chain carries (bounded to 8
  rounds);

deduplicates by event id, and hands snapshot + folds + spends to the package's
`resolveGameInventoryState`. Every rule — author must equal owner,
`(created_at, id)` ordering, overdraw rejected in full, folded ids excluded
exactly once, voided ids closed forever, chain walked head-first and verified —
is the package's. `src/inventory/external-inventory-state.ts` decides what to
fetch and how to present the answer; it reimplements nothing. The protocol is
specified in `@nostr-games/inventory`'s `docs/1416-1417-game-inventory-spend.md`,
which is canonical; nothing here restates it.

Relays: one policy, `externalInventoryRelays()` — every trusted partner
issuer's relay set plus the configured relay. Discovery, spend/fold reads and
the spend publish all use it, so a spend Island publishes is one the Farm's
next fold will see.

### The unresolved state

If a snapshot references a manifest that cannot be retrieved or verified —
missing, malformed, scoped to another inventory, wrong author, cyclic, or
claiming a spend it could not have settled — **there is no balance**. The row
stays visible, marked `Unavailable`, showing the last consolidated number as
such, with no action. Falling back to the raw quantity would resurrect items
another game already consumed; treating every spend as pending would debit the
player twice. Neither is done, and **Blobbi never spends against an unresolved
inventory**. While the spend/fold reads are still in flight the row is marked
`Syncing…` and is equally not actionable.

### Caches, and the pending → folded transition

The derivation runs over the store plus the spends this tab itself established
(`established-spends.ts`), so a spend Island just published reduces the
effective quantity at once and a lagging relay answer cannot bounce it back.
A spend Island publishes is also merged into the store through the same merge
a live delivery uses. **The raw snapshot is never mutated.** That is what
keeps the transition stable, for any quantity:

```
raw 5, pending S1 (quantity 3)     → effective 2
Farm folds: raw 2, chain ∋ S1      → effective 2   (S1 excluded by the chain; never 2 − 3)
```

The owner's later kind:1417 and folding kind:31633 arrive on the tail;
Island acknowledges nothing and edits nothing.

## Compatibility policy: what an external item DOES

```
the kind:31632 definition  = semantic identity   (issuer-signed: what the item IS)
Island's compatibility profile = gameplay interpretation (what it DOES to a Blobbi)
```

The Farm publishes generic semantics — `type: consumable`, `category: food`,
topic `edible` — and deliberately no Blobbi vocabulary. Island interprets them
in exactly one place, `src/inventory/external-item-compatibility.ts`, which
returns a **profile**, never performs an effect, and is consulted by nothing in
the generic protocol parser, the trusted-definition parser or the derivation.

An external item is usable only when **both** hold:

1. its issuer (from the item's **full** address) is a trusted partner that has
   been granted the profile — `TrustedItemIssuer.compatibility` in
   `trusted-issuers.ts`; the Farm is granted `['raw-produce']`;
2. its published definition has the profile's semantics: `consumable` +
   `food` + `edible` for `raw-produce`.

A trusted issuer's crafting material is not food because the issuer is trusted;
a stranger's "edible" is not food because it says so; a Farm item mis-filed
under `category: food` without edible-consumable semantics stays display-only.
No item id, `d` or address of any partner appears in Island code (a contract
test asserts `farm:produce` is named nowhere in production).

`raw-produce` → `{ action: 'feed', hungerSegments: 1 }`. **One food segment is
25 hunger points**, derived from the existing balance rather than chosen: the
hunger meter is 0–100 and the UI reads it in 25-point bands (`needLevel`:
critical ≤ 25, low ≤ 50), the smallest official food (Apple) restores exactly
25, and the generic feed step is +25. Stages are the same as every official
food (`baby`, `adult`). Prepared food from a future cooking game would be a new
profile mapping to more segments, in the same unit — nothing else changes.

For display and gameplay the row's definition is the issuer's definition with
Island's `action`/`effects`/`stages` laid over it (`applyExternalCompatibility`);
the issuer's event is never modified and no `based_on` overlay is published.

## Consuming Farm produce: kind:1416

Farm owns and writes `farm:main`. Blobbi discovers it read-only, derives its
effective state, and — for a compatible item in a `ready` inventory — may
consume N units in ONE action by publishing a **player-signed kind:1416**
carrying `quantity N`.
**Blobbi never replaces `farm:main` and never publishes a kind:1417 for it.**
The Farm folds applied spends and voids rejected ones on its next own write.

```
1. validate: action, Blobbi exists, stage allowed, the inventory is the player's, 1 ≤ N
2. FRESH derivation of the source inventory → unresolved or effective < N: stop, sign nothing
3. build ONE kind:1416 through the canonical builder and sign it as the owner:
     ["a", "31633:<player>:farm:main", <relay>, "inventory"]
     ["a", "31632:<farm-issuer>:farm:produce:<slug>", <relay>, "item"]
     ["quantity", "N"]
     ["purpose", "feed:blobbi"]  ["client", "blobbi-island"]  ["nonce", …]  ["alt", …]
   (purpose/client/nonce/alt are informational; the spec forbids them from
   affecting accounting)
4. establish it: the SAME signed bytes to every cross-game relay
     ≥1 accepted → established
     all silent  → look up the exact id; found → established; else UNCONFIRMED
     all refused → rejected (nothing exists; a new action signs a new spend)
5. apply the effect on kind:31124 through the pet-state transaction, with the
   spend id as the `blobbi_op` operation marker
6. best-effort kind:1124 receipt carrying ["e", <spend id>, <relay>, "inventory-spend"]
```

### A batch is one action

```
quantity N  →  one kind:1416 (quantity N)
            →  one feed:   hunger += N × 25 (clamped at 100)
                           XP     = N × the shared per-unit feed XP
                                    (`calculateInventoryActionXP('feed', N)`, already per-unit × quantity)
            →  once:       care streak, last_meal, last_interaction,
                           the kind:31124 revision, the kind:1124 receipt
```

`planCareEffect({ quantity: N })` is the same planner Island food uses, so a
batch of Farm produce and a batch of Apples scale identically. Never N spends,
never N feeds, never N receipts. The spend id identifies the whole batch: a
retry republishes the same event and, once the marker is on the pet's newest
state, re-applies nothing.

**The dialog** shows `Available: <effective quantity>` — the live number from
the store, which can change while the dialog is open — and lets the player
select 1…available. Waste is allowed exactly as it is for Island food: the
dialog shows the total effect and the stat clamp decides; a "useful maximum"
would be a product change for both paths, not a cross-game one. If the row's
availability drops below the selection the selection follows; if the row
disappears (consumed elsewhere, inventory unresolved) the dialog closes.

Modules: `external-spend.ts` (build/sign/establish), `useConsumeExternalItem.ts`
(the orchestration), `src/lib/external-spend-ledger.ts` (durable per-browser
record of every signed spend **with the signed event**).

### Ordering, and the failure policy

Spend **first**, effect second — the opposite of `useUseItem`, for a reason.
Island's own debit can fail without losing anything, so applying the effect
first favours the player. A kind:1416 is different: its event id is the
durable identity of the whole consumption, so an established spend can always
have its effect recovered, whereas an effect applied before a spend that then
fails to establish could never be reconciled with anything. Spend-first turns
every partial failure into a **resumable state** rather than a leak:

| Outcome | Ledger | Next action on the row |
| --- | --- | --- |
| relays silent, id not found | `unconfirmed` | republishes the **same** signed event; never signs another |
| spend established, 31124 publish ambiguous | `effect-ambiguous` | reads the pet's newest state: marker present → done; else applies the effect — no new spend |
| spend established, 31124 definitely not published (signer refused) | `established` | applies the effect — no new spend |
| everything landed | `applied` | a new action signs a new spend |
| every relay refused | `failed` | a new action signs a new spend |

None of this is atomic and it is not described as such. What is guaranteed:
one player action yields at most one kind:1416; one kind:1416 yields at most
one effect (the marker is checked on the authoritative kind:31124 inside the
per-pet lock before publishing); and every intermediate state is reported to
the UI as a status, not an error, with a toast that says the next tap finishes
it. Double-clicks are stopped by the mutation's pending state, by per-inventory
serialization, and by the resume rule.

### Eventual consistency and the multi-device overdraw

A spend accepted by one relay is established but not globally final. The
protocol orders pending spends by `(created_at, id)`; if another device spends
the same last unit, one spend wins at its deterministic position and the Farm's
next fold **voids** the other, permanently. Island applies the effect as soon
as the spend is established, because waiting for the owner to fold is not a
browser-only UX anyone would accept. The residual cost is a Blobbi fed from a
spend that is later voided — bounded to that concurrent multi-device race
(the fresh in-lock derivation stops every same-browser stale click), the same
class of favour-the-user leak `useUseItem` already tolerates, and accepted
knowingly. No backend or coordinator exists to close it.

### Trust boundaries, stated plainly

- **Spend authority** is cryptographic: `1416.pubkey == inventory owner`.
  Island refuses to sign for any inventory the signed-in player does not own.
- **Item trust** is Island policy: which issuers and which semantics it will
  interpret. The spend protocol does not decide this.
- **Application identity** is informational: `client: blobbi-island` proves
  nothing and is never treated as an authorization by anyone.
- **Snapshot authority** is a coordination convention: the Farm is the
  designated writer of `farm:main`. Island respects it voluntarily — and
  structurally.

## Read, never replace

kind:31633 is a **replaceable** event, and two applications performing
read-modify-write on the same coordinate from different origins have no shared
lock, no compare-and-swap and no shared revision semantics: whichever publishes
second silently discards the other's work. The kind:1416 model exists so that
no consuming game ever needs to. Island's walls are structural:

- `buildInventoryTemplate` hard-codes `id: ISLAND_INVENTORY_D`; there is no
  parameter through which any caller could aim a write at another context;
- the kind:1417 builder is not even re-exported from `package.ts`, and
  `inventory-write-topology.contract.test.ts` asserts that no production module
  reaches it, that every cross-game module (discovery, relays, store,
  derivation, established spends, compatibility, spend, consumption) cannot
  build a kind:31633 or kind:1417 and cannot reach the inventory mutation or
  transaction layer, that the read modules sign and publish nothing, that the
  spend modules sign exactly the enumerated kinds, that no spend query or live
  filter carries a `since`, that the only live-subscription site is the store
  hook and it subscribes per relay (never per inventory or item), that a batch
  signs exactly one spend, that no quantity is ever mutated on a snapshot, and
  that no production module names another game's context or item ids.

The Island's own consumables in `blobbi:island` are untouched: `useUseItem`
still debits through the local kind:31633 mutation path, publishes no spend,
and shares only the effect planner (`care-effect.ts`) with the external path.

## Dependency

`@nostr-games/inventory` is linked as `file:../nostr-games-inventory` (the
sibling checkout at commit `c3e777e`, version `0.4.0`, `dist/` built there) —
the same mechanism the Farm uses. The link is the least invasive way to consume
an unreleased commit; replace it with the released version when it ships.
Island's import surface stays `src/inventory/package.ts`, which now re-exports
the spend/fold reading API and the spend builder and deliberately not the fold
builder.

---

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
  NOT read by any reachable production flow. Its only reader used to be
  `OptimizedStatusExample.tsx`, a dev-only example component that was never
  imported, routed or rendered; that component has since been deleted, so the
  field now has no reader at all. `parseOwnerProfile` itself is NOT dead — it is the production
  profile reader for current companion / owned pets (its `coins` field is
  inert legacy compat data since the economy reset) — only its
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

- **Purchase** is NO LONGER on this list: since the Coin cutover the charge
  and the item grant land in ONE kind:31633 replacement event through the
  canonical wallet (`spendCoins` + `grantLines`) — atomic by construction.
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
  kind:31124 `equip`. They are NOT migrated here. Profile republishes preserve
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

## Authoring and inspection tooling

Item definitions are authored, published and inspected through the internal
Game Item Tools at `/tools/game-items`. See
[`game-item-tools.md`](./game-item-tools.md) for the route's access policy, the
publish flow, unknown-tag preservation, and the read-only inventory inspector.

The "bunker / republication service" note above is unchanged: that page signs
with the user's existing account and stores no key.

## Official cosmetics

Wearable accessories are official kind:31632 definitions from the same issuer,
resolved through the **same** `useItemCatalog` query and cache as consumables —
one query, one cache, no per-accessory or per-Blobbi fetch.

They are a **separate identity list** (`OFFICIAL_COSMETIC_DEFINITIONS`) rather
than entries in `OFFICIAL_ITEM_DEFINITIONS`, because `CONSUMABLE_ITEM_CATEGORIES`
is derived from `ITEM_CATEGORIES` by exclusion: adding a `headwear` category
would declare hats consumable and make them sellable in the coin shop. Cosmetics
also have no meaningful `action`, `stages` or `effects` — `action: null` is what
keeps them out of every care flow.

Their bundled fallback (`bundledCosmeticFallbackDefinition`) is deliberately
thinner than the consumable one: name, symbol and primary artwork only, with
`category: 'unknown'`. Category, rarity, description, topics and pose-specific
image views live in the published definition and nowhere else — inventing them
offline would be the second authoritative catalog the migration exists to avoid.

See [`accessory-definition-migration.md`](./accessory-definition-migration.md).

Since Phase 9 the catalog also resolves the twelve official VISUAL-EFFECT
items (`OFFICIAL_EFFECT_ITEM_DEFINITIONS`), whose ownership-backed activation
through kind:31634 is described in
[`blobbi-effect-activation.md`](./blobbi-effect-activation.md).

Phase 9.5: bulk absolute-quantity writes go through the `set-many` inventory
mutation (one canonical event per bulk action) — added for the internal
[`inventory-equipment-lab.md`](./inventory-equipment-lab.md), which is the
only sanctioned developer mutation surface. Phase 9.5a hardened it: the Lab
is build-flag gated (`VITE_ENABLE_LIVE_INVENTORY_LAB`, off by default), every
Lab write is explicitly confirmed, and its normal controls respect the
published `max_stack` (bulk add ensures ownership instead of incrementing).
