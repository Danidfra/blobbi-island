/**
 * Reads the item catalog ONCE and publishes the accessory slice of it.
 *
 * Mounted near the app root, inside the providers the catalog query needs
 * (`AppProvider` for the configured relay, `QueryClientProvider` for the query
 * itself). Everything below it — every `CurrentBlobbiDisplay` on screen —
 * consumes a plain map and needs neither.
 *
 * See `src/contexts/AccessoryItemDefinitionsContext.ts` for why this is a
 * context and not a hook called per Blobbi, and
 * `src/inventory/accessory-item-identity.ts` for why the map is empty today.
 */

import type { ReactNode } from 'react';

import { AccessoryItemDefinitionsContext } from '@/contexts/AccessoryItemDefinitionsContext';
import { useAccessoryItemDefinitions } from '@/inventory/useAccessoryItemDefinitions';

export function AccessoryItemDefinitionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const definitions = useAccessoryItemDefinitions();

  return (
    <AccessoryItemDefinitionsContext.Provider value={definitions}>
      {children}
    </AccessoryItemDefinitionsContext.Provider>
  );
}
