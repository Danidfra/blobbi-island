# Accessory → kind:31632 definition migration

**Status:** transitional. One accessory activated (Block Builder Cap).
**Scope of this document:** how a hat stops being a filename and starts being a
published item definition — and, just as importantly, what deliberately did *not*
move.

---

## 1. The old system, inventoried

Accessories predate the item protocol in this codebase. The audit below is the
complete set of places accessory data lives, with each one classified by what it
*owns* and what should happen to it.

| # | Module / asset | Owns | Disposition |
|---|---|---|---|
| 1 | `src/components/blobbi/lib/accessory-types.ts` | Equip/inv tag vocabulary, `SLOT_PREFIXES`, `ACCESSORY_CODE_PATTERN` | **Keep now** — this is the equip protocol, not metadata |
| 2 | `src/components/blobbi/lib/accessory-utils.ts` | Tag parse/serialize, slot inference, `generateAccessoryUrl`, `resolveAccessoryImageUrl` | **Keep now**; URL builders become fallback-only |
| 3 | `src/components/blobbi/lib/island-accessory-sources.ts` | Artwork resolution (definition → legacy chain) | **Keep** — this is the join point |
| 4 | `src/inventory/accessory-item-identity.ts` | code → official `d`, issuer trust | **Keep** — the mapping |
| 5 | `src/inventory/item-image-resolution.ts` | Which image view a pose/compact UI wants | **Keep** |
| 6 | `src/protocol/event-registry.ts` → `OFFICIAL_COSMETIC_DEFINITIONS` | Cosmetic identity + minimal fallback | **Keep** — grows per publication |
| 7 | `src/components/blobbi/hooks/useAccessoryManagement.ts` | Ownership (`inv`) + equipped state (`equip`) | **Keep until Placement exists** |
| 8 | `src/components/blobbi/AccessoryOverlay.tsx` | Placement editing surface | **Keep**; artwork now definition-aware (§9) |
| 9 | `AccessoryEditPanel/InventoryGrid/InventoryUI/RemovalModal/UsageModal` | Editor + inventory UI | **Keep**; read artwork through the resolver |
| 10 | `src/lib/asset-paths.ts` → `accessoryImagePath` | Local `public/` layout | **Keep** — final compatibility fallback |
| 11 | `public/assets/characters/blobbi/accessories/**` (24 PNGs) | Local artwork for `headwear-1…21`, `eyewear-2…4` | **Remove only per-item**, after that item is published *and* mapped |
| 12 | `src/components/blobbi/DebugAccessoriesModal.tsx` | Dev-only inv/equip editor | **Keep** — dev fixture, still reachable and useful |
| 13 | `src/components/blobbi/test-accessories.md` | Manual test notes | **Keep** — documentation, no runtime cost |

### What the audit did *not* find

Three things the migration brief anticipated **do not exist in this codebase**,
and no code was deleted for them:

- **No hardcoded accessory metadata catalog.** There has never been a table of
  accessory names, rarities or categories. The legacy system only ever knew
  `code → slot` (prefix inference) and `code → URL` (filename convention). So
  "avoid two catalogs" is satisfied by construction: there is no second catalog
  to retire.
- **No automatically-applied or default accessories.** Nothing decorates a
  Blobbi without reading equip state. The one historical leak — `BlobbiInfoModal`
  rendering *another* player's Blobbi wearing the *local* player's hats — was
  fixed in Phase 5 and is pinned by
  `CurrentBlobbiDisplay.accessory-policy.test.tsx`.
- **No dead accessory fixtures.** `DebugAccessoriesModal` is dev-gated but live,
  and `packages/blobbi-react-consumer/fixtures/accessory-fixtures.ts` is the
  package's own consumer test fixture.

**Consequence:** this phase removed **no** files. Everything found was either
load-bearing or genuinely still the only path for the 24 unmigrated accessories.
Deleting local artwork now would break every one of them.

---

## 2. Transitional architecture

