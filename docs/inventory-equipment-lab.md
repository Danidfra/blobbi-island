# Inventory & Equipment Lab (Phase 9.5)

The internal developer tool for testing official items against a REAL account:
adding/removing kind:31633 inventory, equipping/replacing/removing kind:31634
wearables and effects, and inspecting the resulting state — without editing
raw JSON.

**Where:** the "Inventory & Equipment Lab" tab of `/tools/game-items`
(`src/components/tools/game-items/InventoryEquipmentLab.tsx`, pure logic in
`src/tools/game-items/inventory-equipment-lab.ts`).

## 1. Route and access policy

Same policy as the rest of the Game Item Tools: ships in the production
bundle (it must work against production relays), reachable by direct URL,
**linked from no player navigation**. Obscurity is not authorization — the
real boundaries are:

- every write needs the logged-in account's signature, requested per action,
  never automatically;
- the lab can only write the signer's OWN kind:31633 inventory and the
  signer's own companion's kind:31634 document — there is no foreign-pubkey
  input anywhere (asserted by `src/tools/game-items/boundaries.test.ts`);
- no private key is ever requested, stored or mentioned;
- without a signer, every write control is disabled and a notice says so.

The header keeps the three roles visibly apart: the official ISSUER (authored
the kind:31632 definitions; the lab never writes as it), the inventory OWNER
(the signer, shown as npub + hex), and the equipment TARGET (the current
companion Blobbi, shown by name/id/stage).

## 2. Live-mutation warning

Every confirmation dialog states exactly what will happen before anything is
signed: *"This will publish a signed kind:31633 event"* or *"…kind:31634
event"*, plus the complete diff. There is no simulation mode — the lab exists
to test the REAL write paths, and a fixture that silently replaced live state
would defeat it. Cancel publishes nothing.

## 3–4. Inventory and equipment actions

Per official item (the sixteen published wearables/effects, §6): add one,
remove one, set an exact quantity, remove completely (confirmed, with the
stale-placement consequence spelled out), copy address, inspect the resolved
definition and current inventory state, equip (when owned and the slot is
known) and unequip. Placement rows show slot, item, mode, ownership,
valid/stale/rejected status with the policy's reason, and the raw placement
entry; the parsed document (d, target, revision) is inspectable below.

All writes flow through the two canonical production writers —
`useInventoryMutation` (31633) and `useEquipmentMutation` (31634) — inheriting
their per-user/per-document serialization, fresh-relay-read base, optimistic
cache updates, rollback on failure and post-publish reconciliation. The lab
adds NO third writer (boundary-tested). Inventory writes never equip;
equipping never changes a quantity; no negative quantities; zero-quantity
entries are omitted exactly as the package builder specifies.

## 5. Bulk actions

Inventory: add/remove all official wearables, all official effects, or all
sixteen. Each computes ONE final state (`planBulkInventoryAction`), shows the
complete from→to diff, and publishes ONE canonical kind:31633 event via the
`set-many` mutation — never one event per item. Bulk removal targets only the
official registered addresses; third-party entries in the same inventory are
structurally out of reach.

Equipment: unequip all effects, unequip all wearables, clear only stale
placements, and apply the documented test loadout — each ONE canonical
kind:31634 publish via the `apply-set` mutation, preserving unrelated
placements and unknown fields, incrementing the revision once.

## 6. The official item source of truth

`LAB_OFFICIAL_ITEMS` is a projection of the Phase-9 registries
(`OFFICIAL_COSMETIC_DEFINITIONS` + the typed effect registry) — sixteen items,
full stable `31632:<issuer>:<d>` addresses, no event-id identity, no second
hand-maintained list (tested). Display data prefers the fetched kind:31632
definition and falls back to the registry.

## 7. Stale placements

Removing an item from the inventory NEVER rewrites the placement document.
The placement stays, is diagnosed as `stale — not owned`, stops rendering
(ownership validation fails at render time), and gets its own explicit
"Remove stale placement" / "Clear stale placements" action. No implicit
cleanup happens anywhere, ever.

## 8. Serialization and rollback

Inherited unchanged from the writers: per-user chain for 31633, per-document
chain for 31634, both reading fresh relay state as the base of every write,
optimistic cache with rollback, invalidation on settle, pending state
disabling every mutating control (no double-submit). Tested in
`set-many-mutation.test.tsx`, `apply-set-mutation.test.tsx` and
`InventoryEquipmentLab.test.tsx`.

## 9. The documented test loadout

```
headwear          → Block Builder Cap
eyewear           → Stargazer Glasses
neckwear          → Starlight Bow Tie
aura              → Celestial Aura
ambient-particles → Golden Sparkles
ground-local      → Mystic Fog
body-overlay      → Pixel Glitch
```

Applying it previews every step (empty slot / replaces X / already equipped),
lists items not owned, and BLOCKS the equipment publish while anything is
missing — the offered fix ("Add required items to inventory first") is a
separate kind:31633 write with its own confirmation. Applying the loadout
never modifies quantities.

## 10. Separation from player reward flows

The lab is the sanctioned developer mutation surface; the player-facing Prize
Counter is preview-only and CANNOT reach it or either writer — proven against
the transitive import graph by
`src/components/blobbi/arcade/prizes/prize-counter-boundaries.test.ts`, with
the tools-side rules in `src/tools/game-items/boundaries.test.ts`. Grant is
not implemented anywhere; Arcade redemption stays disabled until its durable
grant/spending flow is audited separately (see
`docs/arcade-prize-catalog.md`).

**See also:** `docs/game-item-tools.md` · `docs/INVENTORY_ARCHITECTURE.md` ·
`docs/blobbi-effect-activation.md` · `docs/arcade-prize-catalog.md`
