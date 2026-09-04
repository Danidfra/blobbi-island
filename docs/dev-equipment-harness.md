# /dev/equipment: the simulation harness (Phase 9.5b)

A dev-only route (`import.meta.env.DEV`-gated in `AppRouter`, excluded from
production builds, `src/dev-routes.test.ts`) for testing all sixteen
official items visually, with **local simulation only**: it signs nothing,
publishes nothing, and never touches the real kind:31633/31634 state.

## 1–4. Purpose and the sixteen items

The harness shows every published official item, four wearables and twelve
visual effects: derived from the same canonical projection the Equipment Lab
uses (`LAB_OFFICIAL_ITEMS`, itself a projection of the Phase-9 registries):
full stable `31632:<issuer>:<d>` addresses, never event ids, no second
hand-maintained list. Display data prefers resolved kind:31632 definitions
(the read-only catalog query) with registry fallbacks. Each row shows
image, name, rarity, address, slot (published `visual.slot` for wearables,
registered effect slot + effect id for effects), supported forms, back-view
availability, and the simulated owned/equipped state.

## 2–3. Simulated inventory and placements

State lives in a pure reducer (`src/lib/dev-equipment-simulation.ts`):
quantities keyed by full address (owned = the published max_stack: 1, never
more, through any control), placement entries shaped exactly like a
kind:31634 document (one per slot, same-slot replacement, unrelated slots
preserved). Bulk actions (own/clear wearables, effects, all sixteen; reset)
update only this local state. Simulated equip requires simulated ownership
by default; the explicit "allow unowned equip" override exists solely to
create the stale placements the resolvers must reject.

## 5. The test loadout

"Apply simulated full loadout" applies the documented seven slots
(cap/glasses/bow-tie/celestial-aura/golden-sparkles/mystic-fog/pixel-glitch),
skipping steps whose item is not simulated-owned; "Clear simulated loadout"
empties the placements.

## 6. Renderer-path reuse

The preview is not a mock-up, the simulated state feeds the REAL production
code:

```
simulated placements → selectRenderablePlacements (policy)
  → toAccessoryPlacementInput → accessory source resolution (front/back)
  → BlobbiRendererView
simulated inventory + placements → resolveActiveBlobbiEffects
  → BlobbiRendererView.effects   (deterministic canonical order)
```

So ownership gates, slot conflicts, egg rejection (`incompatible-form`),
stale diagnostics and effect ordering here are the same behavior production
has, and the Diagnostics card shows each refusal with the policy's own
reason. The renderer-only effect gallery remains separately at
`/dev/blobbi-effects` (raw `BlobbiRendererView` driving, no ownership
simulation): that page's activation panel and this harness complement each
other.

## 7–9. Simulation vs the live account

`/dev/equipment` simulates; the **Equipment Lab**
(`/tools/game-items` → Equipment Lab, `VITE_ENABLE_LIVE_INVENTORY_LAB=true`)
signs. Real mutations deliberately do not belong in a dev harness: dev routes
are unconfirmed, unflagged and unaudited surfaces, and the 9.5a policy is
that every real write lives behind the build flag plus per-write
confirmations. A transitive boundary test (`DevEquipment.test.tsx`) proves
this route cannot import an inventory writer, equipment writer, signer or
publisher.

The Live Account card explains the path. Flag disabled (the default):

```
# .env.local
VITE_ENABLE_LIVE_INVENTORY_LAB=true
```

then FULLY restart Vite (hot reload cannot change build-time variables), or
run `npm run dev:inventory-lab`. Flag enabled: the card offers "Open Live
Equipment Lab", a deep link to `/tools/game-items?tab=lab`: validated by
`coerceToolTab`, so in a disabled build the same link safely lands on the
Item Studio and can never reveal the Lab.

## 10. Production exclusion

The route is mounted only under `import.meta.env.DEV`; production builds emit
no chunk for it (asserted by `src/dev-routes.test.ts`). `.env.example`
documents the Lab flag (off); `.env.local` is git-ignored.

**See also:** `docs/inventory-equipment-lab.md` · `docs/game-item-tools.md`
· `docs/blobbi-effect-activation.md`
