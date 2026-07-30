/**
 * The `accessory code → item definition` map, shared app-wide.
 *
 * WHY A CONTEXT RATHER THAN A HOOK PER BLOBBI. Accessory artwork selection needs
 * the item catalog, and the catalog hook needs the app config (to know which
 * relay to add) and a query client. `CurrentBlobbiDisplay` renders once per
 * Blobbi on screen — local companion, every remote actor, every card and
 * preview — so calling the catalog hook inside it would mean N subscriptions to
 * one query and, worse, would make the single most-reused visual component in
 * the app unrenderable without an `AppProvider`. Drawing a Blobbi should not
 * require knowing what relay the app is configured for.
 *
 * So the catalog is read ONCE, near the root, and the derived map is passed
 * down. The default is an EMPTY map, deliberately not a thrown error: a Blobbi
 * rendered outside the provider (a test, a storybook-style preview, an isolated
 * screen) must still draw, wearing its accessories' legacy artwork. Missing
 * definitions degrade the picture; they never break the render.
 */

import { createContext } from 'react';

import type { ResolvedBlobbiItemDefinition } from '@/inventory/catalog-fallback';

/**
 * The stable empty map used when no provider is mounted.
 *
 * Module-level so its identity never changes — a resolver memoized on it is
 * built once for the whole session instead of on every render.
 */
export const NO_ACCESSORY_ITEM_DEFINITIONS: ReadonlyMap<
  string,
  ResolvedBlobbiItemDefinition
> = new Map();

export const AccessoryItemDefinitionsContext = createContext<
  ReadonlyMap<string, ResolvedBlobbiItemDefinition>
>(NO_ACCESSORY_ITEM_DEFINITIONS);
