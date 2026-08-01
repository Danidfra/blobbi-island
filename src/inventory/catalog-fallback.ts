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
  ADDRESSED_OFFICIAL_COSMETICS,
  ADDRESSED_OFFICIAL_EFFECT_ITEMS,
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
 * What an item definition actually declared about its wearable fields.
 *
 * Kept separate from the salvaged values because ABSENT and MALFORMED must lead
 * to different decisions:
 *
 * - `slot`: `declared` is the only state Island can equip. `missing` means the
 *   issuer has not said where the cosmetic goes; `malformed` means they said
 *   something unusable. Island never infers a slot from an item id or a code
 *   prefix, so both are refused — but they are refused for different reasons
 *   and the diagnostic says which.
 * - `forms`: `absent` means NO RESTRICTION — an optional field the issuer did
 *   not use. `declared` restricts the item to the listed forms. `malformed`
 *   (present but not a usable non-empty string array, including `[]`) makes the
 *   definition invalid for normal production equipping.
 */
export interface DefinitionVisualDiagnostics {
  slot: 'declared' | 'missing' | 'malformed';
  forms: 'declared' | 'absent' | 'malformed';
}

/**
 * What an issuer declared about a VISUAL-EFFECT item in `content.visual`.
 *
 * DIAGNOSTICS ONLY, never authorization. The renderer effect an item activates
 * is decided by the trusted registry keyed by full address
 * (`src/effects/official-visual-effect-items.ts`); these parsed values exist so
 * fixture tests and the dev inspector can show "expected vs published" without
 * re-reading raw content JSON. Nothing in the activation path reads them.
 */
export interface DefinitionEffectVisual {
  /** `visual.kind` — `'blobbi-effect'` marks a definition as an effect item. */
  kind: string | null;
  /** `visual.effect` — the effect id the ISSUER claims. Untrusted. */
  effect: string | null;
  /** `visual.effectSlot` — the slot the ISSUER claims. Untrusted. */
  effectSlot: string | null;
}

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
  /**
   * The wearable slot the issuer declared in `content.visual.slot`, or `null`.
   *
   * THE DEFINITION IS THE AUTHORITY ON WHERE A COSMETIC GOES. The legacy path
   * inferred a slot from an accessory code's prefix (`headwear-8` → `headwear`),
   * which only worked because the code and the artwork filename were the same
   * invented string. Items identified by address have no such prefix, so the
   * issuer states the slot and Island validates it against the slots the
   * renderer knows (`EQUIPPABLE_SLOTS`).
   *
   * `null` for every non-cosmetic item and for a cosmetic whose issuer did not
   * declare one — which is NOT equippable in normal production UI, rather than
   * equippable somewhere guessed. Island cannot safely infer placement from an
   * item id, so a missing slot is a missing answer.
   */
  slot: string | null;
  /**
   * Blobbi forms this item is valid for, from `content.visual.forms`.
   *
   * `null` means the issuer DECLARED NONE, which is no restriction at all — an
   * optional metadata field being absent must never mean "supports no form".
   * A non-empty array restricts the item to exactly those forms.
   *
   * A `forms` key that is present but unusable (not an array, empty, or an
   * array with no usable strings) also lands here as `null`, but is recorded
   * separately in {@link ResolvedBlobbiItemDefinition.visualDiagnostics} as
   * `malformed` — that case is a broken definition, not a universal one, and
   * Island refuses it for normal production equipping.
   */
  forms: readonly string[] | null;
  /**
   * What the issuer actually said about the wearable fields, as opposed to what
   * could be salvaged from it.
   *
   * Exists because "absent" and "present but unusable" must lead to different
   * decisions, and a single nullable field cannot express both. The policy
   * layer reads this; the UI and the dev inspector show it verbatim so an
   * issuer can see why their cosmetic is not offered.
   */
  visualDiagnostics: DefinitionVisualDiagnostics;
  /**
   * The human-readable `content.description`, when the definition carries one.
   *
   * Display only. Absent for bundled fallbacks (which deliberately do not
   * invent copy) and for definitions that publish none.
   */
  description?: string;
  /**
   * The published `rarity` tag, when one exists.
   *
   * Display metadata only — never identity, never authorization, never a
   * price. Present for fetched definitions that carry the tag and for the
   * bundled effect-item fallback (whose recorded rarity mirrors the published
   * events); absent everywhere else.
   */
  rarity?: string;
  /**
   * Parsed effect-visual declarations, when the definition made any.
   *
   * See {@link DefinitionEffectVisual}: diagnostics for tests and the dev
   * inspector, never an activation input. Absent when the definition declares
   * none of the three fields.
   */
  effectVisual?: DefinitionEffectVisual;
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
    // Care items are consumables, never worn. The bundled fallback says so
    // explicitly rather than leaving it to be inferred from a missing field.
    slot: null,
    forms: null,
    visualDiagnostics: { slot: 'missing', forms: 'absent' },
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
    // An item nothing is known about is not equippable anywhere.
    slot: null,
    forms: null,
    visualDiagnostics: { slot: 'missing', forms: 'absent' },
    source: 'unknown',
  };
}

