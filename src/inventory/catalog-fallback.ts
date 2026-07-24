/**
 * Blobbi Island — Resolved item-definition model and bundled fallback catalog
 * (Phase 3).
 *
 * A `ResolvedBlobbiItemDefinition` is the Island view model for an item. It is
 * produced by resolving, in order:
 *   1. a valid fetched kind:31632 `GameItemDefinition` from the official issuer;
 *   2. the bundled canonical fallback (below), keyed by address;
 *   3. a generic "unknown item" model.
 *
 * The bundled fallback uses the EXACT currently-published metadata (effects,
 * action, stages, emoji, category, topics). It exists so the game remains
 * playable when relays are unavailable and so the app never blocks on a fetch.
 * It is not a re-implementation of the protocol — parsing/validation of fetched
 * definitions is done by `@nostr-games/inventory`.
 */

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { OFFICIAL_ITEM_REGISTRY } from './registry';

/** Blobbi stat effects an item applies when used. */
export interface ItemEffects {
  hunger?: number;
  energy?: number;
  hygiene?: number;
  happiness?: number;
  health?: number;
}

/** The gameplay action an item triggers. */
export type ItemAction = 'feed' | 'play' | 'medicine' | 'clean' | 'boost';

/** Blobbi lifecycle stages an item may be used on. */
export type ItemStage = 'egg' | 'baby' | 'adult';

/** High-level item type/category used by UI grouping. */
export type ItemCategory = 'food' | 'toy' | 'medicine' | 'hygiene' | 'energy';

/**
 * Island view model for an item definition. `source` records where the
 * metadata came from so the UI/tests can reason about fallback behavior.
 */
export interface ResolvedBlobbiItemDefinition {
  /** Full canonical kind:31632 address. */
  address: string;
  /** Legacy/UI id, or `null` for unknown items. */
  itemId: string | null;
  /** The definition `d` tag. */
  d: string;
  /** Human-readable name. */
  name: string;
  /** Item `type` tag value (from definition), best-effort. */
  type: string;
  /** UI category. */
  category: ItemCategory | 'unknown';
  /** Stat effects applied on use. */
  effects: ItemEffects;
  /** Gameplay action, or `null` for unknown items. */
  action: ItemAction | null;
  /** Allowed Blobbi stages. */
  stages: ItemStage[];
  /** Emoji fallback (used when no image is present). */
  emoji: string;
  /** Optional image URL (from a future definition `image` tag). */
  image?: string;
  /** `t` topic tags. */
  topics: string[];
  /** Where this resolution came from. */
  source: 'definition' | 'fallback' | 'unknown';
}

/**
 * Canonical fallback metadata, keyed by `d` tag. Values MUST match the
 * currently-published kind:31632 definitions exactly.
 */
interface FallbackMeta {
  name: string;
  type: string;
  category: ItemCategory;
  effects: ItemEffects;
  action: ItemAction;
  stages: ItemStage[];
  emoji: string;
  topics: string[];
}

