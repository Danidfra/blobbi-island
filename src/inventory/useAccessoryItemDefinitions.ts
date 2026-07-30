/**
 * Blobbi Island — the item definitions that describe equipped accessories.
 *
 * A thin projection of the shared item catalog, keyed by accessory code so the
 * accessory source resolver can look one up with the only identity the renderer
 * boundary carries (see `accessory-item-identity.ts` for why the address, not
 * the `d` tag, is the identity, and why the mapping is empty today).
 *
 * It reads the catalog through `useItemCatalog`, which is ONE canonical query
 * key with a one-hour `staleTime` shared by every caller in the app, so mounting
 * this hook per rendered Blobbi adds a subscription to an already-running query
 * rather than a fetch. That matches how `CurrentBlobbiDisplay` already works —
 * it mounts `useBlobbis`, `useBlobbonautProfile` and `useAccessoryManagement`
 * per instance for the same reason.
 *
 * Deliberately NOT a fetch of its own: this phase adds no remote accessory
 * lookup. If an accessory has no published definition — which is every accessory
 * right now — the hook returns an empty map and the legacy asset chain answers
 * on its own.
 */

import { useMemo } from 'react';

import { accessoryDefinitionsByCode } from './accessory-item-identity';
import type { ResolvedBlobbiItemDefinition } from './catalog-fallback';
import { useItemCatalog } from './useItemCatalog';

/**
 * `accessory code → resolved item definition`, for the accessories that have a
 * published official definition.
 *
 * The returned map is referentially stable between catalog updates, so a
 * resolver memoized on it is not rebuilt on every render.
 */
export function useAccessoryItemDefinitions(): ReadonlyMap<
  string,
  ResolvedBlobbiItemDefinition
> {
  const { data } = useItemCatalog();
  const byAddress = data?.byAddress;
  return useMemo(() => accessoryDefinitionsByCode(byAddress), [byAddress]);
}
