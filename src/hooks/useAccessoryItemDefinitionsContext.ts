/**
 * Read the shared `accessory code → item definition` map.
 *
 * Never throws when no provider is mounted — it returns the stable empty map,
 * so a Blobbi still renders (wearing legacy artwork) in a test, a preview, or
 * any screen that has not been wrapped. See
 * `src/contexts/AccessoryItemDefinitionsContext.ts`.
 */

import { useContext } from 'react';

import { AccessoryItemDefinitionsContext } from '@/contexts/AccessoryItemDefinitionsContext';
import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

export function useAccessoryItemDefinitionsContext(): ReadonlyMap<
  string,
  ResolvedBlobbiItemDefinition
> {
  return useContext(AccessoryItemDefinitionsContext);
}