/**
 * The bundled fallback for an official COSMETIC address, or `null`.
 *
 * DELIBERATELY THINNER than the consumable fallback, and the gaps are the point.
 * A cosmetic's category, rarity, description, topics and pose-specific image
 * views live in the published definition and nowhere else; if the catalog query
 * failed, this client genuinely does not know them, and inventing values here
 * would be the "second authoritative catalog" the migration exists to avoid.
 *
 * So this returns the little the registry legitimately records — name, symbol,
 * primary artwork — and states the rest honestly: `category: 'unknown'`,
 * `action: null`, no effects, no topics. `source: 'fallback'` marks it, and a
 * fetched definition replaces it wholesale the moment one arrives.
 *
 * `action: null` is load-bearing rather than cosmetic: `useUseItem` rejects a
 * null action, which is what stops a hat from entering a care flow.
 */
export function bundledCosmeticFallbackDefinition(
  address: string,
): ResolvedBlobbiItemDefinition | null {
  const entry = ADDRESSED_OFFICIAL_COSMETICS.find((e) => e.address === address);
  if (!entry) return null;
  return {
    address: entry.address,
    // A cosmetic has no legacy UI id: it is identified by its address, and
    // inventing one would resurrect the code-based identity this migration
    // removed.
    itemId: null,
    d: entry.d,
    name: entry.name,
    type: 'cosmetic',
    category: 'unknown',
    effects: {},
    action: null,
    stages: [],
    emoji: entry.symbol,
    ...(entry.primaryImage ? { image: entry.primaryImage } : {}),
    // One UNMARKED primary, exactly as a definition with a single plain
    // `["image", url]` tag parses to. Marked views never come from here.
    images: entry.primaryImage ? [{ url: entry.primaryImage }] : [],
    topics: [],
    // The bundled entry deliberately records NO slot and NO forms: both live in
    // the published definition's `content.visual`, and a second copy here would
    // be a second thing to keep in sync. A cosmetic whose definition could not
    // be fetched is therefore not equippable until it is — which is the honest
    // answer, since Island cannot know where to draw it.
    slot: null,
    forms: null,
    visualDiagnostics: { slot: 'missing', forms: 'absent' },
    source: 'fallback',
  };
}

/**
 * The bundled fallback for an official VISUAL-EFFECT item address, or `null`.
 *
 * Follows the cosmetic fallback's honesty rules: name, symbol, primary artwork
 * and rarity are the little the canonical registry legitimately records (all
 * verified against the published events), and everything else is stated as
 * unknown rather than invented. `category: 'unknown'` and `action: null` keep
 * effect items out of every care and shop flow.
 *
 * Deliberately NO `slot`, NO `forms` and NO `effectVisual` here: what an effect
 * item ACTIVATES is decided by the trusted registry in
 * `src/effects/official-visual-effect-items.ts`, not by this display fallback,
 * and duplicating those facts into a second shape would create a copy that can
 * drift. A missing fetched definition therefore costs only description text and
 * marked image views — never activation.
 */
export function bundledEffectItemFallbackDefinition(
  address: string,
): ResolvedBlobbiItemDefinition | null {
  const entry = ADDRESSED_OFFICIAL_EFFECT_ITEMS.find(
    (e) => e.address === address,
  );
  if (!entry) return null;
  return {
    address: entry.address,
    itemId: null,
    d: entry.d,
    name: entry.name,
    type: 'cosmetic',
    category: 'unknown',
    effects: {},
    action: null,
    stages: [],
    emoji: entry.symbol,
    ...(entry.primaryImage ? { image: entry.primaryImage } : {}),
    images: entry.primaryImage ? [{ url: entry.primaryImage }] : [],
    topics: [],
    slot: null,
    forms: null,
    visualDiagnostics: { slot: 'missing', forms: 'absent' },
    rarity: entry.rarity,
    source: 'fallback',
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
