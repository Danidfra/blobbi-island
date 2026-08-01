# Blobbi Island — Placement & Effect-Activation Audit (Phase 9, pre-implementation)

Date: 2026-07-31 · Branch `production` · Baseline commit `627ced2`
(`polish(blobbi): final visual-polish pass for the twelve effects`).

This audit was performed against the **actual repository**, not against the
reports of earlier phases. Where an older phase description and the code
disagree, the code below is what Phase 9 builds on.

---

## 1. What already exists

### kind:31634 — FULLY IMPLEMENTED, and already the only wearable path

The placement kind is **fully implemented** and has been the production
equipment path since commits `06f2c02` (equipment service) and `67df788`
(legacy clean cut). There is no partial implementation to finish and no
parallel legacy path to avoid.

| Concern | Where | Owner |
|---|---|---|
| Parsing / building / validation / addressing / slot mutations | `@nostr-games/inventory@0.3.0` (`KIND_GAME_ITEM_PLACEMENT`, `parseGameItemPlacementResult`, `buildGameItemPlacementEvent`, `setEquippedPlacementForSlot`, `removeEquippedPlacementFromSlot`, `toBuildGameItemPlacementInput`, `compareGameItemPlacementRevisions`) | external package |
| Import surface | `src/inventory/package.ts` (single audited re-export) | Island |
| Document identity | `src/placement/identity.ts` — `d = blobbi-island:character:<characterId>:equipment`, `target = {type:'address', address:'31124:<owner>:<characterId>'}` | Island |
| Read model | `src/placement/usePlacementState.ts` — newest-valid-event selection, honest `isEmpty`, canonical query key `['blobbi-placement-31634', owner, characterId]` | Island |
| Write model | `src/placement/useEquipmentMutation.ts` — per-document serialization, fresh relay read before every write, complete-replacement publish, revision increment, optimistic cache update, rollback, invalidation | Island |
| Authorization policy | `src/placement/policy.ts` — author → mode → slot → issuer → definition → ownership → form gates; last-wins slot conflicts | Island |
| Render translation | `src/placement/render-model.ts` — 2D-percent reference, defaults, unsupported-transform refusal | Island |
| Join hook | `src/placement/useCharacterEquipment.ts` — 31634 ∩ 31633 ∩ 31632 → `AccessoryPlacementInput[]` + `hidden[]` diagnostics | Island |
| App distribution | `CharacterEquipmentProvider` (app root) → `useCharacterEquipmentContext` → `CurrentBlobbiDisplay` | Island |

**Protocol code ownership**: the event format belongs to
`@nostr-games/inventory`. Island owns only identity conventions, policy,
render translation and orchestration. Phase 9 does **not** modify the package
and does not duplicate its parsing.

**Conclusion for Phase 9**: *extend* the existing implementation. Do not add a
second one.

### Placement identity and target-Blobbi ownership

One equipment document per character, addressable as
`31634:<owner>:blobbi-island:character:<id>:equipment`, signed by the player.
Policy accepts a document only when `author === owner` (`mayModifyCharacter`).
The document's `target` re-asserts the Blobbi's 31124 address on every write.

### Effects renderer (Phase 8, accepted baseline)

`@blobbi/react` implements the twelve effects and exports the full vocabulary
needed by this phase — `BLOBBI_VISUAL_EFFECT_IDS`, `BlobbiVisualEffect`,
`EFFECT_SLOTS` (id → slot), `EFFECT_SLOT_ORDER`
(`aura, ground-local, ambient-particles, body-overlay` — the canonical order;
Phase 9 must NOT invent a second one), `normalizeBlobbiVisualEffects`
(dedupe, one-per-slot, canonical ordering), and
`BlobbiRendererView`'s `effects?: readonly BlobbiVisualEffect[]` prop.
The renderer is protocol-agnostic and must remain so.

### Trusted effect-item registry (Phase 8 preparation)

`src/effects/official-visual-effect-items.ts` maps the twelve official item
`d` tags to local effect ids + rarity, derives addresses from
`OFFICIAL_ITEM_ISSUER_PUBKEY`, and resolves **only** by full
`31632:<issuer>:<d>` address. It is deliberately inert: no inventory, no
placement, no production render path. Phase 9 activates it.

