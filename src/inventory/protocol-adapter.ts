/**
 * Blobbi Island — thin protocol adapter (Phase 1).
 *
 * This module is the ONLY place that bridges the framework-free
 * `@nostr-games/inventory` package to Island concerns (view models, relay
 * hints, emoji/visual resolution). It deliberately delegates ALL protocol logic
 * (parsing, validation, addressing, quantities, duplicate handling) to the
 * package and never re-implements it.
 */

import {
  type GameItemDefinition,
  type GameInventory,
  parseGameItemDefinitionResult,
  parseGameInventoryResult,
  getInventoryItems,
} from './package';

import type { NostrEvent } from '@nostrify/nostrify';

import {
  ITEM_ACTIONS,
  ITEM_CATEGORIES,
  ITEM_STAGES,
} from '@/protocol/event-registry';

import {
  type ItemAction,
  type ItemCategory,
  type ItemStage,
  type ResolvedBlobbiItemDefinition,
  bundledFallbackDefinition,
  emojiForItemId,
  unknownItemDefinition,
} from './catalog-fallback';
import { OFFICIAL_ITEM_ISSUER_PUBKEY } from './constants';
import { addressToItemId } from './registry';

/**
 * Validation sets for the metadata a fetched definition may carry.
 *
 * All three DERIVE from the canonical registry (`src/protocol/event-registry.ts`)
 * rather than repeating literal lists here. That is what guarantees a category
 * added to the registry — `currency`, for example — is accepted by the adapter
 * instead of silently degrading a valid definition to `unknown`.
 */
const VALID_ACTIONS: ReadonlySet<string> = new Set<string>(ITEM_ACTIONS);
const VALID_STAGES: ReadonlySet<string> = new Set<string>(ITEM_STAGES);
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>(ITEM_CATEGORIES);

/**
 * Parse a kind:31632 event into a package `GameItemDefinition`, enforcing the
 * official issuer. Returns `null` for rejected events or events from an
 * unexpected issuer.
 *
 * Uses the package's structured parser (`parseGameItemDefinitionResult`).
 */
export function parseOfficialItemDefinition(
  event: NostrEvent,
): GameItemDefinition | null {
  if (event.pubkey !== OFFICIAL_ITEM_ISSUER_PUBKEY) return null;
  const result = parseGameItemDefinitionResult(event, { mode: 'permissive' });
  if (!result.ok) return null;
  // Extra guard: the parsed issuer must match (defensive; parser sets it from
  // the event pubkey).
  if (result.value.issuer !== OFFICIAL_ITEM_ISSUER_PUBKEY) return null;
  return result.value;
}

/**
 * Read structured Blobbi metadata (effects/action/stages/emoji) out of a
 * fetched definition's content JSON.
 *
 * The official published content shape is:
 *   {
 *     "effects":  { "game:blobbi": { <stat>: <number>, ... } },
 *     "metadata": { "itemId", "action", "stages", "emoji", "stackable" }
 *   }
 *
 * This reader honors that canonical shape and, for forward-compatibility, also
 * tolerates a flat shape (`effects.<stat>`, top-level `action`/`stages`/`emoji`).
 * The package exposes `contentJson` verbatim; Island decides how to interpret
 * it. Fields the definition omits are left `undefined` so callers fall back to
 * bundled values.
 */
