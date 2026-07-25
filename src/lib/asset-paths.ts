/**
 * Single source of truth for **computed** public asset paths.
 *
 * Rule of thumb:
 *  - A sprite used in exactly one place may stay an inline literal (`src="/assets/..."`).
 *  - Any path built at runtime from data (an accessory code, a `LocationId`, an item id,
 *    a minigame drop table, ...) MUST be produced here, so that moving a folder is a
 *    one-line change instead of a repo-wide search.
 *
 * See `docs/asset-organization.md` for the full directory layout and conventions.
 */

import type { AccessorySlot } from '@/components/blobbi/lib/accessory-types';

/** Root directories of every asset domain. Keep in sync with docs/asset-organization.md. */
export const ASSET_DIRS = {
  /** Per-`LocationId` full-screen backgrounds. */
  worldBackgrounds: '/assets/world/backgrounds',
  /** Island map and travel miniatures. */
  worldMap: '/assets/world/map',
  /** Exterior building shells and their entrance overlays. */
  worldBuildings: '/assets/world/buildings',
  /** Reusable, location-agnostic scenery. */
  worldProps: '/assets/world/props',
  /** Assets unique to a single place: `/assets/locations/<place>/...`. */
  locations: '/assets/locations',
  /** Wearable accessory sprites, keyed by accessory code. */
  blobbiAccessories: '/assets/characters/blobbi/accessories',
  /** Selectable Blobbi portrait backdrops, keyed by background id. */
  blobbiBackgrounds: '/assets/characters/blobbi/backgrounds',
  /** Inventory item icons. */
  items: '/assets/items',
  /** Minigame-only sprites: `/assets/minigames/<game>/...`. */
  minigames: '/assets/minigames',
  /** UI-layer artwork (branding, cursors, icons). */
  ui: '/assets/ui',
} as const;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/**
 * Full-screen background for a location.
 * `file` comes from `LOCATION_BACKGROUNDS` in `@/lib/location-backgrounds`, which is the
 * authoritative `LocationId -> filename` table.
 */
export function locationBackgroundPath(file: string): string {
  return `${ASSET_DIRS.worldBackgrounds}/${file}`;
}

// ---------------------------------------------------------------------------
// Characters / Blobbi
// ---------------------------------------------------------------------------

/**
 * Sprite for a wearable accessory. Filenames mirror the accessory `code` published in
 * Nostr inventory/equipment tags, so they must never be renamed.
 */
export function accessoryImagePath(
  slot: AccessorySlot | string,
  code: string,
  ext: 'png' | 'webp' = 'png',
): string {
  return `${ASSET_DIRS.blobbiAccessories}/${slot}/${code}.${ext}`;
}

// ---------------------------------------------------------------------------
// Minigames
// ---------------------------------------------------------------------------

/**
 * Sprite for a mining minigame drop. `file` is a `GEM_VALUES` key (e.g. `gem-1.png`),
 * so these filenames are data identifiers and must not be renamed.
 */
export function miningItemPath(file: string): string {
  return `${ASSET_DIRS.minigames}/mining/${file}`;
}
