# Blobbi Kit adoption: what Island takes from the shared kit, and what it keeps

Audited against the installed packages `@blobbi-kit/core` 0.5.2,
`@blobbi-kit/react` 0.5.2 and `@blobbi-kit/renderer` 0.1.0 (registry, no
`file:` links). The 0.5.2 re-audit moved the parser, validator and legacy
filter to the kit; the rows below are the current state. Everything below was checked against the packages' actual
exports, not their READMEs.

## Ownership matrix

| Island module | Kit counterpart | Bucket | Decision |
| --- | --- | --- | --- |
| `lib/blobbi-kinds.ts` | core `KIND_*` constants | A canonical | re-export only; no literal kind numbers elsewhere in `src` |
| `inventory/care-effect.ts` XP / streak | react `blobbi-xp`, `blobbi-streak` | A | already on the kit |
| item-use interaction events | core `buildInteractionEventTemplate` | A | already on the kit |
| egg preview / adoption traits, seed, d, Blobbonaut tags | core `deriveVisualTraits`, `deriveBlobbiSeedV1`, `getCanonicalBlobbiD`, `buildBlobbonautTags` | A | already on the kit |
| every body drawing | renderer `BlobbiRenderer`, `renderBlobbiSvg` | A | `BlobbiCard` moved from `loadBlobbiSvg` (V1-only) to `renderBlobbiSvg` so it honours the generation |
| `visual_generation` reading | core `parseVisualGeneration` | A | read by core inside `parseModernBlobbiEvent`; `PetState.visualGeneration` copies the companion's value and reaches every renderer input |
| `lib/blobbi-parsers.ts` `parsePetState` / `validatePetStateEvent` | core `parseModernBlobbiEvent` / `isModernBlobbiEvent` (0.5.2) | A (migrated) | thin adapter: validity and every protocol field come from core's companion; `companionToPetState` maps to Island's shape and reads Island extension tags (`is_sleeping`, care timestamps, social flags). Missing `b` is now rejected (core contract); stats are defaulted, not required |
| `mergePetStateTags` / `mergeOwnerProfileTags` | core `merge*TagsForRepublish` | C Island-specific | Island manages its own 31124 extension tags and the 11125 profile is a separate protocol; historical egg/fee fields were removed from the writer since a legacy event never parses |
| `lib/blobbi-legacy.ts` `isModernBlobbi` | core `classifyBlobbiEvent` (0.5.2) | A (migrated, removed) | the collection is modern by construction, so the UI-layer filter is gone; `getBlobbiDisplayName` stays (display policy) |
| `hooks/useBlobbis.ts` | react `useBlobbisCollection` (0.5.2 `stages`, `status`) | still blocked | parsing is shared, the READ policy is not: the kit's `'empty'` is one resolved read, Island requires a completed empty answer confirmed by a second read plus a 2 s unknown deadline (`readRelayConfirmedOrThrow`), which the empty-nest vs hiding-nest screens depend on; the `['blobbis', pubkey]` cache is written by the adoption handoff. Unblocks when the kit accepts a pluggable read/confirmation policy |
| `useBlobbonautProfile`, `useSetCurrentCompanion`, `analyzeCareStatus`, `useOptimizedStatus`, `pet-state-transaction.ts`, `adoption-handoff.ts` | core Blobbonaut / decay helpers | C Island-specific | consume the adapter above (so their 31124 reads are canonical); the 11125 profile semantics and Island's transaction/read policies stay local |
| movement, facing, pose, ground anchor, presence, rooms, seats | none | C Island-specific | stays; see `blobbi-actor-architecture.md` §15 |
| inventory (`@nostr-games/inventory`, kinds 31632/31633/31634), Farm interop, economy, Care Store | none | C | stays |
| `lib/blobbi-visual-dev.ts` override | none | C (DEV only) | stays; never a source of generation, see `blobbi-visual-v2-dev-override.md` |

With 0.5.2 the kind 31124 read side is canonical: Island keeps no second
protocol parser and no legacy filter. What remains local is Island-specific
(write side, profile, read policy). The one item still blocked on the kit is
the collection READ policy noted in the `useBlobbis` row.

## Compat code after 0.5.1

No compatibility shims for older kit versions exist in Island. The react
package dropped its `@nostrify/nostrify` peer in 0.5.x; Island depends on
Nostrify directly, nothing changed. `isUnsupportedLegacyBlobbiEvent` is not
used. No `@blobbi/renderer`, `file:` or `../blobbi-kit` references remain
outside the boundary test that forbids them.
