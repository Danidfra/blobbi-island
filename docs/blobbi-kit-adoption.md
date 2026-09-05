# Blobbi Kit adoption: what Island takes from the shared kit, and what it keeps

Audited against the installed packages `@blobbi-kit/core` 0.5.1,
`@blobbi-kit/react` 0.5.1 and `@blobbi-kit/renderer` 0.1.0 (registry, no
`file:` links). Everything below was checked against the packages' actual
exports, not their READMEs.

## Ownership matrix

| Island module | Kit counterpart | Bucket | Decision |
| --- | --- | --- | --- |
| `lib/blobbi-kinds.ts` | core `KIND_*` constants | A canonical | re-export only; no literal kind numbers elsewhere in `src` |
| `inventory/care-effect.ts` XP / streak | react `blobbi-xp`, `blobbi-streak` | A | already on the kit |
| item-use interaction events | core `buildInteractionEventTemplate` | A | already on the kit |
| egg preview / adoption traits, seed, d, Blobbonaut tags | core `deriveVisualTraits`, `deriveBlobbiSeedV1`, `getCanonicalBlobbiD`, `buildBlobbonautTags` | A | already on the kit |
| every body drawing | renderer `BlobbiRenderer`, `renderBlobbiSvg` | A | `BlobbiCard` moved from `loadBlobbiSvg` (V1-only) to `renderBlobbiSvg` so it honours the generation |
| `visual_generation` reading | core `parseVisualGeneration` | A (new) | wired into `parsePetState`; propagated to every renderer input |
| `lib/blobbi-parsers.ts` `parsePetState` / `validatePetStateEvent` | core `parseBlobbiEvent` / `isValidBlobbiEvent` | D deferred | not equivalent: Island requires `breeding_ready`, `generation`, `experience`, `care_streak` and accepts a missing `b`; core does not. Migrating changes which events Island accepts |
| `mergePetStateTags` / `mergeOwnerProfileTags` | core `merge*TagsForRepublish` | D deferred | different managed-tag sets and passthrough rules; a republish would rewrite tags differently |
| `lib/blobbi-legacy.ts` `isModernBlobbi` | core `isLegacyBlobbiEvent` | D deferred | Island's filter is looser (d regex + any seed); swapping it hides or shows different Blobbis |
| `hooks/useBlobbis.ts` | react `useBlobbisCollection` | D deferred | Island needs relay-confirmed empty reads, excludes eggs and hands out the legacy `Blobbi` shape the whole UI consumes |
| `useBlobbonautProfile`, `useSetCurrentCompanion`, `analyzeCareStatus`, `useOptimizedStatus`, `pet-state-transaction.ts`, `adoption-handoff.ts` | core Blobbonaut / decay helpers | D deferred | all consume the local parser above; they move together or not at all |
| movement, facing, pose, ground anchor, presence, rooms, seats | none | C Island-specific | stays; see `blobbi-actor-architecture.md` §15 |
| inventory (`@nostr-games/inventory`, kinds 31632/31633/31634), Farm interop, economy, Care Store | none | C | stays |
| `lib/blobbi-visual-dev.ts` override | none | C (DEV only) | stays; never a source of generation, see `blobbi-visual-v2-dev-override.md` |

Bucket B (duplicated with an equivalent kit API) is empty: every duplicate
found differs in accepted input or output shape, so migrating it is a
behaviour change, not a refactor. Those rows are bucket D and are the
shared-library blockers for a standalone rebuild.

## Compat code after 0.5.1

No compatibility shims for older kit versions exist in Island. The react
package dropped its `@nostrify/nostrify` peer in 0.5.x; Island depends on
Nostrify directly, nothing changed. `isUnsupportedLegacyBlobbiEvent` is not
used. No `@blobbi/renderer`, `file:` or `../blobbi-kit` references remain
outside the boundary test that forbids them.
