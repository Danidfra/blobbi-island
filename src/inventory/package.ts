/**
 * Blobbi Island — single import surface for `@nostr-games/inventory`.
 *
 * All Island code imports package symbols from here so the dependency boundary
 * is explicit and easy to audit. This file adds NO behavior — it only
 * re-exports the package's public API plus the Island-level constants that name
 * the same kinds.
 *
 * The package is the source of truth for parsing, validation, building,
 * addressing, quantities, duplicate handling, parse modes, and result/error
 * types.
 */

export {
  // Kind constants
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_INVENTORY,
  // Address helpers
  buildGameItemAddress,
  parseGameItemAddress,
  buildGameInventoryAddress,
  parseGameInventoryAddress,
  buildAddressableEventAddress,
  parseAddressableEventAddress,
  getDTag,
  getTagValue,
  getTagValues,
  // Item definition (31632)
  parseGameItemDefinition,
  parseGameItemDefinitionResult,
  buildGameItemDefinitionEvent,
  validateGameItemDefinition,
  // Inventory (31633)
  parseGameInventory,
  parseGameInventoryResult,
  buildGameInventoryEvent,
  validateGameInventory,
  // Quantity helpers
  parseInventoryQuantity,
  encodeInventoryQuantity,
  getInventoryItemQuantity,
  setInventoryItemQuantity,
  addInventoryItemQuantity,
  removeInventoryItemQuantity,
  getInventoryItems,
} from '@nostr-games/inventory';

export type {
  NostrEvent as PackageNostrEvent,
  UnsignedEventTemplate,
  GameItemDefinition,
  GameInventory,
  GameInventoryItem,
  GameItemAddress,
  GameInventoryAddress,
  BuildGameInventoryInput,
  BuildGameInventoryItemInput,
  DuplicateStrategy,
  ParseMode,
  ParseResult,
  ParseWarning,
  KindGameItemDefinition,
  KindGameInventory,
} from '@nostr-games/inventory';

// Island-level constants that name the same protocol.
export {
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  OFFICIAL_ITEM_RELAYS,
  ISLAND_INVENTORY_D,
  ISLAND_INVENTORY_NAME,
  ISLAND_INVENTORY_ALT,
} from './constants';
