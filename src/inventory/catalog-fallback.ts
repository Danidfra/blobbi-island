/**
 * Blobbi Island — Resolved item-definition model and bundled fallback catalog.
 *
 * A `ResolvedBlobbiItemDefinition` is the Island view model for an item. It is
 * produced by resolving, in order:
 *   1. a valid fetched kind:31632 `GameItemDefinition` from the official issuer;
 *   2. the bundled canonical fallback (below), keyed by address;
 *   3. a generic "unknown item" model.
 *
 * The bundled fallback is now a PROJECTION of the canonical registry
 * (`src/protocol/event-registry.ts`) rather than a second hand-maintained copy
 * of the same metadata. It exists so the game remains playable when relays are
 * unavailable and so the app never blocks on a fetch. It is not a
 * re-implementation of the protocol — parsing/validation of fetched definitions
 * is done by `@nostr-games/inventory`.
 *
 * For `active` items the fallback mirrors the currently-published kind:31632
 * events exactly. For `reserved` items (identity claimed, official event not
 * published yet — e.g. the Arcade Ticket) the fallback is what the definition
 * WILL say, so the client renders the item correctly today and switches to the
 * published definition automatically the moment it exists.
 */

import {
  ADDRESSED_OFFICIAL_ITEMS,
  type ItemActionName,
  type ItemCategoryName,
  type ItemEffectsShape,
  type ItemStageName,
} from '@/protocol/event-registry';

import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import type { GameItemImage } from './package';
import { OFFICIAL_ITEM_REGISTRY } from './registry';

/**
 * Blobbi stat effects an item applies when used.
 *
 * Re-exported from the canonical registry so there is one shape, not two.
 */
export type ItemEffects = ItemEffectsShape;

/** The gameplay action an item triggers. */
export type ItemAction = ItemActionName;

/** Blobbi lifecycle stages an item may be used on. */
export type ItemStage = ItemStageName;

/**
 * High-level item type/category used by UI grouping.
 *
 * Includes `currency`, which is NOT a care category: currency items have
 * `action: null`, no stat effects, and are never offered as consumables.
 */
export type ItemCategory = ItemCategoryName;

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
  /**
   * Gameplay action, or `null` for items that cannot be used on a Blobbi
   * (unknown items and currency). `useUseItem` rejects a null action, which is
   * what keeps currency out of every care flow.
   */
  action: ItemAction | null;
  /** Allowed Blobbi stages. */
  stages: ItemStage[];
  /** Emoji fallback (used when no image is present). */
  emoji: string;
  /**
   * The item's primary/default image URL, or `undefined`.
   *
   * Retained as a flattened convenience field so every pre-existing consumer
   * keeps compiling and rendering exactly what it rendered before. It is the
   * SAME answer `@nostr-games/inventory` computes for `GameItemDefinition.image`
   * (first unmarked `image` tag, falling back to the first valid one), never a
   * second opinion. New code should call `primaryItemImageUrl()` instead, which
   * reads {@link images} and treats this as its legacy fallback.
   */
  image?: string;
  /**
   * EVERY valid `image` tag of the definition, in tag order, with markers.
   *
   * Kept as the package's own ordered collection rather than a marker→url map:
   * a map would silently lose source order, duplicate markers, a second unmarked
   * primary, and any marker a future spec version adds — all of which are things
   * an issuer can legitimately publish and which the Island must be able to
   * inspect. Empty for fallback/unknown items with no artwork.
   */
  images: readonly GameItemImage[];
  /** `t` topic tags. */
  topics: string[];
  /** Where this resolution came from. */
  source: 'definition' | 'fallback' | 'unknown';
}

/**
 * Canonical fallback metadata, keyed by `d` tag, derived from the single
 * canonical registry. For `active` items the values MUST match the
 * currently-published kind:31632 definitions exactly; the registry is where
 * that guarantee is maintained and tested.
 */
interface FallbackMeta {
  name: string;
  type: string;
  category: ItemCategory;
  effects: ItemEffects;
  /** `null` for items with no gameplay action (currency). */
  action: ItemAction | null;
  stages: ItemStage[];
  emoji: string;
  /** Official artwork URL, when one exists. */
  image?: string;
  topics: string[];
}

const FALLBACK_BY_D: Record<string, FallbackMeta> = Object.fromEntries(
  ADDRESSED_OFFICIAL_ITEMS.map((item) => [
    item.d,
    {
      name: item.name,
      type: item.type,
      category: item.category,
      effects: { ...item.effects },
      action: item.action,
      stages: [...item.stages],
      emoji: item.emoji,
      ...(item.image ? { image: item.image } : {}),
      topics: [...item.topics],
    } satisfies FallbackMeta,
  ]),
);

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
    ...(meta.image ? { image: meta.image } : {}),
    // The bundled catalog knows exactly one artwork URL per item and no view
    // markers, so its collection is a single UNMARKED primary — the same thing
    // a definition with one plain `["image", url]` tag parses to. Pose-specific
    // views only ever come from a fetched definition.
    images: meta.image ? [{ url: meta.image }] : [],
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
    images: [],
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