function readEffectsFromContent(contentJson: unknown): {
  effects?: ResolvedBlobbiItemDefinition['effects'];
  action?: ItemAction;
  stages?: ItemStage[];
  emoji?: string;
} {
  if (!contentJson || typeof contentJson !== 'object') return {};
  const obj = contentJson as Record<string, unknown>;

  const out: {
    effects?: ResolvedBlobbiItemDefinition['effects'];
    action?: ItemAction;
    stages?: ItemStage[];
    emoji?: string;
  } = {};

  // Effects: prefer the canonical `effects["game:blobbi"]` bag, fall back to a
  // flat `effects` object.
  const effectsContainer =
    obj.effects && typeof obj.effects === 'object'
      ? (obj.effects as Record<string, unknown>)
      : undefined;
  const effectsBag =
    effectsContainer &&
    effectsContainer['game:blobbi'] &&
    typeof effectsContainer['game:blobbi'] === 'object'
      ? (effectsContainer['game:blobbi'] as Record<string, unknown>)
      : effectsContainer;
  if (effectsBag) {
    const effects: ResolvedBlobbiItemDefinition['effects'] = {};
    for (const key of ['hunger', 'energy', 'hygiene', 'happiness', 'health']) {
      const v = effectsBag[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        effects[key as keyof typeof effects] = v;
      }
    }
    if (Object.keys(effects).length > 0) out.effects = effects;
  }

  // Metadata: prefer the canonical `metadata` bag, fall back to top-level.
  const meta =
    obj.metadata && typeof obj.metadata === 'object'
      ? (obj.metadata as Record<string, unknown>)
      : obj;

  if (typeof meta.action === 'string' && VALID_ACTIONS.has(meta.action)) {
    out.action = meta.action as ItemAction;
  }

  if (Array.isArray(meta.stages)) {
    const stages = meta.stages.filter(
      (s): s is ItemStage => typeof s === 'string' && VALID_STAGES.has(s),
    );
    if (stages.length > 0) out.stages = stages;
  }

  if (typeof meta.emoji === 'string' && meta.emoji.length > 0) {
    out.emoji = meta.emoji;
  }

  return out;
}

/**
 * Resolve a fetched (already package-parsed) `GameItemDefinition` into the
 * Island view model, merging bundled fallback metadata for any fields the
 * on-Nostr definition does not carry.
 *
 * Visual resolution order for emoji/image:
 *   1. definition `image` tags → `images` (all of them) + `image` (the primary);
 *   2. definition JSON `emoji`;
 *   3. bundled itemId→emoji fallback;
 *   4. generic package emoji.
 *
 * Step 1 copies the package's parsed collection through UNCHANGED — same
 * entries, same order, same markers, including markers this spec version does
 * not define. Island narrows the collection per render context later
 * (`item-image-resolution.ts`); it never narrows it here, because a lossy
 * projection at the adapter would make every downstream policy impossible.
 */
export function resolveFromDefinition(
  def: GameItemDefinition,
): ResolvedBlobbiItemDefinition {
  const address = def.address;
  const itemId = addressToItemId(address);
  const bundled = bundledFallbackDefinition(address);
  const fromContent = readEffectsFromContent(def.contentJson);

  const category: ItemCategory | 'unknown' =
    def.category && VALID_CATEGORIES.has(def.category)
      ? (def.category as ItemCategory)
      : (bundled?.category ?? 'unknown');

  const emoji =
    fromContent.emoji ?? bundled?.emoji ?? emojiForItemId(itemId);

  return {
    address,
    itemId,
    d: def.id,
    name: def.name || bundled?.name || def.id,
    type: def.type || bundled?.type || 'unknown',
    category,
    effects: fromContent.effects ?? bundled?.effects ?? {},
    action: fromContent.action ?? bundled?.action ?? null,
    stages: fromContent.stages ?? bundled?.stages ?? ['egg', 'baby', 'adult'],
    emoji,
    // `def.image` IS the package's primary selection over `def.images`, so the
    // flattened field and the collection can never disagree.
    image: def.image,
    images: def.images,
    topics: def.topics.length > 0 ? def.topics : (bundled?.topics ?? []),
    source: 'definition',
  };
}

/**
 * Full resolution order (Phase 3):
 *   1. valid fetched 31632 (passed in `definitions` by address);
 *   2. bundled canonical fallback by address;
 *   3. generic unknown-item model.
 */
export function resolveItemDefinition(
  address: string,
  definitions: ReadonlyMap<string, GameItemDefinition>,
  dHint?: string,
): ResolvedBlobbiItemDefinition {
  const fetched = definitions.get(address);
  if (fetched) return resolveFromDefinition(fetched);
  const bundled = bundledFallbackDefinition(address);
  if (bundled) return bundled;
  return unknownItemDefinition(address, dHint);
}

/**
 * Parse a kind:31633 event into a package `GameInventory`, using the package's
 * recommended default duplicate strategy (`last`, via permissive mode). Returns
 * `null` for rejected events.
 */
export function parseInventoryEvent(event: NostrEvent): GameInventory | null {
  const result = parseGameInventoryResult(event, { mode: 'permissive' });
  return result.ok ? result.value : null;
}

/** Re-export the package's item-list accessor for convenience. */
export { getInventoryItems };