```
kind:31124 equip tag
  → which accessory code is worn, and its x/y/scale/rot/flipX
        │
        ├─ code ──► ACCESSORY_CODE_TO_OFFICIAL_ITEM_D ──► d
        │                                                  │
        │              OFFICIAL_ITEM_ISSUER_PUBKEY ────────┤
        │                                                  ▼
        │                                    31632:<issuer>:<d>
        │                                                  │
        │                          useItemCatalog (ONE query, ONE cache)
        │                                                  ▼
        │                              trusted official definition
        │                        (name, type, category, rarity, symbol,
        │                         primary + marked image views, topics)
        │                                                  │
        └────────────────────────► island-accessory-sources ◄┘
                                          │
                            ordered candidate URLs (front/back aware)
                                          ▼
                          @blobbi/react — plain placement data + strings
```

`@blobbi/react` never learns that an address, a marker or a relay exists. It
receives `{code, slot, url}` and gets back strings.

---

## 3. What kind:31632 now owns

Display name · type · category · rarity · symbol · description · topics ·
contexts · primary image · marked image views (`front`, `back`, `side-*`) ·
`visual.slot` / `visual.forms`.

## 4. What legacy equip state still owns

Which accessory is equipped · x · y · scale · rotation · flipX · refw/refh ·
which Blobbi it belongs to · ownership (`inv` quantities).

**These were not moved, and moving them is out of scope.** A definition says what
a hat *is*; it says nothing about who has one or where it sits.

---

## 5. Mapping format

The mapping is **derived**, not hand-written. The single edit is an entry in
`OFFICIAL_COSMETIC_DEFINITIONS` (`src/protocol/event-registry.ts`):

```ts
{
  d: 'blobbi:cosmetic:block-builder-cap',
  legacyCode: 'headwear-block-builder-cap',
  name: 'Block Builder Cap',
  symbol: '🧢',
  primaryImage: 'https://blossom.primal.net/11ed17…d1dc.webp',
  status: 'active',
},
```

`ACCESSORY_CODE_TO_OFFICIAL_ITEM_D` is built from that list, so the code and the
`d` can never disagree.

### Why cosmetics are a separate list from `OFFICIAL_ITEM_DEFINITIONS`

`CONSUMABLE_ITEM_CATEGORIES` is derived from `ITEM_CATEGORIES` **by exclusion**
(everything that is not `currency`). Adding a `headwear` category so a hat could
be expressed in the consumable registry would therefore also declare hats
*consumable*, and `shop-catalog.ts` would treat them as sellable care items.
Cosmetics also have no meaningful `action`, `stages` or `effects`. They are a
different domain that happens to share a kind — so they get their own identity
list and resolve through the **same** catalog query.

### Transitional codes

No pre-existing code described the Block Builder Cap. The legacy series is
numeric (`headwear-1` … `headwear-21`), and each number is backed by a file in
`public/assets/`. A new accessory therefore gets a **slug** code, not the next
number:

- `headwear-block-builder-cap` ✅
- `headwear-22` ❌ — implies a local file that does not exist, and collides with
  the next hat that does ship one.

The slug still matches `ACCESSORY_CODE_PATTERN` and still infers its slot from
the prefix, so every existing parser accepts it unchanged.

---

## 6. Official issuer rule

Identity is **always the full address**, never the bare `d`:

```
31632:9efb8d3045ba753f3664d503308b49783356b26a6d5f4b944bfac4239afe63a9:<d>
```

kind:31632 is addressable, so anyone may publish `blobbi:cosmetic:block-builder-cap`
and relays will serve it. Resolving by `d` would let a stranger decide what a
player's hat looks like. `parseOfficialItemDefinition` rejects every other issuer
before a definition can enter the catalog, and `accessoryItemAddress` builds the
address from `OFFICIAL_ITEM_ISSUER_PUBKEY`. Both are tested with a third-party
event carrying the identical `d`.

---

## 7. Publishing and activation checklist

Publishing and activation are **two separate events**, separated by a reviewed
source-code change.

1. Author the definition in `/tools/game-items` → **Item Studio**.
2. Include an unmarked primary `image`, plus `front` and `back` views (side views
   optional — they are preserved but never posed).
