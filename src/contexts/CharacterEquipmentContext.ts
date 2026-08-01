/**
 * The local player's current companion equipment (kind:31634), shared app-wide.
 *
 * WHY A CONTEXT RATHER THAN A HOOK PER BLOBBI — the same reason
 * `AccessoryItemDefinitionsContext` exists, and one more.
 *
 * Resolving what a Blobbi is wearing now needs THREE queries — the placement
 * document (31634), the inventory that proves ownership (31633) and the catalog
 * that supplies artwork (31632). `CurrentBlobbiDisplay` renders once per Blobbi
 * on screen — the companion, every remote actor, every card and preview — so
 * calling those hooks inside it would mean 3N subscriptions and would make the
 * most-reused visual component in the app unrenderable without an `AppProvider`
 * and a query client. Drawing a Blobbi must not require a relay.
 *
 * So equipment is resolved ONCE, near the root, and the renderer-ready result
 * is passed down. The default is EMPTY equipment, deliberately not a thrown
 * error: a Blobbi rendered outside the provider (a test, an isolated screen)
 * still draws — bare. Under the clean 31632/31633/31634 architecture "wearing
 * nothing" is the honest answer when nothing can be resolved, because there is
 * no filename convention left to guess artwork from.
 */

import { createContext } from 'react';

import type { CharacterEquipment } from '@/placement/useCharacterEquipment';

/**
 * The stable empty equipment used when no provider is mounted.
 *
 * Module-level so its identity never changes — a resolver memoized on it is
 * built once for the whole session instead of on every render.
 */
export const NO_CHARACTER_EQUIPMENT: CharacterEquipment = {
  accessories: [],
  effects: [],
  activeEffects: [],
  rejectedEffects: [],
  definitionsByAddress: new Map(),
  hidden: [],
  warnings: [],
  isLoading: false,
  isEmpty: true,
};

export const CharacterEquipmentContext = createContext<CharacterEquipment>(
  NO_CHARACTER_EQUIPMENT,
);
