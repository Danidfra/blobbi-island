# Inventory & Equipment Lab (Phase 9.5, hardened in 9.5a)

The internal developer tool for testing official items against a REAL account:
adding/removing kind:31633 inventory, equipping/replacing/removing kind:31634
wearables and effects, and inspecting the resulting state — without editing
raw JSON.

**Where:** the "Equipment Lab" tab of `/tools/game-items`
(`src/components/tools/game-items/InventoryEquipmentLab.tsx`, pure logic in
`src/tools/game-items/inventory-equipment-lab.ts`) — **only in builds that
enable it** (§1).

## 1. Access policy: BUILD-FLAG GATED, off by default

The Lab is gated by `VITE_ENABLE_LIVE_INVENTORY_LAB`
(`src/lib/feature-flags.ts`): it exists in a build **only when the variable
is the exact string `"true"` at build time**. Default builds — including
`npm run dev` and every production build without the variable — do not
expose the tab, do not include the Lab's chunk, and mount none of its
mutation hooks; a stale or forged tab value falls back to the Item Studio,
and the tools page shows a read-only "Live Inventory Lab is disabled in this
build." note. Enabling the flag is a **deliberate operator/developer
decision** (locally: `.env.local`).

The rest of the Game Item Tools keep their existing policy (production
bundle, direct URL, no player navigation link). To be clear about what each
layer is and is not:

- **the build flag is the product access gate** — without it there is no
  mutation surface to reach;
- **signer ownership checks remain necessary but are not the access gate**:
  within an enabled build, every write still needs the logged-in account's
  signature and can only touch the signer's OWN kind:31633 inventory and
  their own companion's kind:31634 document (no foreign-pubkey input exists —
  asserted by `src/tools/game-items/boundaries.test.ts`);
- **neither the flag nor the route is protocol-level authorization**: any
  user can construct their own Nostr events in another client. What the flag
  guarantees is that Blobbi itself does not hand every authenticated player
  an unrestricted reward-minting surface by default. Route obscurity is not,
  and is not described as, security;
- no private key is ever requested, stored or mentioned; without a signer,
  every write control is disabled and a notice says so.

The header keeps the three roles visibly apart: the official ISSUER (authored
the kind:31632 definitions; the lab never writes as it), the inventory OWNER
(the signer, shown as npub + hex), and the equipment TARGET (the current
companion Blobbi, shown by name/id/stage).

## 2. Every write is confirmed — no exceptions

**Every** real kind:31633/31634 write — single-item add/remove/set,
remove-completely, equip, replace, unequip, stale-placement removal, all bulk
actions, the test loadout and the stack repair — is staged as a
`PendingWrite` and published only from the one confirmation dialog. The
dialog states the exact event kind, the target account (and target Blobbi for
kind:31634), the item name and stable address, the quantity or slot change,
any replacement consequence, and what is deliberately NOT touched ("No
equipment placement will be changed." / "Inventory quantity will not
change."). A source-level test pins that `confirmPending` is the only
call-site of either writer. Cancel publishes nothing; while a publish is in
flight both dialog buttons and all row controls are disabled (an in-flight
signature cannot honestly be "cancelled"); a failed publish keeps the dialog
open and fabricates no success. There is no simulation mode — the lab exists
to test the REAL write paths.

## 3. max_stack is respected by every normal control

All sixteen official items publish `max_stack: 1`, recorded as `maxStack` on
the canonical registry entries (fixture tests pin registry ↔ signed-event
agreement). Normal controls never exceed it:

- **Add to inventory** means `0 → 1` and is disabled (labelled "Owned") once
  the quantity is at least one — it can never produce 2;
- the set-quantity input validates `0 ≤ quantity ≤ maxStack`;
- a pre-existing over-max quantity is DISPLAYED as exceeding the published
  max (`×3 (exceeds max_stack:1)`) and left alone by add actions;
- there is deliberately **no advanced override**: this phase removed the
  ability to create over-max quantities entirely, preferring the safer
  implementation.

## 4. Inventory and equipment actions

Per official item (the sixteen published wearables/effects, §6): add to
inventory, remove one, set an exact quantity (bounded by max_stack), remove
completely (with the stale-placement consequence spelled out), copy address,
inspect the resolved definition and current inventory state, equip (when
owned and the slot is known) and unequip — each behind its own confirmation
(§2). Placement rows show slot, item, mode, ownership, valid/stale/rejected
status with the policy's reason, and the raw placement entry; the parsed
document (d, target, revision) is inspectable below.

All writes flow through the two canonical production writers —
`useInventoryMutation` (31633) and `useEquipmentMutation` (31634) — inheriting
their per-user/per-document serialization, fresh-relay-read base, optimistic
cache updates, rollback on failure and post-publish reconciliation. The lab
adds NO third writer (boundary-tested). Inventory writes never equip;
equipping never changes a quantity; no negative quantities; zero-quantity
entries are omitted exactly as the package builder specifies.

## 5. Bulk actions

Inventory: add/remove all official wearables, all official effects, or all
sixteen — plus the explicit repair, "Normalize official non-stackable
quantities". Each computes ONE final state (`planBulkInventoryAction`), shows
the complete from→to diff, and publishes ONE canonical kind:31633 event via
the `set-many` mutation — never one event per item. **Bulk add ENSURES
OWNERSHIP rather than incrementing**: `0 → 1`, owned items are omitted from
the diff, and a quantity already above the published max is neither
incremented nor silently normalized — it is listed in the dialog as an
anomaly ("Celestial Aura ×2 — quantity exceeds published max_stack:1") for
the normalize action, which plans `quantity > max → max` and nothing else.
Bulk removal targets only the official registered addresses; third-party
entries in the same inventory are structurally out of reach.

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