The `d` values and rarities in that table match the sixteen published events
supplied with this phase **exactly** (verified against the signed events — all
sixteen signatures and ids verify against the official issuer pubkey
`9efb8d3…63a9`).

### Catalog & item resolution

- `src/protocol/event-registry.ts` is the canonical machine-readable source
  for kinds and official 31632 identities. Consumables (19) and cosmetics are
  separate lists; only **Block Builder Cap** is currently registered as a
  cosmetic.
- `useItemCatalog` fetches all official `d` tags in ONE filter across the
  official relays + configured relay, resolves fetched → bundled fallback,
  and caches under one key. Cosmetics resolve into the same map.
- `protocol-adapter.ts` parses `content.visual.slot` / `visual.forms` with
  absent-vs-malformed diagnostics. It does **not** yet read `visual.kind`,
  `visual.effect` or `visual.effectSlot` (the effect-item fields).

### Ownership

`useIslandInventory` / `fetchInventory` (kind:31633, `d = blobbi:island`).
Equipping checks quantity ≥ 1 against a **fresh** relay read at write time and
never mutates quantity. The same rule applies to effects unchanged.

### Player UI

`BlobbiInfoModal` (tabs `primary` / `inventory`) hosts `EquipmentPanel`
(owned/worn, equip/unequip/transform) wired to `useEquipmentMutation`, plus
`CurrentBlobbiPreview` with drag placement overlay. `useEquippableCosmetics`
computes the equippable intersection with per-item unavailability reasons.
This is the natural home for the effect-management surface.

### Dev tooling

- `/dev/equipment` — real-service equipment inspector (publishes real events
  through the logged-in signer; it is not a simulator).
- `/dev/blobbi-effects` — pure renderer harness (no login, no relay, no
  queries); displays the trusted registry as reference data.
- Both are `import.meta.env.DEV`-gated; `src/dev-routes.test.ts` asserts
  production builds exclude them.

## 2. What is still legacy

**Nothing on the equipment path.** The kind:31124 `equip`-tag and kind:11125
`inv`-tag systems were deleted in `67df788`, and
`src/legacy-accessory-removal.test.ts` guards against reintroduction at the
source level. Wearables already flow exclusively through 31634 — so there is
**no legacy migration question for this phase**: accessories and effects will
share the same kind:31634 document from the start, and no implicit migration
happens because none is needed.

Legacy remnants that exist but are out of scope: kind:31125 profile
(read-compat only) and the Arcade's temporary local prize-ownership store
(`src/lib/arcade-prize-ownership.ts`, explicitly V1-temporary and untouched by
this phase).

## 3. Gaps Phase 9 must fill

1. **Registry**: kind:31634 is absent from `APPLICATION_EVENT_KINDS` (the
   generated protocol document does not mention it); the three new wearables
   (necklace, bow tie, glasses) are not in `OFFICIAL_COSMETIC_DEFINITIONS`;
   the twelve effect items are not part of the canonical registry or the
   catalog fetch at all.
2. **Effect-item registry completion**: `official-visual-effect-items.ts`
   records `d`/effect/rarity but not the expected placement slot, supported
   forms, or display fallback (name/symbol/primary image).
3. **Slot vocabulary**: `EQUIPPABLE_SLOTS` covers accessory slots only.
   `ambient-particles`, `body-overlay` and `ground-local` are unknown to
   policy and to `assertEquippableSlot` in the mutation layer. (`aura`
   already exists as an accessory slot; the canonical-slot rule means an aura
   accessory and an aura effect correctly conflict for the same slot.)
4. **Adapter**: no parsing of `visual.kind` / `visual.effect` /
   `visual.effectSlot` for diagnostics.
5. **Activation**: no pure resolver, no wiring of `effects` into
   `CharacterEquipment` / `CurrentBlobbiDisplay`, no player UI, no fixtures
   for the published events, no dev diagnostics for activation.

## 4. Can accessories and effects share one placement event?

**Yes, safely.** The package's placement mutations are slot-keyed and
preserve unrelated entries and unknown fields; Island's document identity is
per-character, not per-item-type. Slot names are disjoint by construction
(`headwear`/`eyewear`/`neckwear`/`back`/… vs
`ambient-particles`/`body-overlay`/`ground-local`), with `aura` shared
deliberately: one aura per Blobbi, whether drawn from an accessory image or a
local effect. Concurrency is already handled per document
(serialization + fresh-read + revision), which effects inherit for free.
Splitting effects into a second document would *add* a lost-update surface
between two events describing one Blobbi.

