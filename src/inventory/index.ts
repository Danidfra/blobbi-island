/**
 * Blobbi Island — clean inventory architecture public surface.
 *
 * Source of truth:
 * - kind:31632 (official issuer) is the canonical item catalog;
 * - kind:31633 is the canonical player inventory;
 * - `@nostr-games/inventory` owns all generic protocol logic.
 *
 * Island code below owns UI, relay orchestration, gameplay, optimistic updates,
 * shops, item effects, and interaction flows.
 */

export * from './constants';
export * from './registry';
export * from './catalog-fallback';
export * from './protocol-adapter';
export * from './shop-catalog';
export * from './useItemCatalog';
export * from './useIslandInventory';
export * from './useInventoryMutation';
export * from './useCoinsMutation';
export * from './usePurchaseItem';
export * from './useBatchPurchase';
export * from './useUseItem';

// Re-export the package surface for consumers that want it from one place.
export * as inventoryProtocol from './package';
