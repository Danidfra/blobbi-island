# Blobbi Visual-Effect Activation (Phase 9)

How an owned official item becomes a rendered visual effect on the local
Blobbi. This is the production activation path introduced in Phase 9, built on
the Phase-8 renderer (see `docs/blobbi-visual-effects.md`) and the existing
kind:31634 equipment stack (`docs/blobbi-placement-activation-audit.md`).

```
kind:31633 inventory (owned)      kind:31634 placement (equipped)
            \                        /
             \                      /
   trusted full-address registry resolution
   (src/effects/official-visual-effect-items.ts)
                    |
     game-defined slot / form validation
     (pure: src/effects/active-effects.ts)
                    |
        plain BlobbiVisualEffect[]
                    |
  CharacterEquipmentProvider → CurrentBlobbiDisplay
                    |
        @blobbi/react (BlobbiRendererView.effects)
```

## 1. The stable official item registry

`OFFICIAL_EFFECT_ITEM_DEFINITIONS` in `src/protocol/event-registry.ts` is the
canonical table: for each of the twelve published effect items it records the
stable `d`, a display fallback (name, symbol, primary image, rarity), the
expected local effect id, the expected placement slot, the supported forms and
whether the published definition carries the `arcade-prize` topic.

`src/effects/official-visual-effect-items.ts` is the TYPED projection the
activation path consumes. It narrows effect ids and slots to the renderer's
own types and **refuses to load** if any entry names an effect the renderer
does not implement, claims a slot that disagrees with the renderer's
`EFFECT_SLOTS`, or duplicates a `d`/address. Lookup is
`resolveOfficialVisualEffectItem(address)`.

The four published wearables (Celestial Seraph Necklace, Starlight Bow Tie,
Block Builder Cap, Stargazer Glasses) are registered in the pre-existing
`OFFICIAL_COSMETIC_DEFINITIONS` list and flow through the unchanged wearable
path.

## 2. Why event ids are never identity

kind:31632 is addressable. The issuer republishes a definition — new event id,
new signature, same `31632:<issuer>:<d>` address — whenever metadata changes.
Anything keyed on an event id breaks on the first such update. The registry
therefore stores no event ids; the currently published revisions live only in
`src/effects/official-item-event-fixtures.ts` for tests and the dev inspector,
and a fixture test asserts that feeding an event id to the registry resolves
nothing.

## 3. The full-address trust rule

A supported local effect is authorized by the full stable address
`31632:<official-issuer>:<d>` and by nothing else. Never by: event id, `d`
alone, item name, `visual.effect`, `metadata.effectId`, category, topics, or
image URL. A third-party event that copies
`{"visual":{"effect":"celestial-aura"}}` under its own pubkey forms a
different address, resolves to nothing, and is refused on the wearable path as
`untrusted-issuer`. The issuer-claimed `visual.effect` / `visual.effectSlot`
ARE parsed (`effectVisual` on the resolved definition) — but only as
diagnostics for tests and the dev inspector, never as an activation input.

## 4–5. Ownership and placement requirements

Activation requires ALL of:

- registered official address (§3);
- kind:31633 quantity ≥ 1 for that exact address, in the owner's inventory;
- an equip-mode entry for that address in the Blobbi's kind:31634 equipment
  document, in the registered slot, signed by the Blobbi's owner;
- a compatible current form (§7).

Placement is never possession; possession is never placement; an official
definition existing is neither. Equipping never decrements quantity and
removing never increments it — kind:31633 is untouched in both directions.

**Stale placements**: when an equipped item is no longer in the inventory, it
is not rendered, the raw placement entry is preserved (rendering never
publishes cleanup), and the Effects panel lists it with an explicit
player-driven Remove action.

## 6. Slot vocabulary