**Decision**: effects and wearables share the existing per-character
kind:31634 equipment document.

## 5. Form/stage resolution

Blobbi stage comes from the kind:31124 state (`currentPet.stage` /
`companion.stage`, values `egg` | `baby` | `adult`).
`CharacterEquipmentProvider` already threads it as `form`. All twelve
published effects declare `forms: ["baby","adult"]`; the registry records the
same, so `egg` never activates them and an unknown stage stays safe (treated
as no restriction for wearables; for effects the registry's forms are always
declared, and an unknown stage must not crash rendering).

## 6. Concurrency & stale-replaceable coverage today

`useEquipmentMutation.test.tsx` and `src/inventory/concurrency.test.tsx`
cover serialized writes, optimistic rollback and stale replaceable events for
the existing paths. Phase 9 adds the equip-aura-then-replace-aura sequence on
top of the same machinery.

## 7. Published events (input validation)

All sixteen supplied kind:31632 events were verified locally with
`nostr-tools` (`getEventHash` + `verifyEvent`): every id matches its event and
every signature verifies against the official issuer pubkey. The pasted
heading "Rainbow Cream" is a prompt typo; the signed event says
`Rainbow Dream` / `blobbi:effect:rainbow-dream` / `rainbow-dream`, and the
fixtures follow the signed content. Exactly three events carry the
`arcade-prize` topic: Golden Sparkles, Mystic Fog, Celestial Aura. One
publishing quirk worth recording: **Golden Sparkles is the only effect item
without the `wearable` topic** (it has `equipable` + `visual-effect`); this is
catalog metadata only and has no bearing on activation.

## 8. Phase-9 implementation plan (result of this audit)

1. Canonical registry: add kind:31634 to `APPLICATION_EVENT_KINDS`; add the
   three wearables to `OFFICIAL_COSMETIC_DEFINITIONS`; add a new
   `OFFICIAL_EFFECT_ITEM_DEFINITIONS` list (identity + display fallback +
   expected effect id/slot/forms as plain data) feeding catalog fetch and
   fallback exactly like cosmetics.
2. `src/effects/official-visual-effect-items.ts` becomes the **typed**
   authorization registry projected from the canonical list, with load-time
   consistency checks (known effect id, slot agrees with the renderer's
   `EFFECT_SLOTS`, no duplicates).
3. Extend the slot vocabulary in `policy.ts` (+ mutation assertion) with the
   three effect-only slots.
4. Adapter: parse `visual.kind`/`effect`/`effectSlot` into diagnostics fields.
5. Pure resolver `resolveActiveBlobbiEffects` in `src/effects/` (no hooks, no
   network, no signing), output ordered by the renderer's canonical
   `EFFECT_SLOT_ORDER`.
6. `useCharacterEquipment` routes registered effect-item placements through
   the resolver; `CharacterEquipment` gains `effects`;
   `CurrentBlobbiDisplay` passes them to `BlobbiRendererView` (local
   companion path only; `visualOverride` renders effects only from an
   explicit override, mirroring `accessoryOverride`).
7. Player UI: an Effects panel beside `EquipmentPanel` in `BlobbiInfoModal`,
   with owned-only actionability, slot grouping, replace warnings, real-path
   preview (no publish), and the existing mutation machinery.
8. Fixtures: the sixteen signed events stored as test/dev fixture data;
   fixture↔registry agreement tests; signature verification in tests.
9. Dev diagnostics on `/dev/blobbi-effects`: registry table, fixture ids,
   expected-vs-parsed, ownership/placement/form/conflict simulation through
   the pure resolver (no signer, no publish).
10. Docs: `docs/blobbi-effect-activation.md` + cross-links; regenerate the
    event-registry document.

## 9. Explicit non-goals confirmed

No Grant, no Arcade payout changes, no ticket spending, no inventory mutation
on equip/remove, no remote-player effect projection, no presence changes, no
per-remote-Blobbi subscriptions, no event-provided code execution, no legacy
migration, no changes to movement/anchors/shadows/depth/theater, no
`@blobbi/react` publish.