const FALLBACK_BY_D: Record<string, FallbackMeta> = {
  // --- Food (action: feed; stages: baby, adult) ---
  'blobbi:food:apple': {
    name: 'Apple',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 25, hygiene: -2, energy: 5 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🍎',
    topics: ['edible', 'food'],
  },
  'blobbi:food:burger': {
    name: 'Burger',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 45, happiness: 10, hygiene: -8, energy: 8 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🍔',
    topics: ['edible', 'food'],
  },
  'blobbi:food:cake': {
    name: 'Cake',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 25, happiness: 30, hygiene: -10, energy: 10 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🎂',
    topics: ['edible', 'food'],
  },
  'blobbi:food:pizza': {
    name: 'Pizza',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 40, happiness: 15, hygiene: -9, energy: 10 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🍕',
    topics: ['edible', 'food'],
  },
  'blobbi:food:sushi': {
    name: 'Sushi',
    type: 'consumable',
    category: 'food',
    effects: { hunger: 35, health: 10, hygiene: -5, energy: 7 },
    action: 'feed',
    stages: ['baby', 'adult'],
    emoji: '🍣',
    topics: ['edible', 'food'],
  },

  // --- Toys (action: play; stages: baby, adult) ---
  'blobbi:toy:ball': {
    name: 'Ball',
    type: 'consumable',
    category: 'toy',
    effects: { happiness: 25, energy: -10, hygiene: -5 },
    action: 'play',
    stages: ['baby', 'adult'],
    emoji: '⚽',
    topics: ['toy', 'playable'],
  },
  'blobbi:toy:teddy': {
    name: 'Teddy Bear',
    type: 'consumable',
    category: 'toy',
    effects: { happiness: 45, energy: -5 },
    action: 'play',
    stages: ['baby', 'adult'],
    emoji: '🧸',
    topics: ['toy', 'playable'],
  },
  'blobbi:toy:blocks': {
    name: 'Building Blocks',
    type: 'consumable',
    category: 'toy',
    effects: { happiness: 30, energy: -10 },
    action: 'play',
    stages: ['baby', 'adult'],
    emoji: '🧱',
    topics: ['toy', 'playable'],
  },

  // --- Medicine ---
  'blobbi:medicine:vitamins': {
    name: 'Vitamins',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 25, energy: 5 },
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    emoji: '💊',
    topics: ['medicine', 'healing'],
  },
  'blobbi:medicine:super': {
    name: 'Super Medicine',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 50, energy: 20, happiness: -10 },
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    emoji: '💉',
    topics: ['medicine', 'healing'],
  },
  'blobbi:medicine:bandage': {
    name: 'Bandage',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 25 },
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🩹',
    topics: ['medicine', 'healing'],
  },
  'blobbi:medicine:health-elixir': {
    name: 'Health Elixir',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 75, happiness: 20, energy: 10 },
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🧪',
    topics: ['medicine', 'healing'],
  },
  'blobbi:medicine:shell-repair-kit': {
    name: 'Shell Repair Kit',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 30 },
    action: 'medicine',
    // Egg-only per published definition.
    stages: ['egg'],
    emoji: '🥚',
    topics: ['medicine', 'healing', 'egg'],
  },
  'blobbi:medicine:calcium': {
    name: 'Calcium Supplement',
    type: 'consumable',
    category: 'medicine',
    effects: { health: 35 },
    action: 'medicine',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🦴',
    topics: ['medicine', 'healing'],
  },

  // --- Hygiene (action: clean; stages: egg, baby, adult) ---
  'blobbi:hygiene:soap': {
    name: 'Soap',
    type: 'consumable',
    category: 'hygiene',
    effects: { hygiene: 25 },
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🧼',
    topics: ['hygiene', 'cleaning'],
  },
  'blobbi:hygiene:shampoo': {
    name: 'Shampoo',
    type: 'consumable',
    category: 'hygiene',
    effects: { hygiene: 50, happiness: 10 },
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🧴',
    topics: ['hygiene', 'cleaning'],
  },
  'blobbi:hygiene:bubble-bath': {
    name: 'Bubble Bath',
    type: 'consumable',
    category: 'hygiene',
    effects: { hygiene: 70, happiness: 25 },
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🛁',
    topics: ['hygiene', 'cleaning'],
  },
  'blobbi:hygiene:soft-towel': {
    name: 'Soft Towel',
    type: 'consumable',
    category: 'hygiene',
    effects: { hygiene: 25, happiness: 5 },
    action: 'clean',
    stages: ['egg', 'baby', 'adult'],
    emoji: '🏖️',
    topics: ['hygiene', 'cleaning'],
  },

  // --- Energy (action: boost; stages: baby, adult) ---
  'blobbi:energy:drink': {
    name: 'Energy Drink',
    type: 'consumable',
    category: 'energy',
    effects: { energy: 35, happiness: 5 },
    action: 'boost',
    stages: ['baby', 'adult'],
    emoji: '🧃',
    topics: ['energy', 'boost'],
  },
};

/**
 * itemId → emoji fallback map (visual resolution order step 3), derived from
 * the same bundled metadata.
 */
const EMOJI_BY_ITEM_ID: Record<string, string> = Object.fromEntries(
  OFFICIAL_ITEM_REGISTRY.map((entry) => [
    entry.itemId,
    FALLBACK_BY_D[entry.d]?.emoji ?? '📦',
  ]),
);

/** Generic package-style emoji for unknown items. */
export const GENERIC_ITEM_EMOJI = '📦';

/** Resolve an emoji by itemId (or generic fallback). */
export function emojiForItemId(itemId: string | null | undefined): string {
  if (!itemId) return GENERIC_ITEM_EMOJI;
  return EMOJI_BY_ITEM_ID[itemId] ?? GENERIC_ITEM_EMOJI;
}

/**
 * Build the bundled fallback resolved definition for a given official address,
 * or `null` if the address is not an official Blobbi item.
 */
export function bundledFallbackDefinition(
  address: string,
): ResolvedBlobbiItemDefinition | null {
  const entry = OFFICIAL_ITEM_REGISTRY.find((e) => e.address === address);
  if (!entry) return null;
  const meta = FALLBACK_BY_D[entry.d];
  if (!meta) return null;
  return {
    address: entry.address,
    itemId: entry.itemId,
    d: entry.d,
    name: meta.name,
    type: meta.type,
    category: meta.category,
    effects: meta.effects,
    action: meta.action,
    stages: meta.stages,
    emoji: meta.emoji,
    topics: meta.topics,
    source: 'fallback',
  };
}

/**
 * Generic unknown-item model for an arbitrary address. Uses whatever we can
 * parse out of the address (`d`) and a generic emoji.
 */
export function unknownItemDefinition(
  address: string,
  d?: string,
): ResolvedBlobbiItemDefinition {
  return {
    address,
    itemId: null,
    d: d ?? '',
    name: d ?? 'Unknown Item',
    type: 'unknown',
    category: 'unknown',
    effects: {},
    action: null,
    stages: ['egg', 'baby', 'adult'],
    emoji: GENERIC_ITEM_EMOJI,
    topics: [],
    source: 'unknown',
  };
}

/** The full bundled fallback catalog as resolved definitions. */
export function bundledFallbackCatalog(): ResolvedBlobbiItemDefinition[] {
  return OFFICIAL_ITEM_REGISTRY.map(
    (entry) => bundledFallbackDefinition(entry.address)!,
  );
}

/** Re-export for consumers that want the issuer without importing constants. */
export { OFFICIAL_ITEM_ISSUER_PUBKEY };