Wearable slots (`headwear`, `eyewear`, `back`, `neckwear`, `handheld`,
`face-mark`, `aura`, `color-overlay`) and effect slots (`aura`,
`ground-local`, `ambient-particles`, `body-overlay` — derived from the
renderer's `EFFECT_SLOT_ORDER`, never restated) form one combined vocabulary
(`PlacementSlot` in `src/placement/policy.ts`). Rules:

- at most one active placement per canonical slot name (exact comparison);
- `aura` is deliberately shared: an image aura accessory and an aura effect
  conflict, so a Blobbi has one aura however it is drawn;
- an effect item may only occupy its registered slot — a placement claiming a
  different slot is refused (`slot-mismatch`), not relocated;
- wearables continue to be validated against their published `visual.slot`;
- event-declared slots never extend the trusted vocabulary.

Examples: Celestial Aura + Golden Sparkles + Pixel Glitch + Mystic Fog — four
slots, all active. Celestial Aura + Solar Radiance — one `aura` slot, the last
equipped wins and equipping warns first. Necklace + Bow Tie — a `neckwear`
conflict, independent of effects. Block Builder Cap + Celestial Aura — fine.

## 7. Form validation

Every current effect registers `forms: ["baby", "adult"]` (matching the
published `visual.forms`). A known stage outside the registered forms is
refused (`incompatible-form`) — so an egg activates nothing — and an unknown
stage is no restriction, so effects do not flicker off while the Blobbi list
loads. "The item supports these forms" (registry fact) is deliberately
separate from "this Blobbi currently has this form" (kind:31124 fact).

## 8. The pure resolver

`resolveActiveBlobbiEffects({ placements, quantityByAddress, stage })` in
`src/effects/active-effects.ts` applies the gates registry → mode → slot →
ownership → form, resolves same-slot duplicates deterministically (last valid
equip wins, the loser is diagnosed as `slot-conflict`), and returns
`{ effects, active, rejected }` with `effects` ordered by the renderer's
canonical `EFFECT_SLOT_ORDER`. It is pure — no hooks, queries, signing,
publishing, clock or randomness — which is what lets the dev simulator and the
tests drive it freely. The AUTHOR gate (document signed by the Blobbi's owner)
is applied by the caller, `useCharacterEquipment`, which knows signatures.

## 9. The local rendering path

`useCharacterEquipment` partitions the one equipment document by item address:
official effect items go through the pure resolver, everything else through
the wearable policy. `CharacterEquipment` gained `effects` (plain renderer
input), `activeEffects` and `rejectedEffects`. The app-root
`CharacterEquipmentProvider` resolves once; `CurrentBlobbiDisplay` reads the
context and passes `effects` to `BlobbiRendererView` — no per-Blobbi
subscription, no new query, and `@blobbi/react` still receives only plain
`{ id }` data, never an item definition or a Nostr event.

Effects follow the visual, exactly like accessories: a `visualOverride`
renders effects only from an explicit `effectsOverride`; with no override the
local companion's resolved effects draw; `showAccessories={false}` renders a
bare Blobbi. With no active effects the renderer receives an empty list and
its output is unchanged from the Phase-8 baseline. Remote Blobbi rendering is
untouched.

## 10–11. Player UI and preview

The **Effects** tab in `BlobbiInfoModal` hosts `EffectsPanel`
(`src/components/blobbi/EffectsPanel.tsx`), grouped by slot in canonical
order. Cards show the published artwork, name, rarity, description, slot,
equipped state and compatibility; only owned, form-compatible official
effects are actionable, with unowned/incompatible items in a collapsed locked
list carrying honest reasons (`useOwnedVisualEffects`).

**Preview** drives `CurrentBlobbiDisplay.effectsOverride` — the real renderer
path — on the modal stage. It writes nothing (no 31633, no 31634, no
publish), keeps the current form and worn accessories visible, is clearly
badged, and cancelling (or leaving the tab, or landing a real mutation)
restores the persisted view.

**Equip/replace** goes through the existing `useEquipmentMutation`: when the
slot is occupied the card states exactly what will be replaced ("Equipping
Solar Radiance will replace Celestial Aura in the Aura slot.") and the action
reads Replace. **Remove** unequips the one slot and preserves every unrelated
placement. Pending state disables all mutating buttons.

## 12. Mutation and concurrency

Effects reuse the wearable write path unchanged: per-document serialization, a
fresh relay read as the base of every write, complete-replacement publish with
an incremented revision, optimistic cache update, rollback on failure,
invalidation on settle, and preservation of unknown fields/unrelated entries
via the package's `toBuildGameItemPlacementInput`. The
equip-Celestial-Aura-then-immediately-equip-Solar-Radiance race is tested
end-to-end (`src/placement/effect-equipment-mutation.test.tsx`): publishes
serialize, the final document holds exactly one aura (the second), and the
first is not resurrected. Signer rejection and relay failure surface in the
panel without clearing state; nothing calls `window.location.reload()`.

## 13–15. Stale placements, wearable compatibility

Stale behavior is §4–5. Wearables and effects share the single per-character
kind:31634 document — the audit (§4 of
`docs/blobbi-placement-activation-audit.md`) records why that is safe. There
is **no legacy migration in this phase because none is needed**: the legacy
31124 equip path was already deleted before Phase 9, and
`src/legacy-accessory-removal.test.ts` keeps it deleted. Front/back accessory
artwork, rear hidden-slot policy, placement geometry, the accessory editor and
equipment ownership policy are unchanged and covered by their existing tests.

## 16. Published official items

Sixteen kind:31632 events by the official issuer
(`9efb8d30…afe63a9`), all signature-verified: four wearables and twelve
effects (fixtures: `src/effects/official-item-event-fixtures.ts`). Exactly
three carry `arcade-prize` — **Golden Sparkles, Mystic Fog, Celestial Aura** —
which is acquisition metadata only and never affects rendering, ownership or
placement. (The Phase-9 hand-off's "Rainbow Cream" heading was a typo; the
signed event is Rainbow Dream.)

## 17. Non-goals of this phase

No Grant implementation, no Arcade prize granting, no ticket spending, no
inventory mutation from equipping, no remote-player effect projection, no
presence (kind:31950) changes, no per-remote-player queries, no execution of
event-provided code, no legacy migration, no `@blobbi/react` publish, no
changes to movement, ground anchors, shadows, depth scaling or the theater.

## 18. Future remote projection (Phase 10 recommendation)

The safest design given this implementation: render a remote Blobbi's effects
by reading that player's OWN kind:31634 equipment document and kind:31633
inventory through **batched, shared queries** (one query for all on-screen
players per kind, cached app-wide like the local provider — never one
subscription per remote Blobbi), then feeding the same pure resolver with the
remote owner's data. Never trust effect ids carried in presence strings:
presence should at most hint that equipment changed. The author gate
(`mayModifyCharacter`) and full-address registry already make a remote
document safe to evaluate verbatim.

## 19. Future Arcade Grant flow

Granting an arcade-prize effect item is an inventory mutation (kind:31633 +1
through the existing writers) plus normal activation — nothing in the
activation path needs to change. The `arcadePrize` flag in the registry marks
which items the Prize Counter may offer once Grant exists.

## Related documents

- `docs/blobbi-visual-effects.md` — the renderer-side effect system (Phase 8)
- `docs/blobbi-placement-activation-audit.md` — the Phase-9 pre-implementation audit
- `docs/INVENTORY_ARCHITECTURE.md` — kind:31632/31633 stack
- `docs/game-item-image-views.md` — accessory artwork views
- `docs/blobbi-renderer-contract.md` — the renderer boundary
- `docs/protocol/blobbi-island-event-registry.md` — generated kind registry (now includes 31634)
