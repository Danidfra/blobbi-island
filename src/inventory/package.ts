/**
 * Blobbi Island — single import surface for `@nostr-games/inventory`.
 *
 * All Island code imports package symbols from here so the dependency boundary
 * is explicit and easy to audit. This file adds NO behavior — it only
 * re-exports the package's public API plus the Island-level constants that name
 * the same kinds.
 *
 * The package is the source of truth for parsing, validation, building,
 * addressing, quantities, duplicate handling, parse modes, result/error types,
 * and — since 0.2.0 — the repeatable `image` tag model with its view markers.
 * Island never re-parses an `image` tag; it selects among already-parsed
 * `GameItemImage` entries (see `item-image-resolution.ts`).
 */

export {
  // Kind constants
  KIND_GAME_ITEM_DEFINITION,
  KIND_GAME_INVENTORY,
  // Derivation marker (`a` tag index 3) for `based_on` references
  BASED_ON_MARKER,
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
  // Marker (`e` tag index 3) identifying grant/receipt references in 31633
  GRANT_MARKER,
  // Owner-wide inventory discovery filter (`authors` only → every context)
  buildGameInventoryFilter,
  // Spend / fold model (kind:1416 Game Inventory Spend, kind:1417 Fold
  // Manifest). Island is a READER of folds and a PUBLISHER of spends against
  // inventories other games own. It never builds a manifest: the fold builder
  // (`buildGameInventoryFoldEvent`, `toBuildGameInventoryFoldInput`) is
  // deliberately NOT re-exported, and `inventory-write-topology.contract.test.ts`
  // asserts no production module reaches it.
  KIND_GAME_INVENTORY_SPEND,
  KIND_GAME_INVENTORY_FOLD,
  INVENTORY_FOLD_MARKER,
  buildGameInventorySpendEvent,
  buildGameInventorySpendFilter,
  buildGameInventoryFoldFilter,
  parseGameInventorySpend,
  parseGameInventoryFold,
  resolveGameInventoryState,
  // Item images / view markers (31632 `image` tags)
  GAME_ITEM_IMAGE_MARKERS,
  isGameItemImageMarker,
  selectPrimaryGameItemImage,
  getPrimaryItemImage,
  getItemImageByMarker,
  getItemImagesByMarker,
  // Quantity helpers
  parseInventoryQuantity,
  encodeInventoryQuantity,
  getInventoryItemQuantity,
  setInventoryItemQuantity,
  addInventoryItemQuantity,
  removeInventoryItemQuantity,
  getInventoryItems,
  // Item placement (31634) — where owned items are equipped or placed.
  //
  // The package treats `content.placements` as authoritative and the `a` tags
  // as a derived index. It decides NOTHING about authorization: whether the
  // author may modify a Blobbi, whether the item is owned, whether the issuer
  // is trusted and whether a placement may render are all Island policy and
  // live in `src/placement/policy.ts`.
  KIND_GAME_ITEM_PLACEMENT,
  PLACEMENT_ITEM_MARKER,
  PLACEMENT_TARGET_MARKER,
  buildGameItemPlacementAddress,
  parseGameItemPlacementAddress,
  parseGameItemPlacement,
  parseGameItemPlacementResult,
  buildGameItemPlacementEvent,
  toBuildGameItemPlacementInput,
  validateGameItemPlacement,
  buildGameItemPlacementFilter,
  filterEventsByPlacementItemAddress,
  isPlacementItemTag,
  isPlacementTargetTag,
  getPlacementItemTags,
  getPlacementTargetTags,
  // Placement modes / guards
  GAME_ITEM_PLACEMENT_MODES,
  isGameItemPlacementMode,
  isAddressPlacementTarget,
  isInternalPlacementTarget,
  isGameItemPlacement2DReference,
  isGameItemPlacement3DReference,
  isGameItemPlacementEulerRotation,
  isGameItemPlacementQuaternionRotation,
  // Placement queries
  getPlacementItems,
  getPlacementById,
  getPlacementsByItem,
  getPlacementsBySlot,
  getFirstEquippedPlacementBySlot,
  getLastEquippedPlacementBySlot,
  // Placement mutations (immutable)
  addPlacement,
  replacePlacement,
  removePlacement,
  setEquippedPlacementForSlot,
  removeEquippedPlacementFromSlot,
  // Advisory revision comparison
  compareGameItemPlacementRevisions,
} from '@nostr-games/inventory';

export type {
  NostrEvent as PackageNostrEvent,
  UnsignedEventTemplate,
  BuildGameItemDefinitionInput,
  GameItemBasedOnReference,
  ItemDefinitionValidationIssue,
  ItemDefinitionValidationResult,
  GameItemDefinition,
  GameItemImage,
  GameItemImageMarker,
  GameItemImageMarkerValue,
  GameItemImageSource,
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
  ParseWarningCode,
  KindGameItemDefinition,
  KindGameInventory,
  // Spend / fold model (1416 / 1417)
  KindGameInventorySpend,
  GameInventorySpend,
  GameInventoryFold,
  GameInventoryFoldReference,
  GameInventoryStateResolution,
  GameInventoryDerivedState,
  GameInventoryFoldResolution,
  GameInventoryFoldProblem,
  BuildGameInventorySpendInput,
  // Item placement (31634)
  KindGameItemPlacement,
  GameItemPlacement,
  GameItemPlacementAddress,
  GameItemPlacementContent,
  GameItemPlacementEntry,
  GameItemPlacementTarget,
  GameItemPlacementAddressTarget,
  GameItemPlacementInternalTarget,
  GameItemPlacementReference,
  GameItemPlacement2DReference,
  GameItemPlacement3DReference,
  GameItemPlacementPosition,
  GameItemPlacementRotation,
  GameItemPlacementEulerRotation,
  GameItemPlacementQuaternionRotation,
  GameItemPlacementScale,
  GameItemPlacementFlip,
  GameItemPlacementMode,
  GameItemPlacementModeValue,
  GameItemPlacementItemTag,
  GameItemPlacementTargetTag,
  GameItemPlacementRevisionStatus,
  BuildGameItemPlacementInput,
  ItemPlacementValidationIssue,
  ItemPlacementValidationResult,
} from '@nostr-games/inventory';

// Island-level constants that name the same protocol.
export {
  OFFICIAL_ITEM_ISSUER_PUBKEY,
  OFFICIAL_ITEM_RELAYS,
  ISLAND_INVENTORY_D,
  ISLAND_INVENTORY_NAME,
  ISLAND_INVENTORY_ALT,
} from './constants';