3. Set `type: cosmetic`, `category`, `rarity`, `symbol`, and
   `content.visual.slot` / `visual.forms`.
4. Sign and publish. Confirm the event on **both** official relays.
5. Open **Published Items** → the card shows an **Accessory activation** panel.
   It will say *Not mapped*.
6. Use **Copy registry snippet**, paste into `OFFICIAL_COSMETIC_DEFINITIONS`,
   review, commit.
7. Reload: the panel reads **Active**.

The tool never edits source and never activates anything.

---

## 8. Fallback rules

**Mapped accessory** (`island-accessory-sources.ts`, highest first):

1. the requested pose's `image` view (`front` / `back`)
2. the definition's primary image
3. when resolving `back`: the definition's `front` view
4. the definition's first valid image
5. the URL stored on the equip tag, else the generated remote URL
6. local `.webp`
7. local `.png`

**Unmapped accessory:** steps 5–7 only — byte-for-byte the pre-migration chain.

Published artwork outranks inferred paths. Resolution is **synchronous and
side-effect free**: a render never triggers a fetch.

---

## 9. Editor behavior

`AccessoryOverlay` is now definition-aware **for artwork only**. It calls the
same `createIslandAccessorySourceResolver` the world calls, with the same
`facing`, so a mapped accessory is positioned against exactly the picture it will
be worn as.

Unchanged: placement editing writes only x/y/scale/rot/flipX; dragging publishes
no event; no inventory mutation; no Placement event.

**One shared transform covers every view.** A front and a back view of the same
hat cannot be positioned independently. Per-view placement would require a
Placement design that does not exist — see §11.

---

## 10. Deletion criteria for legacy assets and code

A local asset or legacy code path may be removed **only when all** hold:

1. the official definition is published and fetched back from the official relays;
2. a `legacyCode` mapping exists and the Studio reports **Active**;
3. the definition supplies every view the renderer requests (primary + front, and
   back if the slot is rear-visible);
4. no currently-equipped accessory depends on the local path as its only source;
5. editor previews still render with the local file deleted.

**Publishing alone is not sufficient.** Until the production resolver
demonstrably no longer needs the fallback, the file stays.

---

## 11. Final state, once Placement exists

- `equip` stops carrying placement; a Placement event owns x/y/scale/rot/flip,
  potentially **per image view**.
- `inv`/Grant owns ownership.
- The `legacyCode` indirection disappears: an equipped item is referenced by
  address.
- `generateAccessoryUrl`, `accessoryImagePath` and
  `public/assets/characters/blobbi/accessories/**` can be deleted.
- `ACCESSORY_CODE_TO_OFFICIAL_ITEM_D` becomes empty and is removed.

None of this is implemented. No Grant, no Placement, no new equip event.

---

## 12. Migration checklist

Update this table as accessories are published.

| Name | Legacy code | Official `d` | Pub | Primary | Front | Back | Mapped | Verified | Legacy metadata removed | Legacy artwork removable |
|---|---|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Block Builder Cap | `headwear-block-builder-cap` | `blobbi:cosmetic:block-builder-cap` | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | n/a² | n/a³ |
| — | `headwear-1` … `headwear-21` | *(unpublished)* | ❌ | — | — | — | ❌ | — | n/a² | ❌ |
| — | `eyewear-2` … `eyewear-4` | *(unpublished)* | ❌ | — | — | — | ❌ | — | n/a² | ❌ |

¹ Verified on `wss://relay.ditto.pub`. **Not present on `wss://relay.dreamith.to`**
  — the second official relay. Republishing there is recommended so the catalog
  resolves if Ditto is unreachable.
² There has never been legacy accessory *metadata* to remove (see §1).
³ No local artwork was ever shipped for this cap, so there is nothing to delete.

---

## 13. Scope boundaries held

No Grant. No Placement. No new equip event. No migration of any real user's
equip tags. No removal of fallback support for unpublished items. No per-Blobbi
or per-accessory query. No automatic publication. No source-code mutation from
the browser. `@blobbi/react` remains protocol-agnostic.
